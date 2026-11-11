// 협동 패스와 힌트 투표. 한 행의 흐름은 mp-coop.test.mjs, 등반·타이머 일반은 mp-climb·mp-timers 쪽이 맡는다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { coopNeedsInput, HINT_VOTE_COOLDOWN_MS, HINT_VOTE_MS } from '../src/lib/mp/rules.ts';
import * as coop from '../src/lib/server/mp/coop.ts';
import { disconnect, leave } from '../src/lib/server/mp/members.ts';
import { parseClientMsg } from '../src/lib/server/mp/parse.ts';
import { reduce } from '../src/lib/server/mp/reduce.ts';
import { personalize } from '../src/lib/server/mp/snapshot.ts';
import { alarmTarget, nextDeadline, tick } from '../src/lib/server/mp/timers.ts';
import { coopClimbStarted, coopStarted, grantHint, rng, stageAnswer, started, T0 } from './mp-helpers.mjs';

const NANBANG = 'ㄴㅏㄴㅂㅏㅇ'; // 정답 바나나에 노랑 ㄴ이 생긴다 -> 힌트 4번째 칸 ㄴ
const X = 'ㅁㅏㅁㅁㅏㅁ';
const Y = 'ㅋㅌㅍㅊㅋㅌ';
const first = () => 0;

const propose = (s, pid, jamo, now = T0 + 1) => coop.propose(s, pid, jamo, true, first, now);
const pass = (s, pid, on = true, now = T0 + 1) => coop.pass(s, pid, on, first, now);
const step = (s) => s.game.step;
const view = (s, pid, now = T0 + 5) => personalize(s, pid, now).game;

/** 접속 중인 모두가 같은 단어를 내서 공유 보드에 한 행을 넣는다. */
function everyoneProposes(s, jamo, now = T0 + 1) {
	for (const p of s.players) if (p.connected && !p.left) propose(s, p.pid, jamo, now);
}

const drop = (s, pid, now) => {
	disconnect(s, pid, now);
	return coop.advance(s, first, now);
};

// ---- 패스 ----

test('패스는 제안과 같이 "다 냈다"로 센다: 마지막 사람이 패스하면 기다리지 않고 선택 단계로 간다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, host, X);
	propose(s, a, Y);
	assert.equal(step(s).kind, 'propose');
	assert.equal(pass(s, b).ok, true);
	assert.equal(step(s).kind, 'vote');
	assert.deepEqual(step(s).candidates, [{ jamo: X, by: [host] }, { jamo: Y, by: [a] }]);
});

test('제안이 하나뿐이고 나머지가 패스하면 선택 없이 그 단어가 제출된다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	pass(s, a);
	pass(s, b);
	assert.equal(step(s).kind, 'propose', '방장이 아직');
	propose(s, host, NANBANG);
	assert.deepEqual([s.game.board.rows, s.game.lastPick.how], [[NANBANG], 'single']);
	assert.deepEqual(step(s), { kind: 'propose', proposals: {}, drafts: {} }, '다음 행은 패스가 비워진 채 시작');
});

test('접속이 끊긴 사람은 패스를 기다리지 않는다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, host, X);
	pass(s, a);
	assert.equal(step(s).kind, 'propose', 'b가 아직');
	drop(s, b, T0 + 2);
	assert.deepEqual([s.game.board.rows, s.game.lastPick.how], [[X], 'single']);
});

test('패스한 뒤 제안하면 패스가 풀리고, 패스 취소도 같다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a] = pids;
	assert.deepEqual(pass(s, a), { ok: true, changed: true });
	assert.deepEqual(pass(s, a), { ok: true, changed: false }, '같은 상태 재전송');
	assert.deepEqual(Object.keys(step(s).passes), [a]);
	propose(s, a, X);
	assert.deepEqual([step(s).passes, step(s).proposals[a]], [{}, X]);
	pass(s, host);
	assert.equal(pass(s, host, false).ok, true);
	assert.deepEqual(step(s).passes, {});
	assert.equal(pass(s, host, false).changed, false);
});

