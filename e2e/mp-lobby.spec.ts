import type { Page } from '@playwright/test';
import { CLOSE } from '../src/lib/mp/protocol.ts';
import { LOBBY_FALLBACK_POLL_MS } from '../src/lib/mp/rules.ts';
import { summary } from './harness/lobby.ts';
import { seed, stored } from './harness/storage.ts';
import { expect, test } from './harness/test.ts';

const NICK = '테스트유저';

test.describe('닉네임', () => {
	test('저장된 이름이 없으면 같이 하기에서 먼저 이름을 묻고 5자 미만은 막는다', async ({ page, openLobby }) => {
		await openLobby();
		await page.goto('/');
		await page.getByRole('button', { name: /같이 하기/ }).click();

		const dialog = page.getByRole('dialog', { name: '닉네임' });
		await expect(dialog).toBeVisible();
		const confirm = dialog.getByRole('button', { name: '확인' });
		await expect(confirm).toBeDisabled();

		await dialog.getByRole('textbox', { name: '닉네임' }).fill('가나다라');
		await expect(dialog.getByText('5자 이상 입력하세요')).toBeVisible();
		await expect(confirm).toBeDisabled();

		await dialog.getByRole('textbox', { name: '닉네임' }).fill(NICK);
		await expect(dialog.getByText('5/12')).toBeVisible();
		await confirm.click();

		await expect(page.getByRole('heading', { name: '같이 하기' })).toBeVisible();
		await expect(page.getByRole('button', { name: `닉네임 수정: ${NICK}` })).toBeVisible();
		// 이름만 저장한다. 토큰은 방을 만들거나 들어갈 때 서버가 준다.
		expect(await stored(page, 'mp-session')).toEqual({ name: NICK });
	});

	test('입력칸은 허용 범위를 알려 주고, 보이지 않는 문자·양방향 제어·결합 문자 4연속·빈칸만은 길이와 상관없이 막는다', async ({ page, openLobby }) => {
		await openLobby();
		await page.goto('/');
		await page.getByRole('button', { name: /같이 하기/ }).click();

		const dialog = page.getByRole('dialog', { name: '닉네임' });
		const input = dialog.getByRole('textbox', { name: '닉네임' });
		const confirm = dialog.getByRole('button', { name: '확인' });
		await expect(input).toHaveAttribute('placeholder', '5~12자, 글자·숫자·기호·이모지');

		for (const bad of ['테스트​유저', '테스트‮유저', '테스트유저́̂̃̄', 'ㅤㅤㅤㅤㅤ', '가​']) {
			await input.fill(bad);
			await expect(dialog.getByRole('status')).toHaveText('쓸 수 없는 닉네임입니다');
			await expect(confirm).toBeDisabled();
		}
		await input.fill('테스트​');
		await expect(dialog.getByText('5자 이상 입력하세요')).toHaveCount(0);

		// 이모지 ZWJ 시퀀스와 결합 문자 3연속은 받는다.
		await input.fill('👨‍👩‍👧곰돌이');
		await expect(dialog.getByRole('status')).toHaveText('');
		await expect(confirm).toBeEnabled();
	});

	test('로비의 이름 수정칸도 같은 안내와 입력 힌트를 쓴다', async ({ page, openLobby }) => {
		await seed(page, { 'mp-session': { name: NICK } });
		await openLobby();
		await page.goto('/');
		await page.getByRole('button', { name: /같이 하기/ }).click();
		await page.getByRole('button', { name: `닉네임 수정: ${NICK}` }).click();

		const input = page.getByRole('textbox', { name: '닉네임' });
		await expect(input).toHaveAttribute('placeholder', '5~12자, 글자·숫자·기호·이모지');
		await input.fill('테스트​유저');
		await expect(page.getByRole('status').filter({ hasText: '쓸 수 없는 닉네임입니다' })).toBeVisible();
		await expect(page.getByRole('button', { name: '확인' })).toBeDisabled();
		await input.fill('가나다라');
		await expect(page.getByText('5자 이상 입력하세요')).toBeVisible();
	});

	test('이름 입력을 취소하면 선택 화면에 남는다', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: /같이 하기/ }).click();
		await page.getByRole('dialog', { name: '닉네임' }).getByRole('button', { name: '취소' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /혼자 하기/ })).toBeVisible();
		expect(await stored(page, 'mp-session')).toBeNull();
	});

	test('저장된 이름이 있으면 묻지 않고 로비로 간다. 이름 수정은 Esc로 되돌릴 수 있다', async ({ page, openLobby }) => {
		await seed(page, { 'mp-session': { name: NICK } });
		await openLobby();
		await page.goto('/');
		await page.getByRole('button', { name: /같이 하기/ }).click();
		await expect(page.getByRole('heading', { name: '같이 하기' })).toBeVisible();
		await expect(page.getByRole('dialog')).toHaveCount(0);

		await page.getByRole('button', { name: `닉네임 수정: ${NICK}` }).click();
		const input = page.getByRole('textbox', { name: '닉네임' });
		await input.fill('바뀐이름이다');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('button', { name: `닉네임 수정: ${NICK}` })).toBeVisible();
	});

	test('임시 계정 지우기는 저장된 이름을 지우고 이름을 다시 입력하게 한다', async ({ page, openLobby }) => {
		await seed(page, { 'mp-session': { name: NICK, token: 'tok-old', exp: Date.parse('2026-12-01T00:00:00Z') } });
		await openLobby();
		await page.goto('/');
		await page.getByRole('button', { name: /같이 하기/ }).click();
		await expect(page.getByRole('button', { name: `닉네임 수정: ${NICK}` })).toBeVisible();

		await page.getByRole('button', { name: '설정' }).click();
		await page.getByRole('dialog', { name: '설정' }).getByRole('button', { name: '임시 계정 지우기' }).click();
		expect(await stored(page, 'mp-session')).toBeNull();
		await expect(page.getByRole('textbox', { name: '닉네임' })).toBeVisible();
		await expect(page.getByRole('button', { name: '방 만들기' })).toBeDisabled();
	});
});

