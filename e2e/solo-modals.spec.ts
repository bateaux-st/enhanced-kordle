import type { Page } from '@playwright/test';
import { seed, stored } from './harness/storage.ts';
import { expect, test } from './harness/test.ts';
import { rows, startSolo, typeJamo } from './harness/ui.ts';
import { toJamo } from './harness/words.ts';

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

test.describe('모드 모달', () => {
	test('모드와 자모 수를 고르면 새 판이 그 설정으로 시작하고 config가 저장된다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토', '고양이'] });
		await startSolo(page);

		await page.getByRole('button', { name: '모드 바꾸기' }).click();
		const dialog = page.getByRole('dialog', { name: '게임 모드' });
		await dialog.getByRole('radio', { name: /랜덤 무한/ }).check();
		await dialog.getByRole('button', { name: '7', exact: true }).click();
		await dialog.getByRole('button', { name: '시작' }).click();

		await expect(dialog).toHaveCount(0);
		await expect(page.getByRole('heading', { name: '꼬들 - 7자' })).toBeVisible();
		await expect(page.locator('.mode-line')).toContainText('랜덤 무한 · 7자');
		expect(api.calls.game.at(-1)).toEqual({ mode: 'endless', n: 7 });
		expect(await stored(page, 'config')).toEqual({ mode: 'endless', length: { kind: 'fixed', n: 7 } });
	});

	test('랜덤 길이는 n 없이 요청하고 서버가 정한 길이로 보드를 그린다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토', '고양이'] });
		await startSolo(page);

		await page.getByRole('button', { name: '모드 바꾸기' }).click();
		const dialog = page.getByRole('dialog', { name: '게임 모드' });
		await dialog.getByRole('radio', { name: /랜덤 무한/ }).check();
		await dialog.getByRole('button', { name: '랜덤', exact: true }).click();
		await dialog.getByRole('button', { name: '시작' }).click();

		await expect(page.locator('.mode-line')).toContainText('랜덤 무한 · 랜덤');
		expect(api.calls.game.at(-1)).toEqual({ mode: 'endless' });
		await expect(page.getByRole('heading', { name: '꼬들 - 7자' })).toBeVisible();
	});

	test('일일 등반은 코스가 고정이라 자모 수를 고르는 칸이 없다', async ({ page, solo }) => {
		await solo({ answers: ['토마토'] });
		await startSolo(page);

		await page.getByRole('button', { name: '모드 바꾸기' }).click();
		const dialog = page.getByRole('dialog', { name: '게임 모드' });
		await expect(dialog.getByText('자모 수', { exact: true })).toBeVisible();
		await dialog.getByRole('radio', { name: /일일 등반/ }).check();
		await expect(dialog.getByText('자모 수', { exact: true })).toHaveCount(0);
		await dialog.getByRole('radio', { name: /길이 상승/ }).check();
		await expect(dialog.getByText('시작 길이', { exact: true })).toBeVisible();
	});

	test('length가 없는 손상된 config로도 페이지가 뜨고 기본 모드로 시작한다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'daily' } });
		const api = await solo({ answers: ['토마토'] });
		await startSolo(page);

		expect(api.calls.game.at(-1)).toMatchObject({ mode: 'daily', n: 6 });
		await expect(page.getByRole('heading', { name: '꼬들 - 6자' })).toBeVisible();
	});

	test('Esc나 닫기 버튼으로 모드를 바꾸지 않고 닫는다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'] });
		await startSolo(page);

		await page.getByRole('button', { name: '모드 바꾸기' }).click();
		await expect(page.getByRole('dialog', { name: '게임 모드' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);

		await page.getByRole('button', { name: '모드 선택' }).click();
		await page.getByRole('dialog', { name: '게임 모드' }).getByRole('button', { name: '닫기' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(api.calls.game).toHaveLength(1);
		expect(await stored(page, 'config')).toBeNull();
	});
});

