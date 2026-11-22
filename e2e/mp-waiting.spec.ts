import type { Page } from '@playwright/test';
import { NUDGE_COOLDOWN_MS } from '../src/lib/mp/rules.ts';
import { summary } from './harness/lobby.ts';
import { expect, test } from './harness/test.ts';
import { mpToast } from './harness/ui.ts';

const row = (page: Page, name: string) => page.locator('li.member', { hasText: name });

test.describe('대기실: 참가자', () => {
	test('방 코드·참가자·방장·나 표시와 빈 자리를 보여 준다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수', '영희'], ready: ['영희'] });
		await room.open();

		await expect(page.getByRole('heading', { name: '방 코드 ABC 234' })).toBeVisible();
		await expect(page.locator('.cnt')).toHaveText(/3\/5/);
		await expect(row(page, '철수')).toContainText('방장');
		await expect(row(page, '철수')).not.toContainText('준비');
		await expect(row(page, '영희')).toContainText('준비 완료');
		await expect(row(page, '테스트유저')).toContainText('나');
		await expect(row(page, '테스트유저')).toContainText('준비 전');
		await expect(page.locator('li.member.empty')).toHaveCount(2);
		await expect(page.getByText('링크나 코드를 보내 친구를 부르세요.')).toBeVisible();
		await expect(page.getByRole('region', { name: '설정 요약' })).toContainText('경쟁');
	});

	test('정원이 차면 가득 표시가 뜬다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['가나', '다라', '마바'] });
		await room.open();
		await expect(page.locator('.bdg.fullb')).toHaveCount(0);
		room.join('사아');
		await expect(page.locator('.bdg.fullb')).toHaveText('가득');
		await expect(page.locator('.cnt')).toHaveText(/5\/5/);
	});

	test('들어오고 나가는 사람을 토스트로 알리고 접속이 끊긴 사람은 따로 표시한다', async ({ page, openRoom, clock }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();

		room.join('민수');
		await expect(mpToast(page)).toHaveText('민수님이 들어왔습니다');
		await expect(row(page, '민수')).toContainText('준비 전');

		room.disconnect('민수');
		await expect(row(page, '민수')).toContainText('접속 끊김');

		room.as('민수').send({ type: 'leave' });
		await expect(mpToast(page)).toHaveText('민수님이 나갔습니다');
		// 나간 자리는 접히는 동안(450ms) 남아 있다.
		await expect(page.locator('li.member.a-collapse')).toHaveCount(1);
		await clock.run(450);
		await expect(row(page, '민수')).toHaveCount(0);
	});

	test('링크 복사는 초대 링크를 클립보드에 넣는다', async ({ page, context, openRoom }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		const room = await openRoom({ others: ['철수'] });
		await room.open();

		await page.getByRole('button', { name: '링크 복사' }).click();
		await expect(mpToast(page)).toHaveText('링크를 복사했습니다');
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://localhost:4789/?room=ABC234');
	});

	test('나가기는 leave를 보내고 로비로 돌아간다', async ({ page, openRoom, openLobby }) => {
		const lobby = await openLobby([summary('ABC234', '철수')]);
		const room = await openRoom({ others: ['철수'] });
		await room.open();

		await page.getByRole('button', { name: '나가기' }).click();
		await room.nextSent('leave');
		await expect(page.getByRole('heading', { name: '같이 하기' })).toBeVisible();
		expect(lobby.polls.rooms).toBeGreaterThan(0);
		expect(page.url()).not.toContain('room=');
	});
});

test.describe('방 안 설정', () => {
	test('테마는 바꿀 수 있고 임시 계정 지우기는 방 밖에서만 보인다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();

		await page.getByRole('button', { name: '설정', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: '설정' });
		await expect(dialog.getByRole('button', { name: '임시 계정 지우기' })).toHaveCount(0);
		await dialog.getByRole('button', { name: '다크' }).click();
		expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
		await expect(dialog.getByRole('switch', { name: /재촉 소리/ })).toHaveAttribute('aria-checked', 'true');
		await dialog.getByRole('switch', { name: /재촉 소리/ }).click();
		await expect(dialog.getByRole('switch', { name: /재촉 소리/ })).toHaveAttribute('aria-checked', 'false');
	});
});