test.describe('로비', () => {
	test.beforeEach(async ({ page }) => {
		await seed(page, { 'mp-session': { name: NICK } });
	});

	const ROOMS = [
		summary('HJK234', '철수', { players: 2 }),
		summary('KLM567', '영희', { kind: 'coop', game: 'climb', players: 3, inProgress: true, length: 8, hard: true, timer: true }),
		summary('NPQ789', '민수', { players: 5 })
	];

	async function openChoice(page: Page) {
		await page.goto('/');
		await page.getByRole('button', { name: /같이 하기/ }).click();
		await expect(page.getByRole('heading', { name: '같이 하기' })).toBeVisible();
	}

	test('방 목록은 소켓이 밀어 준 값으로 그려지고 입장할 수 없는 방은 막힌다', async ({ page, openLobby }) => {
		await openLobby(ROOMS);
		await openChoice(page);

		const list = page.getByRole('region', { name: '방 목록' });
		await expect(page.getByRole('status').filter({ hasText: '공개 방 3' })).toContainText('대기 1 · 진행 중 1 · 가득 1');
		const row = (code: string) => list.locator('li.rrow', { hasText: code });

		await expect(row('HJK234')).toContainText('철수');
		await expect(row('HJK234')).toContainText('2/5');
		await expect(row('HJK234').getByRole('list', { name: '방 설정' })).toHaveText(/경쟁.*단판.*6자.*시도 6회/);
		await expect(row('HJK234').getByRole('button', { name: /입장/ })).toBeEnabled();

		await expect(row('KLM567').getByRole('list', { name: '방 설정' })).toHaveText(/협동.*등반.*8자.*시도 6회.*하드.*제한 시간/);
		await expect(row('KLM567')).toContainText('진행 중');
		await expect(row('KLM567').getByRole('button', { name: /입장/ })).toBeDisabled();
		await expect(row('NPQ789')).toContainText('가득');
		await expect(row('NPQ789').getByRole('button', { name: /입장/ })).toBeDisabled();
	});

	test('목록이 비면 안내하고 푸시가 오면 새로고침 없이 갱신된다', async ({ page, openLobby }) => {
		const lobby = await openLobby([]);
		await openChoice(page);
		await expect(page.getByText('열린 방이 없습니다.')).toBeVisible();

		lobby.pushRooms([summary('HJK234', '철수')]);
		await expect(page.locator('.c-code', { hasText: 'HJK234' })).toBeVisible();
		await expect(page.getByText('열린 방이 없습니다.')).toHaveCount(0);

		lobby.pushRooms([]);
		await expect(page.getByText('열린 방이 없습니다.')).toBeVisible();
	});

	test('소켓이 막히면 15초마다 목록을 직접 불러오고 소켓이 돌아오면 폴링을 멈춘다', async ({ page, openLobby, clock }) => {
		const lobby = await openLobby([]);
		lobby.refuseSocket = true;
		await openChoice(page);
		await expect.poll(() => lobby.polls.rooms).toBe(1);

		// 소켓이 끊긴 것이 페이지에 닿은 뒤에야 폴링 타이머가 걸린다. 한 주기가 지날 때까지 1초씩 흘린다.
		lobby.rooms = [summary('HJK234', '철수')];
		await expect.poll(async () => (await clock.run(1_000), lobby.polls.rooms), { intervals: [20], timeout: 15_000 }).toBeGreaterThanOrEqual(2);
		await expect(page.locator('.c-code', { hasText: 'HJK234' })).toBeVisible();

		// 재연결은 3초부터 두 배씩 늘려 가며 시도한다(최대 60초). 소켓이 열리면 푸시로 바뀌고 폴링은 멈춘다.
		lobby.refuseSocket = false;
		await clock.run(60_000);
		lobby.pushRooms([summary('KLM567', '영희')]);
		await expect(page.locator('.c-code', { hasText: 'KLM567' })).toBeVisible();
		const before = lobby.polls.rooms;
		await clock.run(LOBBY_FALLBACK_POLL_MS * 2);
		expect(lobby.polls.rooms).toBe(before);
	});

	test('뒤로 버튼은 선택 화면으로 돌아간다', async ({ page, openLobby }) => {
		await openLobby([]);
		await openChoice(page);
		await page.getByRole('button', { name: '뒤로' }).click();
		await expect(page.getByRole('button', { name: /혼자 하기/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /같이 하기/ })).toBeVisible();
	});

	test('새로고침 버튼은 목록을 다시 불러온다', async ({ page, openLobby }) => {
		const lobby = await openLobby([]);
		await openChoice(page);
		await expect.poll(() => lobby.polls.rooms).toBe(1);
		await page.getByRole('button', { name: '방 목록 새로고침' }).click();
		await expect.poll(() => lobby.polls.rooms).toBe(2);
	});

	test('목록에서 방을 고르면 그 방의 대기실로 들어간다', async ({ page, openLobby, openRoom }) => {
		await openLobby(ROOMS);
		const room = await openRoom({ code: 'HJK234', name: NICK, others: ['철수'] });
		await openChoice(page);

		await page.locator('li.rrow', { hasText: 'HJK234' }).getByRole('button', { name: /입장/ }).click();
		await room.connected();
		await expect(page.getByRole('heading', { name: '방 코드 HJK 234' })).toBeVisible();
		expect(room.hellos).toEqual([{ name: NICK }]);
		expect(page.url()).toContain('room=HJK234');
	});

	test('방 만들기는 방을 예약하고 받은 세션으로 방장이 되어 들어간다', async ({ page, openLobby, openRoom }) => {
		const lobby = await openLobby([]);
		lobby.nextCode = 'NEW234';
		const room = await openRoom({ code: 'NEW234', name: NICK, host: true });
		await openChoice(page);

		await page.getByRole('button', { name: '방 만들기' }).click();
		await room.connected();
		expect(lobby.created).toEqual([{ name: NICK }]);
		// 서버가 준 토큰을 저장한 뒤 그 토큰으로 hello를 보낸다.
		expect(room.hellos).toEqual([{ name: NICK, token: 'tok-me' }]);
		expect(await stored(page, 'mp-session')).toMatchObject({ name: NICK, token: 'tok-me' });
		await expect(page.getByRole('heading', { name: '방 코드 NEW 234' })).toBeVisible();
		await expect(page.getByRole('button', { name: '설정 바꾸기' })).toBeVisible();
	});

	test('바꾼 이름으로 방을 만든다', async ({ page, openLobby, openRoom }) => {
		const lobby = await openLobby([]);
		const room = await openRoom({ code: 'NEW234', name: '새이름입니다', host: true });
		await openChoice(page);

		await page.getByRole('button', { name: `닉네임 수정: ${NICK}` }).click();
		await page.getByRole('textbox', { name: '닉네임' }).fill('새이름입니다');
		await page.getByRole('button', { name: '확인' }).click();
		await page.getByRole('button', { name: '방 만들기' }).click();
		await room.connected();
		expect(lobby.created).toEqual([{ name: '새이름입니다' }]);
	});

	test('코드로 입장한다: 6자가 차야 버튼이 켜지고 소문자는 대문자로 바뀐다', async ({ page, openLobby, openRoom }) => {
		await openLobby([summary('HJK234', '철수')]);
		const room = await openRoom({ code: 'HJK234', name: NICK, others: ['철수'] });
		await openChoice(page);

		const code = page.getByRole('textbox', { name: '방 코드' });
		const enter = page.getByRole('button', { name: '입장', exact: true });
		await code.fill('hjk23');
		await expect(code).toHaveValue('HJK23');
		await expect(enter).toBeDisabled();
		await code.fill('hjk234');
		await expect(code).toHaveValue('HJK234');
		await enter.click();
		await room.connected();
		await expect(page.getByRole('heading', { name: '방 코드 HJK 234' })).toBeVisible();
	});

	test('없는 방·진행 중인 방·가득 찬 방은 입장 전에 사유를 알려 준다', async ({ page, openLobby }) => {
		await openLobby(ROOMS);
		await openChoice(page);
		const code = page.getByRole('textbox', { name: '방 코드' });
		const enter = page.getByRole('button', { name: '입장', exact: true });
		const msg = page.locator('p.msg');

		await code.fill('ZZZ222');
		await enter.click();
		await expect(msg).toHaveText('없는 방입니다');

		await code.fill('KLM567');
		await expect(msg).toHaveText('');
		await enter.click();
		await expect(msg).toHaveText('진행 중인 방입니다. 게임이 끝나면 들어갈 수 있습니다');

		await code.fill('NPQ789');
		await enter.click();
		await expect(msg).toHaveText('방이 가득 찼습니다');
	});

	test('목록에서 고른 방이 그 사이 가득 차 4001로 닫히면 로비로 돌아와 사유를 보여 준다', async ({ page, openLobby, openRoom }) => {
		await openLobby([summary('HJK234', '철수')]);
		const room = await openRoom({ code: 'HJK234', name: NICK, others: ['철수'] });
		room.refuse = CLOSE.FULL;
		await openChoice(page);

		await page.locator('li.rrow', { hasText: 'HJK234' }).getByRole('button', { name: /입장/ }).click();
		await expect(page.getByRole('heading', { name: '같이 하기' })).toBeVisible();
		await expect(page.locator('p.msg')).toHaveText('방이 가득 찼습니다');
	});

	test('방 만들기가 서버 오류로 실패하면 문구를 보여 준다', async ({ page, openLobby }) => {
		await openLobby([]);
		await page.route('**/api/room', (route) => route.fulfill({ status: 503, body: 'no' }));
		await openChoice(page);
		await page.getByRole('button', { name: '방 만들기' }).click();
		await expect(page.locator('p.msg')).toHaveText('서버에 연결할 수 없습니다');
	});
});

