import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOSE } from '../src/lib/mp/protocol.ts';
import { CHAT_BURST, CHAT_WINDOW_MS, DISCONNECT_GRACE_MS, MAX_PLAYERS, SESSION_TTL_MS } from '../src/lib/mp/rules.ts';
import { verify } from '../src/lib/server/mp/session.ts';
import { NAMES, ofType, rig, T0 } from './do-runtime.mjs';

const POOL = { '3:6': [{ word: '바나나', jamo: 'ㅂㅏㄴㅏㄴㅏ' }] };
const ANSWER_JAMO = 'ㅂㅏㄴㅏㄴㅏ';

/** 대기실에서 시작해 진행 중인 경쟁 단판. 받은 메시지는 비워 둔다. */
async function playing(t, names = [NAMES[1]], settings = {}) {
	const r = await rig(t, { pool: POOL, valid: [ANSWER_JAMO, 'ㅋㅋㅋㅋㅋㅋ'] });
	const ps = await r.players(names, settings);
	await r.send(ps[0].ws, { type: 'start' });
	assert.equal(r.state().phase, 'playing');
	for (const p of ps) p.ws.take();
	return { r, ps, host: ps[0], guest: ps[1] };
}

test('hello: welcome, chat_history, snap 순서로 답하고 snap에만 세션 토큰을 싣는다', async (t) => {
	const r = await rig(t);
	const host = await r.open();
	assert.deepEqual(host.msgs.map((m) => m.type), ['welcome', 'chat_history', 'snap']);
	assert.deepEqual(host.msgs[0], { type: 'welcome', pid: host.pid, name: NAMES[0] });
	assert.deepEqual(host.msgs[1], { type: 'chat_history', msgs: [] });
	const { snap, session } = host.msgs[2];
	assert.equal(snap.you, host.pid);
	assert.equal(snap.hostPid, host.pid);
	assert.equal(snap.code, 'ABC234');
	assert.equal(session.exp, T0 + SESSION_TTL_MS);
	assert.equal((await verify(session.token, T0, r.secret)).name, NAMES[0]);

	const guest = await r.hello(NAMES[1]);
	assert.equal(ofType(guest.msgs, 'snap')[0].session.exp, T0 + SESSION_TTL_MS, '입장한 본인은 첫 snap에 세션을 받는다');
	assert.equal(ofType(host.ws.take(), 'snap')[0].session, undefined, '다른 사람에게 가는 snap에는 세션이 없다');
	await r.send(guest.ws, { type: 'ready', on: true });
	assert.equal(ofType(guest.ws.take(), 'snap')[0].session, undefined, '세션은 첫 snap 한 번뿐이다');
});

test('시크릿이 없으면 dev 기본값으로 서명한다', async (t) => {
	const r = await rig(t, { secret: null });
	await r.create({}, { uid: 'creator-uid', name: NAMES[0] });
	const p = await r.hello(NAMES[1]);
	assert.ok(await verify(p.session.token, T0, 'dev-only-secret'));
	assert.equal(await verify(p.session.token, T0, 'test-secret'), null);
});

test('발급된 토큰으로 다시 hello하면 같은 자리로 돌아오고, 알 수 없는 토큰은 새 자리를 만든다', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	await r.drop(guest.ws);
	assert.equal(r.state().players.find((p) => p.pid === guest.pid).connected, false);

	const back = await r.hello(NAMES[1], guest.session.token);
	assert.equal(back.pid, guest.pid);
	assert.equal(r.state().players.length, 2);
	assert.equal(r.state().players.find((p) => p.pid === guest.pid).connected, true);
	assert.equal(r.state().players.find((p) => p.pid === guest.pid).ready, false, '돌아오면 준비는 풀린다');

	const stranger = await r.hello(NAMES[2], 'mp1.garbage.token');
	assert.notEqual(stranger.pid, guest.pid);
	assert.equal(r.state().players.length, 3);
	assert.equal(ofType(host.ws.take(), 'snap').length, 3, '끊김, 복귀, 새 입장이 각각 방송된다');
});

