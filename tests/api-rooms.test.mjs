import assert from 'node:assert/strict';
import test from 'node:test';
import { call, fakeNs, loadRoute, platformOf } from './route-runtime.mjs';

const { GET } = await loadRoute('api/rooms');

const summary = (code, over = {}) => ({ code, host: '방장이름', kind: 'comp', game: 'single', players: 2, max: 5, inProgress: false, updatedAt: 1, ...over });

test('Lobby의 list()를 그대로 JSON으로 주고 캐시하지 않는다', async () => {
	const list = [summary('AAAAAA'), summary('BBBBBB', { inProgress: true })];
	const lobby = fakeNs(() => ({ list: async () => list }));
	const res = await call(GET, { method: 'GET', platform: platformOf({ LOBBY: lobby }) });
	assert.equal(res.status, 200);
	assert.deepEqual(res.json, list);
	assert.equal(res.headers.get('cache-control'), 'no-store');
	assert.deepEqual(lobby.names, ['lobby']);
	assert.deepEqual(lobby.calls.map((c) => [c.name, c.method]), [['lobby', 'list']]);
});

test('방이 없으면 빈 배열', async () => {
	const lobby = fakeNs(() => ({ list: async () => [] }));
	assert.deepEqual((await call(GET, { method: 'GET', platform: platformOf({ LOBBY: lobby }) })).json, []);
});

test('LOBBY 바인딩이 없으면 503', async () => {
	for (const platform of [undefined, { env: {} }, platformOf({ LOBBY: undefined })]) {
		const res = await call(GET, { method: 'GET', platform });
		assert.deepEqual([res.status, res.message], [503, 'platform bindings not available']);
	}
});

test('Lobby 호출이 실패하면 던져진다(SvelteKit이 500으로 바꾼다)', async () => {
	const lobby = fakeNs(() => ({
		list: async () => {
			throw new Error('lobby down');
		}
	}));
	const res = await call(GET, { method: 'GET', platform: platformOf({ LOBBY: lobby }) });
	assert.equal(res.status, 500);
	assert.equal(res.crashed.message, 'lobby down');
});