test('제안한 사람은 패스할 수 없고, 패스하면 초안도 사라진다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a] = pids;
	propose(s, host, X);
	const r = pass(s, host);
	assert.deepEqual([r.ok, r.code], [false, 'forbidden']);
	coop.draft(s, a, 'ㅋㅌ');
	pass(s, a);
	assert.equal(step(s).drafts[a], undefined);
	assert.equal(view(s, host).step.drafts[a], undefined);
});

test('제안이 하나도 없고 다른 접속자가 전부 패스했으면 마지막 사람은 패스할 수 없다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	pass(s, host);
	pass(s, a);
	const r = pass(s, b);
	assert.deepEqual([r.ok, r.code, r.msg], [false, 'forbidden', '제안이 하나도 없어 패스할 수 없습니다']);
	assert.deepEqual(Object.keys(step(s).passes).sort(), [host, a].sort());
	// 끊긴 사람은 "다른 접속자"가 아니다
	drop(s, a, T0 + 2);
	assert.equal(pass(s, b).ok, false, '남은 접속자는 방장(패스)과 b뿐: 여전히 마지막');
});

test('제안이 하나라도 있으면 마지막 사람도 패스할 수 있다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, host, X);
	pass(s, a);
	assert.equal(pass(s, b).ok, true);
	assert.equal(s.game.board.rows.length, 1, '단 하나의 제안이 제출된다');
});

test('접속이 끊겨 남은 전원이 패스한 상태가 되면 패스를 모두 풀고 알린다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	pass(s, host);
	pass(s, a);
	assert.equal(s.game.passResetAt ?? null, null);
	assert.equal(drop(s, b, T0 + 7), true);
	assert.deepEqual(step(s).passes, {});
	assert.equal(s.game.passResetAt, T0 + 7);
	assert.equal(view(s, host).passResetAt, T0 + 7);
	assert.equal(step(s).kind, 'propose', '진행이 멈추지 않고 다시 제안을 받는다');
	// 같은 상태에서 다시 불러도 바뀌지 않는다
	assert.equal(coop.advance(s, first, T0 + 8), false);
	assert.equal(s.game.passResetAt, T0 + 7);
});

test('나가서(leave) 남은 전원이 패스한 상태가 되는 경우도 같다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	pass(s, host);
	pass(s, a);
	leave(s, b, T0 + 3);
	coop.forfeit(s, b, first, T0 + 3);
	assert.deepEqual(step(s).passes, {});
	assert.equal(s.game.passResetAt, T0 + 3);
	assert.equal(step(s).kind, 'propose');
});

test('나간 사람의 패스 표시는 지워진다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, host, X);
	pass(s, a);
	leave(s, a, T0 + 2);
	coop.forfeit(s, a, first, T0 + 2);
	assert.deepEqual(Object.keys(step(s).passes), []);
	assert.equal(step(s).kind, 'propose', 'b가 아직');
});

test('패스한 사람은 선택 단계에서 모든 후보에 투표할 수 있고, 그 표를 기다린다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, host, X);
	propose(s, a, Y);
	pass(s, b);
	assert.equal(step(s).kind, 'vote');
	coop.vote(s, host, 1, first, T0 + 2);
	coop.vote(s, a, 0, first, T0 + 2);
	assert.equal(step(s).kind, 'vote', '패스한 b가 아직 안 찍었다');
	assert.deepEqual(coop.vote(s, b, 0, first, T0 + 3), { ok: true, changed: true });
	assert.equal(s.game.lastPick.how, 'vote');
	assert.deepEqual(s.game.lastPick.tally, [2, 1]);
	// 두 후보 모두 찍을 수 있었다
	const t = coopStarted(['가', '나']);
	propose(t.s, t.pids[0], X);
	propose(t.s, t.pids[1], Y);
	pass(t.s, t.pids[2]);
	assert.equal(coop.vote(t.s, t.pids[2], 1, first, T0 + 2).ok, true);
	assert.equal(coop.vote(t.s, t.pids[2], 0, first, T0 + 2).ok, true);
});

test('패스는 제안 단계에서만: 선택 단계는 phase 오류, 경쟁에서는 reduce가 거절한다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	propose(s, pids[0], X);
	propose(s, pids[1], Y);
	pass(s, pids[2]);
	const late = coop.pass(s, pids[2], true, first, T0 + 5);
	assert.deepEqual([late.ok, late.code], [false, 'phase']);
	const comp = started(['가']).s;
	const r = reduce(comp, comp.hostPid, { type: 'pass', on: true }, {}, T0 + 5, rng);
	assert.equal(r.events[0].code, 'phase');
});

