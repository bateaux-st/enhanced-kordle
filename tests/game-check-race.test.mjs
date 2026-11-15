import assert from 'node:assert/strict';
import test from 'node:test';
import { setup, start } from './game-mock.mjs';

// /api/check 응답을 손으로 푸는 지연 응답. 풀기 전에는 checkCurrent가 await에 걸려 있다.
function deferredCheck() {
	const pending = [];
	const route = () => new Promise((resolve) => pending.push(resolve));
	const answer = async (i, valid) => {
		pending[i](Response.json({ valid }));
		await new Promise((r) => setImmediate(r));
	};
	return { route, answer, pending };
}

// timers.enable이 setTimeout만 가짜로 하므로 setImmediate는 실제로 돈다.
async function filled(t) {
	const check = deferredCheck();
	setup(t, { '/api/check': check.route });
	const game = await start();
	game.current = 'ㄱ'.repeat(game.n - 1);
	game.type('ㄱ');
	return { game, check };
}

test('확인 응답이 입력이 그대로인 채 오면 invalid에 반영한다', async (t) => {
	const { game, check } = await filled(t);
	assert.equal(check.pending.length, 1);
	await check.answer(0, false);
	assert.equal(game.invalid, true);
});

test('응답이 오기 전에 한 글자 지웠다면 그 응답은 버린다', async (t) => {
	const { game, check } = await filled(t);
	game.back();
	await check.answer(0, false);
	assert.equal(game.invalid, false);
});

test('지우고 다른 자모로 다시 채운 뒤 먼저 보낸 응답이 오면 버린다', async (t) => {
	const { game, check } = await filled(t);
	game.back();
	game.type('ㄴ');
	assert.equal(check.pending.length, 2);
	await check.answer(0, false);
	assert.equal(game.invalid, false);
	await check.answer(1, false);
	assert.equal(game.invalid, true);
});

test('지우고 같은 자모로 다시 채우면 먼저 보낸 응답도 현재 입력과 같아 반영한다', async (t) => {
	const { game, check } = await filled(t);
	game.back();
	game.type('ㄱ');
	await check.answer(0, false);
	assert.equal(game.invalid, true);
});
