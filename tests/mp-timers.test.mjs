import assert from 'node:assert/strict';
import test from 'node:test';
import { CLIMB_GRACE_MS, DEFAULT_SETTINGS, DISCONNECT_GRACE_MS, EMPTY_ROOM_MS, HOST_GRACE_MS, LOBBY_REFRESH_MS, SOCKET_IDLE_MS, STAGE_CLEAR_MS, TIME_LIMIT_MS } from '../src/lib/mp/rules.ts';
import { stageLimitMs } from '../src/lib/server/mp/climb.ts';
import { applyGuess, giveUp } from '../src/lib/server/mp/comp.ts';
import * as coop from '../src/lib/server/mp/coop.ts';
import { disconnect, join, leave, reconcile } from '../src/lib/server/mp/members.ts';
import { reduce } from '../src/lib/server/mp/reduce.ts';
import { personalize } from '../src/lib/server/mp/snapshot.ts';
import { initRoom } from '../src/lib/server/mp/state.ts';
import { abandoned, alarmTarget, isStaleSocket, nextDeadline, reapCheckAt, tick } from '../src/lib/server/mp/timers.ts';
import { ANSWER, compClimbStarted, coopClimbStarted, coopStarted, joinAll, lobby, rng, stageAnswer, started, T0, wrongRow } from './mp-helpers.mjs';

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

test('등반 유예 마감: 첫 완주 뒤 playing인 동안만 마감 후보, 알람은 그 시각 하나로 걸린다', () => {
	const { s, pids } = compClimbStarted(['가'], { tries: 4 });
	assert.equal(nextDeadline(s), null);
	for (let n = 10; n <= 12; n++) applyGuess(s, pids[0], stageAnswer(n).jamo, true, T0 + 5);
	assert.equal(nextDeadline(s), T0 + 5 + CLIMB_GRACE_MS);
	assert.equal(alarmTarget(s, T0 + 30_000), T0 + 5 + CLIMB_GRACE_MS, '재알림이 더 늦으면 유예 마감이 알람 시각');
	s.phase = 'lobby';
	assert.equal(nextDeadline(s), null, '게임이 끝나면 마감이 남지 않는다');
});

test('등반 유예 만료 tick: 같은 now로 두 번 불러도 같고, 한 틱에 방장 승계와 함께 처리된다', () => {
	const { s, pids } = compClimbStarted(['가'], { tries: 4 });
	for (let n = 10; n <= 12; n++) applyGuess(s, pids[0], stageAnswer(n).jamo, true, T0 + 5);
	disconnect(s, pids[0], T0 + 6);
	const due = T0 + 5 + CLIMB_GRACE_MS;
	assert.deepEqual(tick(s, due), { changed: true, destroy: false });
	assert.deepEqual([s.phase, s.game.players[pids[1]].status, s.hostPid], ['result', 'timeout', pids[1]]);
	const after = JSON.stringify(s);
	assert.deepEqual(tick(s, due), { changed: false, destroy: false });
	assert.equal(JSON.stringify(s), after);
});

// ---- 5단계: 제한 시간 ----

const ON = { timer: true };
const SEC = 1000;
const status = (s, pid) => s.game.players[pid].status;
/** 협동에서 접속 중인 모두가 같은 단어를 내 한 행을 푼다. */
const coopSolve = (s, jamo, now) => {
	for (const p of s.players) if (p.connected) coop.propose(s, p.pid, jamo, true, rng, now);
};

test('스테이지 제한 시간 표: 180에서 15초씩 줄어 60초 아래로 내려가지 않는다', () => {
	assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => stageLimitMs(k) / SEC), [180, 165, 150, 135, 120, 105, 90, 75, 60, 60, 60]);
});

test('제한 시간을 끈 방은 어느 게임이든 마감이 null이고 시간으로 끝나지 않는다', () => {
	const single = started(['가']);
	assert.deepEqual(Object.values(single.s.game.players).map((p) => p.board.deadline), [null, null]);
	assert.equal(nextDeadline(single.s), null);
	assert.deepEqual(tick(single.s, T0 + 10 * TIME_LIMIT_MS), { changed: false, destroy: false });
	assert.equal(single.s.phase, 'playing');

	const { s, pids } = compClimbStarted(['가'], {}, 5);
	applyGuess(s, pids[0], stageAnswer(5).jamo, true, T0 + 100);
	assert.equal(s.game.players[pids[0]].board.deadline, null, '다음 스테이지도 null');
	assert.equal(nextDeadline(s), null);

	const c = coopClimbStarted(['가'], {}, 5);
	coopSolve(c.s, stageAnswer(5).jamo, T0 + 100);
	assert.equal(c.s.game.board.stage, 2);
	assert.equal(c.s.game.board.deadline, null);
	assert.equal(nextDeadline(c.s), null);
	assert.equal(tick(c.s, T0 + 10 * TIME_LIMIT_MS).changed, false);
});

