import type { Page } from '@playwright/test';
import { CHAT_BURST, CHAT_MAX, CHAT_WINDOW_MS } from '../src/lib/mp/rules.ts';
import type { FakeRoom, RoomOptions } from './harness/room.ts';
import { expect, test } from './harness/test.ts';
import { answerOf } from './harness/words.ts';

const log = (page: Page) => page.getByRole('log', { name: '채팅 기록' });
const input = (page: Page) => page.getByRole('textbox', { name: '채팅 메시지' });

async function say(page: Page, text: string) {
	await input(page).fill(text);
	await page.keyboard.press('Enter');
}

test.describe('대기실 채팅 패널', () => {
	test('넓은 화면의 대기실은 참가자 옆에 채팅 패널이 늘 보이고 비어 있으면 안내한다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		await expect(page.getByRole('heading', { name: '채팅' })).toBeVisible();
		await expect(log(page)).toContainText('아직 메시지가 없습니다.');
		// 이 화면에는 하단 바의 채팅 버튼이 없다.
		await expect(page.getByRole('button', { name: '채팅', exact: true })).toHaveCount(0);
	});

	test('Enter와 보내기 버튼으로 보내면 서버가 방송한 줄이 내 메시지로 나타나고 입력칸이 비워진다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();

		await say(page, '안녕하세요');
		expect(await room.nextSent('chat')).toEqual({ type: 'chat', text: '안녕하세요' });
		const mine = log(page).locator('.msg', { hasText: '안녕하세요' });
		await expect(mine).toContainText('테스트유저');
		await expect(mine.locator('.bdg.me')).toHaveText('나');
		await expect(input(page)).toHaveValue('');
		await expect(log(page)).not.toContainText('아직 메시지가 없습니다.');

		await input(page).fill('버튼으로 보내기');
		await page.getByRole('button', { name: '보내기' }).click();
		expect((await room.nextSent('chat', 2)).text).toBe('버튼으로 보내기');
		await expect(log(page)).toContainText('버튼으로 보내기');
	});

	test('공백만 있는 글은 보내지 않는다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		await say(page, '    ');
		await page.getByRole('button', { name: '보내기' }).click();
		expect(room.sentOf('chat')).toEqual([]);
	});

	test('남의 메시지와 입장 전에 오간 기록이 줄로 나타난다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수', '영희'] });
		room.seedChat('영희', '먼저 와 있었어요', room.clock.now - 60_000);
		await room.open();
		await expect(log(page)).toContainText('영희');
		await expect(log(page)).toContainText('먼저 와 있었어요');

		room.say('철수', '반갑습니다');
		const theirs = log(page).locator('.msg', { hasText: '반갑습니다' });
		await expect(theirs).toContainText('철수');
		await expect(theirs.locator('.bdg.me')).toHaveCount(0);
	});

	test('입장·퇴장은 시스템 줄로 남는다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		room.join('민수');
		await expect(log(page).locator('.sys', { hasText: '민수님이 들어왔습니다' })).toBeVisible();
		room.as('민수').send({ type: 'leave' });
		await expect(log(page).locator('.sys', { hasText: '민수님이 나갔습니다' })).toBeVisible();
	});

	test('속도 제한에 걸리면 입력칸 곁에 안내하고 쓴 글을 돌려 놓으며 창이 지나면 다시 보낼 수 있다', async ({ page, openRoom, clock }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();

		for (let i = 1; i <= CHAT_BURST; i++) {
			await say(page, `메시지 ${i}`);
			await room.nextSent('chat', i);
		}
		await expect(log(page)).toContainText(`메시지 ${CHAT_BURST}`);

		await say(page, '너무 빠른 메시지');
		await room.nextSent('chat', CHAT_BURST + 1);
		await expect(page.locator('p.fail')).toHaveText('채팅을 너무 빨리 보내고 있습니다');
		await expect(input(page)).toHaveValue('너무 빠른 메시지');
		await expect(log(page)).not.toContainText('너무 빠른 메시지');

		await clock.run(CHAT_WINDOW_MS);
		await page.getByRole('button', { name: '보내기' }).click();
		await expect(log(page)).toContainText('너무 빠른 메시지');
	});

	test('80자부터 글자 수를 보이고 100자에서 잘라 낸다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		await expect(page.locator('.field .cnt')).toHaveCount(0);

		await input(page).fill('가'.repeat(85));
		await expect(page.locator('.field .cnt')).toHaveText('85/100');

		await input(page).fill('나'.repeat(CHAT_MAX + 20));
		await expect(input(page)).toHaveValue('나'.repeat(CHAT_MAX));
		await expect(page.locator('.field .cnt')).toHaveText('100/100');
		await expect(page.locator('.field .cnt')).toHaveClass(/full/);
	});
});

