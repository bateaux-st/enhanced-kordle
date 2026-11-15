import assert from 'node:assert/strict';
import test from 'node:test';
import { LOBBY_LIST_MAX, LOBBY_STALE_MS } from '../src/lib/mp/rules.ts';
import { FakeCtx, lobbyRig, NAMES, rig, summary, T0 } from './do-runtime.mjs';

test('upsert: 받은 시각을 updatedAt으로 적고 저장한다. 목록은 그 값을 돌려준다', async (t) => {
	const r = await lobbyRig(t);
	r.advance(500);
	await r.lobby.upsert(summary('AAAAAA', { updatedAt: 1 }));
	assert.equal(r.stored().AAAAAA.updatedAt, T0 + 500);
	assert.deepEqual((await r.lobby.list()).map((x) => [x.code, x.updatedAt]), [['AAAAAA', T0 + 500]]);
	assert.equal(r.ctx.storage.puts('rooms'), 1);
});

test('remove: 없는 코드는 저장하지 않고, 있는 코드는 지워 저장한다', async (t) => {
	const r = await lobbyRig(t);
	await r.lobby.remove('NOROOM');
	assert.equal(r.ctx.storage.ops.length, 0);
	await r.lobby.upsert(summary('AAAAAA'));
	await r.lobby.remove('AAAAAA');
	assert.deepEqual(r.stored(), {});
	assert.deepEqual(await r.lobby.list(), []);
});

test('목록: 입장 가능한 방이 먼저, 그 안에서 최신순, 최대 50개', async (t) => {
	const r = await lobbyRig(t);
	await r.lobby.upsert(summary('OLDEST', { inProgress: false }));
	r.advance(10);
	await r.lobby.upsert(summary('PLAYNG', { inProgress: true }));
	r.advance(10);
	await r.lobby.upsert(summary('FULLRM', { players: 5 }));
	r.advance(10);
	await r.lobby.upsert(summary('NEWEST'));
	assert.deepEqual((await r.lobby.list()).map((x) => x.code), ['NEWEST', 'OLDEST', 'FULLRM', 'PLAYNG']);

	for (let i = 0; i < LOBBY_LIST_MAX + 5; i++) {
		r.advance(1);
		await r.lobby.upsert(summary(`R${String(i).padStart(5, '0')}`));
	}
	const list = await r.lobby.list();
	assert.equal(list.length, LOBBY_LIST_MAX);
	assert.equal(list[0].code, `R${String(LOBBY_LIST_MAX + 4).padStart(5, '0')}`);
});

test('오래 갱신되지 않은 방은 목록을 만들 때 지우고 저장소에도 반영한다', async (t) => {
	const r = await lobbyRig(t);
	await r.lobby.upsert(summary('STALEE'));
	r.advance(LOBBY_STALE_MS);
	assert.equal((await r.lobby.list()).length, 1, '정확히 한도까지는 유효하다');
	const puts = r.ctx.storage.puts('rooms');
	r.advance(1);
	assert.deepEqual(await r.lobby.list(), []);
	assert.deepEqual(r.stored(), {});
	assert.equal(r.ctx.storage.puts('rooms'), puts + 1);
});

test('WebSocket이 아닌 요청은 426, 새 구독자는 현재 목록을 바로 한 번 받는다', async (t) => {
	const r = await lobbyRig(t);
	assert.equal((await r.lobby.fetch(new Request('https://kordle.test/ws-lobby'))).status, 426);
	await r.lobby.upsert(summary('AAAAAA'));
	const ws = await r.subscribe();
	assert.equal(ws.take().length, 1);
	assert.equal(ws.sent.length, 0);
	assert.deepEqual(r.ctx.storage.data.get('shown').map((x) => x.code), ['AAAAAA']);
});

