import type { Page } from '@playwright/test';
import { IDLE_WARNING_MS } from '../src/lib/mp/rules.ts';
import type { FakeRoom, RoomOptions } from './harness/room.ts';
import { expect, test } from './harness/test.ts';
import { boardMarks, boardText, expectRowMarks, mpToast, typeJamo } from './harness/ui.ts';
import { answerOf, toJamo, WORD_BY_N } from './harness/words.ts';

// 정답은 바나나(ㅂㅏㄴㅏㄴㅏ). 아바나(ㅇㅏㅂㅏㄴㅏ)는 초록 4·노랑 1·회색 1이다.
const 바나나 = toJamo('바나나');
const 아바나 = toJamo('아바나');

type Fixture = (opts?: RoomOptions) => Promise<FakeRoom>;

/** 내가 방장인 경쟁 방에서 게임을 시작해 게임 화면이 뜰 때까지. */
async function startComp(page: Page, openRoom: Fixture, opts: RoomOptions = {}): Promise<FakeRoom> {
	const room = await openRoom({
		host: true,
		others: ['철수', '영희'],
		answer: (n) => answerOf(n === 6 ? '바나나' : WORD_BY_N[n]),
		...opts
	});
	await room.open();
	room.startGame();
	await expect(page.locator('.game-title')).toBeVisible();
	return room;
}

const opp = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const guess = async (page: Page, jamo: string) => {
	await typeJamo(page, jamo);
	await page.keyboard.press('Enter');
};

