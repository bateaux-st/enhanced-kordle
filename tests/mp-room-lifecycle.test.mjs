import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOSE } from '../src/lib/mp/protocol.ts';
import { EMPTY_ROOM_MS, HOST_GRACE_MS, LOBBY_REFRESH_MS, REAP_CHECK_IDLE_MS } from '../src/lib/mp/rules.ts';
import { issue } from '../src/lib/server/mp/session.ts';
import { NAMES, ofType, rig, settle, T0 } from './do-runtime.mjs';

const POOL = { '3:6': [{ word: '바나나', jamo: 'ㅂㅏㄴㅏㄴㅏ' }] };

test('init: 방장 자리를 예약해 한 번 저장하고 빈 방 소멸 알람을 건다. 두 번째 init은 거절한다', async (t) => {
	const r = await rig(t);
	assert.equal(await r.room.info(), null);
	const session = await issue(undefined, NAMES[0], T0, r.secret);
	assert.equal(await r.create({}, { uid: session.uid, name: NAMES[0] }), true);

	const s = r.state();
	assert.equal(s.code, 'ABC234');
	assert.equal(s.phase, 'lobby');
	assert.equal(s.players.length, 1);
	assert.equal(s.players[0].connected, false);
	assert.equal(s.hostPid, s.players[0].pid);
	assert.equal(s.seq, 0);
	assert.deepEqual(r.ctx.storage.ops, [{ op: 'put', key: 'state' }, { op: 'setAlarm', at: T0 + EMPTY_ROOM_MS }]);
	assert.deepEqual(r.lobby.calls, [], '접속자가 없는 방은 목록에 올리지 않는다');

	const before = r.ctx.storage.ops.length;
	assert.equal(await r.create({ length: 9 }, { uid: 'other-uid', name: NAMES[1] }), false);
	assert.equal(r.ctx.storage.ops.length, before);
	assert.equal(r.state().settings.length, 6);
	assert.equal((await r.room.info()).code, 'ABC234');
});

test('방이 없으면 소켓은 열리지만 첫 메시지에서 4004로 닫고 아무것도 저장하지 않는다', async (t) => {
	const r = await rig(t);
	const ws = await r.connect();
	assert.deepEqual(ws.deserializeAttachment(), { pid: null, uid: null, at: T0 });
	await r.send(ws, { type: 'hello', name: NAMES[0] });
	assert.deepEqual(ws.closed, { code: CLOSE.NO_ROOM, reason: 'no room' });
	assert.deepEqual(ws.sent, []);
	assert.deepEqual(r.ctx.storage.ops, []);
	assert.equal(r.ctx.storage.data.size, 0);
});

test('WebSocket이 아닌 요청은 426', async (t) => {
	const r = await rig(t);
	const res = await r.room.fetch(new Request('https://kordle.test/ws/ABC234'));
	assert.equal(res.status, 426);
	assert.equal(await res.text(), 'Expected WebSocket upgrade');
	assert.equal(r.ctx.sockets.length, 0);
});

test('첫 hello: seq 1로 저장하고 Lobby에 요약을 올리고 upsertAt을 남긴다', async (t) => {
	const r = await rig(t);
	await r.open();
	assert.equal(r.state().seq, 1);
	assert.equal(r.state().players[0].connected, true);
	assert.deepEqual(r.lobby.names, ['lobby']);
	const [sum, ...rest] = r.lobby.upserts();
	assert.equal(rest.length, 0);
	assert.deepEqual([sum.code, sum.host, sum.players, sum.inProgress], ['ABC234', NAMES[0], 1, false]);
	assert.equal(r.ctx.storage.data.get('upsertAt'), T0);
});

test('저장은 바뀐 메시지마다 한 번, 바뀌지 않은 요청은 저장하지 않는다', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	await r.settle();
	const base = r.ctx.storage.puts('state');
	const seq = r.state().seq;

	await r.send(guest.ws, { type: 'ready', on: false });
	assert.equal(r.ctx.storage.puts('state'), base + 1);
	assert.equal(r.state().seq, seq + 1);

	await r.send(host.ws, { type: 'ready', on: true });
	assert.equal(r.ctx.storage.puts('state'), base + 1, '방장은 준비하지 않으므로 거절되고 저장하지 않는다');
	assert.equal(r.state().seq, seq + 1);
	assert.equal(ofType(host.ws.take(), 'error').length, 1);
});