test.describe('초대 링크', () => {
	test('형식이 틀린 코드는 없는 방으로 처리하고 로비로 보낸다', async ({ page, openLobby }) => {
		await seed(page, { 'mp-session': { name: NICK } });
		await openLobby();
		await page.goto('/?room=OOOOO0');
		await expect(page.getByRole('alert')).toContainText('없는 방입니다');
		await page.getByRole('button', { name: '로비로' }).click();
		await expect(page.getByRole('heading', { name: '같이 하기' })).toBeVisible();
		expect(page.url()).not.toContain('room=');
	});

	test('이름이 없으면 링크로 와도 이름을 먼저 묻고, 없는 방이면 모달에서 알려 준다', async ({ page, openLobby }) => {
		await openLobby([]);
		await page.goto('/?room=HJK234');
		const dialog = page.getByRole('dialog', { name: '닉네임' });
		await expect(dialog).toContainText('방 HJK234에 들어갈 이름을 정하세요.');
		await dialog.getByRole('textbox', { name: '닉네임' }).fill(NICK);
		await dialog.getByRole('button', { name: '입장' }).click();
		await expect(dialog.getByRole('status')).toHaveText('없는 방입니다');
	});

	test('이름을 넣으면 방에 들어가고 이름이 저장된다', async ({ page, openLobby, openRoom }) => {
		await openLobby([summary('HJK234', '철수')]);
		const room = await openRoom({ code: 'HJK234', name: NICK, others: ['철수'] });
		await page.goto('/?room=HJK234');

		const dialog = page.getByRole('dialog', { name: '닉네임' });
		await dialog.getByRole('textbox', { name: '닉네임' }).fill(NICK);
		await dialog.getByRole('button', { name: '입장' }).click();
		await room.connected();
		await expect(page.getByRole('heading', { name: '방 코드 HJK 234' })).toBeVisible();
		expect(await stored(page, 'mp-session')).toMatchObject({ name: NICK, token: 'tok-me' });
	});

	test('저장된 이름이 지금 규칙에 걸려 서버가 1008로 거절하면 오류 화면에 사유를 보인다', async ({ page, openRoom }) => {
		const room = await openRoom({ code: 'HJK234', name: '테스트​유저', others: ['철수'] });
		await room.enter();
		await expect(page.getByRole('alert')).toContainText('쓸 수 없는 닉네임입니다');
		expect(room.hellos.map((h) => h.name)).toEqual(['테스트​유저']);
	});

	test('링크로 들어간 방이 가득 차 있으면 로비가 아니라 오류 화면으로 간다', async ({ page, openRoom }) => {
		const room = await openRoom({ code: 'HJK234', name: NICK, others: ['가나', '다라', '마바', '사아', '자차'] });
		await room.enter();
		await expect(page.getByRole('alert')).toContainText('방이 가득 찼습니다');
	});

	test('링크로 들어간 방이 이미 시작했으면 안내한다', async ({ page, openRoom }) => {
		const room = await openRoom({ code: 'HJK234', name: NICK, others: ['철수', '영희'] });
		room.state.phase = 'playing';
		await room.enter();
		await expect(page.getByRole('alert')).toContainText('진행 중인 방입니다');
	});

	test('방이 없으면(4004) 없는 방으로 알린다', async ({ page, openRoom }) => {
		const room = await openRoom({ code: 'HJK234', name: NICK, others: ['철수'] });
		room.refuse = CLOSE.NO_ROOM;
		await room.enter();
		await expect(page.getByRole('alert')).toContainText('없는 방입니다');
	});

	test('링크로 들어가면 닉네임 모달도 로비도 거치지 않고 바로 대기실이다', async ({ page, openRoom }) => {
		const room = await openRoom({ code: 'HJK234', name: NICK, others: ['철수'] });
		await room.enter();
		await room.connected();
		await expect(page.getByRole('heading', { name: '방 코드 HJK 234' })).toBeVisible();
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});
});
