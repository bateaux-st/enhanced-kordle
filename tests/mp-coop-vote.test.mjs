// 협동 투표 묶음: 자기 제안 투표, 투표 제한 시간(VOTE_MS), 제안 취소(unpropose).
import assert from 'node:assert/strict';
import test from 'node:test';
import { coopNeedsInput, VOTE_MS } from '../src/lib/mp/rules.ts';
import * as coop from '../src/lib/server/mp/coop.ts';
import { disconnect, leave } from '../src/lib/server/mp/members.ts';
import { parseClientMsg } from '../src/lib/server/mp/parse.ts';
import { reduce } from '../src/lib/server/mp/reduce.ts';
import { personalize } from '../src/lib/server/mp/snapshot.ts';
import { alarmTarget, nextDeadline, tick } from '../src/lib/server/mp/timers.ts';
import { coopStarted, lobby, rng, T0 } from './mp-helpers.mjs';

const X = 'ㅁㅏㅁㅁㅏㅁ';
const Y = 'ㅋㅌㅍㅊㅋㅌ';
const Z = 'ㅅㅗㅅㅈㅜㅈ';
const first = () => 0;
const last = (max) => max - 1;
const T_VOTE = T0 + 1;
const DUE = T_VOTE + VOTE_MS;

const propose = (s, pid, jamo, now = T_VOTE) => coop.propose(s, pid, jamo, true, first, now);
const vote = (s, pid, c, r = first, now = T0 + 2) => coop.vote(s, pid, c, r, now);
const step = (s) => s.game.step;

/** 방장·가·나가 X·Y·Z를 하나씩 낸 투표 단계(T_VOTE에 진입). */
function votingRoom(settings = {}) {
	const { s, pids } = coopStarted(['가', '나'], settings);
	const [host, a, b] = pids;
	propose(s, host, X);
	propose(s, a, Y);
	propose(s, b, Z);
	return { s, host, a, b };
}

test('자기 제안에 투표: 세 명이 모두 자기 제안을 찍으면 1:1:1 동률이라 돌림판이다', () => {
	const { s, host, a, b } = votingRoom();
	assert.equal(vote(s, host, 0, last).ok, true);
	assert.equal(vote(s, a, 1, last).ok, true);
	assert.equal(step(s).kind, 'vote');
	vote(s, b, 2, last, T0 + 3);
	assert.deepEqual([s.game.lastPick.how, s.game.lastPick.tally, s.game.lastPick.chosen], ['roulette', [1, 1, 1], 2]);
	assert.deepEqual(s.game.board.rows, [Z]);
});

test('자기 제안 한 표와 남의 한 표가 겹치면 그 후보가 이긴다', () => {
	const { s, host, a, b } = votingRoom();
	vote(s, host, 0);
	vote(s, a, 0);
	vote(s, b, 2, first, T0 + 3);
	assert.deepEqual([s.game.lastPick.how, s.game.lastPick.tally, s.game.lastPick.chosen], ['vote', [2, 0, 1], 0]);
});

test('끊긴 사람은 투표에서도 기다리지 않는다(자기 제안만 남은 사람도 집계 대상이다)', () => {
	const { s, host, a, b } = votingRoom();
	vote(s, host, 0);
	disconnect(s, b, T0 + 3);
	assert.equal(step(s).kind, 'vote', 'a가 아직 안 찍었다');
	vote(s, a, 1, last, T0 + 4);
	assert.deepEqual([s.game.lastPick.how, s.game.lastPick.tally], ['roulette', [1, 1, 0]]);
});

test('coopNeedsInput: 투표 단계는 내 표가 없으면 자기 제안만 있는 사람도 입력이 필요하다', () => {
	const { s, host, a } = votingRoom();
	vote(s, a, 0);
	const view = (pid) => personalize(s, pid, T0 + 2).game.step;
	assert.equal(coopNeedsInput(view(host), host), true);
	assert.equal(coopNeedsInput(view(a), a), false);
});

test('투표 단계에 들어갈 때 마감이 VOTE_MS 뒤로 걸린다(방 제한 시간이 꺼져 있어도)', () => {
	const { s } = votingRoom();
	assert.equal(s.game.board.deadline, null);
	assert.equal(step(s).deadline, DUE);
	assert.equal(nextDeadline(s), DUE);
	assert.equal(alarmTarget(s, T0, null), DUE);
});

test('방장 마감으로 제안을 닫아도 그 시각부터 VOTE_MS다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, a, X);
	propose(s, b, Y);
	coop.close(s, host, first, T0 + 5);
	assert.equal(step(s).kind, 'vote');
	assert.equal(step(s).deadline, T0 + 5 + VOTE_MS);
});

