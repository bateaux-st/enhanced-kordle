import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, EMPTY_ROOM_MS, HOST_GRACE_MS, LOBBY_REFRESH_MS } from '../src/lib/mp/rules.ts';
import { disconnect, join, leave, reconcile } from '../src/lib/server/mp/members.ts';
import { reduce } from '../src/lib/server/mp/reduce.ts';
import { initRoom } from '../src/lib/server/mp/state.ts';
import { abandoned, alarmTarget, nextDeadline, tick } from '../src/lib/server/mp/timers.ts';
import { joinAll, lobby, rng, started, T0 } from './mp-helpers.mjs';

test('마감이 없으면 null', () => {
	const s = lobby();
	joinAll(s, ['가']);
	assert.equal(nextDeadline(s), null);
});

test('빈 방: 접속자가 0이 된 뒤 30초에 소멸, 그 전에는 유지', () => {
	const s = lobby();
	const [host, a] = joinAll(s, ['가']);
	disconnect(s, host, T0 + 1000);
	assert.equal(s.emptySince, null, '한 명이 남아 있으면 빈 방이 아니다');
	leave(s, a, T0 + 2000);
	assert.equal(s.emptySince, T0 + 2000);
	assert.equal(nextDeadline(s), T0 + 2000 + EMPTY_ROOM_MS);
	assert.deepEqual(tick(s, T0 + 2000 + EMPTY_ROOM_MS - 1), { changed: false, destroy: false });
	assert.deepEqual(tick(s, T0 + 2000 + EMPTY_ROOM_MS), { changed: false, destroy: true });
});

test('빈 방이 되었다가 30초 안에 다시 들어오면 소멸하지 않는다', () => {
	const s = lobby();
	const [host] = s.players.map((p) => p.pid);
	disconnect(s, host, T0);
	assert.equal(s.emptySince, T0);
	join(s, { uid: 'uid-host', name: '방장' }, T0 + EMPTY_ROOM_MS - 1, rng);
	assert.equal(s.emptySince, null);
	assert.equal(tick(s, T0 + EMPTY_ROOM_MS + 1).destroy, false);
	assert.equal(nextDeadline(s), null);
});

test('방장이 끊기면 정확히 5초째에 입장 순으로 접속 중인 다음 사람에게 승계', () => {
	const s = lobby();
	const [host, a, b] = joinAll(s, ['가', '나']);
	disconnect(s, host, T0);
	assert.equal(nextDeadline(s), T0 + HOST_GRACE_MS);
	assert.deepEqual(tick(s, T0 + HOST_GRACE_MS - 1), { changed: false, destroy: false });
	assert.equal(s.hostPid, host);
	assert.deepEqual(tick(s, T0 + HOST_GRACE_MS), { changed: true, destroy: false });
	assert.equal(s.hostPid, a);
	assert.notEqual(s.hostPid, b);
	assert.equal(nextDeadline(s), null, '승계 뒤에는 마감이 남지 않는다');
});

test('5초 안에 같은 uid로 돌아오면 방장 유지', () => {
	const s = lobby();
	const [host] = joinAll(s, ['가']);
	disconnect(s, host, T0);
	join(s, { uid: 'uid-host', name: '방장' }, T0 + 4999, rng);
	assert.deepEqual(tick(s, T0 + HOST_GRACE_MS + 1), { changed: false, destroy: false });
	assert.equal(s.hostPid, host);
	assert.equal(nextDeadline(s), null);
});

test('이어받을 접속자가 없으면 방장 유예 마감을 걸지 않는다(알람이 헛돌지 않게)', () => {
	const s = lobby();
	const [host, a] = joinAll(s, ['가']);
	disconnect(s, a, T0);
	disconnect(s, host, T0 + 100);
	assert.equal(nextDeadline(s), T0 + 100 + EMPTY_ROOM_MS, '남은 마감은 빈 방 소멸뿐');
	assert.deepEqual(tick(s, T0 + 100 + HOST_GRACE_MS + 1), { changed: false, destroy: false });
	assert.equal(s.hostPid, host);
});

