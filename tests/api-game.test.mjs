import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeToken, encodeToken } from '../src/lib/server/token.ts';
import { call, FakeD1, loadRoute, platformOf } from './route-runtime.mjs';

const { POST } = await loadRoute('api/game');
const { POOL_THRESHOLD } = await import('../src/lib/server/dict.ts');

const SECRET = 'test-secret';
// KST 2026-11-15 낮 12시. 데일리 날짜의 기준이다.
const NOON = Date.parse('2026-11-15T03:00:00Z');
const MODES = ['daily', 'daily-climb', 'climb-length', 'endless', 'climb-streak'];

/** 길이 5..12마다 t=1은 200개, t=3은 100개짜리 풀. 행 내용은 이 라우트가 읽지 않는다. */
const pools = () => Object.fromEntries([5, 6, 7, 8, 9, 10, 11, 12].flatMap((n) => [[`3:${n}`, Array(100).fill({})], [`1:${n}`, Array(200).fill({})]]));

async function setup(t, { now = NOON, env = {} } = {}) {
	t.mock.timers.enable({ apis: ['Date'], now });
	const db = new FakeD1({ pool: pools() });
	return { db, platform: platformOf({ DB: db, ...env }) };
}

const tokenOf = (res) => decodeToken(res.json.token, SECRET);

test('다섯 모드가 모두 통하고 토큰의 t는 모드의 풀 임계값(POOL_THRESHOLD)이다', async (t) => {
	const { platform } = await setup(t);
	assert.deepEqual(Object.keys(POOL_THRESHOLD).sort(), [...MODES].sort());
	for (const mode of MODES) {
		const res = await call(POST, { body: { mode, n: 7 }, platform });
		assert.equal(res.status, 200, mode);
		assert.equal(res.json.n, 7);
		assert.deepEqual({ ...(await tokenOf(res)), idx: 0 }, { n: 7, t: POOL_THRESHOLD[mode], idx: 0 }, mode);
	}
});

test('모르는 모드와 깨진 본문은 D1을 읽지 않고 400 bad request', async (t) => {
	const { db, platform } = await setup(t);
	for (const input of [{ raw: 'not json' }, { raw: '' }, { raw: 'null' }, { raw: '5' }, { body: {} }, { body: { mode: 'weekly' } }, { body: { mode: 5 } }, { body: { mode: null } }]) {
		const res = await call(POST, { ...input, platform });
		assert.deepEqual([res.status, res.message], [400, 'bad request'], JSON.stringify(input));
	}
	assert.equal(db.queries.length, 0);
});

test('Object.prototype 키(constructor 등)와 배열 모드는 모드가 아니다', async (t) => {
	const { platform } = await setup(t);
	for (const mode of ['constructor', 'toString', '__proto__', 'hasOwnProperty', ['daily']]) {
		assert.equal((await call(POST, { body: { mode }, platform })).status, 400, String(mode));
	}
});

test('n은 5~12 정수만: 범위 밖·소수·문자열·null은 400이고 D1을 읽지 않는다', async (t) => {
	const { db, platform } = await setup(t);
	for (const n of [4, 13, 0, -6, 5.5, '6', null, true, NaN]) {
		const res = await call(POST, { body: { mode: 'endless', n }, platform });
		assert.deepEqual([res.status, res.message], [400, 'n must be 5..12'], String(n));
	}
	assert.equal(db.queries.length, 0);
	for (const n of [5, 12]) assert.equal((await call(POST, { body: { mode: 'endless', n }, platform })).status, 200);
});

test('비데일리: n을 주면 그 길이의 풀 크기 한 행만 읽고 idx는 난수를 풀 크기로 나눈 나머지', async (t) => {
	const { db, platform } = await setup(t);
	t.mock.method(crypto, 'getRandomValues', (arr) => ((arr[0] = 250), arr));
	const res = await call(POST, { body: { mode: 'endless', n: 8 }, platform });
	assert.deepEqual(db.queries.map((q) => [q.sql, q.args]), [['SELECT count FROM pool_meta WHERE t = ? AND n = ?', [1, 8]]]);
	assert.deepEqual(await tokenOf(res), { n: 8, t: 1, idx: 250 % 200 });

	db.queries.length = 0;
	const climb = await call(POST, { body: { mode: 'climb-length', n: 8 }, platform });
	assert.deepEqual(db.queries.map((q) => q.args), [[3, 8]]);
	assert.equal((await tokenOf(climb)).idx, 250 % 100);
});

test('비데일리: n을 안 주면 5 + (난수 % 8)로 정한 뒤 그 길이의 풀을 읽는다', async (t) => {
	const { db, platform } = await setup(t);
	const draws = [3, 7];
	t.mock.method(crypto, 'getRandomValues', (arr) => ((arr[0] = draws.shift()), arr));
	const res = await call(POST, { body: { mode: 'climb-streak' }, platform });
	assert.equal(res.json.n, 8);
	assert.deepEqual(db.queries.map((q) => q.args), [[1, 8]]);
	assert.deepEqual(await tokenOf(res), { n: 8, t: 1, idx: 7 });
});

