import assert from 'node:assert/strict';
import test from 'node:test';
import { CLIMB_GRACE_MS, DEFAULT_SETTINGS } from '../src/lib/mp/rules.ts';
import { climbUp, hasAllStages, hintUsedMsg, isClimb, isTop, stageLengths } from '../src/lib/server/mp/climb.ts';
import { applyGuess, freshBoard, giveUp, useHint } from '../src/lib/server/mp/comp.ts';
import * as coop from '../src/lib/server/mp/coop.ts';
import { backToLobby, join } from '../src/lib/server/mp/members.ts';
import { reduce } from '../src/lib/server/mp/reduce.ts';
import { summarize } from '../src/lib/server/mp/rooms.ts';
import { personalize } from '../src/lib/server/mp/snapshot.ts';
import { nextDeadline, tick } from '../src/lib/server/mp/timers.ts';
import { climbStart, compClimbStarted, coopClimbStarted, joinAll, lobby, rng, stageAnswer, stagesFrom, T0, wrongRow } from './mp-helpers.mjs';

const A10 = stageAnswer(10).jamo;
const A11 = stageAnswer(11).jamo;
const A12 = stageAnswer(12).jamo;
const guess = (s, pid, jamo, now = T0 + 1) => applyGuess(s, pid, jamo, true, now);
const snapOf = (s, pid, now = T0 + 5000) => personalize(s, pid, now);

/** 협동: 전원이 같은 단어를 제안해 선택 없이 바로 제출되게 한다. */
function coopSubmit(s, pids, jamo, now = T0 + 1) {
	for (const pid of pids) assert.equal(coop.propose(s, pid, jamo, true, rng, now).ok, true);
}

/** 경쟁: pid가 from..to자 스테이지를 한 번에 하나씩 맞힌다. */
function climbTo(s, pid, from, to, now) {
	for (let n = from; n <= to; n++) assert.equal(guess(s, pid, stageAnswer(n).jamo, now).ok, true);
}

test('climb.ts: 스테이지 길이는 시작 길이부터 12자까지, 12자가 꼭대기', () => {
	assert.deepEqual(stageLengths(10), [10, 11, 12]);
	assert.deepEqual(stageLengths(12), [12]);
	assert.equal(stageLengths(5).length, 8);
	assert.equal(isTop(freshBoard(11)), false);
	assert.equal(isTop(freshBoard(12)), true);
	assert.deepEqual([isClimb({ ...DEFAULT_SETTINGS, game: 'climb' }), isClimb(DEFAULT_SETTINGS)], [true, false]);
});

test('climb.ts: 등반 시작은 위쪽 스테이지 정답이 모두 있어야 한다(길이 12는 정답 하나로 충분)', () => {
	assert.equal(hasAllStages(climbStart(10)), true);
	assert.equal(hasAllStages({ n: 10, answer: stageAnswer(10) }), false);
	assert.equal(hasAllStages({ n: 10, answer: stageAnswer(10), stages: { 11: stageAnswer(11) } }), false);
	assert.equal(hasAllStages({ n: 12, answer: stageAnswer(12) }), true);
});

test('climbUp: 길이 +1, 스테이지 +1, 행·점선은 비우고 높이와 힌트 사용 여부는 잇는다', () => {
	const board = { ...freshBoard(10), rows: [A10], marks: [Array(10).fill('c')], hints: { 0: 'ㅂ' }, hintUsed: true, cleared: 1 };
	const { next, clear } = climbUp(board, T0 + 9);
	assert.deepEqual(next, { stage: 2, n: 11, rows: [], marks: [], hints: {}, hintUsed: true, deadline: null, cleared: 1 });
	assert.deepEqual(clear, { stage: 1, n: 10, rows: [A10], marks: board.marks, at: T0 + 9 });
	assert.notEqual(hintUsedMsg({ ...DEFAULT_SETTINGS, game: 'climb' }), hintUsedMsg(DEFAULT_SETTINGS));
});

