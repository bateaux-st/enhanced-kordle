import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, HOST_GRACE_MS, MAX_PLAYERS, NUDGE_COOLDOWN_MS } from '../src/lib/mp/rules.ts';
import { backToLobby, canStart, disconnect, hostSuccessionAt, join, leave, reconcile, uniqueName } from '../src/lib/server/mp/members.ts';
import { eliminate } from '../src/lib/server/mp/comp.ts';
import { reduce } from '../src/lib/server/mp/reduce.ts';
import { sameSummary, summarize } from '../src/lib/server/mp/rooms.ts';
import { ANSWER, coopStarted, joinAll, lobby, rng, started, T0 } from './mp-helpers.mjs';

const send = (s, pid, msg, now = T0, io = {}) => reduce(s, pid, msg, io, now, rng);
const START_IO = { start: { n: 6, answer: ANSWER } };
const errorOf = (r) => r.events.find((e) => e.type === 'error');

test('정원 5명: 6번째 입장은 가득 참으로 거부', () => {
	const s = lobby();
	joinAll(s, ['가', '나', '다', '라']);
	assert.equal(s.players.length, MAX_PLAYERS);
	assert.deepEqual(join(s, { uid: 'uid-6', name: '여섯' }, T0, rng), { ok: false, reason: 'full' });
	assert.equal(s.players.length, MAX_PLAYERS);
});

test('정원이 찼어도 끊긴 지 60초가 지난 사람의 자리는 회수한다(방장 제외)', () => {
	const s = lobby();
	const pids = joinAll(s, ['가', '나', '다', '라']);
	disconnect(s, pids[2], T0);
	assert.equal(join(s, { uid: 'uid-새', name: '새' }, T0 + 59_000, rng).ok, false, '59초: 아직 자리 유지');
	assert.equal(join(s, { uid: 'uid-새', name: '새' }, T0 + 60_000, rng).ok, true);
	assert.ok(!s.players.some((p) => p.pid === pids[2]));
});

test('playing 중 신규 입장은 거부하고 기존 참가자의 같은 uid 재입장은 허용', () => {
	const { s, pids } = started(['가', '나']);
	assert.deepEqual(join(s, { uid: 'uid-새', name: '새' }, T0, rng), { ok: false, reason: 'in_progress' });
	disconnect(s, pids[1], T0 + 1000);
	const back = join(s, { uid: 'uid-가', name: '가' }, T0 + 2000, rng);
	assert.deepEqual(back, { ok: true, pid: pids[1], name: '가', rejoined: true });
	assert.equal(s.players[1].connected, true);
	assert.equal(s.players[1].disconnectedAt, null);
});

test('result에서는 신규 입장이 가능하고 이번 게임 참가자가 아니다', () => {
	const { s, pids } = started(['가']);
	send(s, pids[1], { type: 'giveup' });
	send(s, pids[0], { type: 'giveup' });
	assert.equal(s.phase, 'result');
	const r = join(s, { uid: 'uid-새', name: '새' }, T0 + 5000, rng);
	assert.equal(r.ok, true);
	assert.equal(s.players.find((p) => p.pid === r.pid).inGame, false);
});

test('대기 중 같은 uid 재입장은 자기 자리(pid 유지)로 돌아오고 준비는 해제', () => {
	const s = lobby();
	const [host, a] = joinAll(s, ['가']);
	send(s, a, { type: 'ready', on: true });
	disconnect(s, a, T0 + 100);
	assert.equal(s.players[1].ready, false, '끊기면 준비 해제');
	const back = join(s, { uid: 'uid-가', name: '가' }, T0 + 200, rng);
	assert.equal(back.pid, a);
	assert.equal(s.players.length, 2);
	assert.equal(s.hostPid, host);
	assert.equal(s.players[1].ready, false);
});

