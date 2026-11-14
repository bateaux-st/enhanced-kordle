import type { Page } from '@playwright/test';
import { seed, stored } from './harness/storage.ts';
import { expect, test } from './harness/test.ts';
import { expectRowMarks, startSolo, toast, typeJamo } from './harness/ui.ts';
import { toJamo, WORD_BY_N } from './harness/words.ts';

const byLength = (req: { n?: number }) => WORD_BY_N[req.n ?? 5];

async function guess(page: Page, word: string) {
	await typeJamo(page, toJamo(word));
	await page.keyboard.press('Enter');
}

test.describe('솔로 등반', () => {
	test('스테이지를 올라 시간이 쌓이고, 멈추면 결과 창이 기록·피라미드·멈춘 정답을 보여 준다', async ({ page, solo, clock }) => {
		await seed(page, {
			config: { mode: 'climb-length', length: { kind: 'fixed', n: 5 } },
			// 이전 기록: 같은 스테이지 2까지, 총 90초. 이번 판이 더 빠르다.
			'climbtime:climb-length:fixed-5': { best: { stage: 2, ms: 90_000 }, stages: { 1: 20_000, 2: 50_000 } },
			'best:climb-length:fixed-5': 2
		});
		const api = await solo({ answers: byLength });
		await startSolo(page);
		await expect(page.locator('.mode-line')).toContainText('등반 · 길이 상승 · 5자 · 스테이지 1');
		const timer = page.getByRole('timer');

		await clock.run(12_000);
		await expect(timer.locator('b').nth(0)).toHaveText('0:12');
		await guess(page, '사과');
		await expectRowMarks(page, 0, 'ccccc');
		await expect(toast(page)).toHaveText('스테이지 1 클리어');
		// 클리어한 스테이지는 시간이 멈추고 총 시간에 들어간다.
		await expect(timer.locator('b').nth(1)).toHaveText('0:12');

		await page.getByRole('button', { name: '다음 스테이지' }).click();
		await expect(page.getByRole('heading', { name: '꼬들 - 6자' })).toBeVisible();
		await expect(page.locator('.mode-line')).toContainText('스테이지 2');
		expect(api.calls.game.at(-1)).toEqual({ mode: 'climb-length', n: 6 });
		await expect(timer.locator('b').nth(0)).toHaveText('0:00');

		await clock.run(30_000);
		await guess(page, '바나나');
		await expectRowMarks(page, 0, 'cccccc');
		await expect(timer.locator('b').nth(1)).toHaveText('0:42');

		await page.getByRole('button', { name: '다음 스테이지' }).click();
		await expect(page.getByRole('heading', { name: '꼬들 - 7자' })).toBeVisible();
		await clock.run(7_000);
		await page.getByRole('button', { name: '포기' }).click();
		await page.getByRole('button', { name: '정말 포기?' }).click();
		await expect(toast(page)).toHaveText('정답: 고양이');
		await clock.run(1200);

		const result = page.getByRole('dialog', { name: '등반 결과' });
		await expect(result.locator('.headline')).toHaveText('스테이지 2까지 올랐습니다');
		await expect(result.locator('.box').nth(0)).toContainText('0:42');
		const best = result.locator('.box').nth(1);
		await expect(best).toContainText('새 기록');
		await expect(best).toContainText('0:42');
		await expect(best).toContainText('스테이지 2');

		const pyramid = result.locator('.pyramid .row');
		await expect(pyramid).toHaveCount(2);
		await expect(pyramid.nth(0)).toContainText('사과');
		await expect(pyramid.nth(0)).toContainText('0:12');
		await expect(pyramid.nth(0).locator('.best')).toHaveText('최고');
		await expect(pyramid.nth(1)).toContainText('바나나');
		await expect(pyramid.nth(1)).toContainText('0:30');
		await expect(result.locator('.stopped')).toHaveText('멈춘 스테이지 3 · 0:07');
		await expect(result.locator('.answer')).toHaveText('멈춘 곳의 정답: 고양이');

		expect(await stored(page, 'best:climb-length:fixed-5')).toBe(2);
		expect(await stored(page, 'climbtime:climb-length:fixed-5')).toEqual({ best: { stage: 2, ms: 42_000 }, stages: { 1: 12_000, 2: 30_000 } });
		expect(await stored(page, 'stats:climb-length')).toMatchObject({ played: 3, won: 2 });

		await result.getByRole('button', { name: '처음부터' }).click();
		await expect(result).toHaveCount(0);
		await expect(page.locator('.mode-line')).toContainText('스테이지 1');
		await expect(page.getByRole('heading', { name: '꼬들 - 5자' })).toBeVisible();
	});

	test('12자까지 모두 맞히면 완주 토스트와 완주 결과 창이 뜨고 다시 등반할 수 있다', async ({ page, solo, clock }) => {
		await seed(page, { config: { mode: 'climb-length', length: { kind: 'fixed', n: 5 } } });
		const api = await solo({ answers: byLength });
		await startSolo(page);

		for (let n = 5; n < 12; n++) {
			await guess(page, WORD_BY_N[n]);
			await expectRowMarks(page, 0, 'c'.repeat(n));
			await page.getByRole('button', { name: '다음 스테이지' }).click();
			await expect(page.getByRole('heading', { name: `꼬들 - ${n + 1}자` })).toBeVisible();
		}
		await guess(page, WORD_BY_N[12]);
		await expectRowMarks(page, 0, 'c'.repeat(12));
		await expect(toast(page)).toHaveText('12자까지 완주!');
		expect(api.calls.game.map((g) => (g as { n: number }).n)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);

		await clock.run(1200);
		const result = page.getByRole('dialog', { name: '등반 결과' });
		await expect(result.locator('.headline')).toHaveText('12자 완주!');
		await expect(result.locator('.pyramid .row')).toHaveCount(8);
		await expect(result.getByRole('button', { name: '다시 등반' })).toBeVisible();
		expect(await stored(page, 'best:climb-length:fixed-5')).toBe(8);

		await result.getByRole('button', { name: '다시 등반' }).click();
		await expect(page.getByRole('heading', { name: '꼬들 - 5자' })).toBeVisible();
		await expect(page.locator('.mode-line')).toContainText('스테이지 1');
	});

	test('첫 스테이지에서 멈추면 쌓인 단어 없이 멈춘 정답만 보여 준다', async ({ page, solo, clock }) => {
		await seed(page, { config: { mode: 'climb-streak', length: { kind: 'fixed', n: 5 } } });
		await solo({ answers: byLength });
		await startSolo(page);
		await expect(page.locator('.mode-line')).toContainText('등반 · 연속 클리어 · 5자 · 스테이지 1');

		await page.getByRole('button', { name: '포기' }).click();
		await page.getByRole('button', { name: '정말 포기?' }).click();
		await expect(toast(page)).toHaveText('정답: 사과');
		await clock.run(1200);

		const result = page.getByRole('dialog', { name: '등반 결과' });
		await expect(result.locator('.headline')).toHaveText('첫 스테이지에서 멈췄습니다');
		await expect(result.locator('.pyramid')).toHaveCount(0);
		await expect(result.locator('.box').nth(0)).toContainText('클리어 없음');
		await expect(result.getByText('아직 없음')).toBeVisible();
		await expect(result.locator('.answer')).toHaveText('멈춘 곳의 정답: 사과');
	});
});