test('시작: 경쟁·협동 모두 climb을 받고 위쪽 정답이 빠졌으면 거절한다', () => {
	for (const kind of ['comp', 'coop']) {
		const s = lobby({ kind, game: 'climb' });
		const [host, a] = joinAll(s, ['가']);
		reduce(s, a, { type: 'ready', on: true }, {}, T0, rng);
		const short = reduce(s, host, { type: 'start' }, { start: { n: 10, answer: stageAnswer(10) } }, T0, rng);
		assert.deepEqual([short.events[0].code, s.phase], ['unavailable', 'lobby']);
		const ok = reduce(s, host, { type: 'start' }, { start: climbStart(10) }, T0, rng);
		assert.deepEqual([ok.events, s.phase, s.game.kind], [[], 'playing', kind]);
		assert.deepEqual(Object.keys(s.game.answers).map(Number), [10, 11, 12]);
		assert.equal(s.game.settings.game, 'climb');
	}
});

test('협동 등반: 10 -> 11 -> 12 자동 진행, 12자 정답이면 완주(won)', () => {
	const { s, pids } = coopClimbStarted(['가']);
	coopSubmit(s, pids, A10, T0 + 1);
	const g = s.game;
	assert.deepEqual([s.phase, g.status, g.board.stage, g.board.n, g.board.rows, g.board.cleared], ['playing', 'playing', 2, 11, [], 1]);
	assert.deepEqual(g.step, { kind: 'propose', proposals: {}, drafts: {} }, '새 스테이지는 빈 제안 단계');
	assert.deepEqual([g.lastClear.stage, g.lastClear.n, g.lastClear.rows, g.lastClear.at], [1, 10, [A10], T0 + 1]);

	coopSubmit(s, pids, A11, T0 + 2);
	assert.deepEqual([s.phase, g.board.stage, g.board.n, g.board.cleared, g.lastClear.n], ['playing', 3, 12, 2, 11]);
	coopSubmit(s, pids, A12, T0 + 3);
	assert.deepEqual([s.phase, g.status, g.endReason, g.board.cleared, g.board.n, g.endedAt], ['result', 'won', 'solved', 3, 12, T0 + 3]);

	const view = snapOf(s, pids[0]).game;
	assert.deepEqual([view.cleared, view.status, view.board.stage], [3, 'won', 3]);
	assert.deepEqual(Object.keys(view.answers).map(Number), [10, 11, 12], '피라미드 3단');
});

test('협동 등반: 스테이지마다 시도 횟수는 설정값 그대로 새로 센다', () => {
	const { s, pids } = coopClimbStarted(['가'], { tries: 4 });
	coopSubmit(s, pids, wrongRow(10), T0 + 1);
	coopSubmit(s, pids, wrongRow(10), T0 + 2);
	coopSubmit(s, pids, wrongRow(10), T0 + 3);
	coopSubmit(s, pids, A10, T0 + 4);
	assert.deepEqual([s.game.board.n, s.game.board.rows.length], [11, 0], '4번째 시도로 클리어');
	for (let i = 0; i < 3; i++) coopSubmit(s, pids, wrongRow(11), T0 + 5 + i);
	assert.deepEqual([s.phase, s.game.board.rows.length], ['playing', 3], '11자에서도 3번 틀려도 4번째가 남는다');
	coopSubmit(s, pids, wrongRow(11), T0 + 9);
	assert.equal(s.phase, 'result');
});

test('협동 등반: 중간 스테이지 실패면 종료, 오른 스테이지 수와 멈춘 곳의 정답까지만 공개', () => {
	const { s, pids } = coopClimbStarted(['가'], { tries: 4 });
	coopSubmit(s, pids, A10, T0 + 1);
	for (let i = 0; i < 4; i++) coopSubmit(s, pids, wrongRow(11), T0 + 2 + i);
	const g = s.game;
	assert.deepEqual([s.phase, g.status, g.endReason, g.board.cleared, g.board.n], ['result', 'lost', 'tries', 1, 11]);

	const view = snapOf(s, pids[1]).game;
	assert.deepEqual([view.cleared, view.board.stage, view.board.n], [1, 2, 11]);
	assert.deepEqual(Object.keys(view.answers).map(Number), [10, 11], '못 가 본 12자 정답은 나가지 않는다');
	assert.ok(!JSON.stringify(view).includes(A12));
	assert.ok(!JSON.stringify(view).includes('단어12'));
});

