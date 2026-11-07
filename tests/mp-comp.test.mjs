import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/lib/mp/rules.ts';
import { applyGuess, chooseStartN, eliminate, giveUp, isOver, useHint } from '../src/lib/server/mp/comp.ts';
import { disconnect, join } from '../src/lib/server/mp/members.ts';
import { personalize } from '../src/lib/server/mp/snapshot.ts';
import { reduce } from '../src/lib/server/mp/reduce.ts';
import { ANSWER, rng, seeded, started, T0 } from './mp-helpers.mjs';

// 정답 바나나(ㅂㅏㄴㅏㄴㅏ)에 난방(ㄴㅏㄴㅂㅏㅇ)은 p c c p p a — HelpModal·hard.test.mjs의 실제 판정 예.
const NANBANG = 'ㄴㅏㄴㅂㅏㅇ';
const NANBANG_MARKS = ['p', 'c', 'c', 'p', 'p', 'a'];
const guess = (s, pid, jamo, now = T0 + 1) => applyGuess(s, pid, jamo, true, now);

test('시작: 현재 방 전원이 같은 정답·같은 길이의 빈 개인 보드로 시작한다', () => {
	const { s, pids } = started(['가', '나']);
	assert.equal(s.phase, 'playing');
	assert.deepEqual(Object.keys(s.game.players), pids);
	assert.ok(s.players.every((p) => p.inGame));
	for (const pid of pids) {
		const { board, status } = s.game.players[pid];
		assert.equal(status, 'playing');
		assert.deepEqual([board.n, board.rows.length, board.deadline, board.cleared], [6, 0, null, 0]);
	}
	assert.deepEqual(s.game.answers[6], ANSWER);
	assert.notEqual(s.game.settings, s.settings, '시작 시점 사본');
});

test('chooseStartN: 고정 길이는 그대로, random은 5..12 전부에서 나온다', () => {
	assert.equal(chooseStartN({ ...DEFAULT_SETTINGS, length: 9 }, () => 0), 9);
	const seen = new Set();
	const r = seeded(11);
	for (let i = 0; i < 300; i++) seen.add(chooseStartN({ ...DEFAULT_SETTINGS, length: 'random' }, r));
	assert.deepEqual([...seen].sort((a, b) => a - b), [5, 6, 7, 8, 9, 10, 11, 12]);
});

test('보드는 독립: 한 사람의 제출이 다른 사람 보드에 영향이 없고, 같은 단어는 같은 색', () => {
	const { s, pids } = started(['가', '나']);
	const [, a, b] = pids;
	const ra = guess(s, a, NANBANG);
	assert.deepEqual(ra, { ok: true, marks: NANBANG_MARKS });
	assert.equal(s.game.players[b].board.rows.length, 0);
	assert.deepEqual(guess(s, b, NANBANG).marks, NANBANG_MARKS);
	assert.equal(s.game.players[a].board.rows.length, 1);
});

test('거부되는 제출은 보드를 바꾸지 않는다: 사전 밖, 조회 실패, 자모 수·글자 오류', () => {
	const { s, pids } = started(['가']);
	const a = pids[1];
	assert.equal(applyGuess(s, a, NANBANG, false, T0).code, 'invalid');
	assert.equal(applyGuess(s, a, NANBANG, undefined, T0).code, 'unavailable');
	assert.equal(guess(s, a, 'ㄴㅏㄴㅂㅏ').code, 'invalid');
	assert.equal(guess(s, a, 'ㄴㅏㄴㅂㅏㅇㅇ').code, 'invalid');
	assert.equal(guess(s, a, 'ㄴㅏㄴㅂㅏA').code, 'invalid');
	assert.equal(guess(s, a, '난방난방').code, 'invalid');
	assert.equal(s.game.players[a].board.rows.length, 0);
});