test.describe('경쟁 단판', () => {
	test('시작하면 내 보드와 상대 패널이 뜨고 순위표는 아직 없다', async ({ page, openRoom }) => {
		await startComp(page, openRoom);

		await expect(page.locator('.game-title')).toHaveText('꼬들 - 6자');
		await expect(page.locator('.mode-line')).toHaveText('경쟁 · 단판 · 6자');
		expect(await boardMarks(page)).toEqual(Array(6).fill('......'));
		for (const name of ['철수', '영희']) {
			await expect(opp(page, name)).toContainText('풀이 중');
			await expect(opp(page, name).getByRole('img')).toHaveAttribute('aria-label', `${name}: 제출한 행 없음`);
		}
		await expect(page.getByText('현재 순위')).toHaveCount(0);
	});

	test('추측은 서버로 보내고 판정은 서버가 돌려준 값이 칸과 키보드에 나타난다', async ({ page, openRoom }) => {
		const room = await startComp(page, openRoom);

		await guess(page, 아바나);
		expect(await room.nextSent('guess')).toEqual({ type: 'guess', jamo: 아바나 });
		await expectRowMarks(page, 0, 'acpccc');
		expect((await boardText(page))[0]).toBe(아바나);
		await expect(page.getByRole('button', { name: 'ㅂ', exact: true })).toHaveClass(/\bp\b/);
		await expect(page.getByRole('button', { name: 'ㅇ', exact: true })).toHaveClass(/\ba\b/);
	});

	test('상대의 제출은 판정 개수만 보이고 자모는 보이지 않는다', async ({ page, openRoom }) => {
		const room = await startComp(page, openRoom);

		room.as('철수').send({ type: 'guess', jamo: 아바나 });
		await expect(opp(page, '철수').getByRole('img')).toHaveAttribute('aria-label', '철수: 제출한 행 1개, 마지막 행 초록 4칸 노랑 1칸');
		await expect(opp(page, '철수')).not.toContainText('ㅇ');
		await expect(opp(page, '영희')).toContainText('풀이 중');
		// 서버가 내려보내는 상대 패널에는 행의 자모가 없다.
		const theirs = room.snapshot().players.find((p) => p.name === '철수')!;
		expect(JSON.stringify(theirs)).not.toContain('ㅇ');
	});

	test('길이가 모자라면 보내지 않고 사전에 없는 단어는 서버가 거절해 흔들린다', async ({ page, openRoom, clock }) => {
		const room = await startComp(page, openRoom);
		await typeJamo(page, 'ㅋㅋㅋ');
		await page.keyboard.press('Enter');
		await expect(mpToast(page)).toHaveText('자모가 부족합니다');
		expect(room.sentOf('guess')).toEqual([]);

		room.valid = () => false;
		await typeJamo(page, 'ㅋㅋㅋ');
		await page.keyboard.press('Enter');
		await expect(mpToast(page)).toHaveText('사전에 없는 단어입니다');
		await expect(page.locator('.board .row').first()).toHaveClass(/shake/);
		await clock.run(400);
		await expect(page.locator('.board .row').first()).not.toHaveClass(/shake/);
		expect((await boardText(page))[0]).toBe('ㅋㅋㅋㅋㅋㅋ');
		expect(await boardMarks(page)).toEqual(Array(6).fill('......'));
	});

	test('힌트는 노란 자모의 칸을 점선으로 알려 주고 한 번만 쓴다', async ({ page, openRoom }) => {
		const room = await startComp(page, openRoom);
		const hint = page.getByRole('button', { name: '힌트' });

		await hint.click();
		expect(await room.nextSent('hint', 1)).toEqual({ type: 'hint' });
		await expect(mpToast(page)).toHaveText('힌트를 줄 노란 자모가 없습니다');

		await guess(page, 아바나);
		await expectRowMarks(page, 0, 'acpccc');
		await hint.click();
		await expect(page.getByRole('button', { name: '힌트 사용함' })).toBeDisabled();
		await expect(page.locator('.board .row').nth(1).locator('.cell').first()).toHaveClass(/hint/);
		expect((await boardText(page))[1]).toBe('ㅂ.....');
	});

	test('힌트를 끈 방에는 힌트 버튼이 없다', async ({ page, openRoom }) => {
		await startComp(page, openRoom, { settings: { hints: false } });
		await expect(page.getByRole('button', { name: '포기' })).toBeVisible();
		await expect(page.getByRole('button', { name: /힌트/ })).toHaveCount(0);
	});

	test('하드모드 위반은 서버가 거절하고 보드에 행을 넣지 않는다', async ({ page, openRoom }) => {
		await startComp(page, openRoom, { settings: { hard: true } });
		await expect(page.locator('.mode-line')).toHaveText('경쟁 · 단판 · 6자 · 하드');

		await guess(page, toJamo('소나기'));
		await expectRowMarks(page, 0, 'aaccaa');
		await guess(page, toJamo('안경'));
		await expect(mpToast(page)).toHaveText('4번째 칸은 ㅏ입니다');
		expect((await boardMarks(page))[1]).toBe('......');
		expect((await boardText(page))[1]).toBe(toJamo('안경'));
	});

	test('포기는 두 번 눌러 확정하고 끝난 뒤에는 입력이 잠긴다', async ({ page, openRoom }) => {
		const room = await startComp(page, openRoom);
		await page.getByRole('button', { name: '포기' }).click();
		expect(room.sentOf('giveup')).toEqual([]);
		await page.getByRole('button', { name: '정말 포기?' }).click();
		await room.nextSent('giveup');

		await expect(page.locator('.mystate')).toContainText('포기');
		await expect(page.locator('.mystate')).toContainText('다른 사람이 끝나길 기다리는 중입니다.');
		await expect(page.getByRole('button', { name: '포기' })).toHaveCount(0);
		await typeJamo(page, 'ㅋ');
		expect((await boardText(page))[0]).toBe('......');
	});

	test('맞히면 순위를 알리고 잠정 순위표에 풀이 중인 사람을 따로 둔다', async ({ page, openRoom }) => {
		await startComp(page, openRoom);

		await guess(page, 바나나);
		await expectRowMarks(page, 0, 'cccccc');
		await expect(mpToast(page)).toHaveText('정답입니다 · 1위');
		await expect(page.locator('.mystate')).toContainText('완료 1위');
		await expect(page.locator('.mystate')).toContainText('다른 사람이 끝나길 기다리는 중입니다.');

		const standings = page.locator('.ls');
		await expect(standings.getByRole('heading', { name: '현재 순위' })).toBeVisible();
		await expect(standings.locator('.prov')).toHaveText('잠정');
		await expect(standings.locator('.row.mine')).toContainText('1위');
		await expect(standings.locator('.row.mine')).toContainText('1번째 정답');
		await expect(standings.getByText('풀이 중', { exact: true })).toHaveCount(2);
		await expect(standings).toContainText('풀이 중인 사람이 끝나면 순위가 바뀔 수 있습니다.');
	});

	test('시도 횟수를 다 쓰면 실패로 알리고 상대 패널에도 반영된다', async ({ page, openRoom }) => {
		await startComp(page, openRoom, { settings: { tries: 4 } });
		for (let i = 0; i < 4; i++) {
			await guess(page, toJamo('소나기'));
			await expectRowMarks(page, i, 'aaccaa');
		}
		await expect(mpToast(page)).toHaveText('실패했습니다');
		await expect(page.locator('.mystate')).toContainText('실패');
	});

	test('끊긴 상대는 방장이 탈락 처리할 수 있다', async ({ page, openRoom }) => {
		const room = await startComp(page, openRoom);
		room.disconnect('철수');
		await expect(opp(page, '철수')).toContainText('접속 끊김');

		await opp(page, '철수').getByRole('button', { name: /탈락 처리/ }).click();
		const dialog = page.getByRole('dialog', { name: '철수님을 탈락 처리할까요?' });
		await dialog.getByRole('button', { name: '취소' }).click();
		expect(room.sentOf('eliminate')).toEqual([]);

		await opp(page, '철수').getByRole('button', { name: /탈락 처리/ }).click();
		await dialog.getByRole('button', { name: '탈락 처리' }).click();
		expect(await room.nextSent('eliminate')).toEqual({ type: 'eliminate', pid: room.pid('철수') });
		await expect(opp(page, '철수')).toContainText('탈락');
		await expect(opp(page, '철수').getByRole('button', { name: /탈락 처리/ })).toHaveCount(0);
	});

	test('끊긴 채 60초가 지나면 서버가 자동으로 탈락시킨다', async ({ page, openRoom }) => {
		const room = await startComp(page, openRoom);
		room.disconnect('영희');
		await expect(opp(page, '영희')).toContainText('접속 끊김');
		await room.advance(59_000, 'jump');
		await expect(opp(page, '영희')).toContainText('접속 끊김');
		await room.advance(1_000, 'jump');
		await expect(opp(page, '영희')).toContainText('탈락');
	});

	test('게임 중 나가기는 확인을 거쳐 leave를 보낸다', async ({ page, openRoom, openLobby }) => {
		await openLobby();
		const room = await startComp(page, openRoom);

		await page.getByRole('button', { name: '나가기' }).click();
		const dialog = page.getByRole('dialog', { name: '나가면 이번 게임에서 빠집니다.' });
		await dialog.getByRole('button', { name: '취소' }).click();
		await expect(dialog).toHaveCount(0);

		await page.getByRole('button', { name: '나가기' }).click();
		await dialog.getByRole('button', { name: '나가기' }).click();
		await room.nextSent('leave');
		await expect(page.getByRole('heading', { name: '같이 하기' })).toBeVisible();
	});
});