test('닉네임 규칙을 어기면 error 뒤 1008로 닫고 자리를 만들지 않는다', async (t) => {
	const r = await rig(t);
	await r.open();
	const seq = r.state().seq;
	const ws = await r.connect();
	await r.send(ws, { type: 'hello', name: '가나다라' });
	assert.deepEqual(ws.take(), [{ type: 'error', code: 'forbidden', msg: '닉네임은 5~12자여야 합니다' }]);
	assert.deepEqual(ws.closed, { code: 1008, reason: 'bad name' });
	assert.equal(r.state().seq, seq);
	assert.equal(r.state().players.length, 1);
	assert.equal(ws.deserializeAttachment().pid, null);
});

test('깨진 메시지는 error로만 답하고 소켓과 저장은 그대로, 바이너리는 무시한다', async (t) => {
	const r = await rig(t);
	await r.open();
	const ws = await r.connect();
	const ops = r.ctx.storage.ops.length;
	for (const bad of ['not json', '[]', '{"type":"nope"}', JSON.stringify({ type: 'hello', name: 5 }), 'x'.repeat(5000)]) {
		await r.send(ws, bad);
		assert.deepEqual(ws.take(), [{ type: 'error', code: 'forbidden', msg: '잘못된 요청입니다' }], bad.slice(0, 20));
	}
	await r.room.webSocketMessage(ws, new ArrayBuffer(4));
	assert.deepEqual(ws.sent, []);
	assert.equal(ws.closed, null);
	assert.equal(r.ctx.storage.ops.length, ops);
});

test('hello 전의 행동과 두 번째 hello는 거절한다', async (t) => {
	const r = await rig(t);
	const host = await r.open();
	const ws = await r.connect();
	await r.send(ws, { type: 'ready', on: true });
	await r.send(ws, { type: 'chat', text: '안녕하세요' });
	assert.deepEqual(ws.take().map((m) => m.msg), ['먼저 입장해야 합니다', '먼저 입장해야 합니다']);

	await r.send(host.ws, { type: 'hello', name: NAMES[0] });
	assert.deepEqual(host.ws.take(), [{ type: 'error', code: 'forbidden', msg: '이미 입장했습니다' }]);
});

test('같은 uid가 새 소켓으로 들어오면 이전 소켓은 4000으로 닫히고 자리는 끊기지 않는다', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	const second = await r.hello(NAMES[1], guest.session.token);
	assert.equal(second.pid, guest.pid);
	assert.deepEqual(guest.ws.closed, { code: CLOSE.REPLACED, reason: 'replaced' });
	assert.deepEqual(guest.ws.deserializeAttachment(), { pid: null, uid: null });

	const seq = r.state().seq;
	await r.drop(guest.ws, 1000);
	assert.equal(r.state().seq, seq, '넘겨준 소켓의 close 이벤트는 끊김이 아니다');
	assert.equal(r.state().players.find((p) => p.pid === guest.pid).connected, true);

	await r.send(guest.ws, { type: 'ready', on: true });
	assert.equal(r.state().seq, seq, '자리를 잃은 소켓의 메시지는 상태를 바꾸지 않는다');
	assert.equal(ofType(host.ws.take(), 'snap').length >= 1, true);
});

test('정원 5명이 차면 새 사람은 4001로 닫힌다. 60초 넘게 끊긴 사람이 있으면 그 자리를 쓴다', async (t) => {
	const r = await rig(t);
	const ps = await r.players(NAMES.slice(1, MAX_PLAYERS));
	assert.equal(r.state().players.length, MAX_PLAYERS);
	const seq = r.state().seq;

	const sixth = await r.hello(NAMES[5]);
	assert.deepEqual(sixth.ws.closed, { code: CLOSE.FULL, reason: 'full' });
	assert.equal(sixth.pid, undefined);
	assert.equal(r.state().seq, seq);
	assert.equal(r.state().players.length, MAX_PLAYERS);

	await r.drop(ps[4].ws);
	r.advance(DISCONNECT_GRACE_MS - 1);
	assert.equal((await r.hello('여섯째접속자')).ws.closed?.code, CLOSE.FULL, '59.999초 끊긴 자리는 지키는 중이다');
	r.advance(1);
	const seventh = await r.hello('일곱째접속자');
	assert.equal(seventh.ws.closed, null);
	assert.ok(!r.state().players.some((p) => p.pid === ps[4].pid), '끊긴 지 60초가 된 자리는 회수된다');
	assert.equal(r.state().players.length, MAX_PLAYERS);
});