test.describe('대기실: 참가자 입장에서', () => {
	test('준비와 준비 취소를 서버에 보내고 확정은 서버 스냅샷을 따른다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();

		await page.getByRole('button', { name: '준비', exact: true }).click();
		expect(await room.nextSent('ready')).toEqual({ type: 'ready', on: true });
		await expect(page.getByRole('button', { name: '준비 취소' })).toBeVisible();
		await expect(row(page, '테스트유저')).toContainText('준비 완료');
		await expect(page.getByText('방장이 시작하길 기다리는 중')).toBeVisible();

		await page.getByRole('button', { name: '준비 취소' }).click();
		expect((await room.nextSent('ready', 2)).on).toBe(false);
		await expect(page.getByRole('button', { name: '준비', exact: true })).toBeVisible();
	});

	test('참가자에게는 설정 바꾸기가 없고 방장이 설정을 바꾸면 준비가 풀렸다고 알린다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		await expect(page.getByRole('button', { name: '설정 바꾸기' })).toHaveCount(0);

		await page.getByRole('button', { name: '준비', exact: true }).click();
		await expect(row(page, '테스트유저')).toContainText('준비 완료');
		room.as('철수').send({ type: 'settings', settings: { ...room.state.settings, hard: true } });

		await expect(mpToast(page)).toHaveText('방장이 설정을 바꿔 준비가 풀렸습니다');
		await expect(row(page, '테스트유저')).toContainText('준비 전');
		await expect(page.getByRole('region', { name: '설정 요약' }).getByText('하드모드')).toBeVisible();
		await expect(page.getByRole('region', { name: '설정 요약' }).locator('div', { hasText: '하드모드' }).last()).toContainText('켬');
	});

	test('방장이 시작하면 게임 화면으로 바뀐다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		await page.getByRole('button', { name: '준비', exact: true }).click();
		await room.nextSent('ready');

		room.as('철수').send({ type: 'start' });
		await expect(page.getByRole('heading', { name: '꼬들 - 6자' })).toBeVisible();
		await expect(page.locator('.mode-line')).toContainText('경쟁 · 단판 · 6자');
	});

	test('준비한 참가자는 방장을 재촉할 수 있고 30초 동안 다시 누를 수 없다', async ({ page, openRoom, clock }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		const bell = page.getByRole('button', { name: '방장 재촉' });
		await expect(bell).toHaveCount(0);

		await page.getByRole('button', { name: '준비', exact: true }).click();
		await expect(bell).toBeEnabled();
		await bell.click();
		await room.nextSent('nudge');
		await expect(mpToast(page)).toHaveText('재촉했습니다');
		await expect(page.locator('.ntop.prev')).toContainText('테스트유저님이 재촉합니다!');
		await expect(bell).toBeDisabled();
		await expect(page.locator('.cdbadge')).toHaveText('30');

		await clock.run(NUDGE_COOLDOWN_MS - 10_000);
		await expect(page.locator('.cdbadge')).toHaveText('10');
		await clock.run(10_000);
		await expect(bell).toBeEnabled();
		await expect(page.locator('.cdbadge')).toHaveCount(0);
	});

	test('방장이 끊겨 있으면 재촉이 거절되고 로컬 쿨다운이 풀려 다시 누를 수 있다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		await page.getByRole('button', { name: '준비', exact: true }).click();
		room.disconnect('철수');
		const bell = page.getByRole('button', { name: '방장 재촉' });
		await expect(bell).toBeEnabled();
		await bell.click();
		await room.nextSent('nudge');
		await expect(mpToast(page)).toHaveText('방장이 접속 중이어야 합니다');
		await expect(bell).toBeEnabled();
		await expect(page.locator('.cdbadge')).toHaveCount(0);

		room.reconnect('철수');
		await bell.click();
		await expect(bell).toBeDisabled();
		await expect(page.locator('.cdbadge')).toHaveText('30');
	});

	test('새로고침으로 로컬 쿨다운을 잃어도 서버가 알려 준 남은 초에 맞춘다', async ({ page, openRoom, clock }) => {
		const room = await openRoom({ others: ['철수'] });
		await room.open();
		await page.getByRole('button', { name: '준비', exact: true }).click();
		await expect(page.getByRole('button', { name: '방장 재촉' })).toBeEnabled();
		// 서버 기록상 3초 전에 이미 재촉했다.
		room.state.players.find((p) => p.pid === room.me)!.nudgedAt = clock.now - 3_000;

		await page.getByRole('button', { name: '방장 재촉' }).click();
		await expect(page.locator('.cdbadge')).toHaveText('27');
	});
});

