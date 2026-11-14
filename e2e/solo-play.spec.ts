import { DAY } from './harness/clock.ts';
import { seed, stored } from './harness/storage.ts';
import { expect, test } from './harness/test.ts';
import { boardMarks, boardText, expectRowMarks, keyState, rows, startSolo, toast, typeJamo } from './harness/ui.ts';
import { toJamo } from './harness/words.ts';

const 토마토 = toJamo('토마토');

test.describe('솔로 기본 플레이', () => {
	test('새 게임은 빈 보드와 모드 줄로 시작하고 데일리 요청에 날짜와 길이를 싣는다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'] });
		await startSolo(page);

		await expect(page.getByRole('heading', { name: '꼬들 - 6자' })).toBeVisible();
		await expect(page.locator('.mode-line')).toContainText('하루 1개 · 6자');
		expect(await boardMarks(page)).toEqual(Array(6).fill('......'));
		expect(api.calls.game).toEqual([{ mode: 'daily', n: 6, day: DAY }]);
		await expect(page.getByRole('button', { name: '힌트' })).toBeEnabled();
	});

	test('자모를 치고 지우면 현재 행에 반영되고 가득 차기 전에는 제출되지 않는다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);

		await typeJamo(page, 'ㄱㅗㄱ');
		expect((await boardText(page))[0]).toBe('ㄱㅗㄱ...');
		await page.keyboard.press('Backspace');
		expect((await boardText(page))[0]).toBe('ㄱㅗ....');

		await typeJamo(page, 'ㄱ');
		await page.keyboard.press('Enter');
		await expect(toast(page)).toHaveText('자모가 부족합니다');
		expect(api.calls.guess).toEqual([]);
	});

	test('제출하면 서버 판정이 칸과 키보드 색으로 나타난다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);

		await typeJamo(page, toJamo('고구마'));
		await page.keyboard.press('Enter');

		// 토마토(ㅌㅗㅁㅏㅌㅗ)에 고구마(ㄱㅗㄱㅜㅁㅏ): ㅗ는 자리까지 맞고, ㅁ·ㅏ는 자리만 다르다.
		await expectRowMarks(page, 0, 'acaapp');
		expect((await boardText(page))[0]).toBe(toJamo('고구마'));
		expect(api.calls.guess).toEqual([{ token: `tok:${토마토}`, jamo: toJamo('고구마') }]);
		expect(await keyState(page, 'ㅗ')).toBe('c');
		expect(await keyState(page, 'ㅁ')).toBe('p');
		expect(await keyState(page, 'ㄱ')).toBe('a');
		expect(await keyState(page, 'ㅂ')).toBeNull();
		// 다음 입력은 다음 행에 들어간다.
		await typeJamo(page, 'ㅅ');
		expect((await boardText(page))[1]).toBe('ㅅ.....');
	});

	test('화면 자판으로도 입력하고 입력·삭제 키가 동작한다', async ({ page, solo }) => {
		await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);

		for (const j of 'ㄱㅗㅜ') await page.getByRole('button', { name: j, exact: true }).click();
		expect((await boardText(page))[0]).toBe('ㄱㅗㅜ...');
		await page.getByRole('button', { name: '삭제' }).click();
		expect((await boardText(page))[0]).toBe('ㄱㅗ....');
		await page.getByRole('button', { name: '입력' }).click();
		await expect(toast(page)).toHaveText('자모가 부족합니다');
	});

	test('사전에 없는 열은 가득 차면 빨갛게 표시되고 제출하면 흔들리며 서버에 보내지 않는다', async ({ page, solo, clock }) => {
		const api = await solo({ answers: ['토마토'] });
		await startSolo(page);

		await typeJamo(page, 'ㅋㅋㅋㅋㅋㅋ');
		await expect(page.locator('.board .row').first().locator('.cell.invalid')).toHaveCount(6);
		expect(api.calls.check).toEqual([{ jamo: 'ㅋㅋㅋㅋㅋㅋ' }]);

		await page.keyboard.press('Enter');
		await expect(toast(page)).toHaveText('사전에 없는 단어입니다');
		await expect(rows(page).first()).toHaveClass(/shake/);
		expect(api.calls.guess).toEqual([]);
		await clock.run(400);
		await expect(rows(page).first()).not.toHaveClass(/shake/);

		// 한 글자 지우면 붉은 표시가 풀린다.
		await page.keyboard.press('Backspace');
		await expect(page.locator('.cell.invalid')).toHaveCount(0);
	});

	test('정답을 맞히면 승리 처리되고 통계가 쌓이며 데일리는 통계 창을 연다', async ({ page, solo, clock }) => {
		const api = await solo({ answers: ['토마토'] });
		await startSolo(page);

		await typeJamo(page, 토마토);
		await page.keyboard.press('Enter');

		await expectRowMarks(page, 0, 'cccccc');
		await expect(toast(page)).toHaveText('정답입니다');
		// 승리 판정에는 정답 단어가 실려 와서 reveal을 부르지 않는다.
		expect(api.calls.reveal).toEqual([]);
		await expect(page.getByRole('button', { name: '포기' })).toHaveCount(0);

		await clock.run(1200);
		const stats = page.getByRole('dialog', { name: '통계' });
		await expect(stats).toBeVisible();
		await expect(stats.getByText('정답:')).toBeVisible();
		await expect(stats.locator('.answer b')).toHaveText('토마토');
		expect(await stored(page, 'stats:daily')).toEqual({ played: 1, won: 1, streak: 1, maxStreak: 1, dist: [1] });
	});

	test('포기는 두 번 눌러야 확정되고 정답을 공개하며 패배로 기록한다', async ({ page, solo, clock }) => {
		const api = await solo({ answers: ['토마토'] });
		await startSolo(page);

		await page.getByRole('button', { name: '포기' }).click();
		await expect(page.getByRole('button', { name: '정말 포기?' })).toBeVisible();
		expect(api.calls.reveal).toEqual([]);

		// 3초 안에 다시 누르지 않으면 확인 상태가 풀린다.
		await clock.run(3000);
		await expect(page.getByRole('button', { name: '포기' })).toBeVisible();

		await page.getByRole('button', { name: '포기' }).click();
		await page.getByRole('button', { name: '정말 포기?' }).click();
		await expect(toast(page)).toHaveText('정답: 토마토');
		expect(api.calls.reveal).toEqual([{ token: `tok:${토마토}` }]);
		expect(await stored(page, 'stats:daily')).toEqual({ played: 1, won: 0, streak: 0, maxStreak: 0, dist: [] });
	});

	test('시도 횟수를 다 쓰면 패배하고 정답을 공개하며 랜덤 무한은 다음 단어 버튼을 준다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'endless', length: { kind: 'fixed', n: 6 } }, settings: { maxTries: 4 } });
		const api = await solo({ answers: ['토마토', '바나나'], valid: ['고구마'] });
		await startSolo(page);
		expect(await boardMarks(page)).toHaveLength(4);

		for (let i = 0; i < 4; i++) {
			await typeJamo(page, toJamo('고구마'));
			await page.keyboard.press('Enter');
			await expectRowMarks(page, i, 'acaapp');
		}
		await expect(toast(page)).toHaveText('정답: 토마토');
		expect(api.calls.reveal).toHaveLength(1);

		await page.getByRole('button', { name: '다음 단어' }).click();
		await expect.poll(() => api.calls.game.length).toBe(2);
		expect(await boardText(page)).toEqual(Array(4).fill('......'));
		expect(await stored(page, 'stats:endless')).toEqual({ played: 1, won: 0, streak: 0, maxStreak: 0, dist: [] });
	});

	test('서버에 닿지 않으면 토스트로 알리고 입력은 그대로 남는다', async ({ page, solo }) => {
		const api = await solo({ answers: ['토마토'], valid: ['고구마'] });
		await startSolo(page);
		api.failing.guess = true;

		await typeJamo(page, toJamo('고구마'));
		await page.keyboard.press('Enter');
		await expect(toast(page)).toHaveText('서버에 연결할 수 없습니다');
		expect((await boardText(page))[0]).toBe(toJamo('고구마'));
	});
});
