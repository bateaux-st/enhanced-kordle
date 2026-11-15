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
		// 새 판은 응답을 받은 뒤에 열리므로 요청이 나간 직후에는 이전 판이 아직 남아 있다.
		await expect.poll(() => boardMarks(page)).toEqual(Array(4).fill('......'));
	});

	test('포기 중 정답 확인(reveal)이 실패하면 토스트로 알리고 패배 상태로 남아 다음 단어로 넘어갈 수 있다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'endless', length: { kind: 'fixed', n: 6 } } });
		const api = await solo({ answers: ['토마토', '바나나'], valid: ['고구마'] });
		await startSolo(page);
		await typeJamo(page, 고구마);
		await page.keyboard.press('Enter');
		await expectRowMarks(page, 0, 'acaapp');

		api.failing.reveal = true;
		const giveUp = page.getByRole('button', { name: '포기' });
		await giveUp.click();
		await page.getByRole('button', { name: '정말 포기?' }).click();
		await expect(toast(page)).toHaveText(CONNECT_FAIL);
		expect(api.calls.reveal).toHaveLength(1);
		await expect(giveUp).toHaveCount(0);
		expect((await boardText(page))[0]).toBe(고구마);

		await page.getByRole('button', { name: '다음 단어' }).click();
		await expect.poll(() => api.calls.game.length).toBe(2);
		await expect(giveUp).toBeVisible();
		expect(await boardMarks(page)).toEqual(Array(6).fill('......'));
	});

	test('첫 판 요청(game)이 실패하면 토스트 없이 안내와 다시 시도 버튼이 뜨고, 다시 실패해도 남으며, 성공하면 판이 열린다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'endless', length: { kind: 'fixed', n: 6 } } });
		const api = await solo({ answers: ['토마토'], valid: ['고구마'] });
		api.failing.game = true;
		await page.goto('/');
		await page.getByRole('button', { name: /혼자 하기/ }).click();

		const notice = page.getByRole('alert').filter({ hasText: '게임을 불러오지 못했습니다.' });
		const retry = page.getByRole('button', { name: '다시 시도' });
		await expect(notice).toBeVisible();
		await expect(retry).toBeEnabled();
		await expect(toast(page)).toHaveCount(0);
		await expect(page.locator('.board')).toHaveCount(0);
		expect(api.calls.game).toHaveLength(1);

		await retry.click();
		await expect.poll(() => api.calls.game.length).toBe(2);
		await expect(notice).toBeVisible();
		await expect(toast(page)).toHaveCount(0);

		api.failing.game = false;
		await retry.click();
		await expect(page.getByRole('button', { name: '포기' })).toBeVisible();
		await expect(notice).toHaveCount(0);
		expect(api.calls.game).toHaveLength(3);

		await typeJamo(page, 고구마);
		await page.keyboard.press('Enter');
		await expectRowMarks(page, 0, 'acaapp');
	});

	test('모드를 바꿔 시작하다 새 판 요청이 실패해도 같은 안내가 뜨고 다시 시도로 판이 열린다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'endless', length: { kind: 'fixed', n: 6 } } });
		const api = await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);

		api.failing.game = true;
		await page.getByRole('button', { name: '모드 바꾸기' }).click();
		await page.getByRole('dialog', { name: '게임 모드' }).getByRole('button', { name: '시작' }).click();
		await expect(page.getByRole('alert').filter({ hasText: '게임을 불러오지 못했습니다.' })).toBeVisible();
		await expect(toast(page)).toHaveCount(0);
		await expect(page.getByRole('button', { name: '포기' })).toHaveCount(0);

		api.failing.game = false;
		await page.getByRole('button', { name: '다시 시도' }).click();
		await expect(page.getByRole('button', { name: '포기' })).toBeVisible();
		await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0);
	});

	test('다음 단어 요청이 실패하면 끝난 판 화면이 그대로 남고 토스트만 뜨며 같은 버튼으로 다시 시도한다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'endless', length: { kind: 'fixed', n: 6 } } });
		const api = await solo({ answers: ['토마토', '바나나'], valid: ['고구마'] });
		await startSolo(page);
		await typeJamo(page, 고구마);
		await page.keyboard.press('Enter');
		await expectRowMarks(page, 0, 'acaapp');
		await page.getByRole('button', { name: '포기' }).click();
		await page.getByRole('button', { name: '정말 포기?' }).click();
		const next = page.getByRole('button', { name: '다음 단어' });
		await expect(next).toBeVisible();

		api.failing.game = true;
		await next.click();
		await expect(toast(page)).toHaveText(CONNECT_FAIL);
		await expect(next).toBeVisible();
		expect((await boardText(page))[0]).toBe(고구마);
		await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0);

		api.failing.game = false;
		await next.click();
		await expect(page.getByRole('button', { name: '포기' })).toBeVisible();
		expect(await boardMarks(page)).toEqual(Array(6).fill('......'));
		expect(api.calls.game).toHaveLength(3);
	});
});
