import assert from 'node:assert/strict';
import test from 'node:test';
import * as coop from '../src/lib/server/mp/coop.ts';
import { disconnect, join, leave } from '../src/lib/server/mp/members.ts';
import { reduce } from '../src/lib/server/mp/reduce.ts';
import { personalize } from '../src/lib/server/mp/snapshot.ts';
import { VOTE_MS } from '../src/lib/mp/rules.ts';
import { ANSWER, coopStarted, grantHint, joinAll, lobby, rng, T0 } from './mp-helpers.mjs';

// 정답 바나나(ㅂㅏㄴㅏㄴㅏ). 난방은 p c c p p a — mp-comp.test.mjs와 같은 실제 판정 예.
const NANBANG = 'ㄴㅏㄴㅂㅏㅇ';
const NANBANG_MARKS = ['p', 'c', 'c', 'p', 'p', 'a'];
const X = 'ㅁㅏㅁㅁㅏㅁ';
const Y = 'ㅋㅌㅍㅊㅋㅌ';
const Z = 'ㅅㅗㅅㅈㅜㅈ';
const first = () => 0;
const last = (max) => max - 1;

const propose = (s, pid, jamo, r = first, now = T0 + 1) => coop.propose(s, pid, jamo, true, r, now);
const vote = (s, pid, c, r = first, now = T0 + 2) => coop.vote(s, pid, c, r, now);
const step = (s) => s.game.step;

/** 접속 중인 모두가 같은 단어를 내서 공유 보드에 한 행을 넣는다. */
function everyoneProposes(s, jamo, now = T0 + 1) {
	for (const p of s.players) if (p.connected && !p.left) propose(s, p.pid, jamo, first, now);
}

/** 방장·가·나가 X·Y·Z를 하나씩 낸 투표 단계. */
function votingRoom(settings = {}) {
	const { s, pids } = coopStarted(['가', '나'], settings);
	const [host, a, b] = pids;
	propose(s, host, X);
	propose(s, a, Y);
	propose(s, b, Z);
	return { s, host, a, b };
}

test('시작: 전원이 inGame이고 공유 보드는 비어 있으며 제안 단계에서 시작한다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	assert.equal(s.phase, 'playing');
	assert.equal(s.game.kind, 'coop');
	assert.ok(pids.every((pid) => s.players.find((p) => p.pid === pid).inGame));
	assert.deepEqual([s.game.board.n, s.game.board.rows, s.game.hintBy, s.game.lastPick, s.game.status], [6, [], null, null, 'playing']);
	assert.deepEqual(step(s), { kind: 'propose', proposals: {}, drafts: {} });
	assert.deepEqual(s.game.answers[6], ANSWER);
	assert.notEqual(s.game.settings, s.settings, '시작 시점 사본');
});

test('방 설정의 종류가 협동이면 reduce start가 협동 게임을 연다(경쟁 단판은 그대로)', () => {
	const s = lobby({ kind: 'coop' });
	const [host, a] = joinAll(s, ['가']);
	reduce(s, a, { type: 'ready', on: true }, {}, T0, rng);
	const r = reduce(s, host, { type: 'start' }, { start: { n: 6, answer: ANSWER } }, T0, rng);
	assert.equal(r.changed, true);
	assert.equal(s.game.kind, 'coop');
	const comp = lobby();
	const [h2, a2] = joinAll(comp, ['가']);
	reduce(comp, a2, { type: 'ready', on: true }, {}, T0, rng);
	reduce(comp, h2, { type: 'start' }, { start: { n: 6, answer: ANSWER } }, T0, rng);
	assert.equal(comp.game.kind, 'comp');
	// 등반인데 위쪽 스테이지 정답이 없으면 진행 중에 정답을 못 찾으므로 시작하지 않는다
	const bad = lobby({ kind: 'coop', game: 'climb' });
	const [h3, a3] = joinAll(bad, ['가']);
	reduce(bad, a3, { type: 'ready', on: true }, {}, T0, rng);
	assert.equal(reduce(bad, h3, { type: 'start' }, { start: { n: 6, answer: ANSWER } }, T0, rng).events[0].code, 'unavailable');
});