test.describe('대기실: 방장 입장에서', () => {
	test('혼자·준비 대기·전원 준비에 따라 시작 버튼과 이유가 바뀐다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true });
		await room.open();
		const start = page.getByRole('button', { name: '시작', exact: true });
		await expect(start).toBeDisabled();
		await expect(page.getByText('혼자서는 시작할 수 없습니다')).toBeVisible();

		room.join('철수');
		room.join('영희');
		await expect(page.getByText('2명 대기 중')).toBeVisible();
		room.as('철수').send({ type: 'ready', on: true });
		await expect(page.getByText('1명 대기 중')).toBeVisible();
		room.as('영희').send({ type: 'ready', on: true });
		await expect(start).toBeEnabled();
		await expect(page.getByText('명 대기 중')).toHaveCount(0);
	});

	test('시작하면 start를 보내고 게임 화면으로 넘어간다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수'], ready: ['철수'] });
		await room.open();

		await page.getByRole('button', { name: '시작', exact: true }).click();
		expect(await room.nextSent('start')).toEqual({ type: 'start', kickDisconnected: false });
		await expect(page.getByRole('heading', { name: '꼬들 - 6자' })).toBeVisible();
	});

	test('끊긴 사람이 있으면 내보내고 시작하는 것이 시작 버튼이다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수', '영희'], ready: ['철수', '영희'] });
		await room.open();
		room.disconnect('영희');

		const start = page.getByRole('button', { name: '영희 내보내고 시작' });
		await expect(start).toBeEnabled();
		await start.click();
		expect(await room.nextSent('start')).toEqual({ type: 'start', kickDisconnected: true });
		await expect(page.getByRole('heading', { name: '꼬들 - 6자' })).toBeVisible();
	});

	test('참가자의 재촉은 방장 화면에 뜨고 지금 시작으로 바로 시작할 수 있다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수'], ready: ['철수'] });
		await room.open();

		room.as('철수').send({ type: 'nudge' });
		await expect(page.getByText('철수님이 재촉합니다!').first()).toBeVisible();
		await expect(page.locator('.nbadge')).toHaveText('재촉 1회');
		await page.getByRole('button', { name: '지금 시작' }).click();
		expect(await room.nextSent('start')).toMatchObject({ type: 'start' });
		await expect(page.getByRole('heading', { name: '꼬들 - 6자' })).toBeVisible();
	});

	test('설정 모달에서 종류·게임·길이·시도·토글을 바꾸면 settings가 서버로 가고 요약이 바뀐다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수'], ready: ['철수'] });
		await room.open();
		await page.getByRole('button', { name: '설정 바꾸기' }).click();
		const dialog = page.getByRole('dialog', { name: '설정 바꾸기' });
		const summaryRegion = page.getByRole('region', { name: '설정 요약' });

		await dialog.getByRole('button', { name: /^협동/ }).click();
		expect((await room.nextSent('settings')).settings).toMatchObject({ kind: 'coop', pick: 'vote' });
		await expect(summaryRegion).toContainText('협동');
		await expect(dialog.getByText('선택 방식')).toBeVisible();
		await dialog.getByRole('button', { name: /^돌림판/ }).click();
		await expect(summaryRegion).toContainText('돌림판');

		await dialog.getByRole('button', { name: /^등반/ }).click();
		await expect(dialog.getByText('시작 길이', { exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: '다음 길이' }).click();
		await expect(dialog.getByRole('status', { name: '시작 길이' })).toHaveText('7자');
		await dialog.getByRole('button', { name: '시도 횟수 늘리기' }).click();
		await expect(dialog.getByRole('status', { name: '시도 횟수' })).toHaveText('7회');
		await dialog.getByRole('switch', { name: /하드모드/ }).click();
		await dialog.getByRole('switch', { name: /제한 시간/ }).click();
		await dialog.getByRole('switch', { name: /^힌트/ }).click();

		await expect.poll(() => room.state.settings).toEqual({ kind: 'coop', game: 'climb', length: 7, tries: 7, hard: true, hints: false, timer: true, pick: 'roulette' });
		await expect(dialog.getByRole('switch', { name: /하드모드/ })).toHaveAttribute('aria-checked', 'true');
		// 설정이 바뀌면 준비가 풀린다.
		await expect(row(page, '철수')).toContainText('준비 전');
		await dialog.locator('.dlg-ft').getByRole('button', { name: '닫기' }).click();
		await expect(dialog).toHaveCount(0);
	});

	test('설정 바꾸기는 모두의 준비를 풀고 길이 범위 끝에서 버튼이 막힌다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수'], ready: ['철수'], settings: { length: 12 } });
		await room.open();
		await expect(row(page, '철수')).toContainText('준비 완료');
		await page.getByRole('button', { name: '설정 바꾸기' }).click();
		const dialog = page.getByRole('dialog', { name: '설정 바꾸기' });
		await expect(dialog.getByRole('button', { name: '다음 길이' })).toBeDisabled();
		await dialog.getByRole('button', { name: '이전 길이' }).click();
		await expect(row(page, '철수')).toContainText('준비 전');
	});

	test('방장 넘기기는 확인한 뒤에만 보내고 넘기면 방장 기능이 사라진다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수', '영희'] });
		await room.open();

		await page.getByRole('button', { name: '철수님에게 방장 넘기기' }).click();
		const dialog = page.getByRole('dialog', { name: '방장을 넘길까요?' });
		await expect(dialog).toContainText('철수님이 방장이 됩니다.');
		await dialog.getByRole('button', { name: '취소' }).click();
		await expect(dialog).toHaveCount(0);
		expect(room.sentOf('transfer')).toEqual([]);

		await page.getByRole('button', { name: '철수님에게 방장 넘기기' }).click();
		await dialog.getByRole('button', { name: '넘기기' }).click();
		expect(await room.nextSent('transfer')).toEqual({ type: 'transfer', pid: room.pid('철수') });
		await expect(mpToast(page)).toHaveText('철수님이 방장이 되었습니다');
		await expect(page.getByRole('button', { name: '설정 바꾸기' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: '준비', exact: true })).toBeVisible();
		await expect(row(page, '철수')).toContainText('방장');
	});

	test('끊긴 참가자에게는 방장 넘기기가 없다', async ({ page, openRoom }) => {
		const room = await openRoom({ host: true, others: ['철수', '영희'] });
		await room.open();
		room.disconnect('영희');
		await expect(row(page, '영희')).toContainText('접속 끊김');
		await expect(page.getByRole('button', { name: '영희님에게 방장 넘기기' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: '철수님에게 방장 넘기기' })).toBeVisible();
	});

	test('방장이 나가면 남은 사람에게 방장이 승계된다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수', '영희'] });
		await room.open();
		room.as('철수').send({ type: 'leave' });
		// 승계와 퇴장이 한 스냅샷에 같이 오므로 토스트는 마지막 것만 남고, 둘 다 채팅 기록에 줄로 남는다.
		await expect(page.getByRole('log', { name: '채팅 기록' })).toContainText('영희님이 방장이 되었습니다');
		await expect(page.getByRole('log', { name: '채팅 기록' })).toContainText('철수님이 나갔습니다');
		await expect(row(page, '영희')).toContainText('방장');
	});
});
