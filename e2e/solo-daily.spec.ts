import type { Page } from '@playwright/test';
import { DAY, T0 } from './harness/clock.ts';
import { seed, stored, storedKeys } from './harness/storage.ts';
import { expect, test } from './harness/test.ts';
import { boardMarks, boardText, expectRowMarks, startSolo, toast, typeJamo } from './harness/ui.ts';
import { toJamo } from './harness/words.ts';

const 토마토 = toJamo('토마토');
const 바나나 = toJamo('바나나');

async function guess(page: Page, word: string) {
	await typeJamo(page, toJamo(word));
	await page.keyboard.press('Enter');
}

test.describe('데일리', () => {
	test('진행 중인 판은 새로 열어도 추측과 힌트가 그대로 복원된다', async ({ page, solo }) => {
		await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);
		await guess(page, '고구마');
		await expectRowMarks(page, 0, 'acaapp');
		await page.getByRole('button', { name: '힌트' }).click();
		await expect(toast(page)).toHaveText('ㅁ은(는) 3번째 칸');

		// 키는 날짜와 토큰이다. 토큰이 길이·정답을 함축하므로 같은 날 같은 판만 이어진다.
		expect(await stored(page, `daily:${DAY}:tok:${토마토}`)).toMatchObject({ rows: [toJamo('고구마')], status: 'playing', answer: null, hints: { 2: 'ㅁ' } });

		await startSolo(page);
		await expectRowMarks(page, 0, 'acaapp');
		expect((await boardText(page))[0]).toBe(toJamo('고구마'));
		expect((await boardText(page))[1]).toBe('..ㅁ...');
		await expect(page.getByRole('button', { name: '힌트 사용함' })).toBeDisabled();
	});

	test('끝난 판은 승리 상태로 복원되고 잠시 뒤 통계 창이 열린다', async ({ page, solo, clock }) => {
		await solo({ answers: ['토마토'] });
		await startSolo(page);
		await guess(page, '토마토');
		// 응답이 와서 판정이 그려진 뒤에 시간을 흘려야 통계 창 타이머가 먼저 걸린다.
		await expectRowMarks(page, 0, 'cccccc');
		await clock.run(1200);
		await expect(page.getByRole('dialog', { name: '통계' })).toBeVisible();

		await startSolo(page, { over: true });
		await expectRowMarks(page, 0, 'cccccc');
		await expect(page.getByRole('button', { name: '포기' })).toHaveCount(0);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await clock.run(1200);
		await expect(page.getByRole('dialog', { name: '통계' }).locator('.answer b')).toHaveText('토마토');
		// 복원은 통계를 다시 세지 않는다.
		expect(await stored(page, 'stats:daily')).toMatchObject({ played: 1, won: 1 });
	});

	test('통계 창의 카운트다운은 한국 자정까지 남은 시간을 세고 자정이 지나면 새로고침을 안내한다', async ({ page, solo, clock }) => {
		await solo({ answers: ['토마토'] });
		await startSolo(page);
		await guess(page, '토마토');
		await expectRowMarks(page, 0, 'cccccc');
		await clock.run(1200);

		const next = page.locator('.next');
		await expect(next).toHaveText('다음 단어까지 11:59:59');
		await clock.run(1000);
		await expect(next).toHaveText('다음 단어까지 11:59:58');

		// 정오에서 12시간 뒤가 자정이다.
		await clock.jump(12 * 3600_000);
		await expect(next).toHaveText('새 일일 문제가 준비되었습니다. 새로고침하면 풀 수 있습니다.');
	});

	test('지난 날짜의 저장본은 오늘 진행을 저장할 때 정리된다', async ({ page, solo }) => {
		await seed(page, {
			'daily:2026-11-14:tok:old': { rows: [], marks: [], status: 'playing', answer: null },
			'dclimb:2026-11-14': { stage: 2, n: 6, climbWords: ['사과'] }
		});
		await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);
		expect(await storedKeys(page)).toContain('daily:2026-11-14:tok:old');

		await guess(page, '고구마');
		await expectRowMarks(page, 0, 'acaapp');
		const keys = await storedKeys(page);
		expect(keys).toContain(`daily:${DAY}:tok:${토마토}`);
		expect(keys.filter((k) => k.includes('2026-11-14'))).toEqual(['dclimb:2026-11-14']);
	});
});

test.describe('일일 등반', () => {
	test('저장된 코스 진행과 스테이지 시작 시각에서 이어지고 시간이 그만큼 흘러 있다', async ({ page, solo }) => {
		await seed(page, {
			config: { mode: 'daily-climb', length: { kind: 'fixed', n: 6 } },
			[`dclimb:${DAY}`]: { stage: 2, n: 6, climbWords: ['사과'], stageStartAt: T0 - 20_000, stageTimes: [15_000], lostMs: null, stageBests: [], runBest: false },
			[`daily:${DAY}:tok:${바나나}`]: {
				rows: [토마토],
				marks: [['a', 'a', 'a', 'c', 'a', 'a']],
				status: 'playing',
				answer: null
			}
		});
		const api = await solo({ answers: ['바나나'] });
		await startSolo(page);

		await expect(page.locator('.mode-line')).toContainText('일일 등반 · 5→12자 · 스테이지 2');
		await expect(page.getByRole('heading', { name: '꼬들 - 6자' })).toBeVisible();
		expect(api.calls.game).toEqual([{ mode: 'daily-climb', n: 6, day: DAY }]);
		expect(await boardMarks(page)).toContain('aaacaa');
		// 이번 스테이지는 20초째, 총 시간은 앞 스테이지 15초를 더해 35초.
		const clock = page.getByRole('timer');
		await expect(clock.locator('b').nth(0)).toHaveText('0:20');
		await expect(clock.locator('b').nth(1)).toHaveText('0:35');
	});
});