test.describe('경쟁 단판: 시간', () => {
	test('제한 시간이 켜져 있으면 남은 시간이 줄고 30초부터 급한 표시가 된다', async ({ page, openRoom, clock }) => {
		await startComp(page, openRoom, { settings: { timer: true } });
		const clk = page.locator('.clock .clk');
		await expect(clk).toContainText('남은 시간 3:00');
		await expect(clk).not.toHaveClass(/urgent/);

		await clock.run(60_000);
		await expect(clk).toContainText('남은 시간 2:00');
		await clock.jump(90_000);
		await expect(clk).toContainText('남은 시간 0:30');
		await expect(clk).toHaveClass(/urgent/);
	});

	test('제한 시간이 다 되면 서버가 시간 초과로 끝내고 결과가 열린다', async ({ page, openRoom, clock }) => {
		const room = await startComp(page, openRoom, { settings: { timer: true } });
		await room.advance(180_000, 'jump');

		await expect(mpToast(page)).toHaveText('시간이 다 됐습니다');
		await clock.run(1200);
		const result = page.getByRole('dialog', { name: '결과' });
		await expect(result).toContainText('정답: 바나나');
		await expect(result).toContainText('아무도 맞히지 못했습니다');
		await expect(result.getByRole('row').filter({ hasText: '시간 초과' })).toHaveCount(3);
	});

	test('제한 시간이 꺼진 방에는 시계가 없다', async ({ page, openRoom }) => {
		await startComp(page, openRoom);
		await expect(page.locator('.clock')).toHaveCount(0);
	});

	test('입력 없이 60초가 지나면 경고하고 계속하기를 누르거나 입력하면 다시 센다', async ({ page, openRoom, clock }) => {
		await startComp(page, openRoom);
		await clock.jump(IDLE_WARNING_MS - 10_000);
		await typeJamo(page, 'ㅋ');
		await clock.jump(IDLE_WARNING_MS - 10_000);
		await expect(page.getByRole('dialog')).toHaveCount(0);

		await clock.jump(10_000);
		const warn = page.getByRole('dialog', { name: '진행 중입니다' });
		await expect(warn).toContainText('60초 동안 입력이 없었습니다.');
		await warn.getByRole('button', { name: '계속하기' }).click();
		await expect(warn).toHaveCount(0);

		// 계속하기가 타이머를 다시 시작한다.
		await clock.jump(IDLE_WARNING_MS - 1_000);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await clock.jump(1_000);
		await expect(warn).toBeVisible();
	});
});