test('협동 등반: 방장 포기도 종료(lost/giveup), 높이는 그대로', () => {
	const { s, pids } = coopClimbStarted(['가']);
	coopSubmit(s, pids, A10, T0 + 1);
	assert.equal(coop.giveUp(s, pids[0], T0 + 2).ok, true);
	assert.deepEqual([s.phase, s.game.status, s.game.endReason, s.game.board.cleared], ['result', 'lost', 'giveup', 1]);
});

test('협동 등반: 힌트는 등반 전체에서 1회, 다음 스테이지에서는 거절하고 썼다는 표시만 남는다', () => {
	const { s, pids } = coopClimbStarted(['가']);
	const [host, a] = pids;
	coopSubmit(s, pids, `ㅋㅂ${'ㅋ'.repeat(8)}`, T0 + 1); // ㅂ이 노랑
	const h = coop.useHint(s, a);
	assert.deepEqual([h.ok, h.pos, h.jamo], [true, 0, 'ㅂ']);
	assert.equal(coop.useHint(s, host).msg, '힌트는 등반 전체에서 한 번입니다');

	coopSubmit(s, pids, A10, T0 + 2);
	const b = s.game.board;
	assert.deepEqual([b.n, b.hints, b.hintUsed, s.game.hintBy], [11, {}, true, a], '점선은 사라지고 사용 기록은 남는다');
	coopSubmit(s, pids, `ㅋㅂ${'ㅋ'.repeat(9)}`, T0 + 3);
	const again = coop.useHint(s, host);
	assert.deepEqual([again.ok, again.code, again.msg], [false, 'forbidden', '힌트는 등반 전체에서 한 번입니다']);
	const view = snapOf(s, host).game.board;
	assert.deepEqual([view.hints, view.hintUsed, view.hintBy], [{}, true, a]);
});

test('경쟁 등반: 모두 같은 단어 순서, 서로 기다리지 않고 자기 속도로 오른다', () => {
	const { s, pids } = compClimbStarted(['가']);
	const [host, a] = pids;
	const row = `ㅂ${'ㅋ'.repeat(9)}`;
	const first = guess(s, host, row);
	climbTo(s, host, 10, 10);
	const hostBoard = s.game.players[host].board;
	assert.deepEqual([hostBoard.stage, hostBoard.n, hostBoard.cleared, hostBoard.rows], [2, 11, 1, []]);
	assert.deepEqual([s.game.players[a].board.n, s.game.players[a].board.rows.length], [10, 0], '상대 보드는 그대로');
	assert.deepEqual(guess(s, a, row).marks, first.marks, '같은 스테이지, 같은 단어는 같은 색');
	climbTo(s, a, 10, 10);
	const next = `ㅂ${'ㅋ'.repeat(10)}`;
	assert.deepEqual(guess(s, a, next).marks, guess(s, host, next).marks, '다음 스테이지도 같은 정답');
	const clear = s.game.players[host].lastClear;
	assert.deepEqual([clear.stage, clear.n, clear.rows, clear.at], [1, 10, [row, A10], T0 + 1]);
});

test('경쟁 등반: 스테이지 실패는 그 사람의 등반 종료(높이 확정), 다른 사람은 계속', () => {
	const { s, pids } = compClimbStarted(['가'], { tries: 4 });
	const [host, a] = pids;
	climbTo(s, a, 10, 10, T0 + 1);
	for (let i = 0; i < 4; i++) guess(s, a, wrongRow(11), T0 + 2 + i);
	const p = s.game.players[a];
	assert.deepEqual([p.status, p.board.cleared, p.board.n, p.triesUsed, p.finishedAt], ['failed', 1, 11, 4, T0 + 5]);
	assert.equal(guess(s, a, A11, T0 + 6).code, 'phase');
	assert.deepEqual([s.phase, s.game.players[host].status], ['playing', 'playing']);
	assert.equal(guess(s, host, A10, T0 + 7).ok, true, '남은 사람은 계속 오른다');
	// 끝난 사람은 순위표를 본다. 정답은 아직 나가지 않는다.
	const view = snapOf(s, a).game;
	assert.ok(view.standings);
	assert.equal(view.answers, undefined);
});