test('마감 전에는 그대로, 마감이 되면 아무도 안 찍었어도 전 후보 동률로 돌림판이다', () => {
	const { s } = votingRoom();
	assert.equal(coop.expireVote(s, last, DUE - 1), false);
	assert.equal(step(s).kind, 'vote');
	assert.equal(coop.expireVote(s, last, DUE), true);
	assert.deepEqual([s.game.lastPick.how, s.game.lastPick.tally, s.game.lastPick.chosen, s.game.lastPick.at], ['roulette', [0, 0, 0], 2, DUE]);
	assert.deepEqual(s.game.board.rows, [Z]);
	assert.deepEqual(step(s), { kind: 'propose', proposals: {}, drafts: {} });
	assert.equal(coop.expireVote(s, last, DUE), false, '같은 now로 다시 불러도 그대로');
});

test('마감 시점의 표로 집계한다: 한 명만 찍었으면 그 후보가 제출된다', () => {
	const { s, a } = votingRoom();
	vote(s, a, 2);
	assert.equal(coop.expireVote(s, last, DUE), true);
	assert.deepEqual([s.game.lastPick.how, s.game.lastPick.tally, s.game.lastPick.chosen], ['vote', [0, 0, 1], 2]);
	assert.deepEqual(s.game.board.rows, [Z]);
});

test('마감은 DO 알람 경로(tick)로 처리된다: 만료 시 changed, 다시 불러도 changed=false, 알람은 다음 마감으로 넘어간다', () => {
	const { s } = votingRoom();
	assert.deepEqual(tick(s, DUE - 1, first), { changed: false, destroy: false });
	assert.deepEqual(tick(s, DUE, first), { changed: true, destroy: false });
	assert.equal(s.game.board.rows.length, 1);
	assert.deepEqual(tick(s, DUE, first), { changed: false, destroy: false });
	assert.equal(nextDeadline(s), null);
});

test('접속 중인 사람이 아무도 없으면 마감이 와도 집계하지 않고 마감만 VOTE_MS 뒤로 민다', () => {
	const { s, host, a, b } = votingRoom();
	for (const pid of [host, a, b]) disconnect(s, pid, T0 + 3);
	assert.deepEqual(tick(s, DUE, first), { changed: true, destroy: false });
	assert.equal(step(s).kind, 'vote');
	assert.equal(s.game.board.rows.length, 0);
	assert.equal(step(s).deadline, DUE + VOTE_MS);
	assert.deepEqual(tick(s, DUE, first), { changed: false, destroy: false }, '같은 now로 다시 불러도 그대로');
	assert.equal(nextDeadline(s) > DUE, true, '알람이 과거 시각으로 반복해 울리지 않는다');
});

test('reduce는 다른 메시지를 처리하기 전에 만료된 투표를 먼저 집계한다', () => {
	const { s, host } = votingRoom();
	const r = reduce(s, host, { type: 'vote', candidate: 1 }, {}, DUE + 1, first);
	assert.equal(r.changed, true);
	assert.equal(s.game.board.rows.length, 1, '늦은 표가 아니라 마감 시점의 빈 표로 집계');
	assert.equal(r.events[0].code, 'phase', '이미 제안 단계로 돌아가 있다');
});

test('방 제한 시간 마감이 투표 마감보다 먼저거나 같으면 보드 마감이 이긴다', () => {
	const { s } = votingRoom({ timer: true });
	s.game.board.deadline = DUE;
	assert.equal(nextDeadline(s), DUE);
	assert.deepEqual(tick(s, DUE, first), { changed: true, destroy: false });
	assert.deepEqual([s.phase, s.game.status, s.game.endReason, s.game.board.rows], ['result', 'lost', 'timeout', []]);
});

test('제한 시간이 켜진 방에서도 투표 마감은 따로 걸린다', () => {
	const { s } = votingRoom({ timer: true });
	assert.ok(s.game.board.deadline > DUE);
	assert.equal(nextDeadline(s), DUE, '더 이른 투표 마감이 알람 대상');
});

test('저장본 하위 호환: deadline이 없는 투표 단계는 마감 없이 기다리고 알람도 걸지 않는다', () => {
	const { s, host } = votingRoom();
	delete step(s).deadline;
	assert.equal(nextDeadline(s), null);
	assert.deepEqual(tick(s, DUE + 10 * VOTE_MS, first), { changed: false, destroy: false });
	assert.equal(step(s).kind, 'vote');
	// 이 단계도 전원 투표·방장 마감으로는 끝난다
	assert.equal(coop.close(s, host, first, DUE + 1).ok, true);
	assert.equal(s.game.board.rows.length, 1);
});

test('후보가 줄어 투표 단계를 다시 꾸려도 마감은 처음 그대로다', () => {
	const { s, pids } = coopStarted(['가', '나', '다']);
	const [host, a, b, c] = pids;
	propose(s, host, X);
	propose(s, a, Y);
	propose(s, b, Z);
	propose(s, c, Z);
	assert.equal(step(s).deadline, DUE);
	leave(s, a, T0 + 9);
	coop.forfeit(s, a, first, T0 + 9);
	assert.deepEqual(step(s).candidates.map((x) => x.jamo), [X, Z]);
	assert.equal(step(s).deadline, DUE, '남은 시간이 다시 20초로 늘어나지 않는다');
});