test('방장 마감은 패스와 무관하게 제안 1건 이상이면 된다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a] = pids;
	pass(s, a);
	assert.equal(coop.close(s, host, first, T0 + 2).ok, false, '제안 0건');
	propose(s, host, X);
	assert.equal(coop.close(s, host, first, T0 + 3).ok, true);
	assert.equal(s.game.board.rows.length, 1);
});

test('reduce: pass 메시지는 변경으로 처리되고 저장된다(초안과 달리)', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const r = reduce(s, pids[1], { type: 'pass', on: true }, {}, T0 + 2, rng);
	assert.deepEqual([r.changed, r.skipSave, r.events], [true, false, []]);
	const dup = reduce(s, pids[1], { type: 'pass', on: true }, {}, T0 + 3, rng);
	assert.equal(dup.changed, false);
	reduce(s, pids[2], { type: 'pass', on: true }, {}, T0 + 4, rng);
	const last = reduce(s, pids[0], { type: 'pass', on: true }, {}, T0 + 5, rng);
	assert.equal(last.events[0].msg, '제안이 하나도 없어 패스할 수 없습니다');
});

test('스냅샷: passes는 패스한 사람의 pid 목록이고 선택 단계에는 없다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	pass(s, b);
	assert.deepEqual(view(s, host).step.passes, [b]);
	assert.deepEqual(view(s, a).step.passes, [b], '모두에게 보인다');
	propose(s, host, X);
	propose(s, a, Y);
	assert.equal(view(s, host).step.kind, 'vote');
	assert.equal('passes' in view(s, host).step, false);
});

test('무입력 경고: 패스한 사람은 입력할 것이 없어 대상이 아니다. 제안도 패스도 안 한 사람만 대상이다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	pass(s, a);
	propose(s, b, X);
	const need = (pid) => coopNeedsInput(view(s, pid).step, pid);
	assert.deepEqual([need(host), need(a), need(b)], [true, false, false]);
	pass(s, a, false);
	assert.equal(need(a), true, '패스를 취소하면 다시 대상');
	// 선택 단계: 패스했던 사람은 찍을 후보가 있으면 대상이다
	propose(s, host, Y);
	propose(s, a, X);
	assert.equal(view(s, host).step.kind, 'vote');
	assert.equal(coopNeedsInput(view(s, b).step, b), true);
	assert.equal(coopNeedsInput(view(s, a).step, a), true);
});

test('parse: pass는 on이 불리언일 때만', () => {
	assert.deepEqual(parseClientMsg('{"type":"pass","on":true}'), { type: 'pass', on: true });
	assert.deepEqual(parseClientMsg('{"type":"pass","on":false}'), { type: 'pass', on: false });
	assert.equal(parseClientMsg('{"type":"pass"}'), null);
	assert.equal(parseClientMsg('{"type":"pass","on":"yes"}'), null);
	assert.deepEqual(parseClientMsg('{"type":"hintvote","yes":false}'), { type: 'hintvote', yes: false });
	assert.equal(parseClientMsg('{"type":"hintvote"}'), null);
});

// ---- 힌트 투표 ----

/** 힌트를 줄 수 있는 보드(난방이 들어가 노랑 ㄴ이 있음). */
function withYellow(names) {
	const r = coopStarted(names);
	everyoneProposes(r.s, NANBANG);
	return r;
}

test('요청하면 투표가 열리고 요청한 사람이 찬성 1표다. 게임은 그대로 진행된다', () => {
	const { s, pids } = withYellow(['가', '나', '다']);
	const [host, a] = pids;
	const r = coop.useHint(s, a, T0 + 2);
	assert.equal(r.ok, true);
	assert.deepEqual(s.game.hintVote, { by: a, yes: [a], no: [], deadline: T0 + 2 + HINT_VOTE_MS });
	assert.equal(s.game.board.hintUsed, false, '아직 쓰지 않았다');
	assert.equal(step(s).kind, 'propose', '단계는 그대로');
	assert.equal(propose(s, host, X, T0 + 3).ok, true, '투표 중에도 제안할 수 있다');
	assert.deepEqual(view(s, host).hintVote, { by: a, yes: 1, no: 0, needed: 3, electorate: 4, deadline: T0 + 2 + HINT_VOTE_MS, myVote: null });
	assert.equal(view(s, a).hintVote.myVote, 'yes');
});