test('경쟁 등반: 첫 완주는 1위 확정 + 유예 60초, 유예 중 완주자는 완주 순서, 만료 시 나머지는 지표로 고정', () => {
	const { s, pids } = compClimbStarted(['가', '나', '다'], { tries: 4 });
	const [host, a, b, c] = pids;
	assert.equal(s.game.graceEnd, null);
	assert.equal(nextDeadline(s), null);

	const t1 = T0 + 100_000;
	climbTo(s, host, 10, 12, t1);
	const g = s.game;
	assert.deepEqual([g.players[host].status, g.finishOrder, g.graceEnd, s.phase], ['solved', [host], t1 + CLIMB_GRACE_MS, 'playing']);
	assert.equal(g.players[host].board.cleared, 3);
	assert.equal(nextDeadline(s), t1 + CLIMB_GRACE_MS);
	assert.equal(snapOf(s, c).game.graceEnd, t1 + CLIMB_GRACE_MS, '진행 중인 사람에게도 유예 마감이 보인다');

	// 유예 중: a는 완주, b는 10자를 깬 뒤 11자에서 초록 2칸, c는 10자에서 초록 9칸
	climbTo(s, a, 10, 12, t1 + 30_000);
	assert.deepEqual([g.finishOrder, g.graceEnd], [[host, a], t1 + CLIMB_GRACE_MS], '두 번째 완주가 유예를 늘리지 않는다');
	climbTo(s, b, 10, 10, t1 + 31_000);
	guess(s, b, `ㅂㅏ${'ㅋ'.repeat(9)}`, t1 + 32_000);
	guess(s, c, `ㅂㅏㄴㅏㄴㅏㅁㅏㅁㅋ`, t1 + 33_000);
	assert.deepEqual(tick(s, t1 + CLIMB_GRACE_MS - 1), { changed: false, destroy: false });
	assert.equal(s.phase, 'playing');

	assert.deepEqual(tick(s, t1 + CLIMB_GRACE_MS), { changed: true, destroy: false });
	assert.deepEqual(tick(s, t1 + CLIMB_GRACE_MS), { changed: false, destroy: false }, '멱등');
	assert.equal(s.phase, 'result');
	assert.equal(g.endedAt, t1 + CLIMB_GRACE_MS);
	assert.deepEqual([g.players[b].status, g.players[c].status, g.players[b].finishedAt], ['timeout', 'timeout', t1 + CLIMB_GRACE_MS]);
	// 높이가 먼저라 b(높이 1)가 초록 9칸인 c(높이 0)보다 위
	assert.deepEqual(
		g.standings.map((x) => [x.pid, x.rank, x.status, x.finishOrder]),
		[
			[host, 1, 'solved', 1],
			[a, 2, 'solved', 2],
			[b, 3, 'timeout', null],
			[c, 4, 'timeout', null]
		]
	);
	assert.equal(nextDeadline(s), null, '결과 단계에는 유예 마감이 남지 않는다');
});

test('경쟁 등반: 유예가 끝난 뒤 들어온 제출은 거절되고 완주로 치지 않는다', () => {
	const { s, pids } = compClimbStarted(['가']);
	const [host, a] = pids;
	climbTo(s, host, 10, 12, T0 + 1);
	climbTo(s, a, 10, 11, T0 + 2);
	const late = reduce(s, a, { type: 'guess', jamo: A12 }, { valid: true }, T0 + 1 + CLIMB_GRACE_MS, rng);
	assert.deepEqual([late.events[0].code, s.phase, s.game.players[a].status, s.game.finishOrder], ['phase', 'result', 'timeout', [host]]);
});