test('협동 초안은 메모리와 방송만 바꾸고 저장·seq를 올리지 않는다', async (t) => {
	const r = await rig(t, { pool: POOL });
	const [host, guest] = await r.players([NAMES[1]], { kind: 'coop' });
	await r.send(host.ws, { type: 'start' });
	assert.equal(r.state().phase, 'playing');
	host.ws.take();
	guest.ws.take();
	const puts = r.ctx.storage.puts('state');
	const seq = r.state().seq;

	await r.send(guest.ws, { type: 'draft', jamo: 'ㅂㅏㄴ' });
	assert.equal(r.ctx.storage.puts('state'), puts);
	assert.equal(r.state().seq, seq, '저장본 seq는 그대로다');
	const [snap] = ofType(host.ws.take(), 'snap');
	assert.equal(snap.snap.seq, seq, '클라이언트는 같은 seq의 스냅샷을 받는다');
	assert.deepEqual(Object.values(snap.snap.game.step.drafts), ['ㅂㅏㄴ']);

	// 메모리에만 있던 초안은 다음 저장에 함께 나간다.
	await r.send(host.ws, { type: 'pass', on: true });
	assert.equal(r.ctx.storage.puts('state'), puts + 1);
	assert.deepEqual(r.state().game.step.drafts[guest.pid], 'ㅂㅏㄴ');
});

test('하이버네이션 복원: 같은 저장소·소켓으로 새 인스턴스를 만들면 상태·첨부·알람이 이어지고 아무것도 다시 쓰지 않는다', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	await r.settle();
	const stored = structuredClone(r.state());
	const alarm = r.alarmAt();
	const ops = r.ctx.storage.ops.length;
	const upserts = r.lobby.upserts().length;
	const att = host.ws.deserializeAttachment();

	r.advance(1000);
	await r.revive();

	assert.deepEqual(r.state(), stored);
	assert.equal(r.ctx.storage.ops.length, ops);
	assert.equal(r.alarmAt(), alarm);
	assert.deepEqual(host.ws.deserializeAttachment(), att);
	assert.equal(r.lobby.upserts().length, upserts, '깨어난 것만으로 Lobby를 부르지 않는다');
	assert.equal(host.ws.sent.length, 0);
	assert.deepEqual((await r.room.info()).players, 2);

	// 복원된 인스턴스가 첨부 pid로 메시지를 받아 처리한다.
	await r.send(guest.ws, { type: 'ready', on: false });
	assert.equal(r.state().players.find((p) => p.pid === guest.pid).ready, false);
	assert.equal(r.lobby.upserts().length, upserts, '요약이 같으면 upsert하지 않는다');
	assert.equal(ofType(host.ws.take(), 'snap').length, 1);
});

test('복원 때 열린 소켓이 없는 접속자는 끊김으로 바꿔 저장하고 목록에서 한 번 지운다', async (t) => {
	const r = await rig(t);
	await r.players();
	await r.settle();
	const seq = r.state().seq;
	r.advance(10_000);
	r.ctx.sockets = [];
	await r.revive();
	await r.settle();

	const s = r.state();
	assert.equal(s.seq, seq + 1);
	assert.ok(s.players.every((p) => !p.connected && p.disconnectedAt === T0 + 10_000));
	assert.equal(s.emptySince, T0 + 10_000);
	assert.deepEqual(r.lobby.removes(), ['ABC234']);
	// 걸려 있던 알람이 목표보다 이르면 두고, 그 알람이 울리면 다시 계산한다.
	const first = r.alarmAt();
	assert.ok(first <= T0 + 10_000 + EMPTY_ROOM_MS);
	await r.fireAlarm();
	assert.notEqual(r.state(), undefined, '유예가 끝나기 전에는 소멸하지 않는다');
	assert.equal(r.alarmAt(), T0 + 10_000 + EMPTY_ROOM_MS);
	await r.fireAlarm();
	assert.equal(r.state(), undefined);
});