test('초안: 길이 <= n, 자모만. 같은 내용 재전송은 changed=false, 빈 문자열은 지움, 확정 제안은 그대로', () => {
	const { s, pids } = coopStarted(['가']);
	const [host, a] = pids;
	assert.deepEqual(coop.draft(s, a, 'ㄴㅏ'), { ok: true, changed: true });
	assert.deepEqual(coop.draft(s, a, 'ㄴㅏ'), { ok: true, changed: false });
	assert.equal(coop.draft(s, a, 'ㄴㅏㄴㅂㅏㅇㅇ').code, 'invalid', '길이 초과');
	assert.equal(coop.draft(s, a, 'ㄴㅏA').code, 'invalid', '자모 아님');
	assert.equal(coop.draft(s, a, '난').code, 'invalid');
	assert.deepEqual(step(s).drafts, { [a]: 'ㄴㅏ' });
	assert.deepEqual(coop.draft(s, a, ''), { ok: true, changed: true });
	assert.deepEqual(coop.draft(s, a, ''), { ok: true, changed: false });
	assert.deepEqual(step(s).drafts, {});

	propose(s, host, X);
	coop.draft(s, host, 'ㅁㅏ');
	assert.deepEqual([step(s).proposals[host], step(s).drafts[host]], [X, 'ㅁㅏ'], '초안을 고쳐도 확정 제안은 유지');
});

test('나간 사람은 초안도 제안도 보낼 수 없다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [, a] = pids;
	leave(s, a, T0);
	coop.forfeit(s, a, first, T0);
	assert.equal(coop.draft(s, a, 'ㄴ').code, 'forbidden');
	assert.equal(coop.propose(s, a, X, true, first, T0).code, 'forbidden');
});

test('제안 단계가 아니면 거절한다: 투표 단계의 draft·propose, 게임이 없는 방의 draft', () => {
	const v = votingRoom();
	assert.equal(coop.draft(v.s, v.b, 'ㄴ').code, 'phase');
	assert.equal(coop.propose(v.s, v.b, X, true, first, T0).code, 'phase');
	const l = lobby();
	assert.equal(reduce(l, l.players[0].pid, { type: 'draft', jamo: 'ㄴ' }, {}, T0, rng).events[0].code, 'phase');
});

test('제안 검사: 길이·자모·사전·조회 실패는 개인과 같은 문구로 거절하고 제안은 생기지 않는다', () => {
	const { s, pids } = coopStarted(['가']);
	const a = pids[1];
	assert.deepEqual([coop.propose(s, a, NANBANG, false, first, T0).code, coop.propose(s, a, NANBANG, false, first, T0).msg], ['invalid', '사전에 없는 단어입니다']);
	assert.deepEqual([coop.propose(s, a, NANBANG, undefined, first, T0).code, coop.propose(s, a, NANBANG, undefined, first, T0).msg], ['unavailable', '서버에 연결할 수 없습니다']);
	assert.deepEqual([coop.propose(s, a, 'ㄴㅏㄴㅂㅏ', true, first, T0).code, coop.propose(s, a, 'ㄴㅏㄴㅂㅏ', true, first, T0).msg], ['invalid', '자모가 부족합니다']);
	assert.equal(coop.propose(s, a, 'ㄴㅏㄴㅂㅏA', true, first, T0).code, 'invalid');
	assert.deepEqual(step(s).proposals, {});
});

test('하드모드는 공유 보드 기준: 누가 제안하든 앞서 나온 초록·노랑을 지켜야 한다', () => {
	const { s, pids } = coopStarted(['가'], { hard: true });
	const [host, a] = pids;
	everyoneProposes(s, NANBANG);
	assert.deepEqual(s.game.board.marks, [NANBANG_MARKS]);
	const pos = propose(s, host, 'ㅂㅜㅁㅂㅏㅇ');
	assert.deepEqual([pos.ok, pos.code, pos.msg], [false, 'hard', '2번째 칸은 ㅏ입니다']);
	const missing = propose(s, a, 'ㅁㅏㄴㅁㅜㄹ');
	assert.deepEqual([missing.code, missing.msg], ['hard', 'ㅂ을(를) 포함해야 합니다']);
	assert.deepEqual(step(s).proposals, {});
	assert.equal(propose(s, a, 'ㅁㅏㄴㅂㅜㄹ').ok, true);
});

test('하드모드가 꺼진 방은 제약을 어긴 제안도 받는다', () => {
	const { s, pids } = coopStarted(['가']);
	everyoneProposes(s, NANBANG);
	assert.equal(propose(s, pids[0], Y).ok, true);
});

