import type { Page } from '@playwright/test';
import { summary } from './harness/lobby.ts';
import { seed } from './harness/storage.ts';
import type { FakeRoom, RoomOptions } from './harness/room.ts';
import { expect, test } from './harness/test.ts';
import { expectNoHorizontalOverflow, mpToast, startSolo, typeJamo } from './harness/ui.ts';
import { answerOf, toJamo, WORD_BY_N } from './harness/words.ts';

// 390x844(mobile 프로젝트). 데스크톱과 다르게 그려지는 화면만 본다.
const 아바나 = toJamo('아바나');
const 소나기 = toJamo('소나기');
const answer = (n: number) => answerOf(n === 6 ? '바나나' : WORD_BY_N[n]);

async function started(page: Page, openRoom: (o?: RoomOptions) => Promise<FakeRoom>, opts: RoomOptions = {}): Promise<FakeRoom> {
	const room = await openRoom({ host: true, others: ['철수', '영희'], answer, ...opts });
	await room.open();
	room.startGame();
	await expect(page.locator('.game-title')).toBeVisible();
	return room;
}

test.describe('모바일: 로비와 대기실', () => {
	test('로비는 가로로 넘치지 않고 입장 버튼이 화면 안에 있다', async ({ page, openLobby }) => {
		await seed(page, { 'mp-session': { name: '테스트유저' } });
		await openLobby([summary('HJK234', '철수', { kind: 'coop', game: 'climb', length: 8, hard: true, timer: true, players: 3 })]);
		await page.goto('/');
		await page.getByRole('button', { name: /같이 하기/ }).click();
		const join = page.locator('li.rrow').getByRole('button', { name: /입장/ });
		await expect(join).toBeVisible();
		const box = (await join.boundingBox())!;
		expect(box.x + box.width).toBeLessThanOrEqual(390);
		await expectNoHorizontalOverflow(page);
	});

	test('대기실은 하단 바의 채팅 버튼으로 시트를 열고 열자마자 입력칸에 포커스를 주지 않는다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		await expectNoHorizontalOverflow(page);
		await expect(page.getByRole('heading', { name: '채팅' })).toHaveCount(0);

		room.say('철수', '먼저 보냈어요');
		const bar = page.locator('.action-bar').getByRole('button', { name: /^채팅/ });
		await expect(bar).toHaveAttribute('aria-label', '채팅, 안 읽은 메시지 1개');
		await bar.tap();

		const sheet = page.getByRole('dialog', { name: '채팅' });
		await expect(sheet.getByRole('log')).toContainText('먼저 보냈어요');
		await expect(sheet).toBeFocused();
		await expect(sheet.getByRole('textbox', { name: '채팅 메시지' })).not.toBeFocused();

		await sheet.getByRole('textbox', { name: '채팅 메시지' }).fill('저도 왔어요');
		await sheet.getByRole('button', { name: '보내기' }).tap();
		expect(await room.nextSent('chat')).toEqual({ type: 'chat', text: '저도 왔어요' });
		await sheet.getByRole('button', { name: '닫기' }).tap();
		await expect(sheet).toHaveCount(0);
		await expect(bar).toHaveAttribute('aria-label', '채팅');
	});

	test('방장 화면의 설정 모달과 방장 넘기기 버튼이 화면 안에 들어온다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수', '영희'] });
		await room.open();
		await expectNoHorizontalOverflow(page);
		await page.getByRole('button', { name: '설정 바꾸기' }).tap();
		const dialog = page.getByRole('dialog', { name: '설정 바꾸기' });
		await expect(dialog).toBeVisible();
		const box = (await dialog.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(390);
		await expectNoHorizontalOverflow(page);
	});
});