test('닉네임 충돌: 접미사를 붙이고 확정 이름을 돌려준다', () => {
	const s = lobby();
	const a = join(s, { uid: 'u1', name: '철수' }, T0, rng);
	const b = join(s, { uid: 'u2', name: '철수' }, T0, rng);
	const c = join(s, { uid: 'u3', name: '철수' }, T0, rng);
	assert.deepEqual([a.name, b.name, c.name], ['철수', '철수(2)', '철수(3)']);
	assert.deepEqual(s.players.map((p) => p.name), ['방장', '철수', '철수(2)', '철수(3)']);
});

test('접미사를 붙여도 12자를 넘지 않고, 자기 자신과는 충돌하지 않는다', () => {
	const long = '가나다라마바사아자차카타';
	const s = lobby();
	join(s, { uid: 'u1', name: long }, T0, rng);
	const dup = join(s, { uid: 'u2', name: long }, T0, rng);
	assert.equal(dup.name, '가나다라마바사아자(2)');
	assert.equal([...dup.name].length, 12);
	const again = join(s, { uid: 'u1', name: long }, T0, rng);
	assert.equal(again.name, long);
	assert.equal(uniqueName(s.players, '새이름'), '새이름');
});

test('시작 조건: 방장 혼자는 불가, 방장 외 접속자 전원 준비여야 시작', () => {
	const s = lobby();
	const [host] = s.players.map((p) => p.pid);
	assert.equal(canStart(s).reason, 'alone');
	const [, b] = joinAll(s, ['가']);
	assert.deepEqual(canStart(s), { ok: false, reason: 'waiting', waiting: 1, disconnected: [] });
	send(s, b, { type: 'ready', on: true });
	assert.equal(canStart(s).ok, true);
	send(s, b, { type: 'ready', on: false });
	assert.equal(canStart(s).ok, false);
	send(s, b, { type: 'ready', on: true });
	const [, , c] = joinAll(s, ['나']);
	assert.equal(s.players.find((p) => p.pid === c).ready, false, '신규 입장자만 미준비');
	assert.equal(s.players.find((p) => p.pid === b).ready, true);
	assert.equal(canStart(s).ok, false);
	assert.equal(errorOf(send(s, host, { type: 'start' }, T0, START_IO)).code, 'forbidden');
	send(s, c, { type: 'ready', on: true });
	assert.equal(send(s, host, { type: 'start' }, T0, START_IO).changed, true);
	assert.equal(s.phase, 'playing');
});

test('방장은 준비 대상이 아니고, 방장이 아닌 사람은 시작할 수 없다', () => {
	const s = lobby();
	const [host, a] = joinAll(s, ['가']);
	assert.equal(errorOf(send(s, host, { type: 'ready', on: true })).code, 'forbidden');
	send(s, a, { type: 'ready', on: true });
	assert.equal(errorOf(send(s, a, { type: 'start' }, T0, START_IO)).code, 'forbidden');
	assert.equal(s.phase, 'lobby');
});

test('설정 변경 시 전원 준비 해제, 값이 같으면 유지, 방장만, 범위 밖은 거부', () => {
	const s = lobby();
	const [host, a, b] = joinAll(s, ['가', '나']);
	send(s, a, { type: 'ready', on: true });
	send(s, b, { type: 'ready', on: true });

	assert.equal(send(s, host, { type: 'settings', settings: { ...DEFAULT_SETTINGS } }).changed, false);
	assert.ok(s.players.every((p) => p.pid === host || p.ready), '같은 값이면 준비 유지');

	const next = { ...DEFAULT_SETTINGS, tries: 8 };
	assert.equal(send(s, host, { type: 'settings', settings: next }).changed, true);
	assert.equal(s.settings.tries, 8);
	assert.ok(s.players.every((p) => !p.ready), '모든 준비 해제');

	assert.equal(errorOf(send(s, a, { type: 'settings', settings: { ...next, tries: 5 } })).code, 'forbidden');
	assert.equal(s.settings.tries, 8);
	for (const bad of [{ tries: 11 }, { tries: 3 }, { length: 4 }, { length: 13 }, { length: 6.5 }, { kind: 'solo' }, { hard: 'yes' }]) {
		assert.equal(errorOf(send(s, host, { type: 'settings', settings: { ...next, ...bad } })).code, 'forbidden', JSON.stringify(bad));
	}
	assert.equal(send(s, host, { type: 'settings', settings: { ...next, length: 'random' } }).changed, true);
});

