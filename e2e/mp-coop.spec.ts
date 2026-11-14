import type { Page } from '@playwright/test';
import { HINT_VOTE_MS, VOTE_MS } from '../src/lib/mp/rules.ts';
import type { FakeRoom, RoomOptions } from './harness/room.ts';
import { expect, test } from './harness/test.ts';
import { boardMarks, boardText, expectRowMarks, mpToast, typeJamo } from './harness/ui.ts';
import { answerOf, toJamo, WORD_BY_N } from './harness/words.ts';

// 정답은 바나나(ㅂㅏㄴㅏㄴㅏ). 아바나는 초록 4·노랑 1·회색 1, 소나기는 초록 2·회색 4.
const 바나나 = toJamo('바나나');
const 아바나 = toJamo('아바나');
const 소나기 = toJamo('소나기');

async function startCoop(page: Page, openRoom: (o?: RoomOptions) => Promise<FakeRoom>, opts: RoomOptions = {}): Promise<FakeRoom> {
	const room = await openRoom({
		host: true,
		others: ['철수', '영희'],
		answer: (n) => answerOf(n === 6 ? '바나나' : WORD_BY_N[n]),
		...opts,
		settings: { kind: 'coop', ...opts.settings }
	});
	await room.open();
	room.startGame();
	await expect(page.locator('.game-title')).toBeVisible();
	return room;
}

const card = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const propose = async (page: Page, jamo: string) => {
	await typeJamo(page, jamo);
	await page.keyboard.press('Enter');
};
const vote = (page: Page) => page.getByRole('dialog', { name: '투표' });

test.describe('협동: 제안', () => {
	test('시작하면 공유 보드와 사람별 카드가 뜨고 마감은 제안이 생길 때까지 막힌다', async ({ page, openRoom }) => {
		await startCoop(page, openRoom);

		await expect(page.locator('.mode-line')).toHaveText('협동 · 단판 · 6자');
		expect(await boardMarks(page)).toEqual(Array(6).fill('......'));
		await expect(card(page, '철수')).toBeVisible();
		await expect(card(page, '영희')).toBeVisible();
		await expect(page.getByRole('button', { name: '마감' })).toBeDisabled();
		await expect(page.getByRole('button', { name: '패스', exact: true })).toBeEnabled();
		await expect(page.getByRole('button', { name: '포기' })).toBeVisible();
		await expect(page.locator('.progress .sr')).toHaveText('제안 0/3');
	});

	test('입력 중인 글자는 300ms 뒤에 초안으로 보내고 상대 카드에는 상대의 초안이 보인다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom);

		await typeJamo(page, 'ㅂㅏㄴ');
		expect(room.sentOf('draft')).toEqual([]);
		await clock.run(300);
		expect(await room.nextSent('draft')).toEqual({ type: 'draft', jamo: 'ㅂㅏㄴ' });

		room.as('철수').send({ type: 'draft', jamo: 'ㅅㅗㄴ' });
		await expect(card(page, '철수').getByRole('img', { name: '철수: 입력 중 ㅅㅗㄴ' })).toBeVisible();
	});

	test('제안을 확정하면 제안함으로 바뀌고 취소하면 단어가 입력 행으로 돌아온다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		await propose(page, 아바나);
		expect(await room.nextSent('propose')).toEqual({ type: 'propose', jamo: 아바나 });

		await expect(page.locator('.me-st.prop')).toContainText('제안함');
		await expect(page.locator('.progress .sr')).toHaveText('제안 1/3 · 내 제안 확정');
		await expect(page.getByRole('button', { name: '마감' })).toBeEnabled();
		const cancel = page.getByRole('button', { name: '제안 취소' });
		await expect(cancel).toBeVisible();
		await expect(page.getByRole('button', { name: '패스', exact: true })).toHaveCount(0);

		await cancel.click();
		expect(await room.nextSent('unpropose')).toEqual({ type: 'unpropose' });
		await expect(mpToast(page)).toHaveText('제안을 취소했습니다');
		await expect(page.locator('.me-st.prop')).toHaveCount(0);
		expect((await boardText(page))[0]).toBe(아바나);
		await expect(page.getByRole('button', { name: '패스', exact: true })).toBeVisible();
	});

	test('남의 제안은 카드에 제안함으로 나타난다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		room.as('영희').send({ type: 'propose', jamo: 소나기 });
		await expect(card(page, '영희')).toContainText('제안함');
		await expect(card(page, '영희').getByRole('img', { name: `영희: 제안 ${소나기}` })).toBeVisible();
		await expect(page.locator('.progress .sr')).toHaveText('제안 1/3');
	});

	test('패스는 서버에 보내고 취소할 수 있으며 제안이 없는데 나만 남기면 막힌다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		await page.getByRole('button', { name: '패스', exact: true }).click();
		expect(await room.nextSent('pass')).toEqual({ type: 'pass', on: true });
		await expect(page.locator('.me-st.pass')).toContainText('패스');
		await page.getByRole('button', { name: '패스 취소' }).click();
		expect((await room.nextSent('pass', 2)).on).toBe(false);

		room.as('철수').send({ type: 'pass', on: true });
		room.as('영희').send({ type: 'pass', on: true });
		await expect(card(page, '철수')).toContainText('패스');
		const pass = page.getByRole('button', { name: '패스', exact: true });
		await expect(pass).toBeDisabled();
		await expect(pass).toHaveAttribute('title', '제안이 하나도 없어 패스할 수 없습니다');
	});

	test('제안이 하나뿐이면 마감 때 투표 없이 바로 보드에 들어간다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		await propose(page, 아바나);
		await expect(page.locator('.me-st.prop')).toBeVisible();

		await page.getByRole('button', { name: '마감' }).click();
		expect(await room.nextSent('close')).toEqual({ type: 'close' });
		await expect(mpToast(page)).toHaveText('제안이 하나라 바로 냅니다');
		await expectRowMarks(page, 0, 'acpccc');
		await expect(page.locator('.me-st.prop')).toHaveCount(0);
	});

	test('모두 제안하면 마감을 기다리지 않고 진행한다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		room.as('철수').send({ type: 'propose', jamo: 아바나 });
		room.as('영희').send({ type: 'propose', jamo: 아바나 });
		await propose(page, 아바나);
		// 같은 단어가 합쳐져 후보가 하나라 곧바로 제출된다.
		await expectRowMarks(page, 0, 'acpccc');
	});

	test('참가자에게는 마감과 포기가 없다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수', '영희'], settings: { kind: 'coop' } });
		await room.open();
		room.startGame();
		await expect(page.locator('.game-title')).toBeVisible();
		await expect(page.getByRole('button', { name: '마감' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: '포기' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: '패스', exact: true })).toBeVisible();
	});

	test('제안도 패스도 안 한 채 60초가 지나면 경고하지만 제안한 뒤에는 경고하지 않는다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom);
		await clock.jump(60_000);
		await expect(page.getByRole('dialog', { name: '진행 중입니다' })).toBeVisible();
		await page.getByRole('button', { name: '계속하기' }).click();

		await propose(page, 아바나);
		await room.nextSent('propose');
		await clock.jump(120_000);
		await expect(page.getByRole('dialog')).toHaveCount(0);
	});
});