test('2인 방: 요청자 + 상대 찬성 = 전원 찬성이어야 통과한다', () => {
	const { s, pids } = withYellow(['가']);
	const [host, a] = pids;
	coop.useHint(s, host, T0 + 2);
	assert.equal(s.game.board.hintUsed, false, '2명 중 1표는 과반이 아니다');
	assert.deepEqual(view(s, a).hintVote, { by: host, yes: 1, no: 0, needed: 2, electorate: 2, deadline: T0 + 2 + HINT_VOTE_MS, myVote: null });
	assert.deepEqual(coop.hintVote(s, a, true, T0 + 3), { ok: true, changed: true });
	assert.deepEqual([s.game.board.hints, s.game.board.hintUsed, s.game.hintBy, s.game.hintVote], [{ 4: 'ㄴ' }, true, host, null]);
	assert.deepEqual(s.game.lastHintVote, { at: T0 + 3, outcome: 'passed' });
	assert.equal(view(s, a).board.hintBy, host);
});

test('4인 방: 과반(3표)에서 통과, 2표까지는 열려 있다', () => {
	const { s, pids } = withYellow(['가', '나', '다']);
	const [host, a, b, c] = pids;
	coop.useHint(s, c, T0 + 2);
	coop.hintVote(s, a, true, T0 + 3);
	assert.equal(s.game.board.hintUsed, false, '찬성 2/4');
	coop.hintVote(s, host, false, T0 + 4);
	assert.equal(s.game.hintVote.no.length, 1, '반대 1/4는 아직 가능성이 남는다');
	coop.hintVote(s, host, true, T0 + 5);
	assert.deepEqual([s.game.board.hintUsed, s.game.hintBy, s.game.hints], [true, c, undefined]);
});

test('표는 집계 전까지 바꿀 수 있고 같은 표 재전송은 changed=false', () => {
	const { s, pids } = withYellow(['가', '나', '다']);
	const [host, a, , c] = pids;
	coop.useHint(s, c, T0 + 2);
	assert.equal(coop.hintVote(s, a, false, T0 + 3).changed, true);
	assert.equal(coop.hintVote(s, a, false, T0 + 3).changed, false);
	assert.deepEqual(s.game.hintVote.no, [a]);
	coop.hintVote(s, a, true, T0 + 3);
	assert.deepEqual([s.game.hintVote.yes, s.game.hintVote.no], [[c, a], []]);
});

test('반대가 투표권자의 절반 이상이면 남은 표가 모두 찬성이어도 과반이 안 되니 바로 부결한다', () => {
	// 2인: 상대 반대 1 = 1/2
	const two = withYellow(['가']);
	coop.useHint(two.s, two.pids[0], T0 + 2);
	coop.hintVote(two.s, two.pids[1], false, T0 + 3);
	assert.deepEqual([two.s.game.hintVote, two.s.game.board.hintUsed, two.s.game.lastHintVote], [null, false, { at: T0 + 3, outcome: 'failed' }]);
	// 3인: 반대 1은 아직, 2는 부결(찬성은 최대 1)
	const three = withYellow(['가', '나']);
	const [h, a, b] = three.pids;
	coop.useHint(three.s, h, T0 + 2);
	coop.hintVote(three.s, a, false, T0 + 3);
	assert.ok(three.s.game.hintVote, '반대 1/3: 나머지가 찬성하면 2/3로 통과할 수 있다');
	coop.hintVote(three.s, b, false, T0 + 4);
	assert.equal(three.s.game.hintVote, null);
	assert.equal(three.s.game.lastHintVote.outcome, 'failed');
	// 4인: 반대 2 = 2/4 -> 부결
	const four = withYellow(['가', '나', '다']);
	coop.useHint(four.s, four.pids[0], T0 + 2);
	coop.hintVote(four.s, four.pids[1], false, T0 + 3);
	assert.ok(four.s.game.hintVote);
	coop.hintVote(four.s, four.pids[2], false, T0 + 4);
	assert.equal(four.s.game.lastHintVote.outcome, 'failed');
});

