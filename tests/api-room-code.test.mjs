import assert from 'node:assert/strict';
import test from 'node:test';
import { call, fakeNs, loadRoute, platformOf } from './route-runtime.mjs';

const { GET } = await loadRoute('api/room/[code]');

const INFO = { code: 'ABC234', host: '방장이름', kind: 'comp', game: 'single', players: 2, max: 5, inProgress: false, updatedAt: 1 };
const get = (code, ROOM) => call(GET, { method: 'GET', params: { code }, platform: platformOf({ ROOM }) });

test('방 요약을 JSON으로 주고 캐시하지 않으며 코드로 DO를 고른다', async () => {
	const ns = fakeNs(() => ({ info: async () => INFO }));
	const res = await get('ABC234', ns);
	assert.equal(res.status, 200);
	assert.deepEqual(res.json, INFO);
	assert.equal(res.headers.get('cache-control'), 'no-store');
	assert.deepEqual(ns.names, ['ABC234']);
	assert.deepEqual(ns.calls.map((c) => c.method), ['info']);
});

test('코드 형식이 아니면 DO를 부르지 않고 404', async () => {
	const ns = fakeNs(() => ({ info: async () => INFO }));
	for (const code of ['abc234', 'ABC23', 'ABC2345', 'ABC0O1', 'ABCI23', 'ABC 23', '', undefined, 123456]) {
		const res = await get(code, ns);
		assert.deepEqual([res.status, res.message], [404, 'no such room'], String(code));
	}
	assert.deepEqual(ns.names, []);
});

test('없는 방(info가 null)은 404', async () => {
	const ns = fakeNs(() => ({ info: async () => null }));
	const res = await get('ABC234', ns);
	assert.deepEqual([res.status, res.message], [404, 'no such room']);
	assert.deepEqual(ns.names, ['ABC234']);
});

test('ROOM 바인딩이 없으면 코드 검사보다 먼저 503', async () => {
	for (const platform of [undefined, { env: {} }]) {
		const res = await call(GET, { method: 'GET', params: { code: 'nope' }, platform });
		assert.deepEqual([res.status, res.message], [503, 'platform bindings not available']);
	}
});

test('DO 호출이 실패하면 던져진다', async () => {
	const ns = fakeNs(() => ({
		info: async () => {
			throw new Error('do down');
		}
	}));
	const res = await get('ABC234', ns);
	assert.equal(res.status, 500);
	assert.equal(res.crashed.message, 'do down');
});