test.describe('게임 중 채팅 시트', () => {
	async function inGame(page: Page, openRoom: (o?: RoomOptions) => Promise<FakeRoom>): Promise<FakeRoom> {
		const room = await openRoom({ host: true, others: ['철수', '영희'], answer: () => answerOf('바나나') });
		await room.open();
		room.startGame();
		await expect(page.locator('.game-title')).toBeVisible();
		return room;
	}

	test('안 읽은 메시지는 버튼에 개수로 보이고 열면 구분선이 서고 닫으면 읽음 처리된다', async ({ page, openRoom }) => {
		const room = await inGame(page, openRoom);
		const button = page.locator('.tools').getByRole('button', { name: /^채팅/ });
		await expect(button).toHaveAttribute('aria-label', '채팅');

		room.say('철수', '첫 번째');
		room.say('영희', '두 번째');
		room.say('철수', '세 번째');
		await expect(button).toHaveAttribute('aria-label', '채팅, 안 읽은 메시지 3개');
		await expect(button.locator('.cbadge')).toHaveText('3');

		await button.click();
		const sheet = page.getByRole('dialog', { name: '채팅' });
		await expect(sheet.getByRole('separator')).toHaveText('안 읽은 메시지 3개');
		await expect(sheet.getByRole('log')).toContainText('세 번째');

		await page.keyboard.press('Escape');
		await expect(sheet).toHaveCount(0);
		await expect(button).toHaveAttribute('aria-label', '채팅');
		await expect(button).toBeFocused();
	});

	test('시트에서 보낸 글이 방송되고 쓰던 글은 시트를 닫아도 남는다', async ({ page, openRoom }) => {
		const room = await inGame(page, openRoom);
		const button = page.locator('.tools').getByRole('button', { name: /^채팅/ });
		await button.click();
		const sheet = page.getByRole('dialog', { name: '채팅' });
		// 넓은 화면은 열자마자 입력칸에 포커스가 간다.
		await expect(input(page)).toBeFocused();

		await input(page).fill('쓰다 만 글');
		await page.keyboard.press('Escape');
		await button.click();
		await expect(input(page)).toHaveValue('쓰다 만 글');
		await page.keyboard.press('Enter');
		expect(await room.nextSent('chat')).toEqual({ type: 'chat', text: '쓰다 만 글' });
		await expect(sheet.getByRole('log')).toContainText('쓰다 만 글');
		await sheet.getByRole('button', { name: '닫기' }).click();
		await expect(sheet).toHaveCount(0);
	});

	test('채팅이 열려 있는 동안에는 결과 모달을 미루고 닫으면 띄운다', async ({ page, openRoom, clock }) => {
		const room = await inGame(page, openRoom);
		await page.getByRole('button', { name: '포기' }).click();
		await page.getByRole('button', { name: '정말 포기?' }).click();
		await room.nextSent('giveup');
		await page.locator('.tools').getByRole('button', { name: /^채팅/ }).click();
		await expect(page.getByRole('dialog', { name: '채팅' })).toBeVisible();

		// 마지막 사람이 끝나 결과 단계가 되어도 시트 아래에 결과가 열려 키를 가로채지 않게 한다.
		room.as('철수').send({ type: 'giveup' });
		room.as('영희').send({ type: 'giveup' });
		await clock.run(1200);
		await expect(page.getByRole('dialog', { name: '결과' })).toHaveCount(0);

		await page.keyboard.press('Escape');
		await clock.run(1200);
		await expect(page.getByRole('dialog', { name: '결과' })).toBeVisible();
	});

	test('결과 모달에도 채팅 버튼이 있어 시트를 모달 위에 연다', async ({ page, openRoom, clock }) => {
		const room = await inGame(page, openRoom);
		room.as('철수').send({ type: 'giveup' });
		room.as('영희').send({ type: 'giveup' });
		await page.getByRole('button', { name: '포기' }).click();
		await page.getByRole('button', { name: '정말 포기?' }).click();
		await room.nextSent('giveup');
		await clock.run(1200);

		const result = page.getByRole('dialog', { name: '결과' });
		room.say('철수', '수고했어요');
		await result.getByRole('button', { name: /^채팅/ }).click();
		await expect(page.getByRole('dialog', { name: '채팅' }).getByRole('log')).toContainText('수고했어요');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: '채팅' })).toHaveCount(0);
		await expect(result).toBeVisible();
	});
});
