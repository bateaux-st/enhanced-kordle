import assert from 'node:assert/strict';
import test from 'node:test';
import { judge } from '../src/lib/server/judge.ts';
import { encodeToken, decodeToken, seededIndex, dailyIndex, DAILY_DEDUP_START } from '../src/lib/server/token.ts';

const addDays = (day, d) => new Date(Date.parse(day) + d * 86400000).toISOString().slice(0, 10);

test('중복 자모는 정확한 자리를 먼저 확보하고 남은 개수만 배분한다', () => {
	assert.deepEqual(judge('ㄱㅏㄱㅅㅣ', 'ㄱㄱㄱㅏㅏ'), ['c', 'a', 'c', 'p', 'a']);
	assert.deepEqual(judge('ㅂㅏㄴㅏㄴㅏ', 'ㄴㅏㄴㅂㅏㅇ'), ['p', 'c', 'c', 'p', 'p', 'a']);
	assert.deepEqual(judge('ㅂㅏㄴㅏㄴㅏ', 'ㅂㅏㄴㅏㄴㅏ'), Array(6).fill('c'));
	assert.deepEqual(judge('ㅂㅏㄴㅏㄴㅏ', 'ㅋㅋㅋㅋㅋㅋ'), Array(6).fill('a'));
});

test('토큰은 정답 좌표를 복원하며 좌표 변조와 다른 시크릿을 거부한다', async () => {
	const answer = { n: 6, t: 2, idx: 17 };
	const token = await encodeToken(answer, 'test-only-secret');
	assert.match(token, /^6\.2\.17\.[A-Za-z0-9_-]+$/);
	assert.deepEqual(await decodeToken(token, 'test-only-secret'), answer);
	for (const payload of ['7.2.17', '6.3.17', '6.2.18']) {
		assert.equal(await decodeToken(`${payload}.${token.split('.')[3]}`, 'test-only-secret'), null);
	}
	assert.equal(await decodeToken(token, 'different-test-secret'), null);
	assert.equal(await decodeToken('6.17.AAAA', 'test-only-secret'), null);
	assert.equal(await decodeToken('invalid', 'test-only-secret'), null);
});

test('데일리 시작일 이전 날짜는 예전 날짜별 해시 idx를 그대로 쓴다', async () => {
	for (const day of ['2026-01-01', '2026-09-20', addDays(DAILY_DEDUP_START, -1)]) {
		for (const [n, climb, count] of [[6, false, 3701], [6, true, 3701], [12, false, 174]]) {
			const old = await seededIndex(`${day}:${n}${climb ? ':climb' : ''}`, count);
			assert.equal(await dailyIndex(day, n, climb, count), old);
		}
	}
});

test('데일리 시작일부터 count일 동안 idx가 서로 다르다', async () => {
	for (const count of [1, 2, 174, 3701]) {
		for (const climb of [false, true]) {
			const seen = new Set();
			for (let d = 0; d < count; d++) {
				const idx = await dailyIndex(addDays(DAILY_DEDUP_START, d), 6, climb, count);
				assert.ok(idx >= 0 && idx < count);
				seen.add(idx);
			}
			assert.equal(seen.size, count, `count=${count} climb=${climb}`);
		}
	}
});

test('데일리 idx는 결정론적이다', async () => {
	const day = addDays(DAILY_DEDUP_START, 123);
	assert.equal(await dailyIndex(day, 7, false, 1461), await dailyIndex(day, 7, false, 1461));
	assert.equal(await dailyIndex(day, 7, true, 1461), await dailyIndex(day, 7, true, 1461));
});