test('같은 단어 제안은 후보 하나로 합쳐지고 제안자 목록에 모두 들어간다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, host, X);
	propose(s, a, X);
	assert.equal(step(s).kind, 'propose', '나가 아직');
	propose(s, b, Y);
	assert.equal(step(s).kind, 'vote');
	assert.deepEqual(step(s).candidates, [
		{ jamo: X, by: [host, a] },
		{ jamo: Y, by: [b] }
	]);
});

test('제안이 병합 뒤 하나뿐이면 선택 단계 없이 공유 보드에 바로 제출한다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, host, NANBANG);
	propose(s, a, NANBANG);
	assert.equal(s.game.board.rows.length, 0);
	const r = propose(s, b, NANBANG, first, T0 + 7);
	assert.equal(r.changed, true);
	assert.deepEqual(s.game.board.rows, [NANBANG]);
	assert.deepEqual(s.game.board.marks, [NANBANG_MARKS]);
	assert.deepEqual(s.game.lastPick, { candidates: [NANBANG], by: [[host, a, b]], chosen: 0, how: 'single', at: T0 + 7 });
	assert.deepEqual(step(s), { kind: 'propose', proposals: {}, drafts: {} }, '제안·초안이 비워진다');
	assert.equal(s.game.status, 'playing');
});

test('제안은 덮어쓰기만 된다: 마감 전에 다시 보내면 교체되고, 같은 단어 재전송은 changed=false', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host] = pids;
	assert.equal(propose(s, host, X).changed, true);
	assert.equal(propose(s, host, X).changed, false);
	assert.equal(propose(s, host, Y).changed, true);
	assert.equal(step(s).proposals[host], Y);
	assert.equal(step(s).drafts[host], Y);
});

test('투표: 자기 제안에도 찍을 수 있고, 집계 전에는 다른 후보로 바꿀 수 있다', () => {
	const { s, host, a } = votingRoom();
	assert.deepEqual(vote(s, host, 0), { ok: true, changed: true });
	assert.deepEqual(step(s).votes, { [host]: 0 });
	assert.deepEqual(vote(s, host, 0), { ok: true, changed: false });
	assert.deepEqual(vote(s, host, 1), { ok: true, changed: true });
	assert.deepEqual(vote(s, host, 2), { ok: true, changed: true });
	assert.deepEqual(step(s).votes, { [host]: 2 }, '1인 1표: 바꾸면 이전 표가 사라진다');
	assert.equal(vote(s, a, 9).code, 'invalid', '없는 후보');
	assert.equal(step(s).kind, 'vote');
});

test('전원 투표하면 최다 득표 후보가 선택되고 득표수가 lastPick에 남는다', () => {
	const { s, host, a, b } = votingRoom();
	vote(s, host, 1);
	vote(s, a, 2);
	assert.equal(step(s).kind, 'vote');
	vote(s, b, 1, first, T0 + 9);
	assert.deepEqual(s.game.board.rows, [Y]);
	assert.deepEqual(s.game.lastPick, { candidates: [X, Y, Z], by: [[host], [a], [b]], chosen: 1, how: 'vote', tally: [0, 2, 1], at: T0 + 9 });
	assert.deepEqual(step(s), { kind: 'propose', proposals: {}, drafts: {} });
});

test('1:1:1 동률은 동률 후보끼리 서버가 돌림판으로 정하고 득표수도 기록한다', () => {
	for (const [r, chosen] of [[first, 0], [last, 2]]) {
		const { s, host, a, b } = votingRoom();
		vote(s, host, 1, r);
		vote(s, a, 2, r);
		vote(s, b, 0, r);
		assert.deepEqual([s.game.lastPick.how, s.game.lastPick.tally, s.game.lastPick.chosen], ['roulette', [1, 1, 1], chosen]);
	}
});

test('동률은 최다 득표 후보끼리만 돌린다(득표가 낮은 후보는 뽑히지 않는다)', () => {
	const { s, pids } = coopStarted(['가', '나', '다']);
	const [host, a, b, c] = pids;
	propose(s, host, X);
	propose(s, a, Y);
	propose(s, b, Z);
	propose(s, c, Z);
	// 후보: X(host) Y(a) Z(b,c). host->Y, a->X, b->X, c->Y : X 2표, Y 2표, Z 0표
	vote(s, host, 1, last);
	vote(s, a, 0, last);
	vote(s, b, 0, last);
	vote(s, c, 1, last);
	assert.deepEqual([s.game.lastPick.tally, s.game.lastPick.how, s.game.lastPick.chosen], [[2, 2, 0], 'roulette', 1]);
});