test('방장이 나가면 즉시 입장 순으로 접속 중인 다음 사람이 방장', () => {
	const s = lobby();
	const [host, a, b, c] = joinAll(s, ['가', '나', '다']);
	disconnect(s, a, T0);
	const r = send(s, host, { type: 'leave' }, T0 + 1);
	assert.deepEqual(r.events, [{ type: 'drop', pid: host }]);
	assert.equal(s.hostPid, b, '끊긴 가를 건너뛰고 나');
	assert.ok(!s.players.some((p) => p.pid === host));
	leave(s, b, T0 + 2);
	assert.equal(s.hostPid, c);
});

test('접속자가 아무도 없게 나가면 방장은 비고 emptySince가 기록되며, 다음 입장자가 방장', () => {
	const s = lobby();
	const [host] = s.players.map((p) => p.pid);
	leave(s, host, T0 + 10);
	assert.equal(s.hostPid, null);
	assert.equal(s.emptySince, T0 + 10);
	const r = join(s, { uid: 'uid-새', name: '새' }, T0 + 20, rng);
	assert.equal(s.hostPid, r.pid);
	assert.equal(s.emptySince, null);
});

test('재촉: 방장에게 이벤트, 1인당 30초 쿨다운, 다른 사람은 그동안 가능, 방장은 불가', () => {
	const s = lobby();
	const [host, a, b] = joinAll(s, ['가', '나']);
	const r = send(s, a, { type: 'nudge' }, T0);
	assert.deepEqual(r.events, [{ type: 'nudge', to: host, from: '가' }]);

	const early = send(s, a, { type: 'nudge' }, T0 + NUDGE_COOLDOWN_MS - 1);
	assert.equal(errorOf(early).code, 'cooldown');
	assert.match(errorOf(early).msg, /1초/);
	assert.equal(send(s, b, { type: 'nudge' }, T0 + 5000).events[0].type, 'nudge');
	assert.equal(send(s, a, { type: 'nudge' }, T0 + NUDGE_COOLDOWN_MS).events[0].type, 'nudge');
	assert.equal(errorOf(send(s, host, { type: 'nudge' }, T0)).code, 'forbidden');
});

test('끊긴 사람은 시작을 막지 않고, 내보내고 시작하면 방에서 빠지며, 아니면 자리를 지키고 참가한다', () => {
	const make = () => {
		const s = lobby();
		const [host, a, b] = joinAll(s, ['가', '나']);
		send(s, a, { type: 'ready', on: true });
		disconnect(s, b, T0);
		return { s, host, a, b };
	};

	let { s, host, b } = make();
	assert.deepEqual(canStart(s), { ok: true, reason: null, waiting: 0, disconnected: [b] });
	send(s, host, { type: 'start', kickDisconnected: true }, T0, START_IO);
	assert.equal(s.phase, 'playing');
	assert.equal(s.players.length, 2);
	assert.deepEqual(Object.keys(s.game.players), s.players.map((p) => p.pid));

	({ s, host, b } = make());
	send(s, host, { type: 'start' }, T0, START_IO);
	assert.equal(s.players.length, 3);
	assert.ok(s.game.players[b], '끊긴 채 자리를 지킨 사람도 참가자');
});

test('접속 중인 사람이 방장 하나뿐이면 끊긴 사람이 있어도 시작 불가', () => {
	const s = lobby();
	const [, a] = joinAll(s, ['가']);
	disconnect(s, a, T0);
	assert.equal(canStart(s).reason, 'alone');
});