test('여러 마감 중 가장 이른 것을 고른다', () => {
	const s = lobby();
	const [host, a] = joinAll(s, ['가']);
	disconnect(s, host, T0 + 20_000);
	// 정상 흐름에서는 동시에 걸리지 않으므로 상태를 직접 만든다.
	s.emptySince = T0;
	assert.equal(nextDeadline(s), T0 + 20_000 + HOST_GRACE_MS);
	s.players.find((p) => p.pid === a).connected = false;
	assert.equal(nextDeadline(s), T0 + EMPTY_ROOM_MS);
});

test('tick은 멱등: 같은 now로 두 번 불러도 상태와 결과가 같다', () => {
	const s = lobby();
	const [host] = joinAll(s, ['가']);
	disconnect(s, host, T0);
	const first = tick(s, T0 + 6000);
	const after = JSON.stringify(s);
	const second = tick(s, T0 + 6000);
	assert.equal(first.changed, true);
	assert.deepEqual(second, { changed: false, destroy: false });
	assert.equal(JSON.stringify(s), after);

	const empty = lobby();
	leave(empty, host, T0);
	const t = T0 + EMPTY_ROOM_MS;
	assert.deepEqual(tick(empty, t), tick(empty, t));
});

test('방 생성 직후 방장 자리는 예약: 생성자가 5초 안에 오면 유지, 오지 않으면 먼저 온 사람이 이어받는다', () => {
	const make = () => {
		const s = initRoom('ABC234', { uid: 'uid-creator', name: '생성자' }, DEFAULT_SETTINGS, T0, rng);
		const other = join(s, { uid: 'uid-other', name: '손님' }, T0 + 1000, rng);
		return { s, other, creator: s.hostPid };
	};

	let { s, creator } = make();
	assert.equal(s.emptySince, null, '손님이 들어와 접속자가 있다');
	tick(s, T0 + 3000);
	assert.equal(s.hostPid, creator, '유예 안에는 생성자가 방장');
	join(s, { uid: 'uid-creator', name: '생성자' }, T0 + 4000, rng);
	tick(s, T0 + 10_000);
	assert.equal(s.hostPid, creator);

	let other;
	({ s, other, creator } = make());
	assert.equal(nextDeadline(s), T0 + HOST_GRACE_MS);
	tick(s, T0 + HOST_GRACE_MS);
	assert.equal(s.hostPid, other.pid);
	assert.notEqual(s.hostPid, creator);
});

test('생성 후 아무도 오지 않으면 30초 뒤 소멸', () => {
	const s = initRoom('ABC234', { uid: 'uid-creator', name: '생성자' }, DEFAULT_SETTINGS, T0, rng);
	assert.equal(nextDeadline(s), T0 + EMPTY_ROOM_MS);
	assert.equal(tick(s, T0 + EMPTY_ROOM_MS).destroy, true);
});

test('로비에서 마지막 사람이 나가기로 떠나면 유예 없이 소멸', () => {
	const s = lobby();
	const [host, a] = joinAll(s, ['가']);
	assert.equal(reduce(s, a, { type: 'leave' }, {}, T0 + 1, rng).destroy, false);
	const last = reduce(s, host, { type: 'leave' }, {}, T0 + 2, rng);
	assert.equal(last.destroy, true);
	assert.deepEqual(s.players, []);
});

test('끊김이 하나라도 섞이면 30초 유예: 나가기만으로는 소멸하지 않고, 끊긴 사람이 돌아올 수 있다', () => {
	const s = lobby();
	const [host, a] = joinAll(s, ['가']);
	disconnect(s, a, T0 + 1);
	const last = reduce(s, host, { type: 'leave' }, {}, T0 + 2, rng);
	assert.equal(last.destroy, false);
	assert.equal(s.emptySince, T0 + 2);
	assert.equal(tick(s, T0 + 2 + EMPTY_ROOM_MS - 1).destroy, false);
	join(s, { uid: 'uid-가', name: '가' }, T0 + 5000, rng);
	assert.equal(s.emptySince, null);
	assert.equal(tick(s, T0 + 2 + EMPTY_ROOM_MS).destroy, false);
});

test('자리가 0개인 방은 tick에서도 즉시 소멸 대상', () => {
	const s = lobby();
	leave(s, s.hostPid, T0);
	assert.equal(abandoned(s), true);
	assert.deepEqual(tick(s, T0), { changed: false, destroy: true });
});