test('하드모드: 초록 자리와 노랑 자모를 어기면 hard로 거부하고 개인 플레이와 같은 문구', () => {
	const { s, pids } = started(['가'], { hard: true });
	const a = pids[1];
	guess(s, a, NANBANG);
	const pos = guess(s, a, 'ㅂㅜㅁㅂㅏㅇ'); // 2번째 칸(초록 ㅏ)을 어김
	assert.deepEqual([pos.ok, pos.code, pos.msg], [false, 'hard', '2번째 칸은 ㅏ입니다']);
	const missing = guess(s, a, 'ㅁㅏㄴㅁㅜㄹ'); // 초록은 지켰지만 노랑 ㅂ이 없음
	assert.deepEqual([missing.code, missing.msg], ['hard', 'ㅂ을(를) 포함해야 합니다']);
	assert.equal(s.game.players[a].board.rows.length, 1);
	assert.equal(guess(s, a, 'ㅁㅏㄴㅂㅜㄹ').ok, true);
});

test('하드모드가 꺼진 방은 제약 위반도 받는다', () => {
	const { s, pids } = started(['가']);
	guess(s, pids[1], NANBANG);
	assert.equal(guess(s, pids[1], 'ㅋㅋㅋㅋㅋㅋ').ok, true);
});

test('정답: solved, 시도 수·완료 시각 기록, 이후 제출은 거부, 다른 사람은 계속 진행', () => {
	const { s, pids } = started(['가', '나']);
	const [, a, b] = pids;
	guess(s, a, NANBANG);
	assert.equal(guess(s, a, ANSWER.jamo, T0 + 500).ok, true);
	const me = s.game.players[a];
	assert.deepEqual([me.status, me.triesUsed, me.finishedAt, me.board.cleared], ['solved', 2, T0 + 500, 1]);
	assert.deepEqual(s.game.finishOrder, [a]);
	assert.equal(guess(s, a, NANBANG).code, 'phase');
	assert.equal(s.game.players[b].status, 'playing');
	assert.equal(s.phase, 'playing');
});

test('시도를 모두 쓰면 failed', () => {
	const { s, pids } = started(['가'], { tries: 4 });
	const a = pids[1];
	for (let i = 0; i < 3; i++) assert.equal(guess(s, a, NANBANG).ok, true);
	assert.equal(s.game.players[a].status, 'playing');
	guess(s, a, NANBANG, T0 + 9);
	assert.deepEqual([s.game.players[a].status, s.game.players[a].triesUsed, s.game.players[a].finishedAt], ['failed', 4, T0 + 9]);
});

test('힌트: 노랑을 받은 자모 중 처음 나온 것의 아직 초록 아닌 정답 첫 위치, 1인 1회, 남에게는 영향 없음', () => {
	const { s, pids } = started(['가', '나']);
	const [, a, b] = pids;
	guess(s, a, NANBANG); // 첫 노랑은 0번째 ㄴ. 정답의 ㄴ(2·4번째) 중 2번째는 이미 초록이라 4번째를 알려준다
	assert.deepEqual(useHint(s, a), { ok: true, pos: 4, jamo: 'ㄴ' });
	assert.deepEqual(s.game.players[a].board.hints, { 4: 'ㄴ' });
	assert.equal(s.game.players[a].board.hintUsed, true);
	assert.equal(useHint(s, a).code, 'forbidden');
	assert.equal(s.game.players[b].board.hintUsed, false);
	guess(s, b, NANBANG);
	assert.equal(useHint(s, b).ok, true, '남이 썼어도 나는 쓸 수 있다');
});

test('힌트: 노랑이 나중에 초록을 받은 자모는 후보가 아니고, 노랑이 없으면 쓸 수 없다', () => {
	const { s, pids } = started(['가']);
	const a = pids[1];
	assert.equal(useHint(s, a).code, 'forbidden', '추측 전');
	guess(s, a, 'ㄴㅋㅋㅋㅋㅋ'); // ㄴ 노랑
	guess(s, a, 'ㅋㅋㄴㅋㅋㅋ'); // ㄴ 초록
	const r = useHint(s, a);
	assert.equal(r.ok, false);
	assert.equal(s.game.players[a].board.hintUsed, false, '실패한 요청은 횟수를 쓰지 않는다');
});

test('힌트를 끈 방에서는 쓸 수 없다', () => {
	const { s, pids } = started(['가'], { hints: false });
	guess(s, pids[1], NANBANG);
	assert.equal(useHint(s, pids[1]).code, 'forbidden');
});