test('진행 중인 방은 새 사람을 4002로 닫고, 기존 참가자는 같은 토큰으로 돌아온다', async (t) => {
	const { r, host, guest } = await playing(t);
	const late = await r.hello(NAMES[3]);
	assert.deepEqual(late.ws.closed, { code: CLOSE.IN_PROGRESS, reason: 'in_progress' });

	await r.drop(guest.ws);
	const back = await r.hello(NAMES[1], guest.session.token);
	assert.equal(back.pid, guest.pid);
	assert.equal(back.ws.closed, null);
	assert.equal(ofType(host.ws.take(), 'snap').length >= 1, true);
});

test('나가기로 떠난 참가자는 그 판이 끝나기 전에는 돌아올 수 없다', async (t) => {
	const { r, host, guest } = await playing(t, [NAMES[1], NAMES[2]]);
	await r.send(guest.ws, { type: 'leave' });
	assert.deepEqual(guest.ws.closed, { code: 1000, reason: 'left' });
	const back = await r.hello(NAMES[1], guest.session.token);
	assert.deepEqual(back.ws.closed, { code: CLOSE.IN_PROGRESS, reason: 'in_progress' });
	assert.equal(r.state().players.find((p) => p.pid === guest.pid).left, true);
	assert.equal(host.ws.closed, null);
});

test('close 이벤트: 소켓이 끊긴 자리는 끊김으로 저장·방송한다(답장 close는 런타임이 보내므로 서버는 닫지 않는다)', async (t) => {
	const r = await rig(t);
	const [host, a, b] = await r.players([NAMES[1], NAMES[2]]);
	const seq = r.state().seq;

	await r.drop(a.ws, 1005);
	assert.equal(a.ws.closed, null);
	await r.drop(b.ws, 1006);
	assert.equal(b.ws.closed, null);
	assert.equal(r.state().seq, seq + 2);
	assert.deepEqual(r.state().players.map((p) => p.connected), [true, false, false]);
	const snaps = ofType(host.ws.take(), 'snap');
	assert.equal(snaps.length, 2);
	assert.deepEqual(snaps[1].snap.players.map((p) => p.connected), [true, false, false]);
});

test('close 이벤트의 정상 코드도 서버는 답장 close를 보내지 않고 끊김만 저장한다', async (t) => {
	const r = await rig(t);
	const [, a] = await r.players();
	await r.drop(a.ws, 1001);
	assert.equal(a.ws.closed, null);
	assert.equal(r.state().players[1].connected, false);
});

test('error 이벤트도 끊김으로 처리한다', async (t) => {
	const r = await rig(t);
	const [host, a] = await r.players();
	a.ws.readyState = 3;
	await r.room.webSocketError(a.ws);
	assert.equal(r.state().players.find((p) => p.pid === a.pid).connected, false);
	assert.equal(ofType(host.ws.take(), 'snap').length, 1);
});

test('같은 자리에 열린 다른 소켓이 남아 있으면 close 이벤트는 끊김이 아니다', async (t) => {
	const r = await rig(t);
	const [, a] = await r.players();
	const twin = await r.connect();
	twin.serializeAttachment(a.ws.deserializeAttachment());
	const seq = r.state().seq;
	await r.drop(a.ws);
	assert.equal(r.state().seq, seq);
	assert.equal(r.state().players.find((p) => p.pid === a.pid).connected, true);
});

test('자리를 잃은 첨부(방에 없는 pid)로 온 메시지는 4004 no seat', async (t) => {
	const r = await rig(t);
	await r.open();
	const ws = await r.connect();
	ws.serializeAttachment({ pid: 'pnobody', uid: 'ghost' });
	await r.send(ws, { type: 'ready', on: true });
	assert.deepEqual(ws.closed, { code: CLOSE.NO_ROOM, reason: 'no seat' });
});

test('방송은 소켓마다 그 사람 기준 snap을 보내고, 입장 전·닫힌 소켓에는 보내지 않는다', async (t) => {
	const { r, host, guest } = await playing(t);
	const raw = await r.connect();
	const gone = await r.connect();
	gone.serializeAttachment({ pid: host.pid, uid: 'x' });
	gone.readyState = 3;

	await r.send(guest.ws, { type: 'guess', jamo: 'ㅋㅋㅋㅋㅋㅋ' });
	const [hs] = ofType(host.ws.take(), 'snap');
	const [gs] = ofType(guest.ws.take(), 'snap');
	assert.equal(hs.snap.you, host.pid);
	assert.equal(gs.snap.you, guest.pid);
	assert.equal(gs.snap.game.me.rows.length, 1);
	assert.equal(hs.snap.game.me.rows.length, 0);
	const theirPanel = hs.snap.players.find((p) => p.pid === guest.pid).panel;
	assert.equal(theirPanel.marks.length, 1);
	assert.ok(!('rows' in theirPanel), '남의 보드에는 자모가 없다');
	assert.deepEqual(raw.sent, []);
	assert.deepEqual(gone.sent, []);
	assert.ok(!JSON.stringify([hs, gs]).includes(ANSWER_JAMO), '진행 중에는 정답이 어느 소켓에도 가지 않는다');
});