test('경쟁 단판: 시작 시각 + 180초가 각자 보드의 마감, 만료 전에는 아무 일도 없다', () => {
	const { s, pids } = started(['가'], ON);
	assert.ok(pids.every((pid) => s.game.players[pid].board.deadline === T0 + TIME_LIMIT_MS));
	assert.equal(nextDeadline(s), T0 + TIME_LIMIT_MS);
	assert.deepEqual(tick(s, T0 + TIME_LIMIT_MS - 1), { changed: false, destroy: false });
	assert.equal(s.phase, 'playing');
});

test('경쟁 단판 만료: 정답자는 그대로, 못 푼 사람은 마감 시각으로 timeout, 전원 끝나 결과로 간다', () => {
	const { s, pids } = started(['가'], ON);
	const [host, a] = pids;
	applyGuess(s, host, ANSWER.jamo, true, T0 + 10 * SEC);
	assert.equal(nextDeadline(s), T0 + TIME_LIMIT_MS, '정답자의 마감은 후보가 아니다');
	const late = T0 + TIME_LIMIT_MS + 30 * SEC;
	assert.deepEqual(tick(s, late), { changed: true, destroy: false });
	assert.deepEqual([status(s, host), status(s, a), s.phase], ['solved', 'timeout', 'result']);
	assert.equal(s.game.players[a].finishedAt, T0 + TIME_LIMIT_MS, '알람이 늦어도 마감 시각으로 기록');
	assert.equal(s.game.endedAt, late);
	assert.equal(nextDeadline(s), null);
});

test('tick은 멱등: 만료를 처리한 뒤 같은 now로 다시 불러도 상태가 같다', () => {
	for (const make of [() => started(['가'], ON).s, () => coopStarted(['가'], ON).s, () => compClimbStarted(['가'], ON).s, () => coopClimbStarted(['가'], ON).s]) {
		const s = make();
		const due = T0 + TIME_LIMIT_MS;
		assert.equal(tick(s, due).changed, true);
		const after = JSON.stringify(s);
		assert.deepEqual(tick(s, due), { changed: false, destroy: false });
		assert.equal(JSON.stringify(s), after);
	}
});

test('경쟁 단판 만료 직전 제출은 받고, 마감 시각 제출은 시간 초과가 먼저 반영되어 거절된다', () => {
	const before = started(['가'], ON);
	const ok = reduce(before.s, before.pids[0], { type: 'guess', jamo: ANSWER.jamo }, { valid: true }, T0 + TIME_LIMIT_MS - 1, rng);
	assert.deepEqual([ok.events, status(before.s, before.pids[0])], [[], 'solved']);

	const after = started(['가'], ON);
	const late = reduce(after.s, after.pids[0], { type: 'guess', jamo: ANSWER.jamo }, { valid: true }, T0 + TIME_LIMIT_MS, rng);
	assert.deepEqual([late.events.map((e) => e.code), late.changed, status(after.s, after.pids[0]), after.s.game.players[after.pids[0]].board.rows], [['phase'], true, 'timeout', []]);
});

test('경쟁 등반: 클리어 시각 + 2초 + 다음 스테이지 제한이 새 마감, 스테이지 1은 시작 시각부터', () => {
	const { s, pids } = compClimbStarted(['가'], ON, 5);
	const me = s.game.players[pids[0]];
	assert.equal(me.board.deadline, T0 + stageLimitMs(1));
	let now = T0;
	for (let n = 5; n < 12; n++) {
		now += 7 * SEC;
		applyGuess(s, pids[0], stageAnswer(n).jamo, true, now);
		assert.equal(me.board.stage, n - 3);
		assert.equal(me.board.deadline, now + STAGE_CLEAR_MS + stageLimitMs(n - 3), `스테이지 ${n - 3}`);
	}
});

