import assert from 'node:assert/strict';
import test from 'node:test';
import { Game, setup } from './game-mock.mjs';
import { todayKST } from '../src/lib/day.ts';

// 손으로 고치거나 옛 버전이 남긴 localStorage 값이 어긋나도 Game은 저장본이 없는 것처럼 뜬다.
const DEFAULT_CONFIG = { mode: 'daily', length: { kind: 'fixed', n: 6 } };

const brokenConfigs = {
	'length 없는 객체': '{"mode":"daily"}',
	숫자: '5',
	문자열: '"daily"',
	배열: '[]',
	'모르는 mode': '{"mode":"nope","length":{"kind":"random"}}',
	'n 없는 fixed': '{"mode":"daily","length":{"kind":"fixed"}}',
	'객체가 아닌 length': '{"mode":"daily","length":5}'
};

for (const [name, raw] of Object.entries(brokenConfigs)) {
	test(`config가 ${name}이면 기본 설정으로 뜬다`, (t) => {
		const { values } = setup(t);
		values.set('nkordle:config', raw);
		const game = new Game();
		assert.deepEqual(game.config, DEFAULT_CONFIG);
	});
}

test('정상 config는 그대로 복원된다', (t) => {
	const { values } = setup(t);
	for (const config of [
		{ mode: 'endless', length: { kind: 'fixed', n: 7 } },
		{ mode: 'climb-streak', length: { kind: 'random' } }
	]) {
		values.set('nkordle:config', JSON.stringify(config));
		assert.deepEqual(new Game().config, config);
	}
});

const gameRequests = (calls) => calls.filter((c) => c.url === '/api/game').map((c) => c.body);

async function openClimb(t, raw) {
	const { values, calls } = setup(t);
	if (raw !== undefined) values.set(`nkordle:dclimb:${todayKST()}`, raw);
	const game = new Game();
	game.config = { mode: 'daily-climb', length: { kind: 'fixed', n: 5 } };
	await game.newGame();
	return { game, calls };
}

const brokenClimbSaves = {
	'빈 객체': '{}',
	숫자: '5',
	'climbWords 없음': '{"stage":2,"n":6}',
	'climbWords가 배열이 아님': '{"stage":2,"n":6,"climbWords":"가나"}',
	'stage 없음': '{"n":6,"climbWords":["가나"]}',
	'n 없음': '{"stage":2,"climbWords":["가나"]}'
};

for (const [name, raw] of Object.entries(brokenClimbSaves)) {
	test(`dclimb 저장본이 ${name}이면 1스테이지 5자 새 코스로 시작한다`, async (t) => {
		const { game, calls } = await openClimb(t, raw);
		assert.equal(game.status, 'playing');
		assert.equal(game.stage, 1);
		assert.deepEqual(game.climbWords, []);
		assert.equal(gameRequests(calls).at(-1).n, 5);
	});
}

test('시간 필드가 없는 옛 dclimb 저장본은 그대로 복원된다', async (t) => {
	const { game, calls } = await openClimb(t, '{"stage":2,"n":6,"climbWords":["가나"]}');
	assert.equal(game.stage, 2);
	assert.deepEqual(game.climbWords, ['가나']);
	assert.deepEqual(game.stageTimes, [null]);
	assert.deepEqual(game.stageBests, []);
	assert.equal(game.lostMs, null);
	assert.equal(game.runBest, false);
	assert.equal(gameRequests(calls).at(-1).n, 6);
});

test('시간 필드까지 있는 dclimb 저장본은 그대로 복원된다', async (t) => {
	const raw = JSON.stringify({
		stage: 3, n: 7, climbWords: ['가나', '다라'], stageStartAt: 1000,
		stageTimes: [4000, 5000], lostMs: 300, stageBests: [1], runBest: true
	});
	const { game } = await openClimb(t, raw);
	assert.equal(game.stage, 3);
	assert.deepEqual(game.stageTimes, [4000, 5000]);
	assert.equal(game.stageStartAt, 1000);
	assert.equal(game.lostMs, 300);
	assert.deepEqual(game.stageBests, [1]);
	assert.equal(game.runBest, true);
});

test('dclimb의 배열 선택 필드가 배열이 아니면 없는 것으로 읽고 나머지는 복원한다', async (t) => {
	const { game } = await openClimb(t, '{"stage":2,"n":6,"climbWords":["가나"],"stageTimes":5,"stageBests":"x"}');
	assert.equal(game.stage, 2);
	assert.deepEqual(game.climbWords, ['가나']);
	assert.deepEqual(game.stageTimes, [null]);
	assert.deepEqual(game.stageBests, []);
});

const row = 'ㄱㄴㄷㄹㅁㅂ';
const marks = ['a', 'p', 'a', 'a', 'a', 'a'];

async function openDaily(t, raw) {
	const { values } = setup(t);
	if (raw !== undefined) values.set(`nkordle:daily:${todayKST()}:tok`, raw);
	const game = new Game();
	await game.newGame();
	return game;
}

const brokenDailySaves = {
	'빈 객체': '{}',
	숫자: '5',
	'rows가 배열이 아님': JSON.stringify({ rows: 'x', marks: [marks], status: 'playing', answer: null }),
	'marks 없음': JSON.stringify({ rows: [row], status: 'playing', answer: null }),
	'marks 길이가 rows와 다름': JSON.stringify({ rows: [row], marks: [], status: 'playing', answer: null }),
	'marks 원소가 배열이 아님': JSON.stringify({ rows: [row], marks: ['x'], status: 'playing', answer: null }),
	'모르는 status': JSON.stringify({ rows: [row], marks: [marks], status: 'bogus', answer: null })
};

for (const [name, raw] of Object.entries(brokenDailySaves)) {
	test(`daily 저장본이 ${name}이면 새 판으로 시작한다`, async (t) => {
		const game = await openDaily(t, raw);
		assert.equal(game.status, 'playing');
		assert.deepEqual(game.rows, []);
		assert.deepEqual(game.marks, []);
		assert.deepEqual(game.keyStates, {});
	});
}

test('hints 없는 옛 daily 저장본은 그대로 복원된다', async (t) => {
	const game = await openDaily(t, JSON.stringify({ rows: [row], marks: [marks], status: 'playing', answer: null }));
	assert.equal(game.status, 'playing');
	assert.deepEqual(game.rows, [row]);
	assert.deepEqual(game.marks, [marks]);
	assert.deepEqual(game.hints, {});
});

test('끝난 daily 저장본(answer·hints 포함)은 그대로 복원된다', async (t) => {
	const raw = JSON.stringify({ rows: [row], marks: [marks], status: 'lost', answer: '정답', hints: { 1: 'ㄴ' } });
	const game = await openDaily(t, raw);
	assert.equal(game.status, 'lost');
	assert.equal(game.answer, '정답');
	assert.deepEqual(game.hints, { 1: 'ㄴ' });
});
