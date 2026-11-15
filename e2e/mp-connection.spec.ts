import type { Page } from '@playwright/test';
import { CLOSE } from '../src/lib/mp/protocol.ts';
import { expect, test } from './harness/test.ts';
import { mpToast } from './harness/ui.ts';
import { answerOf } from './harness/words.ts';

const overlay = (page: Page) => page.getByRole('alertdialog');

test.describe('끊김과 재접속', () => {
	test('소켓이 끊기면 같은 토큰으로 바로 다시 붙고 재접속을 알린다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		await page.getByRole('button', { name: '준비', exact: true }).click();
		await room.nextSent('ready');

		room.dropMe();
		await expect(mpToast(page)).toHaveText('다시 연결되었습니다');
		await expect(overlay(page)).toHaveCount(0);
		expect(room.hellos).toHaveLength(2);
		// 서버가 처음 준 토큰으로 이어 붙는다.
		expect(room.hellos[1]).toEqual({ name: '테스트유저', token: 'tok-me' });
		// 다시 들어오면 서버가 준비를 풀어 둔다.
		await expect(page.getByRole('button', { name: '준비', exact: true })).toBeVisible();
	});

	test('움직임 줄이기를 켜면 재접속 안내가 짧은 문구로 바뀐다', async ({ page, openRoom }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		room.refuse = 1006;
		room.dropMe();
		await expect(overlay(page).getByText('재접속 중…')).toBeVisible();
		await expect(overlay(page).getByText('연결이 끊겼습니다. 다시 연결하는 중…')).toBeHidden();
	});

	test('재접속이 계속 실패하면 안내 오버레이가 뜨고 다시 연결로 돌아올 수 있다', async ({ page, openRoom, clock }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();

		room.refuse = 1006;
		room.dropMe();
		await expect(overlay(page)).toContainText('연결이 끊겼습니다. 다시 연결하는 중…');
		await expect(overlay(page).getByRole('button')).toHaveCount(0);

		// 즉시 한 번, 2초 뒤 한 번 더 시도한 뒤 멈춘다.
		await clock.run(2_000);
		await expect(overlay(page)).toContainText('방에 다시 들어갈 수 없습니다');
		await expect(overlay(page).getByRole('button', { name: '로비로' })).toBeVisible();

		room.refuse = null;
		await overlay(page).getByRole('button', { name: '다시 연결' }).click();
		await expect(overlay(page)).toHaveCount(0);
		await expect(mpToast(page)).toHaveText('다시 연결되었습니다');
		await expect(page.getByRole('heading', { name: '방 코드 ABC 234' })).toBeVisible();
	});

	test('재접속을 포기하고 로비로 나갈 수 있다', async ({ page, openRoom, openLobby, clock }) => {
		await openLobby();
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		room.refuse = 1006;
		room.dropMe();
		// 끊김이 페이지에 닿은 뒤에야 재시도 타이머가 걸리므로 오버레이를 확인하고 시간을 흘린다.
		await expect(overlay(page)).toContainText('연결이 끊겼습니다');
		await clock.run(2_000);
		await overlay(page).getByRole('button', { name: '로비로' }).click();
		await expect(page.getByRole('heading', { name: '같이 하기' })).toBeVisible();
		await expect(overlay(page)).toHaveCount(0);
	});

	test('같은 계정이 다른 탭에서 접속하면 이 탭은 안내만 보이고 다시 붙지 않는다', async ({ page, openRoom, openLobby }) => {
		await openLobby();
		const room = await openRoom({ others: ['철수'] });
		await room.open();

		room.closeMe(CLOSE.REPLACED);
		await expect(overlay(page)).toContainText('다른 탭에서 접속했습니다');
		await expect(overlay(page)).toContainText('이 탭은 더 이상 이 방에 연결되어 있지 않습니다.');
		await expect(overlay(page).getByRole('button', { name: '다시 연결' })).toHaveCount(0);
		expect(room.hellos).toHaveLength(1);
		await overlay(page).getByRole('button', { name: '로비로' }).click();
		await expect(page.getByRole('heading', { name: '같이 하기' })).toBeVisible();
	});

	test('방이 사라지면 없는 방이라고 알리고 로비로 보낸다', async ({ page, openRoom, openLobby }) => {
		await openLobby();
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		room.closeMe(CLOSE.DESTROYED);
		await expect(page.getByRole('alert')).toContainText('없는 방입니다');
		await page.getByRole('button', { name: '로비로' }).click();
		await expect(page.getByRole('heading', { name: '같이 하기' })).toBeVisible();
	});

	test('게임 중 끊겼다가 오래 뒤에 돌아오면 서버가 탈락시킨 상태로 이어진다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수', '영희'], answer: () => answerOf('바나나') });
		await room.open();
		room.startGame();
		await expect(page.locator('.game-title')).toBeVisible();

		room.refuse = 1006;
		room.dropMe();
		await expect(overlay(page)).toContainText('연결이 끊겼습니다');
		// 끊긴 지 60초가 넘으면 서버가 탈락시킨다.
		await room.advance(60_000, 'jump');
		await expect(overlay(page)).toContainText('방에 다시 들어갈 수 없습니다');

		room.refuse = null;
		await overlay(page).getByRole('button', { name: '다시 연결' }).click();
		await expect(page.locator('.mystate')).toContainText('탈락');
		await expect(page.getByRole('region', { name: '철수', exact: true })).toBeVisible();
	});

	// MpGame은 '접속이 끊겨 탈락했습니다'를 띄우고, MultiApp은 같은 스냅샷에서 탈락이 확인되면 '다시 연결되었습니다'를 건너뛴다.
	test('끊김 탈락 토스트가 재접속 토스트에 덮이지 않는다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수', '영희'], answer: () => answerOf('바나나') });
		await room.open();
		room.startGame();
		await expect(page.locator('.game-title')).toBeVisible();
		room.refuse = 1006;
		room.dropMe();
		await expect(overlay(page)).toContainText('연결이 끊겼습니다');
		await room.advance(60_000, 'jump');
		await expect(overlay(page)).toContainText('방에 다시 들어갈 수 없습니다');
		room.refuse = null;
		await overlay(page).getByRole('button', { name: '다시 연결' }).click();
		await expect(mpToast(page)).toHaveText('접속이 끊겨 탈락했습니다', { timeout: 1500 });
	});

	test('끊긴 동안에는 오버레이가 키 입력을 가로채 보드에 글자가 들어가지 않는다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수', '영희'], answer: () => answerOf('바나나') });
		await room.open();
		room.startGame();
		await expect(page.locator('.game-title')).toBeVisible();
		room.refuse = 1006;
		room.dropMe();
		await expect(overlay(page)).toBeVisible();
		await page.keyboard.press('Tab');
		await expect(overlay(page)).toBeFocused();
	});
});