test('2인 방에서 서로 상대 제안에 투표하면 동률이라 돌림판이다', () => {
	const { s, pids } = coopStarted(['가']);
	const [host, a] = pids;
	propose(s, host, X);
	propose(s, a, Y);
	vote(s, host, 1, last);
	vote(s, a, 0, last);
	assert.deepEqual([s.game.lastPick.how, s.game.lastPick.tally, s.game.lastPick.chosen], ['roulette', [1, 1], 1]);
	assert.deepEqual(s.game.board.rows, [Y]);
});

test('후보가 하나뿐인 투표 단계에서도 모든 접속자가 찍어야 집계한다(자기 제안 후보도 찍는다)', () => {
	// 병합 규칙상 후보가 둘 이상이어야 투표 단계가 생긴다. 상태를 직접 만들어 "전원 투표" 조건 자체를 확인한다.
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	s.game.step = { kind: 'vote', candidates: [{ jamo: X, by: [host, a] }], votes: {}, deadline: T0 + 1 + VOTE_MS };
	assert.equal(vote(s, host, 0).ok, true);
	assert.equal(vote(s, a, 0).ok, true);
	assert.equal(s.game.board.rows.length, 0, '아직 b가 투표하지 않았다');
	vote(s, b, 0, first, T0 + 3);
	assert.deepEqual([s.game.board.rows, s.game.lastPick.how, s.game.lastPick.tally], [[X], 'vote', [3]]);
});

test('방장 마감: 제안이 하나 이상일 때만 되고, 방장만 할 수 있다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	const none = coop.close(s, host, first, T0);
	assert.deepEqual([none.ok, none.code], [false, 'forbidden']);
	propose(s, a, X);
	propose(s, b, Y);
	assert.equal(step(s).kind, 'propose', '방장이 아직 안 냈다');
	assert.equal(coop.close(s, host, first, T0 + 1).ok, true);
	assert.equal(step(s).kind, 'vote');

	const t = coopStarted(['가', '나']);
	const [h2, a2] = t.pids;
	propose(t.s, a2, X);
	assert.equal(coop.close(t.s, a2, first, T0).code, 'forbidden', '방장이 아니다');
	assert.equal(step(t.s).kind, 'propose');
	assert.equal(coop.close(t.s, h2, first, T0 + 5).ok, true);
	assert.deepEqual([t.s.game.board.rows, t.s.game.lastPick.how], [[X], 'single'], '제안이 하나뿐이라 바로 제출');
});

test('방장이 투표 도중 마감하면 그 시점의 표로 집계하고, 0표 동률은 전체 돌림판이다', () => {
	const { s, host } = votingRoom();
	assert.equal(coop.close(s, host, last, T0 + 4).ok, true);
	assert.deepEqual([s.game.lastPick.how, s.game.lastPick.tally, s.game.lastPick.chosen], ['roulette', [0, 0, 0], 2]);

	const t = votingRoom();
	vote(t.s, t.host, 1);
	coop.close(t.s, t.host, last, T0 + 4);
	assert.deepEqual([t.s.game.lastPick.how, t.s.game.lastPick.tally, t.s.game.lastPick.chosen], ['vote', [0, 1, 0], 1]);
});

test('돌림판 방식: 후보가 둘 이상이면 서버가 투표 없이 바로 고른다', () => {
	const { s, pids } = coopStarted(['가'], { pick: 'roulette' });
	const [host, a] = pids;
	propose(s, host, X);
	propose(s, a, Y, last, T0 + 6);
	assert.deepEqual(s.game.board.rows, [Y]);
	assert.deepEqual(s.game.lastPick, { candidates: [X, Y], by: [[host], [a]], chosen: 1, how: 'roulette', at: T0 + 6 });
	assert.equal(step(s).kind, 'propose');
	// 후보가 하나면 방식과 무관하게 single
	everyoneProposes(s, Z, T0 + 8);
	assert.equal(s.game.lastPick.how, 'single');
});

