import { seed } from './harness/storage.ts';
import { expect, test } from './harness/test.ts';
import { expectNoHorizontalOverflow } from './harness/ui.ts';

// 390x844(mobile 프로젝트).
test('모바일: 첫 판 불러오기 실패 안내와 다시 시도 버튼이 화면 폭 안에 들어온다', async ({ page, solo }) => {
	await seed(page, { config: { mode: 'endless', length: { kind: 'fixed', n: 6 } } });
	const api = await solo({ answers: ['토마토'] });
	api.failing.game = true;
	await page.goto('/');
	await page.getByRole('button', { name: /혼자 하기/ }).tap();

	const retry = page.getByRole('button', { name: '다시 시도' });
	await expect(retry).toBeVisible();
	const box = (await retry.boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(390);
	const notice = (await page.getByRole('alert').filter({ hasText: '게임을 불러오지 못했습니다.' }).boundingBox())!;
	expect(notice.x + notice.width).toBeLessThanOrEqual(390);
	await expectNoHorizontalOverflow(page);

	api.failing.game = false;
	await retry.tap();
	await expect(page.getByRole('button', { name: '포기' })).toBeVisible();
});
