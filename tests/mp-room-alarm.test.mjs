import assert from 'node:assert/strict';
import test from 'node:test';
import { DISCONNECT_GRACE_MS, HOST_GRACE_MS, LOBBY_REFRESH_MS, REAP_CHECK_IDLE_MS, REAP_CHECK_PLAYING_MS, SOCKET_IDLE_MS, TIME_LIMIT_MS, VOTE_MS } from '../src/lib/mp/rules.ts';
import { NAMES, ofType, rig, T0 } from './do-runtime.mjs';

const POOL = { '3:6': [{ word: '바나나', jamo: 'ㅂㅏㄴㅏㄴㅏ' }] };
const VALID = ['ㅂㅏㄴㅏㄴㅏ', 'ㅋㅋㅋㅋㅋㅋ'];
const sec = (n) => T0 + n * 1000;

/** 지금 시각에 소켓들이 ping에 답한 것으로 한다. */
const beat = (r, ...players) => players.forEach((p) => r.ctx.ping(p.ws));

/** 알람이 걸려 있는 동안 소켓이 살아 있게 하며 울려 시각을 모은다. 걸린 알람이 stopAt을 넘으면 멈춘다. */
async function fireUntil(r, players, stopAt) {
	const fired = [];
	while (r.alarmAt() !== null && r.alarmAt() <= stopAt) {
		r.at(Math.max(Date.now(), r.alarmAt()));
		beat(r, ...players);
		fired.push((await r.fireAlarm()) - T0);
	}
	return fired;
}

test('대기실: 점검은 180초 주기로 울리고 Lobby 재알림은 300초에 한 번 더 간다', async (t) => {
	const r = await rig(t);
	const players = await r.players();
	assert.equal(r.alarmAt(), sec(30), '생성 때 건 소멸 시한 알람이 남아 있다');
	await r.settle();
	assert.equal(r.lobby.upserts().length, 2, '방장 입장과 게스트 입장');

	const fired = await fireUntil(r, players, sec(480));
	assert.deepEqual(fired, [30, 210, 300, 480].map((s) => s * 1000));
	assert.equal(r.lobby.upserts().length, 3, '300초에만 다시 알린다');
	assert.equal(r.ctx.storage.data.get('upsertAt'), sec(300));
	assert.equal(r.alarmAt(), sec(300 + LOBBY_REFRESH_MS / 1000), '다음은 재알림 600초가 점검 660초보다 이르다');
	assert.ok(r.alarmAt() < sec(480 + REAP_CHECK_IDLE_MS / 1000));
});

test('게임 중에는 점검 주기가 45초로 줄어든다', async (t) => {
	const r = await rig(t, { pool: POOL });
	const players = await r.players();
	await r.send(players[0].ws, { type: 'start' });
	r.at(sec(30));
	beat(r, ...players);
	await r.fireAlarm();
	assert.equal(r.alarmAt(), sec(30) + REAP_CHECK_PLAYING_MS);
});

test('제한 시간이 있는 판: 점검 알람 사이에 마감이 오면 마감 시각에 울려 판을 끝낸다', async (t) => {
	const r = await rig(t, { pool: POOL });
	const players = await r.players([NAMES[1]], { timer: true });
	await r.send(players[0].ws, { type: 'start' });
	const [host, guest] = players;
	host.ws.take();
	guest.ws.take();

	const fired = await fireUntil(r, players, sec(TIME_LIMIT_MS / 1000));
	assert.deepEqual(fired.map((ms) => ms / 1000), [30, 75, 120, 165, 180]);
	assert.equal(r.state().phase, 'result');
	assert.deepEqual(Object.values(r.state().game.players).map((p) => p.status), ['timeout', 'timeout']);
	const [snap] = ofType(host.ws.take(), 'snap').slice(-1);
	assert.equal(snap.snap.phase, 'result');
	assert.equal(r.lobby.upserts().at(-1).inProgress, false);
	assert.ok(r.ctx.storage.puts('state') > 0);
});