test('포기는 본인만 탈락하고 나머지는 계속 진행', () => {
	const { s, pids } = started(['가', '나']);
	const [host, a, b] = pids;
	assert.equal(giveUp(s, a, T0 + 7).ok, true);
	assert.deepEqual([s.game.players[a].status, s.game.players[a].finishedAt], ['gaveup', T0 + 7]);
	assert.deepEqual([host, b].map((p) => s.game.players[p].status), ['playing', 'playing']);
	assert.equal(s.phase, 'playing');
	assert.equal(giveUp(s, a, T0 + 8).code, 'phase');
	assert.equal(useHint(s, a).code, 'phase');
});

test('방장 강제 탈락: 끊긴 사람만, 방장만, 이미 끝난 사람은 불가', () => {
	const { s, pids } = started(['가', '나']);
	const [host, a, b] = pids;
	assert.equal(eliminate(s, host, a, T0).code, 'forbidden', '접속 중');
	disconnect(s, a, T0 + 1);
	assert.equal(eliminate(s, b, a, T0 + 2).code, 'forbidden', '방장이 아님');
	assert.equal(eliminate(s, host, 'p-nobody', T0 + 2).code, 'forbidden');
	assert.equal(eliminate(s, host, a, T0 + 3).ok, true);
	assert.deepEqual([s.game.players[a].status, s.game.players[a].finishedAt], ['eliminated', T0 + 3]);
	assert.equal(eliminate(s, host, a, T0 + 4).code, 'phase');
	assert.equal(s.phase, 'playing');
});

test('전원이 끝나면 순위가 고정되고 result로 넘어가며 준비가 해제된다', () => {
	const { s, pids } = started(['가', '나']);
	const [host, a, b] = pids;
	s.players.forEach((p) => (p.ready = true));
	guess(s, a, ANSWER.jamo, T0 + 100);
	guess(s, b, NANBANG, T0 + 150);
	giveUp(s, b, T0 + 200);
	assert.equal(isOver(s.game), false);
	assert.equal(s.game.standings, null);
	giveUp(s, host, T0 + 300);
	assert.equal(s.phase, 'result');
	assert.equal(s.game.endedAt, T0 + 300);
	assert.deepEqual(s.game.standings.map((x) => [x.pid, x.rank]), [[a, 1], [b, 2], [host, 3]]);
	assert.ok(s.players.every((p) => !p.ready));
	assert.equal(guess(s, b, NANBANG).code, 'phase');
});

test('게임 중 나가기: 본인 탈락 처리 후 자리는 끊김으로 남고, 마지막 진행자가 나가면 게임이 끝난다', () => {
	const { s, pids } = started(['가', '나']);
	const [host, a, b] = pids;
	guess(s, b, NANBANG);
	const out = reduce(s, a, { type: 'leave' }, {}, T0 + 10, rng);
	assert.deepEqual(out.events, [{ type: 'drop', pid: a }]);
	assert.equal(s.game.players[a].status, 'eliminated');
	const seat = s.players.find((p) => p.pid === a);
	assert.deepEqual([seat.connected, seat.name], [false, '가']);
	assert.equal(s.phase, 'playing');
	giveUp(s, b, T0 + 20);
	reduce(s, host, { type: 'leave' }, {}, T0 + 30, rng);
	assert.equal(s.phase, 'result');
	assert.deepEqual(s.game.standings.map((x) => [x.name, x.rank, x.tied]), [['나', 1, false], ['방장', 2, true], ['가', 2, true]]);
	assert.deepEqual(s.game.standings.map((x) => x.name), ['나', '방장', '가']);
});

test('결과 화면에서는 제출이 phase 오류', () => {
	const { s, pids } = started(['가']);
	giveUp(s, pids[0], T0);
	giveUp(s, pids[1], T0);
	assert.equal(s.phase, 'result');
	const r = reduce(s, pids[0], { type: 'guess', jamo: NANBANG }, { valid: true }, T0 + 5, rng);
	assert.equal(r.events[0].code, 'phase');
});

