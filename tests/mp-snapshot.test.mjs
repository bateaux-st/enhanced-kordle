import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGuess, eliminate, giveUp, useHint } from '../src/lib/server/mp/comp.ts';
import * as coop from '../src/lib/server/mp/coop.ts';
import { backToLobby, disconnect } from '../src/lib/server/mp/members.ts';
import { reduce } from '../src/lib/server/mp/reduce.ts';
import { personalize } from '../src/lib/server/mp/snapshot.ts';
import { ANSWER, compClimbStarted, coopStarted, grantHint, joinAll, lobby, rng, stageAnswer, started, T0 } from './mp-helpers.mjs';
import { VOTE_MS } from '../src/lib/mp/rules.ts';

const HOST_ROW = 'ㅁㅏㅁㅁㅏㅁ';
const A_ROW = 'ㄴㅏㄴㅂㅏㅇ';
const B_ROW = 'ㅋㅌㅍㅊㅋㅌ';
const NOW = T0 + 5000;
const snapOf = (s, pid) => personalize(s, pid, NOW);

/** 방장·가·나 세 명이 각자 한 행씩 낸 진행 중 경쟁 단판. 가는 힌트도 썼다. */
function midGame() {
	const { s, pids } = started(['가', '나']);
	const [host, a, b] = pids;
	applyGuess(s, host, HOST_ROW, true, T0 + 1);
	applyGuess(s, a, A_ROW, true, T0 + 2);
	applyGuess(s, b, B_ROW, true, T0 + 3);
	useHint(s, a);
	return { s, host, a, b, rows: { [host]: HOST_ROW, [a]: A_ROW, [b]: B_ROW } };
}

/** 객체 안의 모든 키 경로 */
function paths(value, prefix = '$', out = []) {
	if (Array.isArray(value)) value.forEach((v, i) => paths(v, `${prefix}[]`, out));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			out.push(`${prefix}.${k}`);
			paths(v, `${prefix}.${k}`, out);
		}
	}
	return out;
}

const windows3 = (str) => [...str].map((_, i) => [...str].slice(i, i + 3).join('')).filter((w) => w.length === 3);

test('누출 검사(진행 중): 남의 추측 자모열·정답·uid·토큰이 부분 문자열로도 없다', () => {
	const { s, rows } = midGame();
	for (const viewer of s.players) {
		const json = JSON.stringify(snapOf(s, viewer.pid));
		for (const [pid, row] of Object.entries(rows)) {
			if (pid === viewer.pid) continue;
			assert.ok(!json.includes(row), `${viewer.name}에게 ${pid}의 행이 보임`);
			for (const w of windows3(row)) assert.ok(!json.includes(w), `${viewer.name}에게 ${pid}의 행 조각 ${w}가 보임`);
		}
		assert.ok(!json.includes(ANSWER.jamo), '정답 자모열');
		assert.ok(!json.includes(ANSWER.word), '정답 단어');
		for (const p of s.players) assert.ok(!json.includes(p.uid), `uid ${p.uid}`);
		assert.ok(!json.includes('uid-'));
		assert.ok(!json.includes('mp1.'));
	}
});

test('남의 패널은 {stage, n, marks, status, cleared}뿐이고 rows·hints는 필드째 없다', () => {
	const { s, host, a, b } = midGame();
	const view = snapOf(s, b);
	for (const p of view.players) {
		assert.deepEqual(Object.keys(p.panel).sort(), ['cleared', 'marks', 'n', 'stage', 'status']);
		assert.deepEqual(Object.keys(p).sort(), ['connected', 'inGame', 'isHost', 'name', 'panel', 'pid', 'ready']);
	}
	assert.deepEqual(view.players.find((p) => p.pid === a).panel.marks, [['p', 'c', 'c', 'p', 'p', 'a']], '색은 보인다');
	assert.equal(view.players.find((p) => p.pid === host).panel.status, 'playing');
	const bad = paths(view).filter((p) => /\.(rows|hints|hintUsed|uid|token)$/.test(p));
	assert.deepEqual(bad, ['$.settings.hints', '$.game.me.rows', '$.game.me.hints', '$.game.me.hintUsed'], 'rows·hints는 내 보드에만(settings.hints는 방 설정)');
});