test('끊긴 사람은 기다리지 않는다: 마지막 미제안자가 끊기면 그 시점에 선택 단계로 간다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, host, X);
	propose(s, a, Y);
	assert.equal(step(s).kind, 'propose');
	disconnect(s, b, T0 + 1);
	assert.equal(coop.advance(s, first, T0 + 1), true);
	assert.equal(step(s).kind, 'vote');
	assert.equal(s.players.find((p) => p.pid === b).left, undefined, '탈락시키지 않는다');
	assert.equal(s.players.find((p) => p.pid === b).inGame, true);
	// 다시 불러도 같다
	assert.equal(coop.advance(s, first, T0 + 1), false);
});

test('투표도 접속 중인 사람만으로 전원 투표가 성립한다', () => {
	const { s, host, a, b } = votingRoom();
	vote(s, host, 1, last);
	disconnect(s, b, T0 + 3);
	assert.equal(step(s).kind, 'vote');
	vote(s, a, 0, last);
	assert.deepEqual([s.game.lastPick.how, s.game.lastPick.tally], ['roulette', [1, 1, 0]]);
});

test('투표 중 마지막 미투표자가 끊기면 그 시점에 집계한다', () => {
	const { s, host, a, b } = votingRoom();
	vote(s, host, 1);
	vote(s, a, 0);
	assert.equal(step(s).kind, 'vote');
	disconnect(s, b, T0 + 3);
	coop.advance(s, last, T0 + 3);
	assert.equal(s.game.lastPick.tally.join(), '1,1,0');
	assert.equal(s.game.board.rows.length, 1);
});

test('끊긴 사람의 기존 제안은 유지되고 후보에 남는다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, b, Z);
	disconnect(s, b, T0 + 1);
	assert.equal(step(s).proposals[b], Z);
	propose(s, host, X);
	propose(s, a, Y);
	assert.deepEqual(step(s).candidates.map((c) => c.jamo), [Z, X, Y], '끊긴 사람의 후보도 남는다');
});

test('재접속으로 조건이 채워지면 그 시점에 진행하고, 아무도 접속하지 않았을 때는 멈춰 기다린다', () => {
	const { s, pids } = coopStarted(['가']);
	const [host, a] = pids;
	propose(s, host, NANBANG);
	disconnect(s, host, T0 + 1);
	assert.equal(step(s).kind, 'propose', '접속 중인 a가 아직 안 냈다');
	propose(s, a, NANBANG);
	assert.equal(s.game.board.rows.length, 1, '접속 중 전원(a)이 냈으니 진행');

	// 다음 행: host가 제안한 채 둘 다 끊기면 집계 대상이 없어 아무것도 진행하지 않는다
	join(s, { uid: 'uid-host', name: '방장' }, T0 + 2, rng);
	propose(s, host, Y);
	assert.equal(s.game.board.rows.length, 1, 'a가 아직 안 냈다');
	disconnect(s, host, T0 + 3);
	disconnect(s, a, T0 + 3);
	assert.equal(coop.advance(s, first, T0 + 3), false);
	assert.equal(s.game.board.rows.length, 1);
	// 이미 제안한 host가 돌아오고 a는 끊긴 채면 접속 중 전원이 제안한 셈이다
	join(s, { uid: 'uid-host', name: '방장' }, T0 + 4, rng);
	assert.equal(coop.advance(s, first, T0 + 4), true);
	assert.deepEqual(s.game.board.rows, [NANBANG, Y]);
});

test('나가기: 나간 사람의 제안·초안은 지워지고, 그 덕에 전원 제안이 성립하면 바로 진행한다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	propose(s, host, X);
	coop.draft(s, a, 'ㄴㅏ');
	propose(s, b, Y);
	assert.equal(step(s).kind, 'propose', '가가 확정하지 않았다');
	leave(s, a, T0 + 1);
	coop.forfeit(s, a, first, T0 + 1);
	assert.equal(s.players.find((p) => p.pid === a).left, true);
	assert.equal(step(s).kind, 'vote', '남은 둘이 모두 제안했다');
	assert.deepEqual(step(s).candidates.map((c) => c.by), [[host], [b]]);
	assert.equal(step(s).proposals, undefined);

	// 이미 제안한 사람이 나가면 후보에서 빠진다
	const t = coopStarted(['가', '나']);
	const [, a2, b2] = t.pids;
	propose(t.s, a2, Y);
	propose(t.s, b2, Z);
	leave(t.s, a2, T0 + 1);
	coop.forfeit(t.s, a2, first, T0 + 1);
	assert.deepEqual(step(t.s).proposals, { [b2]: Z });
	assert.deepEqual(step(t.s).drafts, { [b2]: Z });
});