test.describe('모바일: 경쟁 상대 칩', () => {
	test('상대는 칩으로 보이고 패널은 숨는다', async ({ page, openRoom }) => {
		await started(page, openRoom);
		await expect(page.getByRole('button', { name: /^철수, 풀이 중, 시도 0\/6/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /^영희, 풀이 중/ })).toBeVisible();
		await expect(page.locator('section.opp').first()).toBeHidden();
		await expectNoHorizontalOverflow(page);
	});

	test('칩을 누르면 그 상대의 격자가 펼쳐지고 자판을 눌러도 유지되며 바깥을 누르면 닫힌다', async ({ page, openRoom }) => {
		const room = await started(page, openRoom);
		room.as('철수').send({ type: 'guess', jamo: 아바나 });
		const chip = page.getByRole('button', { name: /^철수, 풀이 중, 시도 1\/6/ });
		await expect(chip).toBeVisible();

		await chip.tap();
		const sheet = page.getByRole('region', { name: '철수 진행 격자' });
		await expect(sheet).toBeVisible();
		await expect(sheet.getByRole('img')).toHaveAttribute('aria-label', '철수: 제출한 행 1개');
		await expect(sheet).toContainText('시도 1/6');
		await expect(chip).toHaveAttribute('aria-expanded', 'true');

		// 자판은 바깥이 아니다. 격자를 펼친 채 입력을 이어 간다.
		await page.getByRole('button', { name: 'ㅂ', exact: true }).tap();
		await expect(sheet).toBeVisible();
		await expect(page.locator('.board .row').first().locator('.cell').first()).toHaveText('ㅂ');

		await page.locator('.game-title').tap();
		await expect(sheet).toHaveCount(0);
		await expect(chip).toHaveAttribute('aria-expanded', 'false');
	});

	test('Esc로 닫으면 포커스가 칩으로 돌아간다', async ({ page, openRoom }) => {
		await started(page, openRoom);
		const chip = page.getByRole('button', { name: /^철수, 풀이 중/ });
		await chip.tap();
		const sheet = page.getByRole('region', { name: '철수 진행 격자' });
		await expect(sheet).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(sheet).toHaveCount(0);
		await expect(chip).toBeFocused();
	});

	test('끊긴 상대는 방장이 펼친 격자에서 탈락 처리한다', async ({ page, openRoom }) => {
		const room = await started(page, openRoom);
		room.disconnect('철수');
		await page.getByRole('button', { name: /^철수, 접속 끊김/ }).tap();
		const sheet = page.getByRole('region', { name: '철수 진행 격자' });
		await sheet.getByRole('button', { name: /탈락 처리/ }).tap();
		await page.getByRole('dialog', { name: '철수님을 탈락 처리할까요?' }).getByRole('button', { name: '탈락 처리' }).tap();
		expect(await room.nextSent('eliminate')).toEqual({ type: 'eliminate', pid: room.pid('철수') });
		await expect(page.getByRole('button', { name: /^철수, 탈락/ })).toBeVisible();
	});

	test('경쟁 등반의 칩은 시도 수 대신 스테이지를 보여 준다', async ({ page, openRoom }) => {
		const room = await started(page, openRoom, { settings: { game: 'climb', length: 11 } });
		room.as('철수').send({ type: 'guess', jamo: toJamo(WORD_BY_N[11]) });
		await expect(page.getByRole('button', { name: /^철수, 풀이 중, 스테이지 2, 시도 0\/6/ })).toBeVisible();
		await expect(page.locator('.band .vl')).toHaveText('1');
		await expectNoHorizontalOverflow(page);
	});

	test('12자 보드와 자판이 화면 폭 안에 들어간다', async ({ page, openRoom }) => {
		await started(page, openRoom, { settings: { length: 12 } });
		const board = (await page.locator('.board').boundingBox())!;
		expect(board.x).toBeGreaterThanOrEqual(0);
		expect(board.x + board.width).toBeLessThanOrEqual(390);
		const kb = (await page.locator('.keyboard').boundingBox())!;
		expect(kb.x + kb.width).toBeLessThanOrEqual(390);
		await expectNoHorizontalOverflow(page);
	});

	test('결과 모달과 순위표가 화면 안에 들어온다', async ({ page, openRoom, clock }) => {
		const room = await started(page, openRoom);
		await typeJamo(page, toJamo('바나나'));
		await page.keyboard.press('Enter');
		await expect(mpToast(page)).toHaveText('정답입니다 · 1위');
		room.as('철수').send({ type: 'giveup' });
		room.as('영희').send({ type: 'giveup' });
		await clock.run(1200);
		const result = page.getByRole('dialog', { name: '결과' });
		await expect(result).toBeVisible();
		const box = (await result.boundingBox())!;
		expect(box.x + box.width).toBeLessThanOrEqual(390);
		await expectNoHorizontalOverflow(page);
	});
});