test('내 보드는 전체(행·색·힌트)가 보이고, 남의 힌트 사용 여부는 모른다', () => {
	const { s, a, b } = midGame();
	const mine = snapOf(s, a).game.me;
	assert.deepEqual([mine.rows, mine.hints, mine.hintUsed], [[A_ROW], { 4: 'ㄴ' }, true]);
	assert.equal(snapOf(s, b).game.me.hintUsed, false);
	assert.ok(!JSON.stringify(snapOf(s, b)).includes('"0":"ㅂ"'));
});

test('진행 중에는 정답이 아무에게도 가지 않는다(먼저 끝난 사람에게도)', () => {
	const { s, a, b } = midGame();
	applyGuess(s, a, ANSWER.jamo, true, T0 + 10);
	assert.equal(s.game.players[a].status, 'solved');
	for (const pid of [a, b]) {
		const g = snapOf(s, pid).game;
		assert.equal(g.answers, undefined);
		assert.ok(!('answers' in g));
	}
	// 정답을 맞춘 본인의 행에는 정답이 들어 있다. 그건 본인이 친 것이다.
	assert.ok(JSON.stringify(snapOf(s, a)).includes(ANSWER.jamo));
	assert.ok(!JSON.stringify(snapOf(s, b)).includes(ANSWER.jamo));
});

test('순위표는 내가 끝났을 때만 보인다', () => {
	const { s, host, a, b } = midGame();
	assert.equal(snapOf(s, a).game.standings, null);
	giveUp(s, a, T0 + 20);
	const done = snapOf(s, a).game.standings;
	assert.deepEqual(done.map((x) => x.pid).sort(), [host, a, b].sort(), '먼저 끝난 사람은 현재 순위를 본다');
	assert.equal(snapOf(s, b).game.standings, null);
	assert.equal(snapOf(s, host).game.standings, null);
});

test('result: 정답과 순위표가 모두에게 나가고, 그래도 남의 행·uid는 나가지 않는다', () => {
	const { s, host, a, b, rows } = midGame();
	for (const pid of [host, a, b]) giveUp(s, pid, T0 + 30);
	assert.equal(s.phase, 'result');
	for (const viewer of s.players) {
		const view = snapOf(s, viewer.pid);
		assert.deepEqual(view.game.answers, { 6: ANSWER });
		assert.equal(view.game.standings.length, 3);
		assert.equal(view.phase, 'result');
		const json = JSON.stringify(view);
		for (const [pid, row] of Object.entries(rows)) if (pid !== viewer.pid) assert.ok(!json.includes(row));
		assert.ok(!json.includes('uid-'));
	}
});

test('스냅샷의 최상위·게임 필드가 늘 때는 이 목록을 의도적으로 고쳐야 한다', () => {
	const { s, host } = midGame();
	const view = snapOf(s, host);
	assert.deepEqual(Object.keys(view).sort(), ['code', 'game', 'host', 'hostPid', 'now', 'phase', 'players', 'seq', 'settings', 'v', 'you']);
	assert.deepEqual(Object.keys(view.game).sort(), ['endedAt', 'graceEnd', 'kind', 'me', 'standings', 'startN', 'startedAt']);
	assert.deepEqual(Object.keys(view.game.me).sort(), ['cleared', 'deadline', 'finishedAt', 'hintUsed', 'hints', 'lastClear', 'marks', 'n', 'rows', 'stage', 'status', 'triesUsed']);
});

test('방장에게만 시작 가능 여부와 대기 인원이 간다', () => {
	const s = lobby();
	const [host, a, b] = joinAll(s, ['가', '나']);
	s.players.find((p) => p.pid === a).ready = true;
	disconnect(s, b, T0);
	assert.deepEqual(snapOf(s, host).host, { canStart: true, waiting: 0, reason: null, disconnected: [b] });
	assert.equal(snapOf(s, a).host, null);
	assert.equal(snapOf(s, host).game, null);
	assert.deepEqual([snapOf(s, host).you, snapOf(s, a).you], [host, a]);
	assert.equal(snapOf(s, a).hostPid, host);
});