test.describe('협동: 투표', () => {
	/** 내가 아바나, 철수가 소나기를 제안하고 방장이 마감해 투표 단계로 간다. */
	async function toVote(page: Page, room: FakeRoom) {
		await propose(page, 아바나);
		await room.nextSent('propose');
		room.as('철수').send({ type: 'propose', jamo: 소나기 });
		await page.getByRole('button', { name: '마감' }).click();
		await expect(vote(page)).toBeVisible();
	}

	test('후보가 둘 이상이면 투표 시트가 뜨고 득표수와 20초 마감이 보인다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		await toVote(page, room);

		const sheet = vote(page);
		await expect(sheet.locator('.cand')).toHaveCount(2);
		await expect(sheet.locator('.cand').nth(0)).toContainText('내 제안');
		await expect(sheet.locator('.cand').nth(1)).toContainText('철수');
		await expect(sheet.locator('.vc')).toHaveText('투표 0/3명');
		await expect(sheet.locator('.vtime')).toHaveAttribute('aria-label', `남은 시간 ${VOTE_MS / 1000}초`);
		await expect(sheet.getByText('누가 어디에 투표했는지는 보이지 않습니다.')).toBeVisible();
		await expect(sheet.getByRole('button', { name: '투표 마감' })).toBeVisible();
		// 투표 중에는 보드 입력이 잠긴다.
		await typeJamo(page, 'ㅋ');
		expect((await boardText(page))[0]).toBe('......');
	});

	test('후보를 고르면 vote를 보내고 득표수와 선택 표시가 서버 값으로 바뀐다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		await toVote(page, room);

		await vote(page).getByRole('button', { name: /^선택하기/ }).nth(1).click();
		expect(await room.nextSent('vote')).toEqual({ type: 'vote', candidate: 1 });
		await expect(vote(page).locator('.cand').nth(1)).toContainText('1표');
		await expect(vote(page).locator('.cand').nth(1).getByRole('button')).toHaveText(/선택함/);
		await expect(vote(page).locator('.vc')).toHaveText('투표 1/3명');

		// 표는 마감 전까지 바꿀 수 있다.
		await vote(page).getByRole('button', { name: /^선택하기/ }).click();
		expect((await room.nextSent('vote', 2)).candidate).toBe(0);
		await expect(vote(page).locator('.cand').nth(0)).toContainText('1표');
		await expect(vote(page).locator('.cand').nth(1)).toContainText('0표');
	});

	test('20초가 줄어들다 5초부터 곧 마감으로 바뀌고 마감되면 그때까지의 표로 정한다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom);
		await toVote(page, room);
		await vote(page).getByRole('button', { name: /^선택하기/ }).first().click();
		await room.nextSent('vote');

		const timer = vote(page).locator('.vtime');
		await clock.run(10_000);
		await expect(timer).toHaveAttribute('aria-label', '남은 시간 10초');
		await expect(timer).not.toHaveClass(/urgent/);
		await clock.run(5_000);
		await expect(timer).toHaveAttribute('aria-label', '남은 시간 5초');
		await expect(timer).toHaveClass(/urgent/);
		await expect(timer).toContainText('곧 마감');

		await room.advance(VOTE_MS - 15_000);
		await expect(vote(page)).toHaveCount(0);
		await expect(mpToast(page)).toHaveText(`정한 단어: ${아바나}`);
		await expectRowMarks(page, 0, 'acpccc');
	});

	test('방장이 투표 마감을 누르면 지금까지의 표로 정한다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		await toVote(page, room);
		room.as('영희').send({ type: 'vote', candidate: 1 });
		await expect(vote(page).locator('.cand').nth(1)).toContainText('1표');

		await vote(page).getByRole('button', { name: '투표 마감' }).click();
		expect(await room.nextSent('close', 2)).toEqual({ type: 'close' });
		await expect(vote(page)).toHaveCount(0);
		await expect(mpToast(page)).toHaveText(`정한 단어: ${소나기}`);
		await expectRowMarks(page, 0, 'aaccaa');
	});

	test('동률이면 돌림판을 돌려 서버가 정한 단어에서 멈춘다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom);
		await toVote(page, room);
		await vote(page).getByRole('button', { name: '투표 마감' }).click();
		await room.nextSent('close', 2);

		await expect(vote(page)).toHaveCount(0);
		await expect(mpToast(page)).toHaveText('동률이라 돌림판으로 정합니다');
		const wheel = page.locator('section.sel');
		await expect(wheel.getByRole('heading', { name: '돌림판' })).toBeVisible();
		await expect(wheel.locator('.cand')).toHaveCount(2);
		// 연출이 끝나기 전에는 방금 고른 행이 보드에 없다.
		expect((await boardMarks(page))[0]).toBe('......');

		await clock.run(4_000);
		await expect(wheel).toHaveCount(0);
		await expect(mpToast(page)).toContainText('정한 단어:');
		expect((await boardMarks(page))[0]).not.toBe('......');
	});

	test('돌림판 방식은 마감 즉시 서버가 고르고 연출 뒤에 행이 보인다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom, { settings: { pick: 'roulette' } });
		await propose(page, 아바나);
		await room.nextSent('propose');
		room.as('철수').send({ type: 'propose', jamo: 소나기 });
		await page.getByRole('button', { name: '마감' }).click();

		await expect(page.locator('section.sel')).toBeVisible();
		expect((await boardMarks(page))[0]).toBe('......');
		await clock.run(3_000);
		await expect(page.locator('section.sel')).toHaveCount(0);
		await expect(mpToast(page)).toContainText('정한 단어:');
		expect((await boardMarks(page))[0]).not.toBe('......');
	});

	test('투표 시트가 뜬 동안에도 채팅을 시트 위에 열고 닫으면 투표 시트로 돌아온다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		await toVote(page, room);

		await vote(page).getByRole('button', { name: '채팅' }).click();
		const chat = page.getByRole('dialog', { name: '채팅' });
		await expect(chat).toBeVisible();
		await chat.getByRole('textbox', { name: '채팅 메시지' }).fill('안녕하세요');
		await page.keyboard.press('Escape');
		await expect(chat).toHaveCount(0);
		await expect(vote(page)).toBeVisible();
		// 쓰던 글은 닫아도 남는다.
		await vote(page).getByRole('button', { name: '채팅' }).click();
		await expect(chat.getByRole('textbox', { name: '채팅 메시지' })).toHaveValue('안녕하세요');
	});

	test('참가자에게는 투표 마감 버튼이 없다', async ({ page, openRoom }) => {
		const room = await openRoom({ others: ['철수', '영희'], settings: { kind: 'coop' } });
		await room.open();
		room.startGame();
		await expect(page.locator('.game-title')).toBeVisible();
		await propose(page, 아바나);
		room.as('철수').send({ type: 'propose', jamo: 소나기 });
		room.as(room.state.players.find((p) => p.pid === room.state.hostPid)!.name).send({ type: 'close' });
		await expect(vote(page)).toBeVisible();
		await expect(vote(page).getByRole('button', { name: '투표 마감' })).toHaveCount(0);
	});
});

