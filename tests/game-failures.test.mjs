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
	await game.giveUp().catch(() => {});
	assert.equal(game.busy, false);
});

test('포기 중 reveal이 실패하면 예외를 던지지 않고 토스트로 알린다', { todo: '앱 버그: giveUp에 catch가 없어 +page.svelte의 void game.giveUp()에서 처리되지 않은 거부가 된다' }, async (t) => {
	setup(t, { '/api/reveal': serverError });
	const game = await start();
	await game.giveUp();
	assert.equal(game.toast, CONNECT_FAIL);
});

test('새 판을 받아 오지 못하면 예외를 던지지 않고 토스트로 알린다', async (t) => {
	setup(t, { '/api/game': serverError });
	const game = new Game();
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	assert.equal(game.toast, CONNECT_FAIL);
});
