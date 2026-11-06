import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, HOST_GRACE_MS, MAX_PLAYERS, NUDGE_COOLDOWN_MS } from '../src/lib/mp/rules.ts';
import { backToLobby, canStart, disconnect, hostSuccessionAt, join, leave, reconcile, uniqueName } from '../src/lib/server/mp/members.ts';
import { reduce } from '../src/lib/server/mp/reduce.ts';
import { ANSWER, joinAll, lobby, rng, started, T0 } from './mp-helpers.mjs';

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