test('채팅은 입장한 열린 소켓 전원에게 가고 저장하지 않으며, 5초에 5개를 넘으면 보낸 사람만 거절당한다', async (t) => {
	const r = await rig(t);
	const [host, a] = await r.players();
	const raw = await r.connect();
	const stale = await r.connect();
	stale.serializeAttachment({ pid: a.pid, uid: 'x' });
	stale.readyState = 3;
	const ops = r.ctx.storage.ops.length;

	await r.send(a.ws, { type: 'chat', text: '  안녕하세요  ' });
	for (const ws of [host.ws, a.ws]) {
		const [chat] = ofType(ws.take(), 'chat');
		assert.deepEqual([chat.msg.pid, chat.msg.name, chat.msg.text, chat.msg.at], [a.pid, NAMES[1], '안녕하세요', T0]);
	}
	assert.deepEqual([raw.sent, stale.sent], [[], []]);
	assert.equal(r.ctx.storage.ops.length, ops, '채팅은 저장하지 않는다');

	for (let i = 1; i < CHAT_BURST; i++) await r.send(a.ws, { type: 'chat', text: `메시지${i}` });
	host.ws.take();
	a.ws.take();
	await r.send(a.ws, { type: 'chat', text: '여섯째' });
	assert.deepEqual(a.ws.take(), [{ type: 'error', code: 'cooldown', msg: '채팅을 너무 빨리 보내고 있습니다' }]);
	assert.deepEqual(host.ws.sent, []);

	r.advance(CHAT_WINDOW_MS);
	await r.send(a.ws, { type: 'chat', text: '다시 보냄' });
	assert.equal(ofType(host.ws.take(), 'chat').length, 1);
});

test('채팅 기록은 입장하는 사람에게만 chat_history로 간다', async (t) => {
	const r = await rig(t);
	const [host] = await r.players();
	await r.send(host.ws, { type: 'chat', text: '첫째' });
	await r.send(host.ws, { type: 'chat', text: '둘째' });
	const late = await r.hello(NAMES[3]);
	assert.deepEqual(ofType(late.msgs, 'chat_history')[0].msgs.map((m) => m.text), ['첫째', '둘째']);
	assert.deepEqual(ofType(late.msgs, 'chat_history')[0].msgs.map((m) => m.id), [1, 2]);
});

test('재촉은 방장에게만 nudge로 가고 쿨다운에 걸리면 보낸 사람에게 error', async (t) => {
	const r = await rig(t);
	const [host, a, b] = await r.players([NAMES[1], NAMES[2]]);
	await r.send(a.ws, { type: 'nudge' });
	assert.deepEqual(ofType(host.ws.take(), 'nudge'), [{ type: 'nudge', from: NAMES[1] }]);
	assert.deepEqual(ofType(b.ws.take(), 'nudge'), []);
	a.ws.take();
	await r.send(a.ws, { type: 'nudge' });
	assert.equal(ofType(a.ws.take(), 'error')[0].code, 'cooldown');
	assert.deepEqual(ofType(host.ws.take(), 'nudge'), []);
});

test('결과에서 방장이 next를 보내면 방장 소켓에만 opensettings가 간다', async (t) => {
	const { r, host, guest } = await playing(t);
	await r.send(host.ws, { type: 'giveup' });
	await r.send(guest.ws, { type: 'giveup' });
	assert.equal(r.state().phase, 'result');
	host.ws.take();
	guest.ws.take();

	await r.send(host.ws, { type: 'next' });
	assert.deepEqual(ofType(host.ws.take(), 'opensettings'), [{ type: 'opensettings' }]);
	assert.deepEqual(ofType(guest.ws.take(), 'opensettings'), []);
	assert.equal(r.state().phase, 'lobby');
});