test('데일리: 날짜가 정하는 n과 idx를 고정값으로 고정한다(바꾸면 그날 데일리가 바뀐다)', async (t) => {
	const { db, platform } = await setup(t);
	const golden = [
		[{ mode: 'daily' }, { n: 10, t: 3, idx: 40 }],
		[{ mode: 'daily', n: 6 }, { n: 6, t: 3, idx: 24 }],
		[{ mode: 'daily-climb' }, { n: 10, t: 3, idx: 63 }],
		[{ mode: 'daily-climb', n: 6 }, { n: 6, t: 3, idx: 6 }],
		[{ mode: 'daily', day: '2026-10-01' }, { n: 9, t: 3, idx: 98 }],
		[{ mode: 'daily', day: '2026-09-01', n: 7 }, { n: 7, t: 3, idx: 62 }]
	];
	for (const [body, want] of golden) {
		db.queries.length = 0;
		const res = await call(POST, { body, platform });
		assert.deepEqual(await tokenOf(res), want, JSON.stringify(body));
		assert.equal(res.json.n, want.n);
		assert.deepEqual(db.queries.map((q) => q.args), [[3, want.n]], '풀 크기 한 행만 읽는다');
	}
});

test('데일리는 같은 날 같은 요청에 같은 토큰을 주고, 일일 등반은 같은 n에서도 다른 단어를 가리킨다', async (t) => {
	const { platform } = await setup(t);
	const a = await call(POST, { body: { mode: 'daily', n: 6 }, platform });
	const b = await call(POST, { body: { mode: 'daily', n: 6 }, platform });
	assert.equal(a.json.token, b.json.token);
	const climb = await call(POST, { body: { mode: 'daily-climb', n: 6 }, platform });
	assert.notEqual((await tokenOf(climb)).idx, (await tokenOf(a)).idx);
});

test('데일리 날짜의 기준은 KST 자정이고, day를 주면 그 날짜의 문제', async (t) => {
	const { platform } = await setup(t, { now: Date.parse('2026-11-14T14:59:59.999Z') });
	const before = await call(POST, { body: { mode: 'daily' }, platform });
	const explicit = await call(POST, { body: { mode: 'daily', day: '2026-11-14' }, platform });
	assert.equal(before.json.token, explicit.json.token, '자정 1ms 전은 아직 11-14');

	t.mock.timers.setTime(Date.parse('2026-11-14T15:00:00Z'));
	const after = await call(POST, { body: { mode: 'daily' }, platform });
	assert.equal(after.json.token, (await call(POST, { body: { mode: 'daily', day: '2026-11-15' }, platform })).json.token);
	assert.notEqual(after.json.token, before.json.token);
});

test('데일리 day가 미래·형식 오류·없는 날짜면 400 invalid daily day, 데일리가 아닌 모드는 day를 무시한다', async (t) => {
	const { db, platform } = await setup(t);
	for (const mode of ['daily', 'daily-climb']) {
		for (const day of ['2026-11-16', '2027-01-01', '2026-02-30', '2026-13-01', '2026-1-5', '15-11-2026', '', 20261115, null]) {
			const res = await call(POST, { body: { mode, day }, platform });
			assert.deepEqual([res.status, res.message], [400, 'invalid daily day'], `${mode} ${day}`);
		}
	}
	assert.equal(db.queries.length, 0);
	assert.equal((await call(POST, { body: { mode: 'endless', n: 6, day: '2099-01-01' }, platform })).status, 200);
	assert.equal((await call(POST, { body: { mode: 'daily', day: '2026-11-15' }, platform })).status, 200, '오늘은 통과');
});

test('토큰은 서버 시크릿으로 서명한다', async (t) => {
	const { platform } = await setup(t);
	const res = await call(POST, { body: { mode: 'endless', n: 6 }, platform });
	assert.ok(await decodeToken(res.json.token, SECRET));
	assert.equal(await decodeToken(res.json.token, 'other-secret'), null);
});

test('KORDLE_SECRET이 없으면 dev-only-secret으로 서명한다', async (t) => {
	const { platform } = await setup(t, { env: { KORDLE_SECRET: undefined } });
	const res = await call(POST, { body: { mode: 'endless', n: 6 }, platform });
	assert.ok(await decodeToken(res.json.token, 'dev-only-secret'));
});

test('platform·DB가 없으면 500, D1 오류는 던져진다', async (t) => {
	await setup(t);
	for (const platform of [undefined, { env: {} }]) assert.equal((await call(POST, { body: { mode: 'endless' }, platform })).status, 500);
	const db = new FakeD1();
	db.failWith = new Error('d1 down');
	const res = await call(POST, { body: { mode: 'endless', n: 6 }, platform: platformOf({ DB: db }) });
	assert.equal(res.status, 500);
	assert.equal(res.crashed.message, 'd1 down');
});

// 풀 크기 0이면 idx가 NaN(비데일리)이거나 0(데일리)이라 서버는 200을 주고, 그 토큰은 이후 guess·reveal에서 깨진다.
test('풀이 비어 있으면 토큰을 내주지 않는다', { todo: 'api/game: answerCount 0을 검사하지 않아 NaN idx 토큰이 200으로 나간다' }, async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: NOON });
	const platform = platformOf({ DB: new FakeD1() });
	for (const mode of MODES) assert.notEqual((await call(POST, { body: { mode, n: 6 }, platform })).status, 200, mode);
});

test('데일리 토큰은 같은 좌표를 서명한 encodeToken 결과와 같다', async (t) => {
	const { platform } = await setup(t);
	const res = await call(POST, { body: { mode: 'daily', n: 6 }, platform });
	assert.equal(res.json.token, await encodeToken({ n: 6, t: 3, idx: 24 }, SECRET));
});
