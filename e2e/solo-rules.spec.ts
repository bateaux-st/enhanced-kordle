import type { Page } from '@playwright/test';
import { seed } from './harness/storage.ts';
import { expect, test } from './harness/test.ts';
import { boardText, expectRowMarks, rows, startSolo, toast, typeJamo } from './harness/ui.ts';
import { toJamo } from './harness/words.ts';

const 토마토 = toJamo('토마토');

async function guess(page: Page, word: string) {
	await typeJamo(page, toJamo(word));
	await page.keyboard.press('Enter');
}

test.describe('힌트', () => {
	test('노란 자모가 없으면 힌트를 쓰지 못하고 서버도 부르지 않는다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'] });
		await startSolo(page);

		await page.getByRole('button', { name: '힌트' }).click();
		await expect(toast(page)).toHaveText('힌트를 줄 노란 자모가 없습니다');
		expect(api.calls.hint).toEqual([]);
		await expect(page.getByRole('button', { name: '힌트' })).toBeEnabled();
	});

	test('힌트는 노란 자모의 실제 칸을 입력 행에 점선으로 보여 주고 한 판에 한 번만 쓴다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);
		await guess(page, '고구마');
		await expectRowMarks(page, 0, 'acaapp');

		await page.getByRole('button', { name: '힌트' }).click();
		// 보드에서 처음 나오는 노란 칸은 ㅁ이고, 정답에서 ㅁ은 3번째 칸이다.
		await expect(toast(page)).toHaveText('ㅁ은(는) 3번째 칸');
		expect(api.calls.hint).toEqual([{ token: `tok:${토마토}`, jamo: 'ㅁ', known: [] }]);
		await expect(rows(page).nth(1).locator('.cell').nth(2)).toHaveClass(/hint/);
		expect((await boardText(page))[1]).toBe('..ㅁ...');

		const used = page.getByRole('button', { name: '힌트 사용함' });
		await expect(used).toBeDisabled();
	});

	test('같은 자모를 초록으로 이미 찾았으면 known으로 보내 남은 자리를 알려 받는다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'], valid: ['오로라'] });
		await startSolo(page);
		// 오로라(ㅇㅗㄹㅗㄹㅏ): 정답 ㅌㅗㅁㅏㅌㅗ에는 ㅗ가 둘이라 2번째 칸은 초록, 4번째 칸의 ㅗ는 노랑이다.
		await guess(page, '오로라');
		await expectRowMarks(page, 0, 'acapap');

		await page.getByRole('button', { name: '힌트' }).click();
		await expect(toast(page)).toHaveText('ㅗ은(는) 6번째 칸');
		expect(api.calls.hint).toEqual([{ token: `tok:${토마토}`, jamo: 'ㅗ', known: [1] }]);
		await expect(rows(page).nth(1).locator('.cell').nth(5)).toHaveClass(/hint/);
	});
});

test.describe('하드 모드', () => {
	test.beforeEach(async ({ page }) => {
		await seed(page, { settings: { hard: true } });
	});

	test('하드 표시가 모드 줄에 붙는다', async ({ page, solo }) => {
		await solo({ answers: ['토마토'] });
		await startSolo(page);
		await expect(page.locator('.mode-line b.hard')).toHaveText('하드');
	});

	test('초록 자리를 바꾸면 제출되지 않고 몇 번째 칸인지 알려 준다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'], valid: ['고구마', '안경'] });
		await startSolo(page);
		await guess(page, '고구마'); // ㅗ가 2번째 칸에서 초록
		await expectRowMarks(page, 0, 'acaapp');

		await guess(page, '안경');
		await expect(toast(page)).toHaveText('2번째 칸은 ㅗ입니다');
		await expect(rows(page).nth(1)).toHaveClass(/shake/);
		// 서버에는 첫 추측만 갔다. 입력은 지워지지 않는다.
		expect(api.calls.guess).toHaveLength(1);
		expect((await boardText(page))[1]).toBe(toJamo('안경'));
	});

	test('노란 자모를 빼먹으면 어떤 자모를 넣어야 하는지 알려 준다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'], valid: ['고구마', '소나기'] });
		await startSolo(page);
		await guess(page, '고구마');
		await expectRowMarks(page, 0, 'acaapp');

		// 소나기(ㅅㅗㄴㅏㄱㅣ)는 ㅗ 자리는 지켰지만 노란 ㅁ이 없다.
		await guess(page, '소나기');
		await expect(toast(page)).toHaveText('ㅁ을(를) 포함해야 합니다');
		expect(api.calls.guess).toHaveLength(1);
	});

	test('제약을 지킨 추측은 통과한다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);
		await guess(page, '고구마');
		await expectRowMarks(page, 0, 'acaapp');
		await guess(page, '토마토');
		await expectRowMarks(page, 1, 'cccccc');
		expect(api.calls.guess).toHaveLength(2);
	});
});