test('이번 게임 참가자가 아닌 사람(결과 중 입장)은 me가 null이고 순위표는 본다', () => {
	const { s, host, a, b } = midGame();
	for (const pid of [host, a, b]) giveUp(s, pid, T0 + 30);
	const newcomer = joinAll(s, ['다']).at(-1);
	const view = snapOf(s, newcomer);
	assert.equal(view.game.me, null);
	assert.equal(view.players.find((p) => p.pid === newcomer).panel, null);
	assert.equal(view.game.standings.length, 3);
});

test('seq와 서버 시각이 실려 나간다', () => {
	const { s, host } = midGame();
	s.seq = 41;
	const view = snapOf(s, host);
	assert.deepEqual([view.v, view.seq, view.now, view.code], [1, 41, NOW, 'ABC234']);
});

test('다음 게임으로 대기실에 돌아오면 스냅샷에서 이전 판(정답·순위표·패널)이 사라진다', () => {
	const { s, pids } = started(['가']);
	for (const pid of [...pids].reverse()) giveUp(s, pid, T0 + 1);
	assert.equal(s.phase, 'result');
	assert.ok(snapOf(s, pids[1]).game.answers);
	backToLobby(s, pids[0]);
	for (const pid of pids) {
		const v = snapOf(s, pid);
		assert.deepEqual([v.phase, v.game], ['lobby', null]);
		assert.ok(v.players.every((p) => p.panel === null && !p.inGame && !p.ready));
		assert.ok(!JSON.stringify(v).includes(ANSWER.jamo));
	}
});

// ---- 협동 ----

const NANBANG = 'ㄴㅏㄴㅂㅏㅇ';
const X = 'ㅁㅏㅁㅁㅏㅁ';
const Y = 'ㅋㅌㅍㅊㅋㅌ';
const Z = 'ㅅㅗㅅㅈㅜㅈ';
const first = () => 0;
const propose = (s, pid, jamo, now = T0 + 1) => coop.propose(s, pid, jamo, true, first, now);

/** 한 행(난방)이 공유 보드에 들어가 있고 힌트를 쓴 뒤, 방장·가·나가 X·Y·Z를 제안했고 방장·가가 투표한 협동 투표 단계. */
function coopVoting() {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	for (const pid of pids) propose(s, pid, NANBANG);
	grantHint(s, b);
	propose(s, host, X, T0 + 2);
	propose(s, a, Y, T0 + 2);
	propose(s, b, Z, T0 + 2);
	coop.vote(s, host, 1, first, T0 + 3);
	coop.vote(s, a, 2, first, T0 + 3);
	return { s, host, a, b };
}

/** 한 행이 들어가 있고, 방장이 제안했고, 가가 입력 중인 제안 단계. */
function coopProposing() {
	const { s, pids } = coopStarted(['가', '나']);
	const [host, a, b] = pids;
	for (const pid of pids) propose(s, pid, NANBANG);
	propose(s, host, X, T0 + 2);
	coop.draft(s, a, 'ㅋㅌㅍ');
	return { s, host, a, b };
}

function assertNoSecrets(s, view) {
	const json = JSON.stringify(view);
	assert.ok(!json.includes(ANSWER.jamo), '정답 자모열');
	assert.ok(!json.includes(ANSWER.word), '정답 단어');
	for (const p of s.players) assert.ok(!json.includes(p.uid), `uid ${p.uid}`);
	assert.ok(!json.includes('uid-'));
	assert.ok(!json.includes('mp1.'));
}

test('협동 누출 검사(제안 단계): 정답·uid·토큰은 없고, 모두의 확정 제안과 초안은 보인다', () => {
	const { s, host, a } = coopProposing();
	for (const viewer of s.players) {
		const view = snapOf(s, viewer.pid);
		assertNoSecrets(s, view);
		assert.equal(view.game.kind, 'coop');
		assert.deepEqual(view.game.step, { kind: 'propose', proposals: { [host]: X }, drafts: { [host]: X, [a]: 'ㅋㅌㅍ' }, passes: [] }, '남의 초안도 보인다');
		assert.deepEqual(view.game.board.rows, [NANBANG]);
		assert.deepEqual(view.game.board.marks, [['p', 'c', 'c', 'p', 'p', 'a']]);
		assert.equal(view.game.answers, undefined);
		assert.ok(!('answers' in view.game));
		assert.deepEqual(view.players.map((p) => p.panel), [null, null, null], '협동은 경쟁용 패널을 쓰지 않는다');
	}
});