test('경쟁 등반: 남은 사람이 모두 끝나면 유예를 기다리지 않고 바로 결과', () => {
	const { s, pids } = compClimbStarted(['가']);
	const [host, a] = pids;
	climbTo(s, host, 10, 12, T0 + 1);
	assert.equal(s.phase, 'playing');
	giveUp(s, a, T0 + 2);
	assert.deepEqual([s.phase, s.game.endedAt], ['result', T0 + 2]);
	assert.equal(tick(s, T0 + 1 + CLIMB_GRACE_MS).changed, false);
});

test('경쟁 등반: 아무도 완주 못 하고 전원 실패하면 그 시점에 결과(유예 없음)', () => {
	const { s, pids } = compClimbStarted(['가'], { tries: 4 });
	const [host, a] = pids;
	climbTo(s, host, 10, 10, T0 + 1);
	for (let i = 0; i < 4; i++) guess(s, host, wrongRow(11), T0 + 2 + i);
	assert.equal(s.phase, 'playing', '한 명이 아직 남았다');
	for (let i = 0; i < 4; i++) guess(s, a, wrongRow(10), T0 + 10 + i);
	assert.deepEqual([s.phase, s.game.graceEnd, s.game.endedAt], ['result', null, T0 + 13]);
	assert.deepEqual(
		s.game.standings.map((x) => [x.pid, x.rank, x.status]),
		[
			[host, 1, 'failed'],
			[a, 2, 'failed']
		]
	);
	assert.deepEqual(Object.keys(snapOf(s, a).game.answers).map(Number), [10, 11], '도달한 스테이지까지');
});

test('경쟁 등반: 힌트는 1인당 등반 전체에서 1회, 한 사람이 써도 다른 사람은 쓸 수 있다', () => {
	const { s, pids } = compClimbStarted(['가']);
	const [host, a] = pids;
	guess(s, host, `ㅋㅂ${'ㅋ'.repeat(8)}`);
	guess(s, a, `ㅋㅂ${'ㅋ'.repeat(8)}`);
	assert.equal(useHint(s, host).ok, true);
	climbTo(s, host, 10, 10);
	assert.deepEqual([s.game.players[host].board.hintUsed, s.game.players[host].board.hints], [true, {}]);
	guess(s, host, `ㅋㅂ${'ㅋ'.repeat(9)}`);
	const r = useHint(s, host);
	assert.deepEqual([r.ok, r.msg], [false, '힌트는 등반 전체에서 한 번입니다']);
	assert.equal(useHint(s, a).ok, true, '다른 사람의 힌트는 따로');
	assert.equal(snapOf(s, host).game.me.hintUsed, true);
});

test('경쟁 등반: 미완주자의 시도 수는 멈춘(현재) 스테이지의 시도 수', () => {
	const { s, pids } = compClimbStarted(['가', '나'], { tries: 4 });
	const [host, a, b] = pids;
	// host: 10자를 3번 만에 깨고 11자에서 1번 틀린 채 멈춤(누적 4). a: 10자를 1번 만에 깨고 11자에서 2번 틀린 채 멈춤(누적 3).
	guess(s, host, wrongRow(10), T0 + 1);
	guess(s, host, wrongRow(10), T0 + 2);
	climbTo(s, host, 10, 10, T0 + 3);
	guess(s, host, wrongRow(11), T0 + 4);
	climbTo(s, a, 10, 10, T0 + 5);
	guess(s, a, wrongRow(11), T0 + 6);
	guess(s, a, wrongRow(11), T0 + 7);
	climbTo(s, b, 10, 12, T0 + 8);
	tick(s, T0 + 8 + CLIMB_GRACE_MS);
	assert.equal(s.phase, 'result');
	const st = Object.fromEntries(s.game.standings.map((x) => [x.pid, x]));
	assert.deepEqual([st[host].tries, st[a].tries], [1, 2]);
	assert.ok(st[host].rank < st[a].rank, '누적(4 vs 3)이 아니라 현재 스테이지(1 vs 2)로 비교');
});