test('start: D1 조회 실패(io.start 없음)와 위쪽 스테이지 정답이 빠진 등반은 상태를 바꾸지 않는다', () => {
	const s = lobby();
	const [host, a] = joinAll(s, ['가']);
	send(s, a, { type: 'ready', on: true });
	assert.equal(errorOf(send(s, host, { type: 'start' }, T0, {})).code, 'unavailable');
	assert.equal(s.phase, 'lobby');
	send(s, host, { type: 'settings', settings: { ...DEFAULT_SETTINGS, game: 'climb' } });
	send(s, a, { type: 'ready', on: true });
	assert.equal(errorOf(send(s, host, { type: 'start' }, T0, START_IO)).code, 'unavailable');
	assert.equal(s.phase, 'lobby');
});

/** 방장·가·나가 한 판을 끝낸 결과 단계. 모두 준비한 상태로 켜 두어 again이 그것을 푸는지 본다. */
function resultRoom(settings = {}) {
	const { s, pids } = started(['가', '나'], settings);
	for (const pid of [...pids].reverse()) send(s, pid, { type: 'giveup' }, T0 + 10);
	assert.equal(s.phase, 'result');
	s.players.forEach((p) => (p.ready = true));
	return { s, pids };
}

test('again: 방장이 결과에서만. 설정은 그대로, lobby로 돌아가 전원 준비 해제, 이전 판 데이터는 버린다', () => {
	const { s, pids } = resultRoom({ tries: 8, hard: true });
	const [host, a] = pids;
	const settings = { ...s.settings };
	assert.equal(errorOf(send(s, a, { type: 'again' }, T0 + 20)).code, 'forbidden');
	assert.equal(s.phase, 'result');

	const r = send(s, host, { type: 'again' }, T0 + 21);
	assert.deepEqual([r.changed, r.events], [true, []]);
	assert.equal(s.phase, 'lobby');
	assert.equal(s.game, null);
	assert.deepEqual(s.settings, settings);
	assert.ok(s.players.every((p) => !p.ready && !p.inGame));

	assert.equal(errorOf(send(s, host, { type: 'again' }, T0 + 22)).code, 'phase', 'lobby에서는 거절');
	assert.equal(JSON.stringify(s).includes(ANSWER.jamo), false, '이전 정답이 상태에 남지 않는다');
});

test('again/next는 게임 중에는 거절하고 상태를 바꾸지 않는다', () => {
	const { s, pids } = started(['가']);
	const before = JSON.stringify(s);
	for (const type of ['again', 'next']) {
		const r = send(s, pids[0], { type }, T0 + 5);
		assert.deepEqual([r.changed, errorOf(r).code], [false, 'phase']);
	}
	assert.equal(JSON.stringify(s), before);
});

test('next: 설정 인자가 있으면 적용하고 방장에게 설정 열기 이벤트를 준다', () => {
	const { s, pids } = resultRoom();
	const host = pids[0];
	const r = send(s, host, { type: 'next', settings: { ...DEFAULT_SETTINGS, length: 9, tries: 5 } }, T0 + 20);
	assert.deepEqual(r.events, [{ type: 'open_settings', to: host }]);
	assert.equal(s.phase, 'lobby');
	assert.deepEqual([s.settings.length, s.settings.tries], [9, 5]);
	assert.ok(s.players.every((p) => !p.ready));
});

test('next: 설정 인자가 없으면 설정을 유지하고, 범위 밖 설정은 거절하며 결과 단계에 머문다', () => {
	const { s, pids } = resultRoom({ length: 7 });
	const host = pids[0];
	const bad = send(s, host, { type: 'next', settings: { ...DEFAULT_SETTINGS, tries: 99 } }, T0 + 20);
	assert.deepEqual([bad.changed, errorOf(bad).code, s.phase, s.settings.length], [false, 'forbidden', 'result', 7]);
	assert.equal(errorOf(send(s, pids[1], { type: 'next' }, T0 + 21)).code, 'forbidden', '방장만');
	const ok = send(s, host, { type: 'next' }, T0 + 22);
	assert.deepEqual([ok.events, s.phase, s.settings.length], [[{ type: 'open_settings', to: host }], 'lobby', 7]);
});