test('협동 누출 검사(투표 단계): 후보·득표수·투표자는 보이고, 누가 어느 후보를 찍었는지는 본인 것만 간다', () => {
	const { s, host, a, b } = coopVoting();
	const views = Object.fromEntries(s.players.map((p) => [p.pid, snapOf(s, p.pid)]));
	for (const [pid, view] of Object.entries(views)) {
		assertNoSecrets(s, view);
		const st = view.game.step;
		assert.equal(st.kind, 'vote');
		assert.deepEqual(st.candidates, [{ jamo: X, by: [host] }, { jamo: Y, by: [a] }, { jamo: Z, by: [b] }]);
		assert.deepEqual(st.tally, [0, 1, 1]);
		assert.deepEqual([...st.voted].sort(), [host, a].sort());
		assert.equal(st.myVote, { [host]: 1, [a]: 2, [b]: null }[pid], `${pid}의 내 표`);
		assert.deepEqual(Object.keys(st).sort(), ['candidates', 'deadline', 'kind', 'myVote', 'tally', 'voted']);
			assert.equal(st.deadline, T0 + 2 + VOTE_MS, '투표 단계에 들어간 시각 + VOTE_MS');
		const bad = paths(view).filter((p) => /\.votes/.test(p));
		assert.deepEqual(bad, [], 'pid -> 후보 맵이 없다');
	}
	assert.equal(views[b].game.board.hintBy, b);
	assert.deepEqual(views[host].game.board.hints, { 4: 'ㄴ' });
});

test('협동: 표를 바꾸면 득표수만 움직이고 투표자 목록과 남의 내 표(myVote)는 그대로다', () => {
	const { s, host, a, b } = coopVoting();
	const before = snapOf(s, b).game.step;
	coop.vote(s, host, 2, first, T0 + 4);
	const after = snapOf(s, b).game.step;
	assert.deepEqual(after.tally, [0, 0, 2]);
	assert.deepEqual([...after.voted].sort(), [...before.voted].sort(), '바꿔도 투표자 목록은 같다');
	assert.equal(after.myVote, null);
	assert.equal(snapOf(s, a).game.step.myVote, 2);
});

test('협동 결과: 정답이 모두에게 나가고 단계는 null, 마지막 선택(lastPick)은 남는다', () => {
	const { s, pids } = coopStarted(['가']);
	for (const pid of pids) propose(s, pid, ANSWER.jamo, T0 + 5);
	assert.equal(s.phase, 'result');
	for (const viewer of s.players) {
		const view = snapOf(s, viewer.pid);
		assert.deepEqual(view.game.answers, { 6: ANSWER });
		assert.equal(view.game.step, null);
		assert.deepEqual([view.game.status, view.game.endReason, view.game.endedAt], ['won', 'solved', T0 + 5]);
		assert.deepEqual(view.game.lastPick, { candidates: [ANSWER.jamo], by: [pids], chosen: 0, how: 'single', at: T0 + 5 });
		const json = JSON.stringify(view);
		assert.ok(!json.includes('uid-'));
		assert.ok(!json.includes('mp1.'));
	}
});

test('협동 포기·시도 소진 결과도 정답을 공개한다', () => {
	const { s, pids } = coopStarted(['가']);
	coop.giveUp(s, pids[0], T0 + 3);
	const view = snapOf(s, pids[1]);
	assert.deepEqual([view.game.status, view.game.endReason, view.game.answers], ['lost', 'giveup', { 6: ANSWER }]);
});