test('구독자가 없으면 upsert는 푸시·알람·shown 저장을 하지 않는다', async (t) => {
	const r = await lobbyRig(t);
	await r.lobby.upsert(summary('AAAAAA'));
	assert.deepEqual(r.ctx.storage.ops.map((o) => o.op + ':' + o.key), ['put:rooms']);
	assert.equal(r.alarmAt(), null);
});

test('이미 목록을 받은 구독자가 있을 때 새 구독자에게만 보낸다(중복 푸시 억제)', async (t) => {
	const r = await lobbyRig(t);
	await r.lobby.upsert(summary('AAAAAA'));
	const first = await r.subscribe();
	assert.equal(first.take().length, 1);
	const second = await r.subscribe();
	assert.equal(second.take().length, 1);
	assert.deepEqual(first.sent, []);
});

test('목록 내용이 바뀐 때만 구독자 전원에게 푸시한다. updatedAt만 달라지면 보내지 않는다', async (t) => {
	const r = await lobbyRig(t);
	const a = await r.subscribe();
	const b = await r.subscribe();
	a.take();
	b.take();
	await r.lobby.upsert(summary('AAAAAA'));
	assert.deepEqual([a.take().length, b.take().length], [1, 1]);

	r.advance(300_000);
	await r.lobby.upsert(summary('AAAAAA'));
	assert.deepEqual([a.sent.length, b.sent.length], [0, 0], '심장박동 upsert는 푸시하지 않는다');
	assert.equal(r.stored().AAAAAA.updatedAt, T0 + 300_000, '저장은 갱신된다');

	await r.lobby.upsert(summary('AAAAAA', { players: 3 }));
	assert.equal(a.take()[0][0].players, 3);
	assert.equal(b.take().length, 1);
	await r.lobby.remove('AAAAAA');
	assert.deepEqual([a.take(), b.take()], [[[]], [[]]]);
});

test('닫힌 구독자는 푸시 대상이 아니고, 보내다 던지는 구독자가 있어도 나머지에게 간다', async (t) => {
	const r = await lobbyRig(t);
	const closed = await r.subscribe();
	const broken = await r.subscribe();
	const healthy = await r.subscribe();
	for (const ws of [closed, broken, healthy]) ws.take();
	closed.readyState = 3;
	broken.send = () => {
		throw new TypeError('보내는 사이 닫혔다');
	};
	await r.lobby.upsert(summary('AAAAAA'));
	assert.deepEqual(closed.sent, []);
	assert.equal(healthy.take().length, 1);
});

test('구독자가 있는 동안 가장 이른 만료 시각(+1ms)에 알람을 걸고, 울리면 빠진 목록을 푸시한다', async (t) => {
	const r = await lobbyRig(t);
	const ws = await r.subscribe();
	ws.take();
	await r.lobby.upsert(summary('AAAAAA'));
	assert.equal(r.alarmAt(), T0 + LOBBY_STALE_MS + 1);
	ws.take();
	const alarms = r.ctx.storage.ops.filter((o) => o.op === 'setAlarm').length;
	r.advance(10_000);
	await r.lobby.upsert(summary('BBBBBB'));
	assert.equal(r.ctx.storage.ops.filter((o) => o.op === 'setAlarm').length, alarms, '목표가 같으면 다시 걸지 않는다');
	ws.take();

	await r.fireAlarm();
	assert.deepEqual(ws.take()[0].map((x) => x.code), ['BBBBBB']);
	assert.deepEqual(Object.keys(r.stored()), ['BBBBBB']);
	assert.equal(r.alarmAt(), T0 + 10_000 + LOBBY_STALE_MS + 1, '다음 만료로 다시 건다');
	await r.fireAlarm();
	assert.deepEqual(ws.take(), [[]]);
	assert.equal(r.alarmAt(), null);
});