test('30초가 지나면 부결한다. 투표하지 않은 사람은 찬성으로 세지 않는다', () => {
	const { s, pids } = withYellow(['가', '나', '다']);
	const [host, a] = pids;
	coop.useHint(s, host, T0 + 2);
	coop.hintVote(s, a, true, T0 + 3); // 찬성 2/4: 아직 부족
	assert.equal(coop.expireHintVote(s, T0 + 2 + HINT_VOTE_MS - 1), false);
	assert.ok(s.game.hintVote);
	assert.equal(coop.expireHintVote(s, T0 + 2 + HINT_VOTE_MS), true);
	assert.deepEqual([s.game.hintVote, s.game.board.hintUsed, s.game.lastHintVote], [null, false, { at: T0 + 2 + HINT_VOTE_MS, outcome: 'timeout' }]);
	assert.equal(coop.expireHintVote(s, T0 + 2 + HINT_VOTE_MS + 1), false, '같은 상태에서 다시 불러도 그대로');
});

test('마감은 DO 알람이 건다: nextDeadline이 투표 마감을 포함하고 tick이 부결한다', () => {
	const { s, pids } = withYellow(['가']);
	assert.equal(nextDeadline(s), null);
	coop.useHint(s, pids[0], T0 + 2);
	assert.equal(nextDeadline(s), T0 + 2 + HINT_VOTE_MS);
	assert.equal(alarmTarget(s, T0, null), T0 + 2 + HINT_VOTE_MS);
	assert.deepEqual(tick(s, T0 + 2 + HINT_VOTE_MS), { changed: true, destroy: false });
	assert.equal(s.game.lastHintVote.outcome, 'timeout');
	assert.equal(nextDeadline(s), null);
	// 제한 시간이 먼저 오면 그 마감이 이긴다
	const t = withYellow(['가']);
	t.s.game.board.deadline = T0 + 10;
	coop.useHint(t.s, t.pids[0], T0 + 2);
	assert.equal(nextDeadline(t.s), T0 + 10);
});

test('부결 직후에는 잠시 다시 요청할 수 없다(cooldown). 시간이 지나면 다시 열 수 있다', () => {
	const { s, pids } = withYellow(['가']);
	const [host, a] = pids;
	coop.useHint(s, host, T0 + 2);
	coop.hintVote(s, a, false, T0 + 3);
	const early = coop.useHint(s, host, T0 + 3 + HINT_VOTE_COOLDOWN_MS - 1);
	assert.deepEqual([early.ok, early.code], [false, 'cooldown']);
	const ok = coop.useHint(s, a, T0 + 3 + HINT_VOTE_COOLDOWN_MS);
	assert.equal(ok.ok, true);
	assert.equal(s.game.board.hintUsed, false, '부결되면 힌트는 그대로 미사용');
});

test('이미 열려 있으면 다시 요청할 수 없고, 요청자는 표를 바꿀 수 없고, 투표가 없으면 phase 오류', () => {
	const { s, pids } = withYellow(['가', '나']);
	const [host, a] = pids;
	assert.equal(coop.hintVote(s, a, true, T0 + 2).code, 'phase');
	coop.useHint(s, host, T0 + 2);
	assert.equal(coop.useHint(s, a, T0 + 2).msg, '이미 힌트 투표가 진행 중입니다');
	assert.equal(coop.hintVote(s, host, false, T0 + 3).code, 'forbidden');
	const out = coopStarted(['가']);
	assert.equal(coop.hintVote(out.s, 'p_none', true, T0).code, 'forbidden', '참가자가 아니다');
});

test('통과한 뒤에는 요청도 투표도 안 받는다(한 판에 한 번)', () => {
	const { s, pids } = withYellow(['가']);
	grantHint(s, pids[0], T0 + 2);
	assert.equal(s.game.board.hintUsed, true);
	assert.equal(coop.useHint(s, pids[1], T0 + 3).msg, '힌트는 한 판에 한 번입니다');
});