test.describe('설정 모달', () => {
	test('시도 횟수는 4~10 범위에서 바꾸고 저장된다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'endless', length: { kind: 'fixed', n: 6 } }, settings: { maxTries: 9 } });
		await solo({ answers: ['토마토'] });
		await startSolo(page);

		await page.getByRole('button', { name: '설정' }).click();
		const dialog = page.getByRole('dialog', { name: '설정' });
		await expect(dialog.getByText('9', { exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: '+' }).click();
		await expect(dialog.getByText('10', { exact: true })).toBeVisible();
		await expect(dialog.getByRole('button', { name: '+' })).toBeDisabled();
		expect(await stored(page, 'settings')).toMatchObject({ maxTries: 10 });
		await expect(rows(page)).toHaveCount(9);
		await expect(dialog.getByText('다음 게임부터 적용됩니다.')).toBeVisible();

		for (let i = 0; i < 6; i++) await dialog.getByRole('button', { name: '−' }).click();
		await expect(dialog.getByRole('button', { name: '−' })).toBeDisabled();
		expect(await stored(page, 'settings')).toMatchObject({ maxTries: 4 });
	});

	test('하드모드는 판이 시작되기 전에만 켤 수 있고 끄는 것은 언제나 된다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'endless', length: { kind: 'fixed', n: 6 } } });
		await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);

		await page.getByRole('button', { name: '설정' }).click();
		const dialog = page.getByRole('dialog', { name: '설정' });
		const hard = dialog.getByRole('switch', { name: '하드모드' });
		await expect(hard).toBeEnabled();
		await hard.click();
		await expect(hard).toHaveAttribute('aria-checked', 'true');
		expect(await stored(page, 'settings')).toMatchObject({ hard: true });
		await page.keyboard.press('Escape');
		await expect(page.locator('.mode-line b.hard')).toHaveText('하드');

		// 판 도중에는 끄는 것만 된다.
		await typeJamo(page, toJamo('고구마'));
		await page.keyboard.press('Enter');
		await expect(rows(page).nth(0).locator('.cell.a, .cell.p, .cell.c').first()).toBeVisible();
		await page.getByRole('button', { name: '설정' }).click();
		await expect(hard).toBeEnabled();
		await hard.click();
		await expect(hard).toHaveAttribute('aria-checked', 'false');
		await expect(hard).toBeDisabled();
		await expect(dialog.getByText('진행 중인 판에는 켤 수 없습니다.')).toBeVisible();
		expect(await stored(page, 'settings')).toMatchObject({ hard: false });
	});

	test('테마를 고르면 즉시 문서에 반영되고 저장되며 시스템은 기기 설정을 따른다', async ({ page, solo }) => {
		await solo({ answers: ['토마토'] });
		await startSolo(page);
		expect(await theme(page)).toBe('light');

		await page.getByRole('button', { name: '설정' }).click();
		const dialog = page.getByRole('dialog', { name: '설정' });
		await dialog.getByRole('button', { name: '다크' }).click();
		expect(await theme(page)).toBe('dark');
		expect(await stored(page, 'settings')).toMatchObject({ theme: 'dark' });
		await expect(dialog.getByRole('button', { name: '다크' })).toHaveAttribute('aria-pressed', 'true');

		await dialog.getByRole('button', { name: '라이트' }).click();
		expect(await theme(page)).toBe('light');

		await page.emulateMedia({ colorScheme: 'dark' });
		await dialog.getByRole('button', { name: '시스템' }).click();
		expect(await theme(page)).toBe('dark');
		// 시스템 테마는 기기 설정이 바뀌면 따라간다.
		await page.emulateMedia({ colorScheme: 'light' });
		await expect.poll(() => theme(page)).toBe('light');
	});

	test('저장된 테마와 하드모드는 새로 열어도 첫 화면부터 유지된다', async ({ page, solo }) => {
		await seed(page, { settings: { theme: 'dark', hard: true, maxTries: 8 }, config: { mode: 'endless', length: { kind: 'fixed', n: 8 } } });
		const api = await solo({ answers: ['초콜릿'] });
		await page.goto('/');
		// 선택 화면에서도 app.html의 인라인 스크립트가 첫 페인트 전에 저장된 테마를 정한다.
		expect(await theme(page)).toBe('dark');

		await page.getByRole('button', { name: /혼자 하기/ }).click();
		await expect(page.getByRole('heading', { name: '꼬들 - 8자' })).toBeVisible();
		await expect(page.locator('.mode-line')).toContainText('랜덤 무한 · 8자');
		await expect(page.locator('.mode-line b.hard')).toBeVisible();
		await expect(rows(page)).toHaveCount(8);
		expect(api.calls.game).toEqual([{ mode: 'endless', n: 8 }]);
	});

	test('첫 화면의 설정에서도 테마를 바꿀 수 있다', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: '설정' }).click();
		const dialog = page.getByRole('dialog', { name: '설정' });
		await dialog.getByRole('button', { name: '다크' }).click();
		expect(await theme(page)).toBe('dark');
		expect(await stored(page, 'settings')).toMatchObject({ theme: 'dark' });
	});
});