test('진행 중 스냅샷에는 `answers`도 현재·위쪽 스테이지의 정답도 없다(협동·경쟁 공통)', () => {
	const stages = Object.values(stagesFrom(10));
	const noAnswers = (json, label, except = []) => {
		for (const { word, jamo } of stages) {
			assert.ok(!json.includes(word), `${label}: ${word}`);
			if (!except.includes(jamo)) assert.ok(!json.includes(jamo), `${label}: ${jamo}`);
		}
	};

	const { s, pids } = compClimbStarted(['가', '나']);
	const [host, a] = pids;
	climbTo(s, host, 10, 10, T0 + 1);
	guess(s, a, wrongRow(10), T0 + 2);
	for (const pid of pids) {
		const view = snapOf(s, pid);
		assert.equal(view.game.answers, undefined);
		// 방금 클리어한 방장만 자기 풀이 행(lastClear)으로 10자 정답을 안다.
		noAnswers(JSON.stringify(view), `경쟁 ${pid}`, pid === host ? [A10] : []);
	}

	const c = coopClimbStarted(['가']);
	coopSubmit(c.s, c.pids, A10, T0 + 1);
	for (const pid of c.pids) {
		const view = snapOf(c.s, pid);
		assert.equal(view.game.answers, undefined);
		// 협동은 방금 같이 맞힌 10자 단어가 lastClear·lastPick에 있다.
		noAnswers(JSON.stringify(view), `협동 ${pid}`, [A10]);
	}
});

test('결과 중 들어온 사람은 inGame=false로 들어와 게임 보드 없이 결과만 받고, 목록 태그는 대기 중', () => {
	const { s, pids } = compClimbStarted(['가']);
	const [host, a] = pids;
	giveUp(s, a, T0 + 1);
	giveUp(s, host, T0 + 2);
	assert.equal(s.phase, 'result');
	assert.equal(summarize(s, T0 + 3).inProgress, false);

	const late = join(s, { uid: 'uid-늦', name: '늦은이' }, T0 + 3, rng);
	assert.equal(late.ok, true);
	const view = snapOf(s, late.pid, T0 + 4);
	const me = view.players.find((p) => p.pid === late.pid);
	assert.deepEqual([view.phase, me.inGame, me.ready, view.game.me], ['result', false, false, null]);
	assert.ok(view.players.filter((p) => p.pid !== late.pid).every((p) => p.inGame));
});

test('결과에서 again/next: 전원 준비 해제, 등반 설정 유지 또는 변경, 새로 들어온 사람도 같은 대기실로', () => {
	const make = () => {
		const { s, pids } = compClimbStarted(['가'], { tries: 7, length: 10 });
		giveUp(s, pids[1], T0 + 1);
		giveUp(s, pids[0], T0 + 2);
		const late = join(s, { uid: 'uid-늦', name: '늦은이' }, T0 + 3, rng);
		s.players.forEach((p) => (p.ready = true));
		return { s, pids, late };
	};

	let { s, pids, late } = make();
	assert.equal(reduce(s, pids[0], { type: 'again' }, {}, T0 + 4, rng).changed, true);
	assert.deepEqual([s.phase, s.game, s.settings.game, s.settings.tries, s.settings.length], ['lobby', null, 'climb', 7, 10]);
	assert.deepEqual(
		s.players.map((p) => [p.ready, p.inGame]),
		[
			[false, false],
			[false, false],
			[false, false]
		]
	);
	assert.ok(s.players.some((p) => p.pid === late.pid));

	({ s, pids } = make());
	const next = { ...DEFAULT_SETTINGS, kind: 'coop', game: 'climb', length: 8 };
	const r = reduce(s, pids[0], { type: 'next', settings: next }, {}, T0 + 4, rng);
	assert.deepEqual(r.events, [{ type: 'open_settings', to: pids[0] }]);
	assert.deepEqual([s.phase, s.settings.kind, s.settings.length], ['lobby', 'coop', 8]);
	assert.ok(s.players.every((p) => !p.ready && !p.inGame));
	assert.equal(backToLobby(s, pids[0]).ok, false, '이미 대기실이면 거절');
});