test('투표 중 나가기: 표와 후보가 빠지고, 후보가 하나 남으면 선택 없이 제출한다', () => {
	const { s, host, a, b } = votingRoom();
	vote(s, host, 2);
	vote(s, b, 0);
	leave(s, a, T0 + 3);
	coop.forfeit(s, a, first, T0 + 3);
	// Y(a)가 사라져 후보는 X(0), Z(1)로 당겨지고, host의 표(Z)도 번호가 따라간다. 투표자가 모두 끝나 바로 집계된다.
	assert.deepEqual(s.game.lastPick.candidates, [X, Z]);
	assert.deepEqual(s.game.lastPick.by, [[host], [b]], '나간 사람의 후보는 빠지고 제안자 목록도 같은 순서로 당겨진다');
	assert.deepEqual(s.game.lastPick.tally, [1, 1]);

	const t = votingRoom();
	vote(t.s, t.host, 2);
	leave(t.s, t.a, T0 + 3);
	coop.forfeit(t.s, t.a, first, T0 + 3);
	assert.equal(step(t.s).kind, 'vote');
	assert.deepEqual(step(t.s).votes, { [t.host]: 1 });
	leave(t.s, t.b, T0 + 4);
	coop.forfeit(t.s, t.b, first, T0 + 4);
	assert.deepEqual([t.s.game.lastPick.how, t.s.game.board.rows], ['single', [X]]);
	assert.deepEqual(t.s.game.lastPick.by, [[t.host]]);
});

test('lastPick.by: 같은 단어를 낸 두 사람은 한 후보에 함께 들어가고 스냅샷에도 나간다', () => {
	// 돌림판 방식: X를 낸 host·a가 한 후보, Y를 낸 b가 다른 후보
	const r = coopStarted(['가', '나'], { pick: 'roulette' });
	const [host, a, b] = r.pids;
	propose(r.s, host, X);
	propose(r.s, a, X);
	propose(r.s, b, Y, last, T0 + 6);
	assert.deepEqual(r.s.game.lastPick.candidates, [X, Y]);
	assert.deepEqual(r.s.game.lastPick.by, [[host, a], [b]]);
	assert.equal(r.s.game.lastPick.how, 'roulette');

	// 투표 방식: 병합 후보 X(host·a)와 Y(b). host·a는 X를 찍을 수 없으니 둘 다 Y, b는 X → X 1표 Y 2표
	const v = coopStarted(['가', '나']);
	const [h2, a2, b2] = v.pids;
	propose(v.s, h2, X);
	propose(v.s, a2, X);
	propose(v.s, b2, Y);
	vote(v.s, h2, 1);
	vote(v.s, a2, 1);
	vote(v.s, b2, 0, first, T0 + 9);
	assert.deepEqual(v.s.game.lastPick.by, [[h2, a2], [b2]]);
	assert.deepEqual(v.s.game.lastPick.tally, [1, 2]);
	// 스냅샷에도 그대로 나간다
	assert.deepEqual(personalize(v.s, h2, T0 + 10).game.lastPick.by, [[h2, a2], [b2]]);
});

test('reduce 경로의 leave가 자동 진행까지 이어진다', () => {
	const { s, pids } = coopStarted(['가']);
	const [host, a] = pids;
	propose(s, host, NANBANG);
	const r = reduce(s, a, { type: 'leave' }, {}, T0 + 2, rng);
	assert.equal(r.changed, true);
	assert.equal(s.game.board.rows.length, 1, '남은 방장의 제안만으로 진행');
});

test('힌트: 판당 1회, 참가자 누구나, 누가 썼는지 남는다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	assert.equal(coop.useHint(s, a, T0).code, 'forbidden', '노랑이 아직 없다');
	everyoneProposes(s, NANBANG);
	assert.equal(grantHint(s, b).ok, true);
	assert.deepEqual([s.game.board.hints, s.game.board.hintUsed, s.game.hintBy], [{ 4: 'ㄴ' }, true, b]);
	const again = coop.useHint(s, host, T0 + 2);
	assert.deepEqual([again.ok, again.code, again.msg], [false, 'forbidden', '힌트는 한 판에 한 번입니다']);
	assert.equal(s.game.hintBy, b);
});

test('힌트가 꺼진 방은 거절한다', () => {
	const { s, pids } = coopStarted(['가'], { hints: false });
	everyoneProposes(s, NANBANG);
	const r = coop.useHint(s, pids[0], T0 + 1);
	assert.deepEqual([r.ok, r.code, r.msg], [false, 'forbidden', '힌트를 쓸 수 없는 방입니다']);
	assert.equal(s.game.board.hintUsed, false);
});

