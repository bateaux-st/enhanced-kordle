import { expect, type Locator, type Page } from '@playwright/test';
import { CODE_TO_JAMO } from '../../src/lib/jamo.ts';

const CODE_OF = Object.fromEntries(Object.entries(CODE_TO_JAMO).map(([code, jamo]) => [jamo, code]));

/** 물리 키로 자모를 친다. 앱이 KeyboardEvent.code를 보므로 IME 상태와 무관하다. */
export async function typeJamo(page: Page, jamo: string): Promise<void> {
	for (const j of jamo) await page.keyboard.press(CODE_OF[j]);
}

/** 화면 자판의 키를 누른다. */
export async function tapKeys(page: Page, jamo: string): Promise<void> {
	for (const j of jamo) await page.getByRole('button', { name: j, exact: true }).click();
}

export const rows = (page: Page): Locator => page.locator('.board .row');

/** 보드의 칸 판정을 행마다 문자열로. c=초록 p=노랑 a=회색, 아직 판정 없는 칸은 점. */
export async function boardMarks(page: Page): Promise<string[]> {
	return rows(page).evaluateAll((els) =>
		els.map((row) =>
			[...row.querySelectorAll('.cell')].map((c) => (c.classList.contains('c') ? 'c' : c.classList.contains('p') ? 'p' : c.classList.contains('a') ? 'a' : '.')).join('')
		)
	);
}

/** 보드의 글자를 행마다 문자열로(빈 칸은 점). */
export async function boardText(page: Page): Promise<string[]> {
	return rows(page).evaluateAll((els) => els.map((row) => [...row.querySelectorAll('.cell')].map((c) => c.textContent?.trim() || '.').join('')));
}

/** r번째 행(0부터)의 판정이 expected가 될 때까지 기다린다. */
export async function expectRowMarks(page: Page, r: number, expected: string): Promise<void> {
	await expect.poll(async () => (await boardMarks(page))[r], { message: `${r + 1}번째 행 판정` }).toBe(expected);
}

/** 키보드 칸의 색. 키가 받은 가장 좋은 판정(c/p/a), 아직 없으면 null. */
export async function keyState(page: Page, jamo: string): Promise<string | null> {
	const cls = (await page.getByRole('button', { name: jamo, exact: true }).getAttribute('class')) ?? '';
	return ['c', 'p', 'a'].find((m) => cls.split(/\s+/).includes(m)) ?? null;
}

/**
 * 첫 화면에서 혼자 하기를 눌러 판이 시작될 때까지. 저장된 config의 모드로 시작한다.
 * 보드는 /api/game 응답 전(loading)에도 빈 칸으로 그려지고 그동안의 키 입력은 버려지므로, 포기 버튼(진행 중에만 있다)을 기다린다.
 * 저장된 끝난 판을 복원하는 경우는 진행 중 버튼이 없으니 over를 켠다.
 */
export async function startSolo(page: Page, { over = false } = {}): Promise<void> {
	await page.goto('/');
	await page.getByRole('button', { name: /혼자 하기/ }).click();
	await expect(rows(page).first()).toBeVisible();
	if (!over) await expect(page.getByRole('button', { name: '포기' })).toBeVisible();
}

export const toast = (page: Page): Locator => page.locator('.toast');

/** 멀티 화면의 토스트(한 번에 하나). 같은 문구가 채팅 시스템 줄에도 남으므로 문구 검사는 이 영역으로 좁힌다. */
export const mpToast = (page: Page): Locator => page.locator('.toast-wrap .toast');

/** 페이지가 화면 폭을 넘어 가로로 밀리지 않는다. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
	const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(over, '가로로 넘치는 폭(px)').toBeLessThanOrEqual(0);
}
