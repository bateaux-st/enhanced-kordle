import type { Page } from '@playwright/test';
import type { FakeRoom, RoomOptions } from './harness/room.ts';
import { expect, test } from './harness/test.ts';
import { typeJamo } from './harness/ui.ts';
import { answerOf, toJamo, WORD_BY_N } from './harness/words.ts';

const answers = (n: number) => answerOf(n === 6 ? '바나나' : WORD_BY_N[n]);

async function started(page: Page, openRoom: (o?: RoomOptions) => Promise<FakeRoom>, opts: RoomOptions = {}): Promise<FakeRoom> {
	const room = await openRoom({ host: true, others: ['철수', '영희'], answer: answers, ...opts });
	await room.open();
	room.startGame();
	await expect(page.locator('.game-title')).toBeVisible();
	return room;
}

const submit = async (page: Page, jamo: string) => {
	await typeJamo(page, jamo);
	await page.keyboard.press('Enter');
};

test.describe('경쟁 결과 화면', () => {
	test('순위가 같은 미완주자는 공동 순위로 묶인다', async ({ page, openRoom, clock }) => {
		const room = await started(page, openRoom);
		await submit(page, toJamo('바나나'));
		await expect(page.locator('.mystate')).toContainText('완료 1위');
		room.as('철수').send({ type: 'giveup' });
		room.as('영희').send({ type: 'giveup' });
		await clock.run(1200);

		const rows = page.getByRole('dialog', { name: '결과' }).getByRole('row');
		await expect(rows.nth(1)).toContainText('1위');
		await expect(rows.nth(2)).toContainText('공동 2위');
		await expect(rows.nth(3)).toContainText('공동 2위');
		await expect(rows.nth(2)).toContainText('포기');
	});

	test('게임 중 나간 사람도 순위표에 탈락으로 남는다', async ({ page, openRoom, clock }) => {
		const room = await started(page, openRoom);
		room.as('철수').send({ type: 'leave' });
		await submit(page, toJamo('바나나'));
		await expect(page.locator('.mystate')).toContainText('완료 1위');
		room.as('영희').send({ type: 'giveup' });
		await clock.run(1200);

		const result = page.getByRole('dialog', { name: '결과' });
		await expect(result.getByRole('row').filter({ hasText: '철수' })).toContainText('탈락');
		await expect(result.getByRole('row')).toHaveCount(4);
	});

	test('아무도 못 맞히면 정답과 함께 알린다', async ({ page, openRoom, clock }) => {
		const room = await started(page, openRoom);
		room.as('철수').send({ type: 'giveup' });
		room.as('영희').send({ type: 'giveup' });
		await page.getByRole('button', { name: '포기' }).click();
		await page.getByRole('button', { name: '정말 포기?' }).click();
		await clock.run(1200);
		const result = page.getByRole('dialog', { name: '결과' });
		await expect(result).toContainText('정답: 바나나');
		await expect(result).toContainText('아무도 맞히지 못했습니다');
	});
});

test.describe('경쟁 등반 결과 화면', () => {
	test('높이 열과 피라미드를 보여 주고 끝까지 오르면 멈춘 정답은 없다', async ({ page, openRoom, clock }) => {
		const room = await started(page, openRoom, { settings: { game: 'climb', length: 11 } });
		room.as('철수').send({ type: 'guess', jamo: toJamo(WORD_BY_N[11]) });
		await submit(page, toJamo(WORD_BY_N[11]));
		await clock.run(2000);
		await expect(page.locator('.band .vl')).toHaveText('2');
		await submit(page, toJamo(WORD_BY_N[12]));
		await expect(page.locator('.mystate')).toContainText('완료 1위');
		room.as('철수').send({ type: 'giveup' });
		room.as('영희').send({ type: 'giveup' });
		await clock.run(1200);

		const result = page.getByRole('dialog', { name: '등반 결과' });
		await expect(result.getByRole('columnheader')).toHaveText(['순위', '이름', '결과', '높이', '시도']);
		const rows = result.getByRole('row');
		await expect(rows.nth(1)).toContainText('1번째 완주');
		await expect(rows.nth(1)).toContainText('2');
		await expect(rows.nth(2)).toContainText('철수');
		await expect(result.getByRole('img', { name: /등반 단어/ })).toHaveAttribute('aria-label', `등반 단어: ${WORD_BY_N[11]}, ${WORD_BY_N[12]}`);
		await expect(result.locator('.stopped')).toHaveCount(0);
	});

	test('끝까지 오른 사람이 없으면 가장 높이 오른 사람이 못 넘은 스테이지의 정답을 보여 준다', async ({ page, openRoom, clock }) => {
		const room = await started(page, openRoom, { settings: { game: 'climb', length: 11 } });
		room.as('철수').send({ type: 'guess', jamo: toJamo(WORD_BY_N[11]) });
		room.as('철수').send({ type: 'giveup' });
		room.as('영희').send({ type: 'giveup' });
		await page.getByRole('button', { name: '포기' }).click();
		await page.getByRole('button', { name: '정말 포기?' }).click();
		await clock.run(1200);

		const result = page.getByRole('dialog', { name: '등반 결과' });
		await expect(result.locator('.stopped')).toHaveText(`멈춘 곳의 정답: ${WORD_BY_N[12]}`);
		await expect(result.getByRole('img', { name: /등반 단어/ })).toHaveAttribute('aria-label', `등반 단어: ${WORD_BY_N[11]}`);
	});
});

test.describe('결과 중에 들어온 사람', () => {
	test('이번 판 참가자가 아니면 결과 대신 대기실을 보고 준비할 수 있다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수', '영희'], answer: answers });
		room.startGame();
		room.as('철수').send({ type: 'giveup' });
		room.as('영희').send({ type: 'giveup' });
		expect(room.state.phase).toBe('result');

		await room.open();
		await expect(page.getByRole('heading', { name: '방 코드 ABC 234' })).toBeVisible();
		await expect(page.getByText('방장이 다음 게임을 고르는 중입니다.')).toBeVisible();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByRole('button', { name: '준비', exact: true })).toBeVisible();
	});

	test('방장을 넘겨받았다면 다음 게임을 고르는 화면이 열린다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수', '영희'], answer: answers });
		room.startGame();
		room.as('철수').send({ type: 'giveup' });
		room.as('영희').send({ type: 'giveup' });
		room.disconnect('영희');
		await room.open();
		await expect(page.getByText('방장이 다음 게임을 고르는 중입니다.')).toBeVisible();

		room.as('철수').send({ type: 'leave' });
		await expect(page.getByText('다음 게임을 골라 주세요.')).toBeVisible();
		await page.getByRole('button', { name: '같은 설정으로 한 판 더' }).click();
		expect(await room.nextSent('again')).toEqual({ type: 'again' });
		await expect(page.getByRole('heading', { name: '방 코드 ABC 234' })).toBeVisible();
	});
});