test('접속자가 줄면 투표권자가 바뀐다: 끊긴 사람의 표는 세지 않고 과반을 다시 계산한다', () => {
	const { s, pids } = withYellow(['가', '나']);
	const [host, a, b] = pids;
	coop.useHint(s, host, T0 + 2);
	coop.hintVote(s, a, false, T0 + 3); // 찬성 1 반대 1 / 3명: 아직
	assert.ok(s.game.hintVote);
	assert.equal(drop(s, b, T0 + 4), true);
	// 투표권자 2: 찬성 1 반대 1 -> 과반 불가
	assert.deepEqual([s.game.hintVote, s.game.lastHintVote.outcome], [null, 'failed']);

	// 끊겨서 통과하는 경우: 4명 중 찬성 2(과반 아님), 한 명이 끊기면 3명 중 2표로 과반
	const q = withYellow(['가', '나', '다']);
	const [h, x, y, z] = q.pids;
	coop.useHint(q.s, h, T0 + 2);
	coop.hintVote(q.s, x, true, T0 + 3);
	assert.ok(q.s.game.hintVote);
	drop(q.s, y, T0 + 4);
	assert.deepEqual([q.s.game.board.hintUsed, q.s.game.hintBy], [true, h], '투표권자 3명 중 찬성 2는 과반이라 접속이 줄어드는 순간 통과');
});

test('끊긴 요청자의 찬성은 세지 않는다. 돌아오면 다시 센다', () => {
	const { s, pids } = withYellow(['가']);
	const [host, a] = pids;
	coop.useHint(s, host, T0 + 2);
	assert.equal(drop(s, host, T0 + 3), false, '투표권자 1(a), 찬성 0');
	assert.deepEqual(view(s, a).hintVote.yes, 0);
	// a가 찬성하면 투표권자 1명이 찬성 1명: 통과
	coop.hintVote(s, a, true, T0 + 4);
	assert.equal(s.game.board.hintUsed, true);
});

test('투표권자가 혼자 남으면 요청 즉시 통과한다', () => {
	const { s, pids } = withYellow(['가']);
	drop(s, pids[1], T0 + 2);
	coop.useHint(s, pids[0], T0 + 3);
	assert.deepEqual([s.game.board.hintUsed, s.game.hintBy], [true, pids[0]]);
});

test('요청자가 나가면 투표를 접는다(moot)', () => {
	const { s, pids } = withYellow(['가', '나']);
	const [host, a] = pids;
	coop.useHint(s, a, T0 + 2);
	leave(s, a, T0 + 3);
	coop.forfeit(s, a, first, T0 + 3);
	assert.deepEqual([s.game.hintVote, s.game.lastHintVote, s.game.board.hintUsed], [null, { at: T0 + 3, outcome: 'moot' }, false]);
});

test('판이 끝나면 열려 있던 투표를 접는다(포기·시간 초과·정답)', () => {
	const g = withYellow(['가', '나']);
	coop.useHint(g.s, g.pids[1], T0 + 2);
	coop.giveUp(g.s, g.pids[0], T0 + 3);
	assert.deepEqual([g.s.game.hintVote, g.s.game.lastHintVote.outcome, g.s.phase], [null, 'moot', 'result']);
	assert.equal(view(g.s, g.pids[0]).hintVote, null);

	const t = withYellow(['가', '나']);
	t.s.game.board.deadline = T0 + 20;
	coop.useHint(t.s, t.pids[1], T0 + 2);
	assert.equal(coop.expireDeadline(t.s, T0 + 20), true);
	assert.equal(t.s.game.hintVote, null);

	const w = withYellow(['가', '나']);
	coop.useHint(w.s, w.pids[1], T0 + 2);
	everyoneProposes(w.s, 'ㅂㅏㄴㅏㄴㅏ', T0 + 3);
	assert.deepEqual([w.s.game.status, w.s.game.hintVote], ['won', null]);
});

test('같은 스테이지에서 행이 제출되어도 투표는 이어진다. 등반이 다음 스테이지로 넘어가면 접는다', () => {
	const { s, pids } = coopClimbStarted(['가', '나'], {}, 10);
	everyoneProposes(s, `ㅋㅂ${'ㅋ'.repeat(8)}`, T0 + 1); // ㅂ이 노랑
	coop.useHint(s, pids[1], T0 + 2);
	everyoneProposes(s, 'ㅋ'.repeat(10), T0 + 3); // 같은 스테이지의 다음 행
	assert.ok(s.game.hintVote, '행이 들어가도 같은 스테이지면 유지');
	everyoneProposes(s, stageAnswer(10).jamo, T0 + 4); // 클리어 -> 11자
	assert.equal(s.game.board.n, 11);
	assert.deepEqual([s.game.hintVote, s.game.lastHintVote], [null, { at: T0 + 4, outcome: 'moot' }]);
	assert.equal(s.game.board.hintUsed, false);
});