test('마지막 구독자가 나가면 알람을 지우고, 남은 구독자가 있으면 둔다', async (t) => {
	const r = await lobbyRig(t);
	const a = await r.subscribe();
	const b = await r.subscribe();
	await r.lobby.upsert(summary('AAAAAA'));
	const alarm = r.alarmAt();
	assert.notEqual(alarm, null);

	await r.drop(a, 1000);
	assert.equal(r.alarmAt(), alarm);
	b.readyState = 2;
	await r.lobby.webSocketError(b);
	assert.equal(r.alarmAt(), null);
	assert.ok(r.ctx.storage.ops.some((o) => o.op === 'deleteAlarm'));
});

test('close 이벤트: 서버는 답장 close를 보내고 예약 코드 1005/1006은 1000으로 바꾼다', async (t) => {
	const r = await lobbyRig(t);
	const a = await r.subscribe();
	const b = await r.subscribe();
	const c = await r.subscribe();
	await r.drop(a, 1005);
	await r.drop(b, 1006);
	await r.drop(c, 1001);
	assert.deepEqual([a.closed, b.closed, c.closed], [
		{ code: 1000, reason: 'closed' },
		{ code: 1000, reason: 'closed' },
		{ code: 1001, reason: 'closed' },
	]);
});

test('이미 닫힌 소켓의 close 이벤트도 던지지 않고 처리한다', async (t) => {
	const r = await lobbyRig(t);
	const ws = await r.subscribe();
	ws.readyState = 3;
	await r.lobby.webSocketClose(ws, 1000);
	assert.equal(ws.closed, null);
});

test('클라이언트 메시지는 무시한다(ping은 런타임이 자동 응답한다)', async (t) => {
	const r = await lobbyRig(t);
	const ws = await r.subscribe();
	ws.take();
	assert.equal(await r.lobby.webSocketMessage(ws, 'ping'), undefined);
	assert.deepEqual(ws.sent, []);
	assert.equal(r.ctx.autoResponse.request, 'ping');
	assert.equal(r.ctx.autoResponse.response, 'pong');
});

test('하이버네이션 복원: 방 목록·shown·알람이 이어지고 같은 목록을 다시 푸시하지 않는다', async (t) => {
	const r = await lobbyRig(t);
	const ws = await r.subscribe();
	await r.lobby.upsert(summary('AAAAAA'));
	ws.take();
	const alarm = r.alarmAt();
	const ops = r.ctx.storage.ops.length;

	await r.revive();
	assert.deepEqual((await r.lobby.list()).map((x) => x.code), ['AAAAAA']);
	assert.deepEqual(ws.sent, [], '복원 뒤 같은 목록은 보내지 않는다');
	assert.equal(r.alarmAt(), alarm);
	assert.equal(r.ctx.storage.ops.length, ops);

	await r.lobby.upsert(summary('BBBBBB'));
	assert.equal(ws.take()[0].length, 2);
});

test('Room 연동: 입장·인원 변화·접속자 소멸이 실제 Lobby 목록과 구독 푸시에 반영된다', async (t) => {
	const { Lobby } = await import('../src/lib/server/mp/lobby.ts');
	const lctx = new FakeCtx();
	const lobby = new Lobby(lctx, {});
	await Promise.all(lctx.blocked);
	const r = await rig(t, { lobbyTarget: lobby });
	await lobby.fetch(new Request('https://kordle.test/ws-lobby', { headers: { Upgrade: 'websocket' } }));
	const sub = lctx.sockets.at(-1);
	sub.take();
	const lastPush = () => sub.take().at(-1);

	const host = await r.open();
	await r.settle();
	assert.deepEqual(lastPush().map((x) => [x.code, x.host, x.players]), [['ABC234', NAMES[0], 1]]);

	const guest = await r.hello(NAMES[1]);
	await r.settle();
	assert.equal(lastPush()[0].players, 2);

	await r.drop(guest.ws);
	await r.settle();
	assert.equal(lastPush()[0].players, 1);

	await r.send(host.ws, { type: 'leave' });
	await r.settle();
	assert.deepEqual(lastPush(), [], '접속자가 없으면 방이 남아 있어도 목록에서 뺀다');
	assert.deepEqual(await lobby.list(), []);
});
