import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/lib/mp/rules.ts';
import { judge } from '../src/lib/server/judge.ts';
import { cmpMetrics, metrics, standings } from '../src/lib/server/mp/rank.ts';

const ANS = 'ㅂㅏㄴㅏㄴㅏ';

/** 정답 바나나로 실제 판정한 보드. */
function board(rows, cleared = 0) {
	return { stage: 1, n: 6, rows, marks: rows.map((r) => judge(ANS, r)), hints: {}, hintUsed: false, deadline: null, cleared };
}
const filler = (k) => Array.from({ length: k }, () => 'ㅋㅋㅋㅋㅋㅋ'); // 전부 회색
const entry = (status, rows, { finishedAt = null, cleared = 0 } = {}) => ({ board: board(rows, cleared), status, finishedAt, triesUsed: rows.length });
const game = (mode, players, finishOrder = []) => ({ kind: 'comp', settings: { ...DEFAULT_SETTINGS, game: mode }, startN: 6, answers: {}, startedAt: 0, endedAt: null, players, finishOrder, graceEnd: null, standings: null });
const ranks = (g) => standings(g, (p) => p).map((x) => `${x.pid}${x.rank}`);

test('지표: 초록은 행을 합친 자리 수(같은 자리 두 번 초록은 1), 노랑은 자모 종류 수', () => {
	// 난방: ㅏ(1)·ㄴ(2) 초록, ㄴ(0)·ㅂ(3)·ㅏ(4) 노랑. 다시 난방: 같은 자리가 또 초록.
	const m = metrics(board(['ㄴㅏㄴㅂㅏㅇ', 'ㄴㅏㄴㅂㅏㅇ']));
	assert.deepEqual(m, { height: 0, greens: 2, yellows: 3, tries: 2 });
	// ㅏ가 두 행에서 노랑이어도 종류로는 1.
	assert.equal(metrics(board(['ㅏㅋㅋㅋㅋㅋ', 'ㅋㅋㅏㅋㅋㅋ'])).yellows, 1);
	assert.deepEqual(metrics(board([], 3)), { height: 3, greens: 0, yellows: 0, tries: 0 });
});

test('cmpMetrics: 초록 -> 노랑 -> 시도 수, 모두 같으면 0, 높이는 useHeight일 때만', () => {
	const m = (height, greens, yellows, tries) => ({ height, greens, yellows, tries });
	assert.ok(cmpMetrics(m(0, 3, 0, 5), m(0, 2, 9, 1), false) < 0);
	assert.ok(cmpMetrics(m(0, 2, 3, 5), m(0, 2, 2, 1), false) < 0);
	assert.ok(cmpMetrics(m(0, 2, 2, 3), m(0, 2, 2, 4), false) < 0);
	assert.equal(cmpMetrics(m(0, 2, 2, 3), m(0, 2, 2, 3), false), 0);
	assert.equal(cmpMetrics(m(5, 2, 2, 3), m(1, 2, 2, 3), false), 0, '단판은 높이를 보지 않는다');
	assert.ok(cmpMetrics(m(5, 0, 0, 9), m(1, 6, 6, 1), true) < 0, '등반은 높이가 먼저');
});

test('단판: 3번째 정답 / 4번째 정답 / 실패 -> 1, 2, 3위', () => {
	const g = game('single', {
		C: entry('failed', filler(6), { finishedAt: 50 }),
		B: entry('solved', [...filler(3), ANS], { finishedAt: 40 }),
		A: entry('solved', [...filler(2), ANS], { finishedAt: 60 })
	});
	assert.deepEqual(ranks(g), ['A1', 'B2', 'C3']);
});

test('단판: 같은 시도 수 정답은 먼저 끝낸 쪽이 위, 시각까지 같으면 공동', () => {
	const g = game('single', {
		late: entry('solved', [...filler(2), ANS], { finishedAt: 90 }),
		early: entry('solved', [...filler(2), ANS], { finishedAt: 30 }),
		same: entry('solved', [...filler(2), ANS], { finishedAt: 30 })
	});
	const s = standings(g, (p) => p);
	assert.deepEqual(s.map((x) => [x.pid, x.rank, x.tied]), [['early', 1, true], ['same', 1, true], ['late', 3, false]]);
});

test('단판: 정답자는 지표가 아무리 좋은 미정답자보다 위', () => {
	const g = game('single', {
		close: entry('gaveup', ['ㅂㅏㄴㅏㄴㅇ', 'ㅂㅏㄴㅏㅇㅏ'], { finishedAt: 5 }),
		solver: entry('solved', [...filler(5), ANS], { finishedAt: 99 })
	});
	assert.deepEqual(ranks(g), ['solver1', 'close2']);
});