test('통과한 시점의 보드에 힌트가 적용된다(투표 중에 행이 늘어도)', () => {
	const { s, pids } = withYellow(['가']);
	coop.useHint(s, pids[0], T0 + 2);
	everyoneProposes(s, 'ㅂㅜㅁㅂㅏㅇ', T0 + 3);
	assert.equal(s.game.board.rows.length, 2);
	coop.hintVote(s, pids[1], true, T0 + 4);
	assert.equal(s.game.board.hintUsed, true);
	assert.equal(Object.keys(s.game.board.hints).length, 1);
});

test('힌트가 꺼진 방과 줄 힌트가 없는 보드는 투표를 열지 않는다', () => {
	const off = coopStarted(['가'], { hints: false });
	everyoneProposes(off.s, NANBANG);
	assert.equal(coop.useHint(off.s, off.pids[0], T0 + 2).msg, '힌트를 쓸 수 없는 방입니다');
	const none = coopStarted(['가']);
	const r = coop.useHint(none.s, none.pids[0], T0 + 2);
	assert.deepEqual([r.ok, r.msg, none.s.game.hintVote ?? null], [false, '힌트를 줄 노란 자모가 없습니다', null]);
});

test('reduce: hint는 협동에서 투표를 열고 hintvote로 표를 던진다. 경쟁은 hintvote를 거절하고 hint는 그대로 즉시 적용', () => {
	const { s, pids } = withYellow(['가']);
	const [host, a] = pids;
	const open = reduce(s, host, { type: 'hint' }, {}, T0 + 2, rng);
	assert.deepEqual([open.changed, open.skipSave, open.events], [true, false, []]);
	assert.ok(s.game.hintVote);
	const again = reduce(s, host, { type: 'hintvote', yes: true }, {}, T0 + 3, rng);
	assert.equal(again.events[0].code, 'forbidden', '요청자는 표를 못 바꾼다');
	const vote = reduce(s, a, { type: 'hintvote', yes: true }, {}, T0 + 4, rng);
	assert.equal(vote.changed, true);
	assert.equal(s.game.board.hintUsed, true);
	const dup = reduce(s, a, { type: 'hintvote', yes: true }, {}, T0 + 5, rng);
	assert.deepEqual([dup.changed, dup.events[0].code], [false, 'phase']);

	const comp = started(['가']).s;
	assert.equal(reduce(comp, comp.hostPid, { type: 'hintvote', yes: true }, {}, T0, rng).events[0].code, 'phase');
});

test('스냅샷: 열린 투표는 득표수·필요 수·마감·내 표만 보내고 누가 찍었는지는 보내지 않는다. 끝난 결과는 hintVoteEnd', () => {
	const { s, pids } = withYellow(['가', '나', '다']);
	const [host, a, b, c] = pids;
	assert.deepEqual([view(s, host).hintVote, view(s, host).hintVoteEnd, view(s, host).passResetAt], [null, null, null]);
	coop.useHint(s, c, T0 + 2);
	coop.hintVote(s, a, false, T0 + 3);
	const v = view(s, a).hintVote;
	assert.deepEqual(v, { by: c, yes: 1, no: 1, needed: 3, electorate: 4, deadline: T0 + 2 + HINT_VOTE_MS, myVote: 'no' });
	assert.deepEqual(Object.keys(v).sort(), ['by', 'deadline', 'electorate', 'myVote', 'needed', 'no', 'yes']);
	assert.equal(view(s, b).hintVote.myVote, null);
	assert.equal(view(s, c).hintVote.myVote, 'yes');
	coop.hintVote(s, b, false, T0 + 4); // 반대 2/4 -> 부결
	assert.deepEqual(view(s, host).hintVoteEnd, { at: T0 + 4, outcome: 'failed' });
	assert.equal(view(s, host).hintVote, null);
});