test('협동 스냅샷의 게임·보드·단계 필드가 늘 때는 이 목록을 의도적으로 고쳐야 한다', () => {
	const { s, host } = coopVoting();
	const view = snapOf(s, host);
	assert.deepEqual(Object.keys(view).sort(), ['code', 'game', 'host', 'hostPid', 'now', 'phase', 'players', 'seq', 'settings', 'v', 'you']);
	assert.deepEqual(Object.keys(view.game).sort(), ['board', 'cleared', 'endedAt', 'hintVote', 'hintVoteEnd', 'kind', 'lastClear', 'lastPick', 'passResetAt', 'startN', 'startedAt', 'status', 'step']);
	assert.deepEqual(Object.keys(view.game.board).sort(), ['deadline', 'hintBy', 'hintUsed', 'hints', 'marks', 'n', 'rows', 'stage']);
	const p = coopProposing();
	assert.deepEqual(Object.keys(snapOf(p.s, p.host).game.step).sort(), ['drafts', 'kind', 'passes', 'proposals']);
});

test('협동 스냅샷은 상태를 복사한다: 받은 뒤 서버 상태가 바뀌어도 이미 만든 스냅샷은 그대로', () => {
	const { s, host, a } = coopProposing();
	const view = snapOf(s, host);
	coop.draft(s, a, 'ㅋ');
	propose(s, a, Y, T0 + 9);
	assert.deepEqual(view.game.step.drafts[a], 'ㅋㅌㅍ');
	assert.equal(view.game.step.proposals[a], undefined);
});

test('등반 스냅샷: 스테이지 전환 뒤 내 보드는 새 스테이지, lastClear에 방금 클리어한 보드, 남의 패널은 색과 스테이지만', () => {
	const { s, pids } = compClimbStarted(['가']);
	const [host, a] = pids;
	applyGuess(s, host, stageAnswer(10).jamo, true, T0 + 1);
	const view = snapOf(s, host);
	assert.deepEqual([view.game.me.stage, view.game.me.n, view.game.me.rows, view.game.me.cleared], [2, 11, [], 1]);
	assert.deepEqual([view.game.me.lastClear.n, view.game.me.lastClear.rows, view.game.me.lastClear.at], [10, [stageAnswer(10).jamo], T0 + 1]);
	const other = snapOf(s, a).players.find((p) => p.pid === host).panel;
	assert.deepEqual(Object.keys(other).sort(), ['cleared', 'marks', 'n', 'stage', 'status']);
	assert.deepEqual([other.stage, other.n, other.cleared, other.marks.length], [2, 11, 1, 0]);
	assert.equal(JSON.stringify(snapOf(s, a)).includes(stageAnswer(10).jamo), false, '남의 클리어 풀이는 가지 않는다');
});

test('등반 결과 스냅샷: answers는 도달한 스테이지까지만', () => {
	const { s, pids } = compClimbStarted(['가']);
	applyGuess(s, pids[0], stageAnswer(10).jamo, true, T0 + 1);
	giveUp(s, pids[0], T0 + 2);
	giveUp(s, pids[1], T0 + 3);
	assert.deepEqual(Object.keys(snapOf(s, pids[1]).game.answers).map(Number), [10, 11]);
});

test('스스로 나간 사람만 left: true로 보이고, 끊김·방장의 탈락 처리는 보이지 않는다', () => {
	const { s, pids } = started(['가', '나', '다']);
	const [host, a, b, c] = pids;
	reduce(s, a, { type: 'leave' }, {}, T0 + 5, rng);
	disconnect(s, b, T0 + 6);
	disconnect(s, c, T0 + 7);
	eliminate(s, host, c, T0 + 8);
	const view = snapOf(s, host);
	const by = (pid) => view.players.find((p) => p.pid === pid);
	assert.equal(by(a).left, true);
	assert.equal(by(a).panel.status, 'eliminated');
	for (const pid of [host, b, c]) assert.ok(!('left' in by(pid)), `${pid}에 left가 없어야 한다`);
	assert.equal(by(c).panel.status, 'eliminated');
});

test('협동: deadline이 없는 저장본의 투표 단계는 스냅샷에서 null(마감 없음)이다', () => {
	const { s, host } = coopVoting();
	delete s.game.step.deadline;
	assert.equal(snapOf(s, host).game.step.deadline, null);
});