test('소켓 정리: 마지막 응답이 45초를 넘긴 소켓만 1001로 닫고 그 자리를 끊김으로 처리한다', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	r.at(sec(10));
	beat(r, host);
	r.at(sec(55));
	beat(r, guest);
	await r.fireAlarm({ stay: true });
	assert.equal(host.ws.closed, null, '10초에 응답했으니 55초에는 정확히 45초라 아직 살아 있다');
	assert.equal(guest.ws.closed, null);

	r.at(sec(55) + 1);
	beat(r, guest);
	await r.fireAlarm({ stay: true });
	assert.deepEqual(host.ws.closed, { code: 1001, reason: 'stale' });
	assert.deepEqual(host.ws.deserializeAttachment(), { pid: null, uid: null });
	assert.equal(guest.ws.closed, null);
	assert.equal(r.state().players.find((p) => p.pid === host.pid).connected, false);
	const [snap] = ofType(guest.ws.take(), 'snap').slice(-1);
	assert.equal(snap.snap.players.find((p) => p.pid === host.pid).connected, false);
});

test('응답이 한 번도 없는 소켓은 접속 시각 기준으로 정리한다', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	r.at(sec(46));
	beat(r, guest);
	await r.fireAlarm({ stay: true });
	assert.equal(host.ws.closed.reason, 'stale');
	assert.equal(guest.ws.closed, null);
	// 정리된 소켓의 close 이벤트가 뒤늦게 와도 이미 끊김 처리된 자리를 다시 바꾸지 않는다.
	const seq = r.state().seq;
	await r.drop(host.ws);
	assert.equal(r.state().seq, seq);
});

test('방장이 끊기면 5초 뒤 알람에서 접속 중인 다음 사람이 이어받고 방송한다', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	r.at(sec(1));
	await r.drop(host.ws);
	assert.equal(r.alarmAt(), sec(1) + HOST_GRACE_MS);
	guest.ws.take();

	r.at(sec(1) + HOST_GRACE_MS);
	beat(r, guest);
	await r.fireAlarm();
	assert.equal(r.state().hostPid, guest.pid);
	const [snap] = ofType(guest.ws.take(), 'snap');
	assert.equal(snap.snap.hostPid, guest.pid);
	assert.equal(snap.snap.host.reason !== undefined, true);
});

test('경쟁 중 끊긴 사람은 유예 60초 뒤 알람에서 탈락하고 나머지 판은 이어진다', async (t) => {
	const r = await rig(t, { pool: POOL });
	const players = await r.players([NAMES[1], NAMES[2]]);
	const [host, a, b] = players;
	await r.send(host.ws, { type: 'start' });
	r.at(sec(10));
	await r.drop(a.ws);
	host.ws.take();
	b.ws.take();

	await fireUntil(r, [host, b], sec(10) + DISCONNECT_GRACE_MS - 1);
	assert.equal(r.state().game.players[a.pid].status, 'playing');
	assert.equal(r.alarmAt(), sec(10) + DISCONNECT_GRACE_MS);
	const fired = await fireUntil(r, [host, b], sec(10) + DISCONNECT_GRACE_MS);
	assert.deepEqual(fired, [10_000 + DISCONNECT_GRACE_MS]);
	assert.equal(r.state().game.players[a.pid].status, 'eliminated');
	assert.equal(r.state().phase, 'playing');
	const [snap] = ofType(host.ws.take(), 'snap').slice(-1);
	assert.equal(snap.snap.players.find((p) => p.pid === a.pid).panel.status, 'eliminated');
});

test('협동 후보 투표는 마감 알람이 울리면 그 시점 표로 집계해 다음 제안으로 넘어간다', async (t) => {
	const r = await rig(t, { pool: POOL, valid: VALID });
	const [host, guest] = await r.players([NAMES[1]], { kind: 'coop' });
	await r.send(host.ws, { type: 'start' });
	await r.send(host.ws, { type: 'propose', jamo: 'ㅂㅏㄴㅏㄴㅏ' });
	await r.send(guest.ws, { type: 'propose', jamo: 'ㅋㅋㅋㅋㅋㅋ' });
	assert.equal(r.state().game.step.kind, 'vote');
	assert.equal(r.alarmAt(), T0 + VOTE_MS);
	host.ws.take();

	await r.send(host.ws, { type: 'vote', candidate: 0 });
	beat(r, host, guest);
	await r.fireAlarm();
	const g = r.state().game;
	assert.equal(g.step.kind, 'propose', '표를 집계한 뒤 다음 행의 제안 단계로 간다');
	assert.equal(g.board.rows.length, 1);
	assert.equal(g.lastPick.how, 'vote');
	assert.equal(g.board.rows[0], g.lastPick.candidates[g.lastPick.chosen]);
	assert.equal(ofType(guest.ws.take(), 'snap').at(-1).snap.game.board.rows.length, 1);
});