test('reduce 경유: guess/hint/giveup는 오류 이벤트로 돌아오고 changed는 상태가 바뀐 때만 true', () => {
	const { s, pids } = started(['가']);
	const a = pids[1];
	const bad = reduce(s, a, { type: 'guess', jamo: NANBANG }, { valid: false }, T0 + 1, rng);
	assert.deepEqual([bad.changed, bad.events[0].code], [false, 'invalid']);
	const ok = reduce(s, a, { type: 'guess', jamo: NANBANG }, { valid: true }, T0 + 2, rng);
	assert.deepEqual([ok.changed, ok.events], [true, []]);
	const hint = reduce(s, a, { type: 'hint' }, {}, T0 + 3, rng);
	assert.equal(hint.changed, true);
	assert.equal(reduce(s, a, { type: 'hint' }, {}, T0 + 4, rng).changed, false);
	assert.equal(reduce(s, a, { type: 'vote', candidate: 0 }, {}, T0 + 5, rng).events[0].code, 'phase', '경쟁 방에서 협동 메시지');
	assert.equal(reduce(s, 'p-nobody', { type: 'giveup' }, {}, T0 + 6, rng).events[0].code, 'forbidden');
});

/** 방장·가·나가 각자 다르게 끝난 결과 단계: 가 정답(1번째), 나 실패(6행 소진), 방장 포기. */
function finished() {
	const { s, pids } = started(['가', '나'], { tries: 4 });
	const [host, a, b] = pids;
	guess(s, a, ANSWER.jamo, T0 + 10);
	for (let i = 0; i < 4; i++) guess(s, b, NANBANG, T0 + 20 + i);
	giveUp(s, host, T0 + 50);
	assert.equal(s.phase, 'result');
	return { s, host, a, b };
}

test('결과 단계에서 1위부터 차례로 나가도 순위표(상태·시도·k번째 정답)는 그대로다', () => {
	const { s, host, a, b } = finished();
	const before = JSON.stringify(s.game.standings);
	assert.deepEqual(s.game.standings.map((x) => [x.pid, x.status, x.tries, x.finishOrder]), [
		[a, 'solved', 1, 1],
		[b, 'failed', 4, null],
		[host, 'gaveup', 0, null]
	]);
	for (const pid of [a, b]) {
		reduce(s, pid, { type: 'leave' }, {}, T0 + 100, rng);
		assert.equal(JSON.stringify(s.game.standings), before);
		const view = personalize(s, host, T0 + 100);
		assert.equal(JSON.stringify(view.game.standings), before, '스냅샷의 순위표도 같다');
		assert.ok(!view.players.some((p) => p.pid === pid), '나간 사람은 players에서 사라진다');
	}
});

test('게임 중 나간 사람의 자리는 게임이 끝나면 치우고, 순위표에는 이름과 탈락이 남는다', () => {
	const { s, pids } = started(['가']);
	const [host, a] = pids;
	reduce(s, a, { type: 'leave' }, {}, T0 + 5, rng);
	assert.ok(s.players.some((p) => p.pid === a), '진행 중에는 패널을 위해 자리가 남는다');
	giveUp(s, host, T0 + 9);
	assert.equal(s.phase, 'result');
	assert.deepEqual(s.players.map((p) => p.pid), [host]);
	assert.deepEqual(s.game.standings.map((x) => [x.name, x.status]), [['방장', 'gaveup'], ['가', 'eliminated']]);
});

test('결과 단계 재입장: 끊겼다 돌아오면 내 줄 그대로, 나갔다 오면 새 자리이고 표는 그대로', () => {
	const { s, host, a, b } = finished();
	const before = JSON.stringify(s.game.standings);

	disconnect(s, b, T0 + 100);
	const back = join(s, { uid: 'uid-나', name: '나' }, T0 + 200, rng);
	assert.deepEqual([back.pid, back.rejoined], [b, true]);
	const mine = personalize(s, b, T0 + 200);
	assert.equal(mine.players.find((p) => p.pid === b).panel.status, 'failed');
	assert.equal(mine.game.standings.find((x) => x.pid === b).tries, 4);

	reduce(s, a, { type: 'leave' }, {}, T0 + 300, rng);
	const again = join(s, { uid: 'uid-가', name: '가' }, T0 + 400, rng);
	assert.notEqual(again.pid, a);
	assert.equal(s.players.find((p) => p.pid === again.pid).inGame, false);
	assert.equal(JSON.stringify(s.game.standings), before);
	assert.equal(host, s.hostPid);
});