test.describe('통계·도움말', () => {
	test('통계 창은 저장된 기록을 승률·연승·시도 분포로 보여 준다', async ({ page, solo }) => {
		await seed(page, { 'stats:daily': { played: 10, won: 8, streak: 3, maxStreak: 5, dist: [0, 1, 2, 3, 2] } });
		await solo({ answers: ['토마토'] });
		await startSolo(page);

		await page.getByRole('button', { name: '통계' }).click();
		const dialog = page.getByRole('dialog', { name: '통계' });
		await expect(dialog.getByText('하루 1개 · 6자')).toBeVisible();
		const tiles = dialog.locator('.tiles div');
		await expect(tiles).toHaveText(['10플레이', '80승률 %', '3현재 연승', '5최다 연승']);
		const bars = dialog.locator('.bar');
		await expect(bars).toHaveText(['0', '1', '2', '3', '2', '0']);
		// 아직 끝나지 않은 판이라 정답과 카운트다운은 없다.
		await expect(dialog.locator('.answer')).toHaveCount(0);
		await expect(dialog.locator('.next')).toHaveCount(0);

		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
	});

	test('등반 모드의 통계 창은 최고 스테이지를 함께 보여 준다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'climb-streak', length: { kind: 'fixed', n: 5 } }, 'best:climb-streak:fixed-5': 4 });
		await solo({ answers: ['사과'] });
		await startSolo(page);

		await page.getByRole('button', { name: '통계' }).click();
		const dialog = page.getByRole('dialog', { name: '통계' });
		await expect(dialog.locator('.best')).toContainText('최고 스테이지 4');
		await expect(dialog.locator('.best')).toContainText('현재 1');
	});

	test('도움말 창을 열고 닫기 버튼과 Esc로 닫는다', async ({ page, solo }) => {
		await solo({ answers: ['토마토'] });
		await startSolo(page);

		await page.getByRole('button', { name: '도움말' }).click();
		const dialog = page.getByRole('dialog', { name: '이 놀이는?' });
		await expect(dialog.getByRole('heading', { name: '자모 규칙' })).toBeVisible();
		await expect(dialog.getByRole('heading', { name: '하드모드' })).toBeVisible();
		await dialog.getByRole('button', { name: '닫기' }).click();
		await expect(dialog).toHaveCount(0);

		await page.getByRole('button', { name: '도움말' }).click();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});

	test('모달이 열린 동안에는 글자 입력이 보드에 들어가지 않는다', async ({ page, solo }) => {
		await solo({ answers: ['토마토'] });
		await startSolo(page);
		await page.getByRole('button', { name: '도움말' }).click();

		await typeJamo(page, 'ㄱㄱ');
		await page.keyboard.press('Escape');
		await expect(page.locator('.cell.filled')).toHaveCount(0);
	});
});
