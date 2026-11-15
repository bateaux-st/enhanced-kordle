import { seed } from './harness/storage.ts';
import { expect, test } from './harness/test.ts';
import { boardMarks, boardText, expectRowMarks, startSolo, toast, typeJamo } from './harness/ui.ts';
import { toJamo } from './harness/words.ts';

const 고구마 = toJamo('고구마');
const CONNECT_FAIL = '서버에 연결할 수 없습니다';

test.describe('솔로 서버 실패', () => {
	test('힌트 요청이 실패하면 토스트로 알리고 힌트는 쓰지 않은 채로 남아 다시 누를 수 있다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);
		await typeJamo(page, 고구마);
		await page.keyboard.press('Enter');
		await expectRowMarks(page, 0, 'acaapp');

		api.failing.hint = true;
		const hint = page.getByRole('button', { name: '힌트' });
		await hint.click();
		await expect(toast(page)).toHaveText(CONNECT_FAIL);
		await expect(hint).toBeEnabled();
		expect(api.calls.hint).toHaveLength(1);

		api.failing.hint = false;
		await hint.click();
		await expect(toast(page)).toHaveText(/번째 칸$/);
		await expect(hint).toBeDisabled();
		expect(api.calls.hint).toHaveLength(2);
	});

	test('확인 요청이 실패하면 붉은 표시 없이 넘어가고 제출은 서버 판정으로 이어진다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);
		api.failing.check = true;

		await typeJamo(page, 고구마);
		await expect.poll(() => api.calls.check.length).toBe(1);
		await expect(page.locator('.cell.invalid')).toHaveCount(0);

		await page.keyboard.press('Enter');
		await expectRowMarks(page, 0, 'acaapp');
		expect(api.calls.guess).toEqual([{ token: `tok:${toJamo('토마토')}`, jamo: 고구마 }]);
	});

	test('패배 확인(reveal)이 실패하면 토스트로 알리고 다음 단어로 넘어갈 수 있다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'endless', length: { kind: 'fixed', n: 6 } }, settings: { maxTries: 4 } });
		const api = await solo({ answers: ['토마토', '바나나'], valid: ['고구마'] });
		await startSolo(page);
		api.failing.reveal = true;

		for (let i = 0; i < 4; i++) {
			await typeJamo(page, 고구마);
			await page.keyboard.press('Enter');
			await expectRowMarks(page, i, 'acaapp');
		}
		await expect(toast(page)).toHaveText(CONNECT_FAIL);
		expect(api.calls.reveal).toHaveLength(1);
		expect(await boardText(page)).toEqual(Array(4).fill(고구마));

		await page.getByRole('button', { name: '다음 단어' }).click();
		await expect.poll(() => api.calls.game.length).toBe(2);
		expect(await boardMarks(page)).toEqual(Array(4).fill('......'));
	});
});