test('경쟁 등반 만료: 만료된 사람만 높이를 확정하고 멈추며, 다른 사람은 자기 마감까지 계속한다', () => {
	const { s, pids } = compClimbStarted(['가'], ON, 10);
	const [host, a] = pids;
	applyGuess(s, a, stageAnswer(10).jamo, true, T0 + 30 * SEC);
	const hostDue = T0 + stageLimitMs(1);
	const aDue = T0 + 30 * SEC + STAGE_CLEAR_MS + stageLimitMs(2);
	assert.equal(nextDeadline(s), hostDue);
	assert.equal(tick(s, hostDue).changed, true);
	assert.deepEqual([status(s, host), status(s, a), s.phase], ['timeout', 'playing', 'playing']);
	assert.equal(s.game.players[host].board.cleared, 0);
	assert.equal(s.game.graceEnd, null, '시간 초과는 유예를 열지 않는다');
	assert.equal(nextDeadline(s), aDue);
	tick(s, aDue);
	assert.deepEqual([status(s, a), s.game.players[a].board.cleared, s.phase], ['timeout', 1, 'result']);
	const rank = (pid) => s.game.standings.find((x) => x.pid === pid).rank;
	assert.ok(rank(a) < rank(host), '더 높이 오른 사람이 위');
});

test('경쟁 등반: 유예가 먼저 끝나면 마감이 더 늦은 사람도 유예 마감 시각으로 멈춘다', () => {
	const { s, pids } = compClimbStarted(['가'], ON, 10);
	const [host, a] = pids;
	const t = T0 + 5 * SEC;
	for (let n = 10; n <= 12; n++) applyGuess(s, host, stageAnswer(n).jamo, true, t);
	const graceEnd = t + CLIMB_GRACE_MS;
	assert.equal(nextDeadline(s), graceEnd, '유예가 a의 시작 마감(180초)보다 이르다');
	tick(s, graceEnd + 5 * SEC);
	assert.deepEqual([status(s, a), s.game.players[a].finishedAt, s.phase], ['timeout', graceEnd, 'result']);
});

test('경쟁 등반: 완주자가 늦게 끝나 개인 마감이 유예보다 먼저 오면 그 마감에 멈춘다', () => {
	const { s, pids } = compClimbStarted(['가'], ON, 10);
	const [host, a] = pids;
	const t = T0 + 170 * SEC;
	for (let n = 10; n <= 12; n++) applyGuess(s, host, stageAnswer(n).jamo, true, t);
	assert.equal(nextDeadline(s), T0 + stageLimitMs(1), 'a의 마감(180초)이 유예(230초)보다 이르다');
	tick(s, T0 + stageLimitMs(1));
	assert.deepEqual([status(s, host), status(s, a), s.game.players[a].finishedAt, s.phase], ['solved', 'timeout', T0 + stageLimitMs(1), 'result']);
	assert.deepEqual(s.game.finishOrder, [host]);
});

test('협동 단판: 방 보드 하나의 마감, 만료 = 실패 결과(timeout)이고 진행 중이던 제안은 비워진다', () => {
	const { s, pids } = coopStarted(['가'], ON);
	assert.equal(s.game.board.deadline, T0 + TIME_LIMIT_MS);
	coop.propose(s, pids[0], wrongRow(6), true, rng, T0 + 5 * SEC);
	assert.equal(nextDeadline(s), T0 + TIME_LIMIT_MS);
	assert.deepEqual(tick(s, T0 + TIME_LIMIT_MS - 1), { changed: false, destroy: false });
	assert.deepEqual(tick(s, T0 + TIME_LIMIT_MS), { changed: true, destroy: false });
	assert.deepEqual([s.phase, s.game.status, s.game.endReason, s.game.step], ['result', 'lost', 'timeout', { kind: 'propose', proposals: {}, drafts: {} }]);
	assert.equal(nextDeadline(s), null);
});

test('협동 단판 만료 직전 제안은 받고, 마감 시각의 제안은 시간 초과가 먼저 반영되어 거절된다', () => {
	const ok = coopStarted(['가'], ON);
	for (const p of ok.s.players) reduce(ok.s, p.pid, { type: 'propose', jamo: ANSWER.jamo }, { valid: true }, T0 + TIME_LIMIT_MS - 1, rng);
	assert.deepEqual([ok.s.game.status, ok.s.game.endReason], ['won', 'solved']);

	const late = coopStarted(['가'], ON);
	const r = reduce(late.s, late.pids[0], { type: 'propose', jamo: ANSWER.jamo }, { valid: true }, T0 + TIME_LIMIT_MS, rng);
	assert.deepEqual([r.events.map((e) => e.code), late.s.game.status, late.s.game.endReason, late.s.game.board.rows], [['phase'], 'lost', 'timeout', []]);
});

