import assert from 'node:assert/strict';
import test from 'node:test';
import { lobbyRig, NAMES, rig, summary } from './do-runtime.mjs';
import { fakeNs, loadHooks, platformOf } from './route-runtime.mjs';

const { handle } = await loadHooks();

const upgrade = { Upgrade: 'websocket' };

/** SvelteKit이 handle에 넘기는 모양. resolve 호출은 resolved에 쌓인다. */
function event(path, { headers = {}, platform } = {}) {
	const url = new URL(path, 'https://kordle.test');
	const resolved = [];
	return {
		resolved,
		args: {
			event: { url, request: new Request(url, { headers }), platform },
			resolve: async (e) => {
				resolved.push(e);
				return new Response('resolved');
			}
		}
	};
}

const run = async (path, opts) => {
	const e = event(path, opts);
	const res = await handle(e.args);
	return { res, resolved: e.resolved, text: res.status === 101 ? null : await res.text() };
};

test('WS 경로가 아닌 요청은 resolve에 맡긴다(비슷한 경로 포함)', async () => {
	for (const path of ['/', '/api/rooms', '/ws', '/ws/', '/ws/ABC234/extra', '/ws/ABC234/', '/ws-lobby/x', '/wss/ABC234']) {
		const { res, resolved, text } = await run(path, { headers: upgrade, platform: platformOf() });
		assert.equal(resolved.length, 1, path);
		assert.equal(text, 'resolved', path);
		assert.equal(res.status, 200);
	}
});

test('로비 WS: 업그레이드가 아니면 426, 바인딩이 없으면 503(업그레이드 검사가 먼저)', async () => {
	const plain = await run('/ws-lobby', { platform: platformOf() });
	assert.deepEqual([plain.res.status, plain.text, plain.resolved.length], [426, 'Expected WebSocket upgrade', 0]);

	for (const platform of [undefined, { env: {} }, platformOf({ LOBBY: undefined })]) {
		const res = await run('/ws-lobby', { headers: upgrade, platform });
		assert.deepEqual([res.res.status, res.text, res.resolved.length], [503, 'Durable Object binding not available', 0]);
	}
	const noBinding = await run('/ws-lobby', { platform: undefined });
	assert.equal(noBinding.res.status, 426);
});

test('로비 WS: 업그레이드 요청을 lobby DO의 fetch에 그대로 넘기고 그 응답을 돌려준다', async (t) => {
	const r = await lobbyRig(t);
	await r.lobby.upsert(summary('AAAAAA'));
	const LOBBY = fakeNs(() => ({ fetch: (request) => r.lobby.fetch(request) }));
	const { res, resolved } = await run('/ws-lobby', { headers: upgrade, platform: platformOf({ LOBBY }) });

	assert.equal(res.status, 101);
	assert.deepEqual(LOBBY.names, ['lobby']);
	assert.equal(LOBBY.calls[0].args[0].headers.get('Upgrade'), 'websocket');
	assert.equal(resolved.length, 0, 'resolve를 거치면 101이 가공된다');
	const ws = r.ctx.sockets.at(-1);
	assert.deepEqual(ws.take()[0].map((x) => x.code), ['AAAAAA'], '구독 소켓이 현재 목록을 받는다');
});

test('방 WS: 코드 형식이 아니면 404, 업그레이드가 아니면 426, 바인딩이 없으면 503이고 DO는 부르지 않는다', async () => {
	const ROOM = fakeNs(() => ({ fetch: async () => new Response('should not be called') }));
	for (const code of ['abc234', 'ABC23', 'ABC2345', 'ABC0O1', 'ABCI23', 'ABC%2034']) {
		const res = await run(`/ws/${code}`, { headers: upgrade, platform: platformOf({ ROOM }) });
		assert.deepEqual([res.res.status, res.text], [404, 'Not found'], code);
	}
	const plain = await run('/ws/ABC234', { platform: platformOf({ ROOM }) });
	assert.deepEqual([plain.res.status, plain.text], [426, 'Expected WebSocket upgrade']);

	for (const platform of [undefined, { env: {} }, platformOf({ ROOM: undefined })]) {
		const res = await run('/ws/ABC234', { headers: upgrade, platform });
		assert.deepEqual([res.res.status, res.text, res.resolved.length], [503, 'Durable Object binding not available', 0]);
	}
	assert.deepEqual(ROOM.names, []);
});

test('방 WS: 코드로 고른 Room DO의 fetch에 그대로 넘기고, 입장한 소켓이 같은 방에서 hello를 처리한다', async (t) => {
	const r = await rig(t);
	await r.open();
	const ROOM = fakeNs(() => ({ fetch: (request) => r.room.fetch(request) }));
	const before = r.ctx.sockets.length;
	const { res, resolved } = await run('/ws/ABC234', { headers: upgrade, platform: platformOf({ ROOM }) });

	assert.equal(res.status, 101);
	assert.equal(resolved.length, 0);
	assert.deepEqual(ROOM.names, ['ABC234']);
	assert.equal(r.ctx.sockets.length, before + 1);
	const ws = r.ctx.sockets.at(-1);
	await r.send(ws, { type: 'hello', name: NAMES[1] });
	assert.deepEqual(ws.take().map((m) => m.type), ['welcome', 'chat_history', 'snap']);
	assert.equal(r.state().players.length, 2);
});

test('방 WS: 같은 코드는 같은 DO 이름으로 고르고 다른 코드는 다른 이름이다', async () => {
	const ROOM = fakeNs(() => ({ fetch: async () => new Response(null, { status: 200 }) }));
	const platform = platformOf({ ROOM });
	await run('/ws/ABC234', { headers: upgrade, platform });
	await run('/ws/ABC234', { headers: upgrade, platform });
	await run('/ws/ZZZ999', { headers: upgrade, platform });
	assert.deepEqual(ROOM.names, ['ABC234', 'ABC234', 'ZZZ999']);
});
