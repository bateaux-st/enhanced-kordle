import assert from 'node:assert/strict';
import test from 'node:test';
import { Game, setup } from './game-mock.mjs';

// 정답은 'ㄱ' 반복. 그 밖의 추측은 모두 오답이다.
const routes = {
	'/api/game': (body) => Response.json({ n: body.n ?? 6, token: 'tok' }),
	'/api/guess': (body) => {
		const win = /^ㄱ+$/.test(body.jamo);
		return Response.json({ ok: true, marks: Array(body.jamo.length).fill(win ? 'c' : 'a'), ...(win ? { word: '정답' } : {}) });
	}
};

async function guess(game, ok) {
	game.current = (ok ? 'ㄱ' : 'ㄴ').repeat(game.n);
	await game.submit();
}

test('endless: 판 도중 시도 횟수를 낮춰도 그 판은 시작 때 값이고 다음 판부터 새 값이다', async (t) => {
	setup(t, routes);
	const game = new Game();
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	assert.equal(game.maxTries, 6);

	for (let i = 0; i < 3; i++) await guess(game, false);
	game.setTries(4);
	assert.equal(game.settingTries, 4);
	assert.equal(game.maxTries, 6);
	assert.equal(game.status, 'playing');

	await guess(game, false);
	assert.equal(game.status, 'playing');
	await guess(game, false);
	await guess(game, false);
	assert.equal(game.rows.length, 6);
	assert.equal(game.status, 'lost');

	game.setTries(5);
	assert.equal(game.maxTries, 6);
	await game.newGame();
	assert.equal(game.maxTries, 5);
});

test('endless: 판 도중 시도 횟수를 올려도 그 판의 한도는 그대로다', async (t) => {
	setup(t, routes);
	const game = new Game();
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	game.setTries(10);
	for (let i = 0; i < 6; i++) await guess(game, false);
	assert.equal(game.status, 'lost');
});

test('등반: 스테이지 도중 바꿔도 다음 스테이지는 옛 값이고 처음부터 누르면 새 값이다', async (t) => {
	setup(t, routes);
	const game = new Game();
	game.config = { mode: 'climb-streak', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	await guess(game, false);
	game.setTries(4);
	assert.equal(game.maxTries, 6);
	await guess(game, true);
	assert.equal(game.status, 'won');
	assert.equal(game.maxTries, 6);

	await game.nextStage();
	assert.equal(game.stage, 2);
	assert.equal(game.maxTries, 6);

	await game.newGame();
	assert.equal(game.stage, 1);
	assert.equal(game.maxTries, 4);
});

test('등반: 시도를 다 써서 끝난 뒤 다시 등반하면 새 값이다', async (t) => {
	setup(t, routes);
	const game = new Game();
	game.config = { mode: 'climb-streak', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	game.setTries(4);
	for (let i = 0; i < 6; i++) await guess(game, false);
	assert.equal(game.status, 'lost');
	assert.equal(game.maxTries, 6);
	await game.newGame();
	assert.equal(game.stage, 1);
	assert.equal(game.maxTries, 4);
});

test('모드를 바꾸면 새 값으로 시작한다', async (t) => {
	const { values } = setup(t, routes);
	values.set('nkordle:settings', '{"maxTries":8}');
	const game = new Game();
	await game.newGame();
	assert.equal(game.config.mode, 'daily');
	assert.equal(game.maxTries, 6);
	game.setConfig({ mode: 'endless', length: { kind: 'fixed', n: 6 } });
	await new Promise((r) => setImmediate(r));
	assert.equal(game.maxTries, 8);
});

test('daily 계열은 설정과 상관없이 항상 6이다', async (t) => {
	const { values } = setup(t, routes);
	values.set('nkordle:settings', '{"maxTries":9}');
	const game = new Game();
	assert.equal(game.maxTries, 6);
	await game.newGame();
	assert.equal(game.maxTries, 6);
	game.setTries(4);
	await game.newGame();
	assert.equal(game.maxTries, 6);
});

test('첫 판 전 초기값도 저장된 시도 횟수를 따른다', (t) => {
	const { values } = setup(t, routes);
	values.set('nkordle:config', '{"mode":"endless","length":{"kind":"fixed","n":6}}');
	values.set('nkordle:settings', '{"maxTries":8}');
	assert.equal(new Game().maxTries, 8);
});