test('게임 중 전원이 나가기로 떠나면 게임이 끝나는 순간 자리가 치워져 즉시 소멸', () => {
	const { s, pids } = started(['가']);
	const [host, a] = pids;
	assert.equal(reduce(s, a, { type: 'leave' }, {}, T0 + 1, rng).destroy, false);
	assert.equal(s.phase, 'playing');
	const last = reduce(s, host, { type: 'leave' }, {}, T0 + 2, rng);
	assert.equal(last.destroy, true);
	assert.equal(s.players.length, 0);
});

test('게임 중 나가기와 끊김이 섞이면 소멸하지 않고 30초 유예', () => {
	const { s, pids } = started(['가']);
	const [host, a] = pids;
	disconnect(s, a, T0 + 1);
	const last = reduce(s, host, { type: 'leave' }, {}, T0 + 2, rng);
	assert.equal(last.destroy, false);
	assert.equal(s.phase, 'playing', '끊긴 사람은 아직 진행 중이라 게임은 안 끝난다');
	assert.deepEqual(s.players.map((p) => p.pid), [host, a]);
	assert.equal(s.emptySince, T0 + 2);
	assert.equal(tick(s, T0 + 2 + EMPTY_ROOM_MS).destroy, true);
});

test('알람 시각: 접속자가 없으면 낡은 lastUpsert로 만든 재알림을 후보에 넣지 않는다', () => {
	// 생성 직후(lastUpsert=0, 생성자 미접속)에 과거 값이 후보가 되면 알람이 곧바로 반복된다.
	const s = initRoom('ABC234', { uid: 'uid-creator', name: '생성자' }, DEFAULT_SETTINGS, T0, rng);
	assert.equal(alarmTarget(s, 0), T0 + EMPTY_ROOM_MS);
	assert.ok(alarmTarget(s, 0) > T0, '과거 시각이 아니다');
});

test('알람 시각: 접속자가 있으면 재알림과 마감 중 이른 것, 마감이 없으면 재알림', () => {
	const s = lobby();
	joinAll(s, ['가']);
	assert.equal(alarmTarget(s, T0), T0 + LOBBY_REFRESH_MS);
	disconnect(s, s.hostPid, T0 + 1000);
	assert.equal(alarmTarget(s, T0), T0 + 1000 + HOST_GRACE_MS, '방장 유예가 재알림보다 이르다');
});

test('알람 시각: 접속자도 마감도 없으면 null(알람을 걸지 않는다)', () => {
	const s = lobby();
	joinAll(s, ['가']);
	for (const p of s.players) p.connected = false;
	s.emptySince = null;
	for (const p of s.players) p.disconnectedAt = null;
	assert.equal(alarmTarget(s, 0), null);
});

test('빈 방 유예는 30초', () => {
	assert.equal(EMPTY_ROOM_MS, 30_000);
	const s = lobby();
	disconnect(s, s.hostPid, T0);
	assert.equal(tick(s, T0 + 29_999).destroy, false);
	assert.equal(tick(s, T0 + 30_000).destroy, true);
});

test('심장박동: 접속자가 있는 방만 LOBBY_REFRESH_MS(60초)마다 알람 후보, 접속자가 0이면 마감만', () => {
	assert.equal(LOBBY_REFRESH_MS, 60_000);
	const s = lobby();
	joinAll(s, ['가']);
	assert.equal(alarmTarget(s, T0), T0 + LOBBY_REFRESH_MS);
	for (const p of s.players) disconnect(s, p.pid, T0 + 5);
	assert.equal(alarmTarget(s, T0), T0 + 5 + EMPTY_ROOM_MS, '접속자 0: 심장박동 없이 소멸 마감만');
});

test('재시작 화해 뒤의 방: 소켓이 없으면 emptySince가 시작돼 30초 뒤 소멸한다', () => {
	const s = lobby();
	joinAll(s, ['가']);
	assert.equal(nextDeadline(s), null, '화해 전에는 connected를 믿어 마감이 없다');
	reconcile(s, [], T0 + 100);
	assert.equal(nextDeadline(s), T0 + 100 + EMPTY_ROOM_MS);
	assert.equal(tick(s, T0 + 100 + EMPTY_ROOM_MS).destroy, true);
});
