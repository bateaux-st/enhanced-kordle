import { expect, test } from './harness/test.ts';
import { boardText, rows, startSolo, toast, typeJamo } from './harness/ui.ts';

test('확인이 놓친 열을 서버 추측이 사전에 없다고 하면 붉게 표시하고 행을 늘리지 않는다', async ({ page, solo, clock }) => {
	const api = await solo({ answers: ['토마토'] });
	await startSolo(page);
	// 확인이 실패하면 제출 전에는 붉은 표시가 없고, 거르는 일은 /api/guess의 ok:false 몫이 된다.
	api.failing.check = true;

	await typeJamo(page, 'ㅋㅋㅋㅋㅋㅋ');
	await expect.poll(() => api.calls.check.length).toBe(1);
	await expect(page.locator('.cell.invalid')).toHaveCount(0);

	await page.keyboard.press('Enter');
	await expect(toast(page)).toHaveText('사전에 없는 단어입니다');
	await expect(rows(page).first().locator('.cell.invalid')).toHaveCount(6);
	await expect(rows(page).first()).toHaveClass(/shake/);
	expect(api.calls.guess).toHaveLength(1);
	expect(await boardText(page)).toEqual(['ㅋㅋㅋㅋㅋㅋ', ...Array(5).fill('......')]);

	await clock.run(400);
	await expect(rows(page).first()).not.toHaveClass(/shake/);

	// 한 글자 지우면 붉은 표시가 풀린다.
	await page.keyboard.press('Backspace');
	await expect(page.locator('.cell.invalid')).toHaveCount(0);
});