test('후보가 하나로 줄면 마감과 무관하게 바로 제출되고, 0개면 제안 단계로 돌아가 마감이 없다', () => {
	const { s, pids } = coopStarted(['가']);
	const [host, a] = pids;
	propose(s, host, X);
	propose(s, a, Y);
	leave(s, a, T0 + 9);
	coop.forfeit(s, a, first, T0 + 9);
	assert.deepEqual([s.game.board.rows, s.game.lastPick.how], [[X], 'single']);
	assert.equal(step(s).kind, 'propose');
	assert.equal(nextDeadline(s), null);
});

test('투표가 끝나고 다음 행의 투표 단계는 새 마감을 받는다', () => {
	const { s, host, a, b } = votingRoom();
	coop.expireVote(s, first, DUE);
	const t = DUE + 5;
	propose(s, host, X, t);
	propose(s, a, Y, t);
	propose(s, b, Z, t);
	assert.equal(step(s).deadline, t + VOTE_MS);
});

// ---- 제안 취소 ----

test('제안 취소: 제안이 지워지고 초안은 취소한 자모열로 남으며, 그 뒤 패스할 수 있다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a] = pids;
	propose(s, host, X);
	coop.draft(s, host, 'ㅁㅏ');
	assert.deepEqual(coop.unpropose(s, host), { ok: true, changed: true });
	assert.deepEqual(step(s).proposals, {});
	assert.equal(step(s).drafts[host], X, '입력 중이던 글자가 아니라 취소한 제안이 초안이다');
	assert.equal(personalize(s, a, T0).game.step.drafts[host], X, '남들에게는 다시 입력 중으로 보인다');
	assert.deepEqual(personalize(s, a, T0).game.step.proposals, {});
	assert.equal(coop.pass(s, host, true, first, T0 + 2).ok, true);
	assert.deepEqual(step(s).passes, { [host]: true });
});

test('제안 취소: 취소한 뒤 다시 제안할 수 있고, 남은 제안자로 마감 조건이 다시 계산된다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, host, X);
	propose(s, a, Y);
	coop.unpropose(s, a);
	propose(s, b, Z);
	assert.equal(step(s).kind, 'propose', 'a가 취소해 아직 전원이 내지 않았다');
	propose(s, a, Y);
	assert.deepEqual(step(s).candidates.map((c) => c.jamo), [X, Z, Y]);
});

test('제안 취소 거절: 제안하지 않은 사람, 투표 단계, 게임 밖 사람, 패스한 사람', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	const none = coop.unpropose(s, host);
	assert.deepEqual([none.ok, none.code], [false, 'forbidden']);
	coop.pass(s, a, true, first, T0 + 1);
	assert.equal(coop.unpropose(s, a).code, 'forbidden', '패스는 pass(false)로 푼다');
	propose(s, host, X);
	propose(s, b, Y);
	assert.equal(step(s).kind, 'vote');
	const late = coop.unpropose(s, host);
	assert.deepEqual([late.ok, late.code, late.msg], [false, 'phase', '이미 투표가 시작됐습니다']);
	assert.deepEqual(step(s).candidates.map((c) => c.jamo), [X, Y], '후보는 그대로');

	const l = lobby({ kind: 'coop' });
	assert.equal(coop.unpropose(l, l.players[0].pid).code, 'phase', '게임이 없는 방');
});

test('제안 취소: 나간 사람은 할 수 없다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a] = pids;
	propose(s, a, X);
	leave(s, host, T0 + 1);
	coop.forfeit(s, host, first, T0 + 1);
	assert.equal(coop.unpropose(s, host).code, 'forbidden');
});

test('reduce: unpropose는 협동에서만 받고 상태가 바뀌었을 때만 changed다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host] = pids;
	propose(s, host, X);
	const ok = reduce(s, host, { type: 'unpropose' }, {}, T0 + 2, rng);
	assert.deepEqual([ok.changed, ok.events], [true, []]);
	const again = reduce(s, host, { type: 'unpropose' }, {}, T0 + 3, rng);
	assert.deepEqual([again.changed, again.events.map((e) => e.code)], [false, ['forbidden']]);

	const comp = lobby();
	const r = reduce(comp, comp.players[0].pid, { type: 'unpropose' }, {}, T0, rng);
	assert.deepEqual(r.events.map((e) => e.code), ['phase']);
});

test('parse: unpropose는 필드 없이 받고 알 수 없는 필드는 복사하지 않는다', () => {
	assert.deepEqual(parseClientMsg('{"type":"unpropose","jamo":"ㄱ"}'), { type: 'unpropose' });
});