test('투표 단계에서도 힌트를 쓸 수 있고 단계는 그대로다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	everyoneProposes(s, NANBANG);
	propose(s, host, X);
	propose(s, a, Y);
	propose(s, b, Z);
	assert.equal(step(s).kind, 'vote');
	assert.equal(grantHint(s, a, T0 + 3).ok, true);
	assert.deepEqual([step(s).kind, s.game.hintBy], ['vote', a]);
});

test('힌트 계산은 경쟁과 같은 규칙: 나중에 초록을 받은 자모는 노랑 후보가 아니다', () => {
	const { s, pids } = coopStarted(['가']);
	everyoneProposes(s, 'ㄴㅂㅋㅋㅋㅋ'); // ㄴ·ㅂ 노랑
	everyoneProposes(s, 'ㅋㅋㄴㅋㄴㅋ', T0 + 2); // ㄴ이 정답 속 두 자리 모두 초록
	assert.equal(grantHint(s, pids[0], T0 + 3).ok, true);
	assert.deepEqual([s.game.board.hints, s.game.hintBy], [{ 0: 'ㅂ' }, pids[0]]);
});

test('포기: 방장만 할 수 있고, 공유 판 전체가 실패로 끝난다', () => {
	const { s, pids } = coopStarted(['가']);
	const [host, a] = pids;
	assert.deepEqual([coop.giveUp(s, a, T0).ok, coop.giveUp(s, a, T0).code], [false, 'forbidden']);
	assert.equal(s.phase, 'playing');
	propose(s, a, X);
	assert.equal(coop.giveUp(s, host, T0 + 9).ok, true);
	assert.deepEqual([s.game.status, s.game.endReason, s.game.endedAt, s.phase], ['lost', 'giveup', T0 + 9, 'result']);
	assert.deepEqual(step(s), { kind: 'propose', proposals: {}, drafts: {} }, '진행 중이던 제안은 버린다');
});

test('정답: won/solved, result로 넘어가고 준비가 풀리며 나간 사람의 자리가 정리된다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	leave(s, b, T0);
	coop.forfeit(s, b, first, T0);
	s.players.find((p) => p.pid === a).ready = true;
	propose(s, host, ANSWER.jamo, first, T0 + 5);
	propose(s, a, ANSWER.jamo, first, T0 + 5);
	assert.deepEqual([s.game.status, s.game.endReason, s.game.endedAt, s.phase], ['won', 'solved', T0 + 5, 'result']);
	assert.deepEqual(s.game.board.marks, [['c', 'c', 'c', 'c', 'c', 'c']]);
	assert.deepEqual(s.players.map((p) => p.pid), [host, a], '나간 사람의 자리가 치워진다');
	assert.ok(s.players.every((p) => !p.ready));
	assert.equal(s.game.lastPick.how, 'single');
	// 끝난 판에는 아무 메시지도 먹지 않는다
	assert.equal(propose(s, host, X).code, 'phase');
	assert.equal(coop.useHint(s, host, T0 + 6).code, 'phase');
	assert.equal(coop.giveUp(s, host, T0 + 6).code, 'phase');
	assert.equal(coop.close(s, host, first, T0 + 6).code, 'phase');
});

test('시도 소진: 마지막 행이 정답이 아니면 lost/tries', () => {
	const { s } = coopStarted(['가'], { tries: 4 });
	for (const w of [X, Y, Z]) everyoneProposes(s, w);
	assert.equal(s.phase, 'playing');
	everyoneProposes(s, NANBANG, T0 + 9);
	assert.deepEqual([s.game.board.rows.length, s.game.status, s.game.endReason, s.phase], [4, 'lost', 'tries', 'result']);
});

test('마지막 시도가 정답이면 이긴다(시도 소진보다 정답이 먼저)', () => {
	const { s } = coopStarted(['가'], { tries: 4 });
	for (const w of [X, Y, Z]) everyoneProposes(s, w);
	everyoneProposes(s, ANSWER.jamo);
	assert.deepEqual([s.game.status, s.game.endReason], ['won', 'solved']);
});

