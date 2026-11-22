import assert from 'node:assert/strict';
import test from 'node:test';
import { Game, serverError, setup, start } from './game-mock.mjs';

const CONNECT_FAIL = '서버에 연결할 수 없습니다';

const stored = (values, key) => JSON.parse(values.get(`nkordle:${key}`));

test('시도를 모두 쓴 판에서 reveal이 실패하면 토스트로 알리고 busy를 풀며 패배·통계는 저장되고 정답은 비어 있다', async (t) => {
	const { values } = setup(t, { '/api/reveal': serverError });
	const game = await start();
	for (let i = 0; i < game.maxTries; i++) {
		game.current = 'ㄱ'.repeat(game.n);
		await game.submit();
	}
	assert.equal(game.status, 'lost');
	assert.equal(game.toast, CONNECT_FAIL);
	assert.equal(game.busy, false);
	assert.equal(game.answer, null);
	assert.deepEqual(game.stats, { played: 1, won: 0, streak: 0, maxStreak: 0, dist: [] });
	assert.deepEqual(stored(values, 'stats:endless'), game.stats);
});

test('포기 중 reveal이 실패해도 busy는 풀리고 예외 없이 토스트로 알리며 통계는 저장된다', async (t) => {
	const { values } = setup(t, { '/api/reveal': serverError });
	const game = await start();
	await game.giveUp();
	assert.equal(game.busy, false);
	assert.equal(game.status, 'lost');
	assert.equal(game.toast, CONNECT_FAIL);
	assert.equal(game.answer, null);
	assert.deepEqual(stored(values, 'stats:endless'), { played: 1, won: 0, streak: 0, maxStreak: 0, dist: [] });
});

test('패배 통계는 reveal 응답을 기다리는 동안 이미 저장되어 있다', async (t) => {
	let release;
	const { values } = setup(t, { '/api/reveal': () => new Promise((r) => (release = () => r(Response.json({ word: '정답' })))) });
	const game = await start();
	const pending = game.giveUp();
	await new Promise((r) => setImmediate(r));
	assert.equal(game.status, 'lost');
	assert.equal(game.answer, null);
	assert.equal(stored(values, 'stats:endless').played, 1);
	release();
	await pending;
	assert.equal(game.answer, '정답');
	assert.equal(game.toast, '정답: 정답');
});

