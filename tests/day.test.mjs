import assert from 'node:assert/strict';
import test from 'node:test';
import { dailySecondsLeft, todayKST, validDailyDay } from '../src/lib/day.ts';

test('KST 자정에 날짜가 바뀌고 이전 문제의 대기는 0에서 멈춘다', (t) => {
	const midnight = Date.parse('2026-09-14T00:00:00+09:00');
	t.mock.timers.enable({ apis: ['Date'], now: midnight - 1 });
	assert.equal(todayKST(), '2026-09-13');
	assert.equal(dailySecondsLeft('2026-09-13'), 1);
	t.mock.timers.setTime(midnight);
	assert.equal(todayKST(), '2026-09-14');
	assert.equal(dailySecondsLeft('2026-09-13'), 0);
	assert.equal(dailySecondsLeft('2026-09-14'), 86400);
	t.mock.timers.setTime(midnight + 3 * 86400_000);
	assert.equal(dailySecondsLeft('2026-09-13'), 0);
});

test('문제 날짜는 실제 존재하는 오늘·과거 날짜만 허용한다', () => {
	for (const day of ['2026-09-14', '2026-09-13', '2024-02-29']) assert.equal(validDailyDay(day, '2026-09-14'), true);
	for (const day of ['2026-09-15', '2026-02-29', '2026-02-30', '2026-13-01', '2026-9-1', '', null, {}, 123]) {
		assert.equal(validDailyDay(day, '2026-09-14'), false, JSON.stringify(day));
	}
});