test('lobby 전환: 끊긴 사람은 자리를 지키고 시작에서 내보낼 수 있으며, 결과 중 들어온 사람은 준비 전으로 참가한다', () => {
	const { s, pids } = resultRoom();
	const [host, a, b] = pids;
	disconnect(s, b, T0 + 15);
	const late = join(s, { uid: 'uid-늦', name: '늦' }, T0 + 16, rng);
	assert.equal(s.players.find((p) => p.pid === late.pid).inGame, false);

	assert.equal(backToLobby(s, host).ok, true);
	assert.deepEqual(s.players.map((p) => [p.pid, p.connected, p.ready, p.inGame]), [
		[host, true, false, false],
		[a, true, false, false],
		[b, false, false, false],
		[late.pid, true, false, false]
	]);
	assert.deepEqual(canStart(s).disconnected, [b]);

	s.players.find((p) => p.pid === a).ready = true;
	s.players.find((p) => p.pid === late.pid).ready = true;
	const start = send(s, host, { type: 'start', kickDisconnected: true }, T0 + 30, START_IO);
	assert.equal(errorOf(start), undefined);
	assert.deepEqual(s.players.map((p) => p.pid), [host, a, late.pid]);
	assert.ok(s.players.every((p) => p.inGame));
});

test('lobby 전환 뒤 정원이 차면 오래 끊긴 사람의 자리는 기존 규칙대로 회수된다', () => {
	const { s, pids } = resultRoom();
	disconnect(s, pids[2], T0 + 15);
	joinAll(s, ['다', '라'], T0 + 16);
	send(s, pids[0], { type: 'again' }, T0 + 17);
	assert.equal(s.players.length, MAX_PLAYERS);
	const late = join(s, { uid: 'uid-마', name: '마' }, T0 + 15 + 60_000, rng);
	assert.equal(late.ok, true);
	assert.ok(!s.players.some((p) => p.pid === pids[2]));
});

test('reconcile: 열린 소켓이 없는 접속자는 끊김으로 바뀌고, 소켓이 있는 사람은 그대로다', () => {
	const s = lobby();
	const [host, a, b] = joinAll(s, ['가', '나']);
	s.players.find((p) => p.pid === b).ready = true;
	assert.equal(reconcile(s, [host, a], T0 + 10), true);
	const p = (pid) => s.players.find((x) => x.pid === pid);
	assert.deepEqual([p(host).connected, p(a).connected], [true, true]);
	assert.deepEqual([p(b).connected, p(b).disconnectedAt, p(b).ready], [false, T0 + 10, false]);
	assert.equal(s.emptySince, null, '접속자가 남아 있으면 빈 방이 아니다');
	assert.equal(s.players.length, 3, '자리는 남는다');
});

test('reconcile: 소켓이 하나도 없으면 전원 끊김, emptySince는 처음 한 번만 now로', () => {
	const s = lobby();
	joinAll(s, ['가']);
	assert.equal(reconcile(s, [], T0 + 10), true);
	assert.ok(s.players.every((p) => !p.connected && p.disconnectedAt === T0 + 10));
	assert.equal(s.emptySince, T0 + 10);
	assert.equal(reconcile(s, [], T0 + 99), false, '이미 끊긴 상태에서는 아무것도 바꾸지 않는다');
	assert.equal(s.emptySince, T0 + 10);
});

test('reconcile: 전원 소켓이 있으면 바뀌는 것이 없다', () => {
	const s = lobby();
	const pids = joinAll(s, ['가']);
	const before = JSON.stringify(s);
	assert.equal(reconcile(s, pids, T0 + 10), false);
	assert.equal(JSON.stringify(s), before);
});

test('reconcile: 방장 소켓만 사라지면 끊김 유예 뒤 승계 대상이 된다', () => {
	const s = lobby();
	const [host, a] = joinAll(s, ['가']);
	reconcile(s, [a], T0 + 10);
	assert.equal(s.hostPid, host);
	assert.equal(hostSuccessionAt(s), T0 + 10 + HOST_GRACE_MS);
});

