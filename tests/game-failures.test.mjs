import assert from 'node:assert/strict';
import test from 'node:test';
import { Game, serverError, setup, start } from './game-mock.mjs';

const CONNECT_FAIL = '서버에 연결할 수 없습니다';

test('시도를 모두 쓴 판에서 reveal이 실패하면 토스트로 알리고 busy를 풀며 패배 상태는 남는다', async (t) => {
	setup(t, { '/api/reveal': serverError });
	const game = await start();
	for (let i = 0; i < game.maxTries; i++) {
		game.current = 'ㄱ'.repeat(game.n);
		await game.submit();
	}
	assert.equal(game.status, 'lost');
	assert.equal(game.toast, CONNECT_FAIL);
	assert.equal(game.busy, false);
});

test('포기 중 reveal이 실패해도 busy는 풀린다', async (t) => {
	setup(t, { '/api/reveal': serverError });
	const game = await start();
	await game.giveUp();
	assert.equal(game.busy, false);
});

test('포기 중 reveal이 실패하면 예외를 던지지 않고 토스트로 알린다', async (t) => {
	setup(t, { '/api/reveal': serverError });
	const game = await start();
	await game.giveUp();
	assert.equal(game.toast, CONNECT_FAIL);
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