test('투표 방식에서 정답 후보가 뽑히면 이긴다', () => {
	const { s, pids } = coopStarted(['가']);
	const [host, a] = pids;
	propose(s, host, ANSWER.jamo);
	propose(s, a, X);
	vote(s, host, 1, first);
	vote(s, a, 0, first);
	assert.deepEqual([s.game.lastPick.chosen, s.game.status, s.phase], [0, 'won', 'result']);
});

test('경쟁 방 전용 메시지: 협동에서 guess·eliminate는 phase로 거절, 경쟁에서 draft·propose·close·vote도 거절', () => {
	const { s, pids } = coopStarted(['가']);
	const [host, a] = pids;
	for (const msg of [{ type: 'guess', jamo: NANBANG }, { type: 'eliminate', pid: a }]) {
		const r = reduce(s, host, msg, { valid: true }, T0, rng);
		assert.deepEqual([r.changed, r.events[0].code], [false, 'phase'], msg.type);
	}
	assert.equal(s.game.board.rows.length, 0);

	const comp = lobby();
	const [h, c] = joinAll(comp, ['가']);
	reduce(comp, c, { type: 'ready', on: true }, {}, T0, rng);
	reduce(comp, h, { type: 'start' }, { start: { n: 6, answer: ANSWER } }, T0, rng);
	for (const msg of [{ type: 'draft', jamo: 'ㄴ' }, { type: 'propose', jamo: NANBANG }, { type: 'close' }, { type: 'vote', candidate: 0 }]) {
		const r = reduce(comp, h, msg, { valid: true }, T0, rng);
		assert.deepEqual([r.changed, r.events[0].code], [false, 'phase'], msg.type);
	}
	assert.equal(comp.game.players[h].board.rows.length, 0);
});

test('reduce: 초안만 바뀐 결과는 skipSave, 같은 초안은 changed=false, 제안·투표는 저장한다', () => {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a] = pids;
	const draft = (pid, jamo) => reduce(s, pid, { type: 'draft', jamo }, {}, T0 + 1, rng);
	const r1 = draft(host, 'ㅁㅏ');
	assert.deepEqual([r1.changed, r1.skipSave], [true, true]);
	assert.deepEqual(step(s).drafts, { [host]: 'ㅁㅏ' }, '메모리 상태에는 남는다');
	const r2 = draft(host, 'ㅁㅏ');
	assert.deepEqual([r2.changed, r2.skipSave], [false, false]);
	const bad = draft(host, 'ㅁㅏㅁㅁㅏㅁㅁ');
	assert.deepEqual([bad.changed, bad.skipSave, bad.events[0].code], [false, false, 'invalid']);

	const p1 = reduce(s, host, { type: 'propose', jamo: X }, { valid: true }, T0 + 2, rng);
	assert.deepEqual([p1.changed, p1.skipSave], [true, false]);
	reduce(s, a, { type: 'propose', jamo: Y }, { valid: true }, T0 + 3, rng);
	reduce(s, pids[2], { type: 'propose', jamo: Z }, { valid: true }, T0 + 3, rng);
	const v = reduce(s, host, { type: 'vote', candidate: 1 }, {}, T0 + 4, rng);
	assert.deepEqual([v.changed, v.skipSave], [true, false]);
	const closed = reduce(s, host, { type: 'close' }, {}, T0 + 5, first);
	assert.deepEqual([closed.changed, closed.skipSave], [true, false]);
	assert.equal(s.game.board.rows.length, 1);
});

test('reduce: 조회 실패(valid 없음)나 사전 밖 제안은 상태를 바꾸지 않고 error 이벤트만 낸다', () => {
	const { s, pids } = coopStarted(['가']);
	const none = reduce(s, pids[0], { type: 'propose', jamo: X }, {}, T0, rng);
	assert.deepEqual([none.changed, none.events[0].code], [false, 'unavailable']);
	const no = reduce(s, pids[0], { type: 'propose', jamo: X }, { valid: false }, T0, rng);
	assert.deepEqual([no.changed, no.events[0].msg], [false, '사전에 없는 단어입니다']);
	assert.deepEqual(step(s).proposals, {});
});

test('끝난 판의 후속: 대기실로 돌아가면 협동 게임 데이터가 사라진다', () => {
	const { s, pids } = coopStarted(['가']);
	coop.giveUp(s, pids[0], T0 + 1);
	assert.equal(reduce(s, pids[0], { type: 'again' }, {}, T0 + 2, rng).changed, true);
	assert.deepEqual([s.phase, s.game], ['lobby', null]);
});
