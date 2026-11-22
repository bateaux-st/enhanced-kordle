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

const nonIntegerLengths = { '5.5': '5.5', 문자열: "'6'", 무한대: '1e400' };
for (const [name, n] of Object.entries(nonIntegerLengths)) {
	test(`config의 fixed 길이가 정수가 아니면(${name}) 기본 설정으로 뜬다`, (t) => {
		const { values } = setup(t);
		values.set('nkordle:config', `{"mode":"endless","length":{"kind":"fixed","n":${n}}}`);
		assert.deepEqual(new Game().config, DEFAULT_CONFIG);
	});
}

// 범위 밖 정수는 끝값으로 자른다. 저장값은 그대로 둬서 다음에 고쳐 쓸 때까지 원래 값이 남는다.
const clampedLengths = [[99, 12], [1, 5], [0, 5], [-3, 5], [5, 5], [12, 12]];
for (const [n, want] of clampedLengths) {
	test(`config의 fixed 길이 ${n}은 ${want}자로 읽고 저장값은 고치지 않는다`, (t) => {
		const { values } = setup(t);
		values.set('nkordle:config', JSON.stringify({ mode: 'endless', length: { kind: 'fixed', n } }));
		assert.deepEqual(new Game().config, { mode: 'endless', length: { kind: 'fixed', n: want } });
		assert.deepEqual(JSON.parse(values.get('nkordle:config')), { mode: 'endless', length: { kind: 'fixed', n } });
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

const win = () => Response.json({ ok: true, marks: Array(6).fill('c') });
const win12 = () => Response.json({ ok: true, marks: Array(12).fill('c') });

async function winEndless(t, raw) {
	const { values } = setup(t, { '/api/guess': win });
	values.set('nkordle:config', JSON.stringify({ mode: 'endless', length: { kind: 'fixed', n: 6 } }));
	if (raw !== undefined) values.set('nkordle:stats:endless', raw);
	const game = new Game();
	const initial = JSON.parse(JSON.stringify(game.stats));
	await game.newGame();
	game.current = 'ㄱ'.repeat(6);
	await game.submit();
	return { game, initial, values };
}

const emptyStats = { played: 0, won: 0, streak: 0, maxStreak: 0, dist: [] };
const brokenStats = {
	'빈 객체': '{}',
	숫자: '5',
	'dist 없음': '{"played":3,"won":2,"streak":1,"maxStreak":2}',
	'dist가 배열이 아님': '{"played":3,"won":2,"streak":1,"maxStreak":2,"dist":"x"}',
	'숫자 필드가 문자열': '{"played":"3","won":2,"streak":1,"maxStreak":2,"dist":[]}'
};

for (const [name, raw] of Object.entries(brokenStats)) {
	test(`stats 저장본이 ${name}이면 빈 통계로 시작해 판이 끝나도 던지지 않는다`, async (t) => {
		const { game, initial, values } = await winEndless(t, raw);
		assert.deepEqual(initial, emptyStats);
		assert.notEqual(game.toast, '서버에 연결할 수 없습니다');
		assert.equal(game.status, 'won');
		assert.deepEqual(game.stats, { played: 1, won: 1, streak: 1, maxStreak: 1, dist: [1] });
		assert.deepEqual(JSON.parse(values.get('nkordle:stats:endless')), game.stats);
	});
}

test('정상 stats 저장본은 그대로 복원되고 이어서 쌓인다', async (t) => {
	const saved = { played: 3, won: 2, streak: 1, maxStreak: 2, dist: [0, 1, 1] };
	const { game, initial } = await winEndless(t, JSON.stringify(saved));
	assert.deepEqual(initial, saved);
	assert.deepEqual(game.stats, { played: 4, won: 3, streak: 2, maxStreak: 2, dist: [1, 1, 1] });
});

test('일일 등반에서 12자 스테이지를 맞히면 climb-length와 같은 완주 토스트를 띄운다', async (t) => {
	const { values } = setup(t, {
		'/api/game': () => Response.json({ n: 12, token: 'tok' }),
		'/api/guess': win12
	});
	values.set(`nkordle:dclimb:${todayKST()}`, JSON.stringify({ stage: 8, n: 12, climbWords: Array(7).fill('가') }));
	const game = new Game();
	game.config = { mode: 'daily-climb', length: { kind: 'fixed', n: 5 } };
	await game.newGame();
	assert.equal(game.n, 12);
	for (let i = 0; i < 12; i++) game.type('ㄱ');
	await game.submit();
	assert.equal(game.status, 'won');
	assert.equal(game.toast, '12자까지 완주!');
});

// settings·best·climbtime도 어긋난 값은 없는 것처럼 읽는다. 읽을 때만 보고 저장값은 지우거나 고치지 않는다.
const readSettings = (t, raw) => {
	const { values } = setup(t);
	values.set('nkordle:settings', raw);
	return { game: new Game(), values };
};

const triesCases = [['99', 10], ['1', 4], ['0', 4], ['-3', 4], ['5.5', 6], ['"7"', 6], ['null', 6], ['7', 7]];
for (const [raw, want] of triesCases) {
	test(`settings.maxTries ${raw}는 ${want}회로 읽고 저장값은 그대로 둔다`, (t) => {
		const stored = `{"maxTries":${raw}}`;
		const { game, values } = readSettings(t, stored);
		assert.equal(game.settingTries, want);
		assert.equal(values.get('nkordle:settings'), stored);
	});
}

const hardThemeCases = [
	['{"hard":"yes"}', 'hard', false], ['{"hard":1}', 'hard', false], ['{"hard":true}', 'hard', true],
	['{"theme":"blue"}', 'theme', 'system'], ['{"theme":"dark"}', 'theme', 'dark'], ['{"theme":"light"}', 'theme', 'light']
];
for (const [raw, field, want] of hardThemeCases) {
	test(`settings ${raw}는 ${field}를 ${want}로 읽는다`, (t) => {
		assert.equal(readSettings(t, raw).game[field], want);
	});
}

for (const raw of ['5', '[]', '"x"']) {
	test(`settings가 ${raw}이면 전부 기본값이다`, (t) => {
		const { game } = readSettings(t, raw);
		assert.deepEqual([game.settingTries, game.hard, game.theme], [6, false, 'system']);
	});
}

test('settings 필드는 따로 판단한다', (t) => {
	const { game } = readSettings(t, '{"maxTries":8,"hard":"x","theme":"dark"}');
	assert.deepEqual([game.settingTries, game.hard, game.theme], [8, false, 'dark']);
});

const CLIMB = { mode: 'climb-streak', length: { kind: 'fixed', n: 6 } };
const CLIMB_KEY = 'climb-streak:fixed-6';

for (const [raw, want] of [['"x"', 0], ['-1', 0], ['2.5', 0], ['{}', 0], ['3', 3]]) {
	test(`best:가 ${raw}이면 ${want}으로 읽고 저장값은 그대로 둔다`, (t) => {
		const { values } = setup(t);
		values.set('nkordle:config', JSON.stringify(CLIMB));
		values.set(`nkordle:best:${CLIMB_KEY}`, raw);
		assert.equal(new Game().bestStage, want);
		assert.equal(values.get(`nkordle:best:${CLIMB_KEY}`), raw);
	});
}

// 어긋난 climbtime은 기록 전체가 없는 것이라, 스테이지를 클리어하면 새 기록으로 정상 처리된다.
const brokenClimbTimes = {
	'stages 없음': '{"best":null}',
	'best.stage가 문자열': '{"best":{"stage":"a","ms":1},"stages":{}}',
	'best.stage가 0': '{"best":{"stage":0,"ms":1},"stages":{}}',
	'best.ms가 음수': '{"best":{"stage":1,"ms":-1},"stages":{}}',
	'stages가 배열': '{"best":null,"stages":[]}',
	'stages 값이 문자열': '{"best":null,"stages":{"1":"x"}}',
	'stages 값이 음수': '{"best":null,"stages":{"1":-5}}',
	배열: '[]',
	숫자: '5'
};
for (const [name, raw] of Object.entries(brokenClimbTimes)) {
	test(`climbtime이 ${name}이면 빈 기록으로 읽고 스테이지를 클리어하면 통계와 토스트가 정상이다`, async (t) => {
		const { values, calls } = setup(t, {
			'/api/game': (body) => Response.json({ n: body.n ?? 6, token: 'tok' }),
			'/api/guess': (body) => Response.json({ ok: true, marks: Array(body.jamo.length).fill('c'), word: '정답' })
		});
		values.set('nkordle:config', JSON.stringify(CLIMB));
		values.set(`nkordle:climbtime:${CLIMB_KEY}`, raw);
		const game = new Game();
		assert.deepEqual(game.climbTime, { best: null, stages: {} });
		assert.equal(values.get(`nkordle:climbtime:${CLIMB_KEY}`), raw);

		await game.newGame();
		game.current = 'ㄱ'.repeat(game.n);
		await game.submit();
		assert.equal(game.status, 'won');
		assert.equal(game.toast, '스테이지 1 클리어');
		assert.equal(game.stats.played, 1);
		assert.equal(JSON.parse(values.get('nkordle:stats:climb-streak')).won, 1);
		assert.equal(game.bestStage, 1);
		assert.equal(calls.filter((c) => c.url === '/api/reveal').length, 0);
	});
}

const goodClimbTimes = [
	{ best: { stage: 3, ms: 90000 }, stages: { 1: 1000, 2: 2500.5 } },
	{ best: null, stages: {} }
];
for (const r of goodClimbTimes) {
	test(`정상 climbtime ${JSON.stringify(r)}은 그대로 읽는다`, (t) => {
		const { values } = setup(t);
		values.set('nkordle:config', JSON.stringify(CLIMB));
		values.set(`nkordle:climbtime:${CLIMB_KEY}`, JSON.stringify(r));
		assert.deepEqual(new Game().climbTime, r);
	});
}