test('복원 때 소켓이 모두 끊긴 방은 깨어난 시각부터 빈 방 유예를 다시 센다(축출 중 지난 시간은 세지 않는다)', async (t) => {
	const r = await rig(t);
	await r.players();
	await r.settle();
	r.advance(EMPTY_ROOM_MS + 1000);
	r.ctx.sockets = [];
	await r.revive();
	assert.ok(r.state(), '생성자는 지우지 않는다');
	const woke = T0 + EMPTY_ROOM_MS + 1000;
	assert.equal(r.state().emptySince, woke);
	assert.equal(r.alarmAt(), woke + EMPTY_ROOM_MS);
	await r.fireAlarm({ stay: true });
	assert.ok(r.state(), '깨어난 직후에는 소멸하지 않는다');
	await r.fireAlarm();
	assert.equal(r.state(), undefined);
	assert.equal(r.ctx.storage.data.size, 0);
	assert.equal(r.alarmAt(), null);
});

test('채팅 기록은 저장하지 않아 복원한 인스턴스는 빈 기록으로 시작한다', async (t) => {
	const r = await rig(t);
	const [host] = await r.players();
	await r.send(host.ws, { type: 'chat', text: '안녕하세요' });
	const late = await r.hello(NAMES[3]);
	assert.equal(ofType(late.msgs, 'chat_history')[0].msgs.length, 1);
	assert.ok(![...r.ctx.storage.data.keys()].some((k) => k.includes('chat')));

	await r.revive();
	const again = await r.hello(NAMES[4]);
	assert.deepEqual(ofType(again.msgs, 'chat_history')[0].msgs, []);
});

test('유예가 끝나 소멸하면 알람·저장소를 지우고 목록에서 빼고 이후 메시지는 4004', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	await r.drop(host.ws);
	await r.drop(guest.ws);
	assert.equal(r.state().emptySince, T0);

	// 방장 승계 알람(5초)이 먼저 울리지만 이어받을 접속자가 없어 소멸 시한(30초)으로 다시 건다.
	assert.equal(await r.fireAlarm(), T0 + HOST_GRACE_MS);
	assert.ok(r.state());
	assert.equal(r.alarmAt(), T0 + EMPTY_ROOM_MS);
	const opsBefore = r.ctx.storage.ops.length;
	await r.fireAlarm();

	assert.equal(r.state(), undefined);
	assert.equal(r.ctx.storage.data.size, 0);
	assert.equal(r.alarmAt(), null);
	assert.ok(r.ctx.storage.ops.slice(opsBefore).some((o) => o.op === 'deleteAll'));
	assert.ok(r.lobby.removes().includes('ABC234'));
	assert.equal(await r.room.info(), null);

	const ws = await r.connect();
	await r.send(ws, { type: 'hello', name: NAMES[2] });
	assert.equal(ws.closed.code, CLOSE.NO_ROOM);
	assert.equal(r.ctx.storage.data.size, 0, '소멸한 방에 키를 되살리지 않는다');
});

test('upsert가 끝나기 전에 방이 소멸해도 비운 저장소에 upsertAt을 되살리지 않는다', async (t) => {
	const r = await rig(t);
	let release;
	r.lobby.gate.upsert = new Promise((resolve) => (release = resolve));
	const host = await r.open();
	assert.equal(r.lobby.upserts().length, 1);

	await r.send(host.ws, { type: 'leave' });
	assert.equal(r.state(), undefined, '혼자 나가면 유예 없이 소멸한다');
	release();
	await r.settle();
	assert.equal(r.ctx.storage.data.size, 0);
	assert.equal(r.ctx.storage.data.has('upsertAt'), false);
});

test('혼자 나가면 나가는 소켓은 1000 left, 방은 즉시 소멸하고 알람도 지운다', async (t) => {
	const r = await rig(t);
	const host = await r.open();
	await r.send(host.ws, { type: 'leave' });
	assert.deepEqual(host.ws.closed, { code: 1000, reason: 'left' });
	assert.equal(r.ctx.storage.data.size, 0);
	assert.equal(r.alarmAt(), null);
	assert.deepEqual(r.lobby.removes(), ['ABC234']);
});

test('소멸 때 hello 없이 열려 있던 소켓은 4005로 닫는다', async (t) => {
	const r = await rig(t);
	const host = await r.open();
	const raw = await r.connect();
	await r.drop(host.ws);
	await r.fireAlarm();
	assert.equal(r.state(), undefined);
	assert.deepEqual(raw.closed, { code: CLOSE.DESTROYED, reason: 'room closed' });
	assert.deepEqual(raw.deserializeAttachment(), { pid: null, uid: null });
});

test('주기 상수: 대기실 점검(180초)이 Lobby 재알림(300초)보다 이르다', () => {
	assert.ok(REAP_CHECK_IDLE_MS < LOBBY_REFRESH_MS);
});