test('협동 등반: 클리어 + 2초 + 다음 스테이지 제한이 방 보드의 새 마감, 만료 = 등반 종료', () => {
	const { s } = coopClimbStarted(['가'], ON, 5);
	assert.equal(s.game.board.deadline, T0 + stageLimitMs(1));
	let now = T0;
	for (let n = 5; n < 8; n++) {
		now += 9 * SEC;
		coopSolve(s, stageAnswer(n).jamo, now);
		assert.equal(s.game.board.deadline, now + STAGE_CLEAR_MS + stageLimitMs(n - 3));
	}
	assert.equal(s.game.board.cleared, 3);
	assert.equal(nextDeadline(s), s.game.board.deadline);
	tick(s, s.game.board.deadline);
	assert.deepEqual([s.phase, s.game.status, s.game.endReason, s.game.board.cleared], ['result', 'lost', 'timeout', 3]);
});

test('nextDeadline: 개별 마감, 끊김 탈락, 유예 중 가장 이른 것', () => {
	const { s, pids } = compClimbStarted(['가'], ON, 10);
	const [host, a] = pids;
	assert.equal(nextDeadline(s), T0 + stageLimitMs(1));
	disconnect(s, a, T0 + 20 * SEC);
	assert.equal(nextDeadline(s), T0 + 20 * SEC + DISCONNECT_GRACE_MS, '끊김 탈락(80초)이 마감(180초)보다 이르다');
	for (let n = 10; n <= 12; n++) applyGuess(s, host, stageAnswer(n).jamo, true, T0 + 30 * SEC);
	assert.equal(nextDeadline(s), T0 + 20 * SEC + DISCONNECT_GRACE_MS, '유예(90초)보다 끊김 탈락이 이르다');
	giveUp(s, a, T0 + 40 * SEC);
	assert.equal(s.phase, 'result');
	assert.equal(nextDeadline(s), null);
});

// ---- 5단계: 경쟁 끊김 자동 탈락 ----

test('경쟁: 진행 중에 끊긴 지 정확히 60초째에 그 사람만 탈락, 기록 시각은 끊김 + 60초', () => {
	const { s, pids } = started(['가']);
	const [host, a] = pids;
	disconnect(s, a, T0 + SEC);
	const at = T0 + SEC + DISCONNECT_GRACE_MS;
	assert.equal(nextDeadline(s), at);
	assert.deepEqual(tick(s, at - 1), { changed: false, destroy: false });
	assert.deepEqual(tick(s, at + 7 * SEC), { changed: true, destroy: false });
	assert.deepEqual([status(s, a), status(s, host), s.phase, s.game.players[a].finishedAt], ['eliminated', 'playing', 'playing', at]);
	assert.equal(nextDeadline(s), null);
});

test('경쟁: 60초 안에 돌아오면 탈락하지 않고, 탈락한 뒤에 돌아와도 되살아나지 않는다', () => {
	const back = started(['가']);
	disconnect(back.s, back.pids[1], T0 + SEC);
	join(back.s, { uid: 'uid-가', name: '가' }, T0 + SEC + DISCONNECT_GRACE_MS - 1, rng);
	assert.equal(nextDeadline(back.s), null, '돌아오면 후보가 사라진다');
	assert.equal(tick(back.s, T0 + 5 * DISCONNECT_GRACE_MS).changed, false);
	assert.equal(status(back.s, back.pids[1]), 'playing');

	const late = started(['가']);
	disconnect(late.s, late.pids[1], T0 + SEC);
	const now = T0 + SEC + DISCONNECT_GRACE_MS + 3 * SEC;
	// DO는 hello 처리 전에 tick을 돌리므로 같은 순서로 재현한다.
	tick(late.s, now);
	join(late.s, { uid: 'uid-가', name: '가' }, now, rng);
	assert.deepEqual([status(late.s, late.pids[1]), late.s.players.find((p) => p.pid === late.pids[1]).connected], ['eliminated', true]);
	assert.equal(late.s.game.players[late.pids[1]].finishedAt, T0 + SEC + DISCONNECT_GRACE_MS);
});

test('경쟁: 이미 끝난 사람은 자동 탈락 대상이 아니다', () => {
	const { s, pids } = started(['가', '나']);
	const [host, a, b] = pids;
	applyGuess(s, a, ANSWER.jamo, true, T0 + 100);
	giveUp(s, b, T0 + 200);
	disconnect(s, a, T0 + 300);
	disconnect(s, b, T0 + 300);
	assert.equal(nextDeadline(s), null);
	tick(s, T0 + 10 * DISCONNECT_GRACE_MS);
	assert.deepEqual([status(s, a), status(s, b), status(s, host)], ['solved', 'gaveup', 'playing']);
});