test.describe('협동: 힌트 투표', () => {
	/** 아바나를 제안해 보드에 노란 칸을 만든다. */
	async function withYellow(page: Page, room: FakeRoom) {
		await propose(page, 아바나);
		await room.nextSent('propose');
		await page.getByRole('button', { name: '마감' }).click();
		await expectRowMarks(page, 0, 'acpccc');
	}

	test('요청하면 과반 찬성이 모일 때까지 막대를 열고 통과하면 모두의 보드에 힌트를 넣는다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		await withYellow(page, room);

		await page.getByRole('button', { name: '힌트' }).click();
		expect(await room.nextSent('hint')).toEqual({ type: 'hint' });
		const bar = page.getByRole('region', { name: '힌트 투표' });
		await expect(bar).toContainText('내 힌트 요청');
		await expect(bar).toContainText('찬성 1 · 반대 0 · 2명 필요 · 30초');
		await expect(page.getByRole('button', { name: '힌트 투표 중' })).toBeDisabled();
		// 요청한 사람에게는 찬성·반대 버튼이 없다.
		await expect(bar.getByRole('button')).toHaveCount(0);

		room.as('철수').send({ type: 'hintvote', yes: true });
		await expect(bar).toHaveCount(0);
		await expect(mpToast(page)).toHaveText('테스트유저님 힌트: ㅂ은(는) 1번째 칸');
		await expect(page.getByRole('button', { name: '힌트 사용함' })).toBeDisabled();
		expect((await boardText(page))[1]).toBe('ㅂ.....');
	});

	test('반대가 이기면 부결을 알리고 막대를 닫는다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		await withYellow(page, room);
		await page.getByRole('button', { name: '힌트' }).click();
		await room.nextSent('hint');
		const bar = page.getByRole('region', { name: '힌트 투표' });

		room.as('철수').send({ type: 'hintvote', yes: false });
		await expect(bar).toContainText('찬성 1 · 반대 1');
		room.as('영희').send({ type: 'hintvote', yes: false });
		await expect(bar).toHaveCount(0);
		await expect(mpToast(page)).toHaveText('힌트 투표가 부결됐습니다');
		await expect(page.getByRole('button', { name: '힌트', exact: true })).toBeEnabled();
	});

	test('30초 안에 과반이 모이지 않으면 시간 만료로 부결된다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom);
		await withYellow(page, room);
		await page.getByRole('button', { name: '힌트' }).click();
		await room.nextSent('hint');
		const bar = page.getByRole('region', { name: '힌트 투표' });

		await clock.run(10_000);
		await expect(bar).toContainText('20초');
		await room.advance(HINT_VOTE_MS - 10_000);
		await expect(bar).toHaveCount(0);
		await expect(mpToast(page)).toHaveText('시간 안에 과반이 모이지 않아 부결됐습니다');
	});

	test('남이 올린 힌트 요청에는 찬성·반대를 보내고 내 표가 과반을 채우면 통과한다', async ({ page, openRoom }) => {
		const room = await startCoop(page, openRoom);
		await withYellow(page, room);
		room.as('철수').send({ type: 'hint' });

		const bar = page.getByRole('region', { name: '힌트 투표' });
		await expect(bar).toContainText('철수님의 힌트 요청');
		await expect(bar.getByRole('button', { name: '찬성' })).toHaveAttribute('aria-pressed', 'false');
		await bar.getByRole('button', { name: '찬성' }).click();
		expect(await room.nextSent('hintvote')).toEqual({ type: 'hintvote', yes: true });
		await expect(bar).toHaveCount(0);
		await expect(mpToast(page)).toHaveText('철수님 힌트: ㅂ은(는) 1번째 칸');
	});

	test('힌트가 꺼진 방에는 힌트 버튼이 없다', async ({ page, openRoom }) => {
		await startCoop(page, openRoom, { settings: { hints: false } });
		await expect(page.getByRole('button', { name: /힌트/ })).toHaveCount(0);
	});
});