test('단판: 미정답자는 초록 자리 -> 노랑 종류 -> 시도 수 순, 모두 같으면 공동 (1,2,2,4)', () => {
	const g = game('single', {
		five: entry('failed', ['ㅋㅋㅋㅋㅋㅋ'], { finishedAt: 1 }), // 초록 0
		greenOnly: entry('gaveup', ['ㅂㅋㅋㅋㅋㅋ', 'ㅋㅋㅋㅋㅋㅋ'], { finishedAt: 2 }), // 초록 1, 노랑 0
		best: entry('failed', ['ㅂㅏㄴㅏㅋㅋ'], { finishedAt: 3 }), // 초록 4
		greenYellow: entry('timeout', ['ㅋㅋㅋㅋㅏㅋ', 'ㅂㅋㅋㅋㅋㅋ'], { finishedAt: 4 }) // 두 행을 합쳐 초록 1(ㅂ), 노랑 1(ㅏ)
	});
	// 초록 4 > 초록 1+노랑 1 > 초록 1 > 초록 0
	assert.deepEqual(ranks(g), ['best1', 'greenYellow2', 'greenOnly3', 'five4']);

	const tries = game('single', {
		many: entry('failed', ['ㅋㅋㅋㅋㅋㅋ', 'ㅋㅋㅋㅋㅋㅋ']),
		few: entry('failed', ['ㅋㅋㅋㅋㅋㅋ'])
	});
	assert.deepEqual(ranks(tries), ['few1', 'many2']);

	const same = game('single', {
		x: entry('failed', ['ㅂㅋㅋㅋㅋㅋ'], { finishedAt: 1 }),
		y: entry('failed', ['ㅂㅋㅋㅋㅋㅋ'], { finishedAt: 9 }),
		z: entry('failed', ['ㅋㅋㅋㅋㅋㅋ'], { finishedAt: 5 }),
		w: entry('solved', [ANS], { finishedAt: 7 })
	});
	assert.deepEqual(ranks(same), ['w1', 'x2', 'y2', 'z4']);
});

test('단판: 높이(cleared)는 순위에 영향이 없다', () => {
	const g = game('single', {
		tall: entry('failed', ['ㅋㅋㅋㅋㅋㅋ'], { cleared: 5 }),
		green: entry('failed', ['ㅂㅋㅋㅋㅋㅋ'], { cleared: 0 })
	});
	assert.deepEqual(ranks(g), ['green1', 'tall2']);
});

test('등반: 완주자는 완주 순서(finishOrder), 미완주자는 높이가 초록 자리 수보다 우선', () => {
	const g = game('climb', {
		low: entry('failed', ['ㅂㅏㄴㅏㄴㅋ'], { cleared: 2 }),
		high: entry('failed', ['ㅋㅋㅋㅋㅋㅋ'], { cleared: 4 }),
		second: entry('solved', [ANS], { finishedAt: 200, cleared: 6 }),
		first: entry('solved', [ANS], { finishedAt: 100, cleared: 6 })
	}, ['first', 'second']);
	assert.deepEqual(ranks(g), ['first1', 'second2', 'high3', 'low4']);
});

test('등반: 같은 밀리초에 완주해도 finishOrder 순서대로 순위가 갈린다', () => {
	const g = game('climb', {
		q: entry('solved', [ANS], { finishedAt: 10, cleared: 6 }),
		p: entry('solved', [ANS], { finishedAt: 10, cleared: 6 })
	}, ['p', 'q']);
	assert.deepEqual(standings(g, (x) => x).map((x) => [x.pid, x.rank, x.tied, x.finishOrder]), [['p', 1, false, 1], ['q', 2, false, 2]]);
});

test('등반: 높이가 같으면 초록 -> 노랑 -> 시도 수', () => {
	const g = game('climb', {
		c: entry('failed', ['ㅋㅋㅋㅋㅋㅋ', 'ㅋㅋㅋㅋㅋㅋ'], { cleared: 2 }),
		a: entry('failed', ['ㅂㅏㅋㅋㅋㅋ'], { cleared: 2 }),
		b: entry('failed', ['ㅂㅋㅋㅋㅋㅋ'], { cleared: 2 })
	});
	assert.deepEqual(ranks(g), ['a1', 'b2', 'c3']);
});

test('순위표는 이름·상태·시도·정답 순서를 들고 있다', () => {
	const g = game('single', { p1: entry('solved', [ANS], { finishedAt: 1 }) });
	assert.deepEqual(standings(g, () => '철수'), [{ pid: 'p1', name: '철수', rank: 1, tied: false, status: 'solved', tries: 1, finishOrder: 1 }]);
});

test('finishOrder는 정답자끼리 순위표 순서(공동 순위가 있어도 1, 2, 3), 정답이 아니면 null', () => {
	const g = game('single', {
		fail: entry('failed', filler(3)),
		b: entry('solved', ['ㄴㅏㄴㅂㅏㅇ', ANS], { finishedAt: 5 }),
		a: entry('solved', [ANS], { finishedAt: 9 }),
		quit: entry('gaveup', filler(1)),
		c: entry('solved', ['ㄴㅏㄴㅂㅏㅇ', ANS], { finishedAt: 7 })
	});
	const s = standings(g, (p) => p);
	assert.deepEqual(s.map((x) => [x.pid, x.finishOrder, x.status, x.tries]), [
		['a', 1, 'solved', 1],
		['b', 2, 'solved', 2],
		['c', 3, 'solved', 2],
		['quit', null, 'gaveup', 1],
		['fail', null, 'failed', 3]
	]);
});

test('등반: 시도 수는 현재 스테이지 보드의 행 수(누적이 아니다)', () => {
	// 둘 다 높이 3. 지표는 초록·노랑이 같고 현재 스테이지 시도 수만 다르다.
	const g = game('climb', {
		two: entry('timeout', filler(2), { cleared: 3 }),
		one: entry('timeout', filler(1), { cleared: 3 })
	});
	assert.deepEqual(ranks(g), ['one1', 'two2']);
	assert.equal(metrics(board(filler(2), 3)).tries, 2);
	assert.deepEqual(standings(g, (p) => p).map((x) => [x.pid, x.status, x.tries]), [['one', 'timeout', 1], ['two', 'timeout', 2]]);
});