test('경쟁: 끊긴 사람 때문에 기다리던 판은 그 사람이 탈락하는 순간 끝난다', () => {
	const { s, pids } = started(['가']);
	const [host, a] = pids;
	applyGuess(s, host, ANSWER.jamo, true, T0 + 100);
	disconnect(s, a, T0 + 200);
	assert.equal(s.phase, 'playing');
	assert.equal(tick(s, T0 + 200 + DISCONNECT_GRACE_MS).changed, true);
	assert.deepEqual([s.phase, status(s, a), s.game.standings.map((x) => x.pid)], ['result', 'eliminated', [host, a]]);
});

test('협동: 아무리 오래 끊겨도 탈락하지 않고 마감 후보도 없다', () => {
	const { s, pids } = coopStarted(['가']);
	disconnect(s, pids[1], T0 + SEC);
	assert.equal(nextDeadline(s), null);
	assert.deepEqual(tick(s, T0 + 10 * DISCONNECT_GRACE_MS), { changed: false, destroy: false });
	assert.equal(s.phase, 'playing');
	assert.equal(s.players.find((p) => p.pid === pids[1]).inGame, true);
});

test('끊김 탈락과 제한 시간이 같은 틱에 만료돼도 한 번씩만 처리된다', () => {
	const { s, pids } = started(['가'], ON);
	const [host, a] = pids;
	disconnect(s, a, T0 + 121 * SEC);
	const now = T0 + TIME_LIMIT_MS + 10 * SEC;
	assert.equal(tick(s, now).changed, true);
	assert.deepEqual([status(s, host), status(s, a), s.phase], ['timeout', 'timeout', 'result']);
	assert.equal(tick(s, now).changed, false);
});

// ---- 5단계: 소켓 정리와 알람 ----

test('무응답 소켓 판정: 45초까지는 정상, 넘으면 정리 대상', () => {
	assert.equal(SOCKET_IDLE_MS, 45_000);
	assert.equal(isStaleSocket(T0, T0 + SOCKET_IDLE_MS), false);
	assert.equal(isStaleSocket(T0, T0 + SOCKET_IDLE_MS + 1), true);
});

test('소켓 정리 점검은 소켓이 있을 때만 알람 후보이고, 다른 후보와 최솟값을 취한다', () => {
	assert.equal(reapCheckAt(T0, 0), null);
	assert.equal(reapCheckAt(T0, 2), T0 + SOCKET_IDLE_MS);
	const s = lobby();
	joinAll(s, ['가']);
	assert.equal(alarmTarget(s, T0, T0 + SOCKET_IDLE_MS), T0 + SOCKET_IDLE_MS, '재알림(60초)보다 이르다');
	assert.equal(alarmTarget(s, T0, T0 + 2 * LOBBY_REFRESH_MS), T0 + LOBBY_REFRESH_MS);
	for (const p of s.players) p.connected = false;
	s.emptySince = null;
	for (const p of s.players) p.disconnectedAt = null;
	assert.equal(alarmTarget(s, 0, null), null);
	assert.equal(alarmTarget(s, 0, T0), T0, '접속자가 없어도 소켓이 남아 있으면 점검은 걸린다');
});

test('제한 시간이 있는 방의 알람은 마감 하나로 걸리고, 점검이 더 이르면 점검이 우선한다', () => {
	const { s } = started(['가'], ON);
	assert.equal(alarmTarget(s, T0, null), T0 + LOBBY_REFRESH_MS);
	assert.equal(alarmTarget(s, T0 + 200 * SEC, null), T0 + TIME_LIMIT_MS);
	assert.equal(alarmTarget(s, T0 + 200 * SEC, T0 + SOCKET_IDLE_MS), T0 + SOCKET_IDLE_MS);
});

// ---- 5단계: 스냅샷 ----

test('스냅샷: 경쟁은 본인 보드의 마감, 협동은 공유 보드의 마감이 나가고 등반 새 스테이지의 마감도 반영된다', () => {
	const { s, pids } = compClimbStarted(['가'], ON, 10);
	applyGuess(s, pids[0], stageAnswer(10).jamo, true, T0 + 4 * SEC);
	const mine = personalize(s, pids[0], T0 + 5 * SEC).game.me;
	assert.equal(mine.deadline, T0 + 4 * SEC + STAGE_CLEAR_MS + stageLimitMs(2));
	assert.equal(personalize(s, pids[1], T0 + 5 * SEC).game.me.deadline, T0 + stageLimitMs(1), '남의 마감이 아니라 본인 것');

	const c = coopStarted(['가'], ON);
	assert.equal(personalize(c.s, c.pids[1], T0 + SEC).game.board.deadline, T0 + TIME_LIMIT_MS);
	const off = coopStarted(['가']);
	assert.equal(personalize(off.s, off.pids[1], T0 + SEC).game.board.deadline, null);
});
