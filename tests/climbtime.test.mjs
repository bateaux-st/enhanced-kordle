import assert from 'node:assert/strict';
import test from 'node:test';
import { applyClear, emptyClimbTime, formatTime, isBetterBest, spokenTime, totalOf } from '../src/lib/climbtime.ts';

test('시간 포맷은 m:ss, 1시간부터 h:mm:ss, 모르면 -', () => {
	assert.equal(formatTime(0), '0:00');
	assert.equal(formatTime(42_999), '0:42');
	assert.equal(formatTime(75_000), '1:15');
	assert.equal(formatTime(3_599_000), '59:59');
	assert.equal(formatTime(3_600_000), '1:00:00');
	assert.equal(formatTime(3_909_000), '1:05:09');
	assert.equal(formatTime(null), '-');
	assert.equal(formatTime(-5), '0:00');
});

test('읽어 주는 시간은 0인 앞 단위를 뺀다', () => {
	assert.equal(spokenTime(42_000), '42초');
	assert.equal(spokenTime(135_000), '2분 15초');
	assert.equal(spokenTime(3_909_000), '1시간 5분 9초');
	assert.equal(spokenTime(3_600_000), '1시간 0분 0초');
	assert.equal(spokenTime(null), '기록 없음');
});

test('총 시간은 모든 스테이지 시간이 있을 때만 합한다', () => {
	assert.equal(totalOf([]), 0);
	assert.equal(totalOf([1000, 2500]), 3500);
	assert.equal(totalOf([1000, null]), null);
	assert.equal(totalOf([1000, , 3000]), null);
});

test('최고 기록은 스테이지가 높을수록, 같으면 시간이 짧을수록 좋다', () => {
	assert.equal(isBetterBest(null, { stage: 1, ms: 9 }), true);
	assert.equal(isBetterBest({ stage: 3, ms: 100 }, { stage: 4, ms: 900 }), true);
	assert.equal(isBetterBest({ stage: 3, ms: 100 }, { stage: 3, ms: 99 }), true);
	assert.equal(isBetterBest({ stage: 3, ms: 100 }, { stage: 3, ms: 100 }), false);
	assert.equal(isBetterBest({ stage: 3, ms: 100 }, { stage: 2, ms: 1 }), false);
});

test('첫 클리어는 기록을 만들지만 스테이지 최고 배지는 아니다', () => {
	const r = applyClear(emptyClimbTime(), { stage: 1, ms: 25_000, totalMs: 25_000, legacyBestStage: 0 });
	assert.deepEqual(r.rec, { best: { stage: 1, ms: 25_000 }, stages: { 1: 25_000 } });
	assert.equal(r.stageBest, false);
	assert.equal(r.bestBeaten, true);
});

test('더 빠르면 스테이지 기록과 배지, 느리면 둘 다 그대로', () => {
	const rec = { best: { stage: 2, ms: 60_000 }, stages: { 1: 25_000, 2: 35_000 } };
	const fast = applyClear(rec, { stage: 1, ms: 20_000, totalMs: 20_000, legacyBestStage: 2 });
	assert.equal(fast.stageBest, true);
	assert.equal(fast.rec.stages[1], 20_000);
	assert.equal(fast.bestBeaten, false);
	const slow = applyClear(rec, { stage: 1, ms: 30_000, totalMs: 30_000, legacyBestStage: 2 });
	assert.equal(slow.stageBest, false);
	assert.equal(slow.rec.stages[1], 25_000);
	assert.equal(slow.bestBeaten, false);
});

test('같은 스테이지에서 총 시간이 짧으면 최고 기록 갱신, 길면 유지', () => {
	const rec = { best: { stage: 2, ms: 60_000 }, stages: {} };
	assert.equal(applyClear(rec, { stage: 2, ms: 1, totalMs: 59_000, legacyBestStage: 2 }).bestBeaten, true);
	const same = applyClear(rec, { stage: 2, ms: 1, totalMs: 61_000, legacyBestStage: 2 });
	assert.equal(same.bestBeaten, false);
	assert.deepEqual(same.rec.best, { stage: 2, ms: 60_000 });
});

test('시간을 모르는 클리어는 기록 비교에서 빠진다', () => {
	const rec = { best: { stage: 2, ms: 60_000 }, stages: { 3: 9_000 } };
	const r = applyClear(rec, { stage: 3, ms: null, totalMs: null, legacyBestStage: 2 });
	assert.deepEqual(r.rec, rec);
	assert.equal(r.stageBest, false);
	assert.equal(r.bestBeaten, false);
	const partial = applyClear(rec, { stage: 3, ms: 8_000, totalMs: null, legacyBestStage: 2 });
	assert.equal(partial.stageBest, true);
	assert.deepEqual(partial.rec.best, rec.best);
});

test('시간 기록이 없던 옛 최고 스테이지는 그보다 낮은 클리어로 덮이지 않는다', () => {
	const low = applyClear(emptyClimbTime(), { stage: 3, ms: 30_000, totalMs: 90_000, legacyBestStage: 8 });
	assert.equal(low.rec.best, null);
	assert.equal(low.bestBeaten, false);
	const equal = applyClear(emptyClimbTime(), { stage: 8, ms: 30_000, totalMs: 400_000, legacyBestStage: 8 });
	assert.deepEqual(equal.rec.best, { stage: 8, ms: 400_000 });
	assert.equal(equal.bestBeaten, true);
	const above = applyClear(emptyClimbTime(), { stage: 9, ms: 30_000, totalMs: 500_000, legacyBestStage: 8 });
	assert.equal(above.bestBeaten, true);
});