test.describe('협동: 결과와 시간', () => {
	test('정답을 맞히면 성공 결과에 정답과 함께한 사람을 보여 준다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom);
		await propose(page, 바나나);
		await room.nextSent('propose');
		await page.getByRole('button', { name: '마감' }).click();
		await expectRowMarks(page, 0, 'cccccc');
		await clock.run(1200);

		const result = page.getByRole('dialog', { name: '결과' });
		await expect(result.locator('.verdict')).toContainText('성공');
		await expect(result.locator('.count')).toContainText('1회 시도');
		await expect(result.locator('.word')).toHaveText('바나나');
		await expect(result.getByText('함께한 사람 3명')).toBeVisible();
		await expect(result.locator('.people li')).toHaveText(['테스트유저나', '철수', '영희']);
		await expect(result.getByRole('button', { name: '같은 설정으로 한 판 더' })).toBeVisible();
	});

	test('시도 횟수를 다 쓰면 실패 결과가 열린다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom, { settings: { tries: 4 } });
		for (let i = 0; i < 4; i++) {
			await propose(page, 소나기);
			await room.nextSent('propose', i + 1);
			await page.getByRole('button', { name: '마감' }).click();
			await expectRowMarks(page, i, 'aaccaa');
		}
		await clock.run(1200);
		const result = page.getByRole('dialog', { name: '결과' });
		await expect(result.locator('.verdict')).toContainText('실패');
		await expect(result.locator('.count')).toContainText('4회 시도');
	});

	test('제한 시간이 다 되면 실패로 끝나고 시간이 다 됐다고 알린다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom, { settings: { timer: true } });
		await expect(page.locator('.clock .clk')).toContainText('남은 시간 3:00');
		await room.advance(180_000, 'jump');
		await expect(mpToast(page)).toHaveText('시간이 다 됐습니다');
		await clock.run(1200);
		const result = page.getByRole('dialog', { name: '결과' });
		await expect(result.locator('.verdict')).toContainText('실패');
		await expect(result.getByText('시간이 다 됐습니다.')).toBeVisible();
	});

	test('방장이 포기하면 판이 끝난다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom);
		await page.getByRole('button', { name: '포기' }).click();
		await page.getByRole('button', { name: '정말 포기?' }).click();
		await room.nextSent('giveup');
		await clock.run(1200);
		await expect(page.getByRole('dialog', { name: '결과' }).locator('.verdict')).toContainText('실패');
	});
});