test('나가기로 떠난 사람은 협동 playing 중 같은 uid로 재입장할 수 없다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	send(s, pids[1], { type: 'leave' }, T0 + 10);
	assert.equal(s.players[1].left, true);
	const before = structuredClone(s.players);
	assert.deepEqual(join(s, { uid: 'uid-가', name: '새이름' }, T0 + 20, rng), { ok: false, reason: 'in_progress' });
	assert.deepEqual(s.players, before, '거절은 자리 상태를 바꾸지 않는다');
});

test('나가기로 떠난 사람은 경쟁 playing 중 같은 uid로 재입장할 수 없다', () => {
	const { s, pids } = started(['가', '나']);
	send(s, pids[1], { type: 'leave' }, T0 + 10);
	const before = structuredClone(s.players);
	assert.deepEqual(join(s, { uid: 'uid-가', name: '새이름' }, T0 + 20, rng), { ok: false, reason: 'in_progress' });
	assert.deepEqual(s.players, before);
});

test('나가기가 아닌 끊김 뒤 재입장은 playing 중에도 같은 자리로 복귀한다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	disconnect(s, pids[1], T0 + 10);
	const back = join(s, { uid: 'uid-가', name: '가' }, T0 + 20, rng);
	assert.deepEqual(back, { ok: true, pid: pids[1], name: '가', rejoined: true });
	assert.equal(s.players[1].left, undefined);
});

test('경쟁에서 끊김으로 탈락한 사람은 재입장하면 탈락 상태로 들어온다', () => {
	const { s, pids } = started(['가', '나']);
	disconnect(s, pids[1], T0 + 10);
	assert.equal(eliminate(s, pids[0], pids[1], T0 + 70_000).ok, true);
	const back = join(s, { uid: 'uid-가', name: '가' }, T0 + 71_000, rng);
	assert.equal(back.ok, true);
	assert.equal(back.pid, pids[1]);
	assert.equal(s.game.players[pids[1]].status, 'eliminated');
});

test('나갔던 사람은 협동·경쟁 모두 결과 단계에서 들어올 수 있다', () => {
	for (const make of [() => coopStarted(['가', '나']), () => started(['가', '나'])]) {
		const { s, pids } = make();
		send(s, pids[1], { type: 'leave' }, T0 + 10);
		send(s, pids[0], { type: 'giveup' }, T0 + 20);
		if (s.phase !== 'result') send(s, pids[2], { type: 'giveup' }, T0 + 30);
		assert.equal(s.phase, 'result');
		const r = join(s, { uid: 'uid-가', name: '가' }, T0 + 40, rng);
		assert.equal(r.ok, true);
		assert.equal(s.players.find((p) => p.pid === r.pid).left, undefined);
	}
});

test('방장 넘기기: 방장만, 접속 중인 다른 참가자에게만. 거절은 상태를 바꾸지 않는다', () => {
	const s = lobby();
	const [host, a, b, ghost] = joinAll(s, ['가', '나', '다']);
	disconnect(s, ghost, T0);
	send(s, a, { type: 'ready', on: true });

	assert.equal(errorOf(send(s, a, { type: 'transfer', pid: b })).code, 'forbidden', '방장이 아닌 사람');
	assert.equal(errorOf(send(s, host, { type: 'transfer', pid: host })).code, 'forbidden', '자기 자신');
	assert.equal(errorOf(send(s, host, { type: 'transfer', pid: ghost })).code, 'forbidden', '끊긴 사람');
	assert.equal(errorOf(send(s, host, { type: 'transfer', pid: 'pnone' })).code, 'forbidden', '방에 없는 pid');
	assert.equal(s.hostPid, host);
	assert.equal(s.players.find((p) => p.pid === a).ready, true, '거절은 준비를 건드리지 않는다');

	const r = send(s, host, { type: 'transfer', pid: b });
	assert.equal(r.changed, true);
	assert.deepEqual(r.events, []);
	assert.equal(s.hostPid, b);
});