// 일일 판 하나를 시도 소진으로 지게 만든다. 응답 속도를 정하려고 reveal 핸들러는 호출부가 준다.
async function loseDaily(t, extra) {
	const env = setup(t, extra);
	const game = new Game();
	game.config = { mode: 'daily', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	for (let i = 0; i < game.maxTries; i++) {
		game.current = 'ㄱ'.repeat(game.n);
		await game.submit();
	}
	return { ...env, game, key: `daily:${game.dailyDay}:${game.token}` };
}

async function reopen(config) {
	const game = new Game();
	game.config = config;
	await game.newGame();
	return game;
}

test('일일: 시도 소진 뒤 reveal이 실패해도 lost·answer null로 저장되고, 다시 열면 reveal을 다시 요청해 정답을 채워 저장한다', async (t) => {
	const reveal = { fail: true };
	const { values, calls, game, key } = await loseDaily(t, {
		'/api/reveal': () => (reveal.fail ? serverError() : Response.json({ word: '정답' }))
	});
	assert.equal(game.status, 'lost');
	assert.equal(stored(values, key).status, 'lost');
	assert.equal(stored(values, key).answer, null);
	assert.equal(stored(values, 'stats:daily').played, 1);

	reveal.fail = false;
	const again = await reopen(game.config);
	assert.equal(again.status, 'lost');
	await new Promise((r) => setImmediate(r));
	assert.equal(calls.filter((c) => c.url === '/api/reveal').length, 2);
	assert.equal(again.answer, '정답');
	assert.equal(stored(values, key).answer, '정답');
	assert.equal(stored(values, 'stats:daily').played, 1);
});

test('일일: 복원 때 reveal도 실패하면 토스트를 띄우고 answer는 null, 상태는 lost로 남는다', async (t) => {
	const { game } = await loseDaily(t, { '/api/reveal': serverError });
	const again = await reopen(game.config);
	await new Promise((r) => setImmediate(r));
	assert.equal(again.status, 'lost');
	assert.equal(again.answer, null);
	assert.equal(again.toast, CONNECT_FAIL);
});

test('정답이 이미 저장된 진 판을 복원할 때는 reveal을 다시 요청하지 않는다', async (t) => {
	const { game, calls } = await loseDaily(t);
	const before = calls.filter((c) => c.url === '/api/reveal').length;
	const again = await reopen(game.config);
	await new Promise((r) => setImmediate(r));
	assert.equal(again.answer, '정답');
	assert.equal(calls.filter((c) => c.url === '/api/reveal').length, before);
});

test('복원 reveal이 걸려 있는 동안 새 판이 열리면 늦게 온 응답은 새 판에 들어가지 않는다', async (t) => {
	const reveal = { hold: false, held: false, release: () => {} };
	const { values, game, key } = await loseDaily(t, {
		'/api/game': (body) => Response.json({ n: 6, token: body.mode === 'daily' ? 'tok' : 'tok2' }),
		'/api/reveal': () => {
			if (!reveal.hold || reveal.held) return serverError();
			reveal.held = true;
			return new Promise((r) => (reveal.release = () => r(Response.json({ word: '늦은정답' }))));
		}
	});
	assert.equal(game.answer, null);

	reveal.hold = true;
	const again = await reopen(game.config);
	assert.equal(again.status, 'lost');
	again.setConfig({ mode: 'endless', length: { kind: 'fixed', n: 6 } });
	await new Promise((r) => setImmediate(r));
	assert.equal(again.status, 'playing');
	assert.equal(again.token, 'tok2');

	// 새 판도 정답 없이 진 판이 되면 상태 조건만으로는 늦은 응답을 못 막는다. 토큰이 달라야 막힌다.
	await again.giveUp();
	assert.equal(again.status, 'lost');
	assert.equal(again.answer, null);

	reveal.release();
	await new Promise((r) => setImmediate(r));
	assert.equal(again.answer, null);
	assert.equal(stored(values, key).answer, null);
});

test('일일 등반: 포기 뒤 reveal이 실패해도 dclimb 저장본이 남아 새로고침하면 끝난 상태로 이어진다', async (t) => {
	const { values } = setup(t, { '/api/reveal': serverError });
	const config = { mode: 'daily-climb', length: { kind: 'fixed', n: 5 } };
	const game = await reopen(config);
	await game.giveUp();
	assert.equal(game.status, 'lost');
	assert.equal(game.answer, null);
	assert.equal(game.toast, CONNECT_FAIL);
	const dclimb = stored(values, `dclimb:${game.dailyDay}`);
	assert.equal(dclimb.stage, 1);
	assert.equal(dclimb.stageStartAt, null);
	assert.equal(typeof dclimb.lostMs, 'number');
	assert.equal(stored(values, `daily:${game.dailyDay}:${game.token}`).status, 'lost');

	const again = await reopen(config);
	assert.equal(again.status, 'lost');
	assert.equal(again.stage, 1);
	assert.equal(again.lostMs, dclimb.lostMs);
});

test('첫 판을 받아 오지 못하면 예외를 던지지 않고 토스트 없이 불러오기 실패로 남는다', async (t) => {
	setup(t, { '/api/game': serverError });
	const game = new Game();
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	assert.equal(game.toast, null);
	assert.equal(game.status, 'loading');
	assert.equal(game.loadFailed, true);
});

// 다음 판 요청만 실패시킬 수 있는 가짜 서버. 판마다 토큰이 달라야 일일 저장본이 섞이지 않는다.
function rounds(t, extra = {}) {
	const state = { fail: false, issued: 0 };
	const env = setup(t, {
		'/api/game': (body) => {
			if (state.fail) return serverError();
			state.issued += 1;
			return Response.json({ n: body.n ?? 6, token: `tok${state.issued}` });
		},
		'/api/guess': (body) => Response.json({ ok: true, marks: Array(body.jamo.length).fill('c'), word: '정답' }),
		...extra
	});
	return { ...env, state, gameCalls: () => env.calls.filter((c) => c.url === '/api/game').length };
}

async function clear(game) {
	game.current = 'ㄱ'.repeat(game.n);
	await game.submit();
}

const snapshot = (game, values) =>
	JSON.stringify({
		rows: game.rows, marks: game.marks, status: game.status, answer: game.answer, token: game.token, n: game.n,
		stage: game.stage, climbWords: game.climbWords, stageTimes: game.stageTimes, lostMs: game.lostMs,
		stageBests: game.stageBests, runBest: game.runBest, bestStage: game.bestStage, stats: game.stats,
		stored: [...values.entries()]
	});

const CLIMB_CASES = [
	['climb-streak', { kind: 'fixed', n: 6 }, 6],
	['climb-length', { kind: 'fixed', n: 6 }, 7],
	['daily-climb', { kind: 'fixed', n: 6 }, 6]
];
for (const [mode, length, nextN] of CLIMB_CASES) {
	test(`${mode}: 다음 스테이지 요청이 실패하면 클리어한 판·스테이지·시간·저장본이 그대로이고 토스트가 뜨며, 다시 부르면 넘어간다`, async (t) => {
		const { state, values, gameCalls } = rounds(t);
		const game = new Game();
		game.config = { mode, length };
		await game.newGame();
		await clear(game);
		assert.equal(game.status, 'won');
		const before = snapshot(game, values);
		const firstN = game.n;

		state.fail = true;
		await game.nextStage();
		assert.equal(game.toast, CONNECT_FAIL);
		assert.equal(game.loadFailed, false);
		assert.equal(game.busy, false);
		assert.equal(snapshot(game, values), before);

		state.fail = false;
		await game.nextStage();
		assert.equal(game.status, 'playing');
		assert.equal(game.stage, 2);
		assert.equal(game.n, mode === 'climb-length' || mode === 'daily-climb' ? firstN + 1 : nextN);
		assert.deepEqual(game.rows, []);
		assert.equal(gameCalls(), 3);
		if (mode === 'daily-climb') assert.equal(JSON.parse(values.get(`nkordle:dclimb:${game.dailyDay}`)).stage, 2);
	});
}

test('endless: 다음 단어 요청이 실패하면 끝난 판이 그대로이고 토스트가 뜨며, 다시 부르면 새 판이 열린다', async (t) => {
	const { state, values } = rounds(t);
	const game = new Game();
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	await clear(game);
	const before = snapshot(game, values);

	state.fail = true;
	await game.newGame();
	assert.equal(game.toast, CONNECT_FAIL);
	assert.equal(game.loadFailed, false);
	assert.equal(snapshot(game, values), before);

	state.fail = false;
	await game.newGame();
	assert.equal(game.status, 'playing');
	assert.deepEqual(game.rows, []);
});

test('climb-streak: 실패로 끝난 판에서 처음부터 요청이 실패하면 스테이지·소요 시간·정답·통계가 그대로다', async (t) => {
	const { state, values } = rounds(t, { '/api/reveal': () => Response.json({ word: '정답' }) });
	const game = new Game();
	game.config = { mode: 'climb-streak', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	await clear(game);
	await game.nextStage();
	await game.giveUp();
	assert.equal(game.status, 'lost');
	assert.equal(game.stage, 2);
	const before = snapshot(game, values);

	state.fail = true;
	await game.newGame();
	assert.equal(game.toast, CONNECT_FAIL);
	assert.equal(snapshot(game, values), before);

	state.fail = false;
	await game.newGame();
	assert.equal(game.status, 'playing');
	assert.equal(game.stage, 1);
	assert.deepEqual(game.climbWords, []);
});

test('요청이 오가는 동안 다음 판 버튼을 다시 눌러도 요청은 한 번만 나간다', async (t) => {
	const { gameCalls } = rounds(t);
	const game = new Game();
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	await clear(game);
	const sent = gameCalls();
	await Promise.all([game.newGame(), game.newGame()]);
	assert.equal(gameCalls(), sent + 1);

	game.config = { mode: 'climb-streak', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	await clear(game);
	const climb = gameCalls();
	await Promise.all([game.nextStage(), game.nextStage()]);
	assert.equal(gameCalls(), climb + 1);
	assert.equal(game.stage, 2);
});

test('불러오기 실패 뒤 다시 시도: 요청 중에는 busy로 막히고, 또 실패하면 안내가 남고 성공하면 판이 열린다', async (t) => {
	const { state, gameCalls } = rounds(t);
	state.fail = true;
	const game = new Game();
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	assert.equal(game.loadFailed, true);

	await game.newGame();
	assert.equal(game.loadFailed, true);
	assert.equal(game.toast, null);
	assert.equal(game.busy, false);

	state.fail = false;
	const pending = game.newGame();
	assert.equal(game.busy, true);
	assert.equal(game.loadFailed, true);
	await game.newGame();
	await pending;
	assert.equal(gameCalls(), 3);
	assert.equal(game.loadFailed, false);
	assert.equal(game.status, 'playing');
});

test('모드를 바꿔 시작하다 실패하면 이전 판을 지우고 토스트 없이 불러오기 실패로 남으며, 다음 시작이 성공하면 풀린다', async (t) => {
	const { state, values } = rounds(t);
	const game = new Game();
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	await clear(game);

	state.fail = true;
	game.setConfig({ mode: 'climb-streak', length: { kind: 'fixed', n: 6 } });
	await new Promise((r) => setImmediate(r));
	assert.equal(game.loadFailed, true);
	assert.equal(game.status, 'loading');
	assert.deepEqual(game.rows, []);
	assert.equal(game.stage, 1);
	assert.notEqual(game.toast, CONNECT_FAIL);
	assert.equal(values.has('nkordle:dclimb:' + game.dailyDay), false);

	state.fail = false;
	game.setConfig({ mode: 'climb-streak', length: { kind: 'fixed', n: 6 } });
	await new Promise((r) => setImmediate(r));
	assert.equal(game.loadFailed, false);
	assert.equal(game.status, 'playing');
});
