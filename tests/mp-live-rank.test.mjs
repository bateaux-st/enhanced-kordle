import assert from 'node:assert/strict';
import test from 'node:test';
import { liveRows } from '../src/lib/mp/live-rank.ts';

const st = (pid, rank, status, extra = {}) => ({ pid, name: pid, rank, tied: false, status, tries: 0, finishOrder: null, ...extra });
const view = (rows) => liveRows(rows).map((r) => `${r.s.pid}:${r.shown ?? '-'}${r.tied ? 't' : ''}`);

test('풀이 중인 사람은 순위 숫자 없이 끝난 사람 아래로 간다', () => {
	// 서버는 풀이 중인 b를 한가운데(2위)로 줄 세웠다. 끝난 a, c는 1위, 2위로 다시 매겨진다.
	assert.deepEqual(view([st('a', 1, 'failed'), st('b', 2, 'playing'), st('c', 3, 'gaveup')]), ['a:1', 'c:2', 'b:-']);
});

test('끝난 사람끼리 공동 순위는 같은 숫자와 공동 표시, 다음 순위는 건너뛴다', () => {
	assert.deepEqual(view([st('a', 1, 'solved', { finishOrder: 1 }), st('b', 2, 'failed'), st('c', 2, 'failed'), st('d', 4, 'timeout')]), ['a:1', 'b:2t', 'c:2t', 'd:4']);
});

test('풀이 중인 사이에 끼어 순위가 벌어져도 끝난 사람은 빈틈 없이 매긴다', () => {
	assert.deepEqual(view([st('p', 1, 'playing'), st('a', 2, 'failed'), st('q', 3, 'playing'), st('b', 4, 'failed')]), ['a:1', 'b:2', 'p:-', 'q:-']);
});

test('전부 풀이 중이면 숫자가 하나도 없다, 전부 끝났으면 서버 순위 그대로', () => {
	assert.deepEqual(view([st('a', 1, 'playing'), st('b', 2, 'playing')]), ['a:-', 'b:-']);
	assert.deepEqual(view([st('a', 1, 'solved', { finishOrder: 1 }), st('b', 2, 'failed')]), ['a:1', 'b:2']);
});