test.describe('경쟁 단판: 결과', () => {
	async function finishAll(page: Page, room: FakeRoom, clock: { run: (ms: number) => Promise<void> }) {
		await guess(page, 바나나);
		await expect(page.locator('.mystate')).toContainText('완료 1위');
		room.as('철수').send({ type: 'guess', jamo: 아바나 });
		room.as('철수').send({ type: 'giveup' });
		room.as('영희').send({ type: 'giveup' });
		await clock.run(1200);
	}

	test('전원이 끝나면 잠시 뒤 결과 모달이 정답과 순위표를 보여 준다', async ({ page, openRoom, clock }) => {
		const room = await startComp(page, openRoom);
		await finishAll(page, room, clock);

		const result = page.getByRole('dialog', { name: '결과' });
		await expect(result.locator('.ans .big')).toHaveText('정답: 바나나');
		const rows = result.getByRole('row');
		await expect(rows).toHaveCount(4);
		await expect(rows.nth(1)).toContainText('1위');
		await expect(rows.nth(1)).toContainText('테스트유저');
		await expect(rows.nth(1)).toContainText('나');
		await expect(rows.nth(1)).toContainText('1번째 정답');
		await expect(rows.nth(1)).toContainText('1회');
		await expect(result).toContainText('포기');
		await expect(rows.nth(2)).toContainText('철수');
		await expect(rows.nth(2)).toContainText('1회');
	});

	test('방장은 같은 설정으로 한 판 더를 눌러 대기실로 돌아간다', async ({ page, openRoom, clock }) => {
		const room = await startComp(page, openRoom);
		await finishAll(page, room, clock);

		await page.getByRole('dialog', { name: '결과' }).getByRole('button', { name: '같은 설정으로 한 판 더' }).click();
		expect(await room.nextSent('again')).toEqual({ type: 'again' });
		await expect(page.getByRole('heading', { name: '방 코드 ABC 234' })).toBeVisible();
		await expect(page.getByRole('region', { name: '설정 요약' })).toContainText('경쟁');
	});

	test('설정 바꾸기는 대기실로 가서 설정 모달을 바로 연다', async ({ page, openRoom, clock }) => {
		const room = await startComp(page, openRoom);
		await finishAll(page, room, clock);

		await page.getByRole('dialog', { name: '결과' }).getByRole('button', { name: '설정 바꾸기' }).click();
		expect(await room.nextSent('next')).toEqual({ type: 'next' });
		await expect(page.getByRole('dialog', { name: '설정 바꾸기' })).toBeVisible();
	});

	test('참가자는 결과를 닫고 대기실로 가기 전에 방장을 기다린다', async ({ page, openRoom, clock }) => {
		const room = await openRoom({ others: ['철수', '영희'], answer: () => answerOf('바나나') });
		await room.open();
		room.startGame();
		await expect(page.locator('.game-title')).toBeVisible();
		await finishAll(page, room, clock);

		const result = page.getByRole('dialog', { name: '결과' });
		await expect(result.getByText('방장이 다음 게임을 고르는 중입니다.')).toBeVisible();
		await expect(result.getByRole('button', { name: '같은 설정으로 한 판 더' })).toHaveCount(0);
		await result.getByRole('button', { name: '대기실로' }).click();
		await expect(page.getByText('방장이 다음 게임을 고르는 중입니다.').first()).toBeVisible();
		await page.getByRole('button', { name: '결과 보기' }).click();
		// 결과 단계로 다시 들어온 화면은 지연 없이 결과 모달을 연다.
		await clock.run(1);
		await expect(page.getByRole('dialog', { name: '결과' })).toBeVisible();
	});

	test('결과를 닫으면 결과 버튼으로 다시 열 수 있다', async ({ page, openRoom, clock }) => {
		const room = await startComp(page, openRoom);
		await finishAll(page, room, clock);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await page.getByRole('button', { name: '결과', exact: true }).click();
		await expect(page.getByRole('dialog', { name: '결과' })).toBeVisible();
	});
});