test.describe('모바일: 협동', () => {
	async function coop(page: Page, openRoom: (o?: RoomOptions) => Promise<FakeRoom>) {
		return started(page, openRoom, { settings: { kind: 'coop' } });
	}

	test('상대 카드는 가로로 스크롤되는 띠로 보인다', async ({ page, openRoom }) => {
		const room = await coop(page, openRoom);
		room.as('철수').send({ type: 'draft', jamo: 'ㅅㅗㄴ' });
		const strip = page.getByRole('region', { name: '상대 진행' });
		await expect(strip).toBeVisible();
		await expect(strip.getByRole('region', { name: '철수', exact: true })).toBeVisible();
		// 좁은 띠에서는 칸 대신 글자로 보인다.
		await expect(strip.getByRole('region', { name: '철수', exact: true }).locator('.prop-t')).toHaveText('ㅅㅗㄴ');
		await expectNoHorizontalOverflow(page);
	});

	test('투표 시트는 화면 아래에 붙고 안의 채팅 버튼과 마감 버튼이 보인다', async ({ page, openRoom }) => {
		const room = await coop(page, openRoom);
		await typeJamo(page, 아바나);
		await page.keyboard.press('Enter');
		await room.nextSent('propose');
		room.as('철수').send({ type: 'propose', jamo: 소나기 });
		await page.getByRole('button', { name: '마감' }).tap();

		const sheet = page.getByRole('dialog', { name: '투표' });
		await expect(sheet).toBeVisible();
		const box = (await sheet.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(390);
		expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
		await expect(sheet.getByRole('button', { name: '투표 마감' })).toBeInViewport();
		await sheet.getByRole('button', { name: '채팅' }).tap();
		await expect(page.getByRole('dialog', { name: '채팅' })).toBeVisible();
		await expectNoHorizontalOverflow(page);
	});

	test('힌트 투표 막대가 화면 폭 안에 들어온다', async ({ page, openRoom }) => {
		const room = await coop(page, openRoom);
		await typeJamo(page, 아바나);
		await page.keyboard.press('Enter');
		await room.nextSent('propose');
		await page.getByRole('button', { name: '마감' }).tap();
		await expect(page.locator('.board .row').first().locator('.cell.p')).toHaveCount(1);
		room.as('철수').send({ type: 'hint' });
		const bar = page.getByRole('region', { name: '힌트 투표' });
		await expect(bar).toBeVisible();
		const box = (await bar.boundingBox())!;
		expect(box.x + box.width).toBeLessThanOrEqual(390);
		await expectNoHorizontalOverflow(page);
	});
});

test.describe('모바일: 솔로', () => {
	test('12자 등반 보드와 자판이 화면 안에 들어가고 버튼이 가려지지 않는다', async ({ page, solo }) => {
		await seed(page, { config: { mode: 'climb-length', length: { kind: 'fixed', n: 12 } } });
		await solo({ answers: ['대한민국'] });
		await startSolo(page);
		await expectNoHorizontalOverflow(page);
		const board = (await page.locator('.board').boundingBox())!;
		expect(board.x + board.width).toBeLessThanOrEqual(390);
		await expect(page.getByRole('button', { name: '포기' })).toBeInViewport();
		await expect(page.getByRole('button', { name: '입력' })).toBeInViewport();
	});
});