test('모두 끊겼다가 유예 안에 돌아오면 소멸 알람이 울려도 방은 남는다', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	await r.drop(host.ws);
	await r.drop(guest.ws);
	r.at(sec(20));
	const back = await r.hello(NAMES[1], guest.session.token);
	assert.equal(r.state().emptySince, null);
	r.at(sec(31));
	beat(r, back);
	await r.fireAlarm();
	assert.ok(r.state());
	assert.equal(back.ws.closed, null);
	assert.ok(r.alarmAt() > sec(31));
});

test('Lobby 알림: 접속 인원·방장·설정이 바뀔 때만 올리고 준비 토글은 올리지 않는다', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	await r.settle();
	const n = r.lobby.upserts().length;
	assert.equal(n, 2, '방장 입장과 게스트 입장');
	assert.deepEqual(r.lobby.upserts().map((u) => u.players), [1, 2]);

	await r.send(guest.ws, { type: 'ready', on: false });
	await r.send(guest.ws, { type: 'ready', on: true });
	assert.equal(r.lobby.upserts().length, n);

	await r.send(host.ws, { type: 'settings', settings: { ...r.state().settings, length: 9 } });
	await r.settle();
	assert.equal(r.lobby.upserts().length, n + 1);
	assert.equal(r.lobby.upserts().at(-1).length, 9);
	assert.equal(r.ctx.storage.puts('upsertAt'), n + 1);
});

test('Lobby 알림이 실패하면 요약이 같아도 다음 동기화에서 다시 올린다', async (t) => {
	const r = await rig(t);
	r.lobby.fail.upsert = new Error('lobby down');
	const [, guest] = await r.players();
	await r.settle();
	assert.equal(r.ctx.storage.puts('upsertAt'), 0, '실패한 알림은 upsertAt을 남기지 않는다');
	const failed = r.lobby.upserts().length;

	delete r.lobby.fail.upsert;
	await r.send(guest.ws, { type: 'ready', on: false });
	await r.settle();
	assert.equal(r.lobby.upserts().length, failed + 1);
	assert.equal(r.ctx.storage.puts('upsertAt'), 1);
	await r.send(guest.ws, { type: 'ready', on: true });
	assert.equal(r.lobby.upserts().length, failed + 1, '성공한 뒤에는 같은 요약을 다시 올리지 않는다');
});

test('목록에서 지우는 호출이 실패하면 다음 동기화에서 다시 지운다', async (t) => {
	const r = await rig(t);
	const [host, guest] = await r.players();
	await r.settle();
	r.lobby.fail.remove = new Error('lobby down');
	await r.drop(host.ws);
	await r.drop(guest.ws);
	await r.settle();
	assert.deepEqual(r.lobby.removes(), ['ABC234']);

	// 두 번째 close 이벤트가 같은 자리에 다시 와도 run을 지나 동기화한다.
	await r.room.webSocketClose(guest.ws, 1000).catch(() => {});
	await r.settle();
	assert.equal(r.lobby.removes().length, 2);
	delete r.lobby.fail.remove;
	await r.room.webSocketClose(guest.ws, 1000).catch(() => {});
	await r.settle();
	assert.equal(r.lobby.removes().length, 3);
	await r.room.webSocketClose(guest.ws, 1000).catch(() => {});
	assert.equal(r.lobby.removes().length, 3, '지운 뒤에는 더 부르지 않는다');
});

test('상수: 소켓 무응답 한도는 점검 주기와 같은 45초다', () => {
	assert.equal(SOCKET_IDLE_MS, REAP_CHECK_PLAYING_MS);
});