test.describe('협동 등반', () => {
	test('스테이지를 클리어하면 연출 뒤에 다음 스테이지 보드로 넘어가고 끝까지 오르면 피라미드를 보여 준다', async ({ page, openRoom, clock }) => {
		const room = await startCoop(page, openRoom, { settings: { game: 'climb', length: 11 } });
		await expect(page.locator('.mode-line')).toHaveText('협동 · 등반 · 11자');
		await expect(page.locator('.band .vl')).toHaveText('1');

		await propose(page, toJamo(WORD_BY_N[11]));
		await room.nextSent('propose');
		await page.getByRole('button', { name: '마감' }).click();
		await expect(mpToast(page)).toHaveText('스테이지 1 클리어');
		await expectRowMarks(page, 0, 'c'.repeat(11));
		await expect(page.locator('.band .vl')).toHaveText('1');
		await clock.run(2000);
		await expect(page.locator('.band .vl')).toHaveText('2');
		expect((await boardMarks(page))[0]).toBe('.'.repeat(12));

		await propose(page, toJamo(WORD_BY_N[12]));
		await room.nextSent('propose', 2);
		await page.getByRole('button', { name: '마감' }).click();
		await expectRowMarks(page, 0, 'c'.repeat(12));
		await clock.run(1200);
		const result = page.getByRole('dialog', { name: '등반 결과' });
		await expect(result.locator('.count')).toContainText('2스테이지 클리어');
		await expect(result.getByRole('img', { name: /등반 단어/ })).toBeVisible();
	});
});