test('방장 넘기기: 새 방장은 준비가 풀리고 옛 방장은 준비 안 함인 일반 참가자, 나머지 준비는 유지', () => {
	const s = lobby();
	const [host, a, b] = joinAll(s, ['가', '나']);
	send(s, a, { type: 'ready', on: true });
	send(s, b, { type: 'ready', on: true });

	send(s, host, { type: 'transfer', pid: a });
	const by = (pid) => s.players.find((p) => p.pid === pid);
	assert.equal(s.hostPid, a);
	assert.equal(by(a).ready, false, '새 방장은 준비하지 않는다');
	assert.equal(by(host).ready, false, '옛 방장은 준비 안 함');
	assert.equal(by(b).ready, true, '다른 참가자의 준비는 유지');
	assert.equal(errorOf(send(s, a, { type: 'ready', on: true })).code, 'forbidden', '새 방장은 준비 불가');
	assert.equal(send(s, host, { type: 'ready', on: true }).changed, true, '옛 방장은 준비할 수 있다');
	assert.equal(errorOf(send(s, host, { type: 'start' }, T0, START_IO)).code, 'forbidden', '옛 방장은 시작 불가');
	assert.equal(send(s, a, { type: 'start' }, T0, START_IO).changed, true, '새 방장이 시작(나머지 모두 준비)');
});

test('방장 넘기기: 결과 화면에서도 되고 게임 중에는 거절한다', () => {
	const { s, pids } = started(['가', '나']);
	const [host, a] = pids;
	const r = send(s, host, { type: 'transfer', pid: a }, T0 + 1);
	assert.equal(errorOf(r).code, 'phase');
	assert.equal(s.hostPid, host);

	for (const pid of [...pids].reverse()) send(s, pid, { type: 'giveup' }, T0 + 10);
	assert.equal(s.phase, 'result');
	assert.equal(send(s, host, { type: 'transfer', pid: a }, T0 + 11).changed, true);
	assert.equal(s.hostPid, a);
	assert.equal(s.phase, 'result');
	assert.equal(send(s, a, { type: 'again' }, T0 + 12).changed, true, '새 방장이 대기실로 돌린다');
	assert.equal(errorOf(send(s, host, { type: 'again' }, T0 + 12)).code, 'forbidden');
});

test('방장 넘기기: 연속으로 넘기고 되받아도 방장은 하나이고 요약의 방장 이름이 바뀐다', () => {
	const s = lobby();
	const [host, a, b] = joinAll(s, ['가', '나']);
	const hostOf = () => summarize(s, T0).host;
	assert.equal(hostOf(), '방장');
	const before = summarize(s, T0);

	send(s, host, { type: 'transfer', pid: a });
	assert.equal(sameSummary(before, summarize(s, T0)), false, '요약이 달라져 기존 upsert 경로를 탄다');
	assert.equal(hostOf(), '가');
	send(s, a, { type: 'transfer', pid: b });
	assert.equal(hostOf(), '나');
	assert.equal(errorOf(send(s, a, { type: 'transfer', pid: host })).code, 'forbidden', '넘긴 사람은 더는 방장이 아니다');
	send(s, b, { type: 'transfer', pid: host });
	assert.equal(s.hostPid, host);
	assert.equal(hostOf(), '방장');
	assert.equal(s.players.filter((p) => p.pid === s.hostPid).length, 1);
	assert.ok(s.players.every((p) => !p.ready));
});

test('방장 넘기기: 넘긴 뒤 옛 방장이 나가도 새 방장이 유지된다', () => {
	const s = lobby();
	const [host, a, b] = joinAll(s, ['가', '나']);
	send(s, host, { type: 'transfer', pid: b });
	send(s, host, { type: 'leave' }, T0 + 1);
	assert.equal(s.hostPid, b);
	assert.ok(!s.players.some((p) => p.pid === host));
	assert.ok(s.players.some((p) => p.pid === a));
});