test.describe('경쟁 등반', () => {
	const CLIMB = { game: 'climb', length: 11 } as const;

	test('스테이지 띠가 뜨고 클리어한 보드를 2초 보여 준 뒤 다음 스테이지로 넘어간다', async ({ page, openRoom, clock }) => {
		await startComp(page, openRoom, { settings: CLIMB });
		await expect(page.locator('.mode-line')).toHaveText('경쟁 · 등반 · 11자');
		await expect(page.locator('.band')).toContainText('스테이지');
		await expect(page.locator('.band .vl')).toHaveText('1');
		expect((await boardMarks(page))[0]).toHaveLength(11);

		await guess(page, toJamo(WORD_BY_N[11]));
		await expect(mpToast(page)).toHaveText('스테이지 1 클리어');
		// 서버는 이미 다음 스테이지 보드를 보냈지만 클리어한 보드가 약 2초 남는다.
		await expectRowMarks(page, 0, 'c'.repeat(11));
		await expect(page.locator('.band .vl')).toHaveText('1');
		await clock.run(2000);
		await expect(page.locator('.band .vl')).toHaveText('2');
		await expect.poll(async () => (await boardMarks(page))[0]).toBe('.'.repeat(12));
		await expect(page.locator('.game-title')).toHaveText('꼬들 - 11자');
	});

	test('첫 완주자가 나오면 유예 시간이 흐르고 끝나면 서버가 시간 초과로 끝낸다', async ({ page, openRoom, clock }) => {
		const room = await startComp(page, openRoom, { settings: CLIMB });
		room.as('철수').send({ type: 'guess', jamo: toJamo(WORD_BY_N[11]) });
		room.as('철수').send({ type: 'guess', jamo: toJamo(WORD_BY_N[12]) });

		const grace = page.locator('.grace');
		await expect(grace).toContainText('철수님 완주. 남은 시간');
		await expect(grace.locator('.num')).toHaveText('60');
		await clock.run(15_000);
		await expect(grace.locator('.num')).toHaveText('45');
		await clock.run(35_000);
		await expect(grace.locator('.num')).toHaveText('10');
		await expect(grace.locator('.num')).toHaveClass(/urgent/);

		room.as('영희').send({ type: 'giveup' });
		await room.advance(10_000);
		await expect(mpToast(page)).toHaveText('시간이 다 됐습니다');
		await clock.run(1200);
		const result = page.getByRole('dialog', { name: '등반 결과' });
		await expect(result).toBeVisible();
		await expect(result.getByRole('row').nth(1)).toContainText('철수');
		await expect(result.getByRole('row').nth(1)).toContainText('1번째 완주');
		await expect(result.getByRole('img', { name: /등반 단어/ })).toBeVisible();
	});

	test('등반에서 스테이지를 못 넘기면 실패가 아니라 탈락으로 말한다', async ({ page, openRoom }) => {
		await startComp(page, openRoom, { settings: { ...CLIMB, tries: 4 } });
		for (let i = 0; i < 4; i++) {
			await guess(page, 'ㅍ'.repeat(11));
			// 서버가 행을 받아 주기 전의 입력은 막히므로 판정이 온 뒤에 다음 추측을 친다.
			await expectRowMarks(page, i, 'a'.repeat(11));
		}
		await expect(mpToast(page)).toHaveText('탈락했습니다');
		await expect(page.locator('.mystate')).toContainText('탈락');
	});

	test('제한 시간이 켜진 등반은 띠에 남은 시간을 보이고 스테이지마다 줄어든 한도를 준다', async ({ page, openRoom, clock }) => {
		await startComp(page, openRoom, { settings: { ...CLIMB, timer: true } });
		await expect(page.locator('.band .vl').nth(1)).toHaveText('3:00');

		await guess(page, toJamo(WORD_BY_N[11]));
		await expect(mpToast(page)).toHaveText('스테이지 1 클리어');
		// 2스테이지는 15초 줄어든 165초. 클리어 연출 2초 동안은 가득 찬 값에 붙는다.
		await expect(page.locator('.band .vl').nth(1)).toHaveText('2:45');
		await clock.run(2000);
		await expect(page.locator('.band .vl').nth(1)).toHaveText('2:45');
		await clock.run(5000);
		await expect(page.locator('.band .vl').nth(1)).toHaveText('2:40');
	});
});
