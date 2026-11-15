import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeToken } from '../src/lib/server/token.ts';
import { call, FakeD1, loadRoute, platformOf } from './route-runtime.mjs';

const { POST } = await loadRoute('api/guess');

const SECRET = 'test-secret';
const BANANA = { word: '바나나', jamo: 'ㅂㅏㄴㅏㄴㅏ' };
const NEAR = 'ㄴㅏㄴㅂㅏㅇ';
const VALID_SQL = 'SELECT 1 FROM valid WHERE jamo = ?';
const AT_SQL = 'SELECT word, jamo FROM pool WHERE t = ? AND n = ? AND idx = ?';

const token = (a = { n: 6, t: 3, idx: 0 }, secret = SECRET) => encodeToken(a, secret);

function setup(over = {}) {
	const db = new FakeD1({ valid: [BANANA.jamo, NEAR, 'ㅋㅋㅋㅋㅋㅋ'], pool: { '3:6': [BANANA] } });
	return { db, platform: platformOf({ DB: db, ...over }) };
}

test('사전에 있는 오답은 마크만, 정답은 마크와 단어를 준다', async () => {
	const { platform } = setup();
	const body = { token: await token() };
	const miss = await call(POST, { body: { ...body, jamo: NEAR }, platform });
	assert.deepEqual(miss.json, { ok: true, marks: ['p', 'c', 'c', 'p', 'p', 'a'] });
	const win = await call(POST, { body: { ...body, jamo: BANANA.jamo }, platform });
	assert.deepEqual(win.json, { ok: true, marks: Array(6).fill('c'), word: '바나나' });
});

test('조회는 valid 한 행, 그다음 정답 풀 한 행(t, n, idx)이다', async () => {
	const { db, platform } = setup();
	await call(POST, { body: { token: await token(), jamo: NEAR }, platform });
	assert.deepEqual(db.queries, [
		{ sql: VALID_SQL, args: [NEAR] },
		{ sql: AT_SQL, args: [3, 6, 0] }
	]);
});

test('사전에 없는 말은 invalid로 답하고 정답 풀을 읽지 않는다', async () => {
	const { db, platform } = setup();
	const res = await call(POST, { body: { token: await token(), jamo: 'ㅂㅏㄴㅏㄴㅂ' }, platform });
	assert.equal(res.status, 200);
	assert.deepEqual(res.json, { ok: false, reason: 'invalid' });
	assert.deepEqual(db.queries.map((q) => q.sql), [VALID_SQL]);
});

test('토큰이 없거나 위조·다른 시크릿·깨졌으면 D1을 읽지 않고 400 bad token', async () => {
	const { db, platform } = setup();
	const good = await token();
	const [n, t, idx, sig] = good.split('.');
	const bad = [
		{ raw: 'not json' },
		{ raw: 'null' },
		{ body: { jamo: NEAR } },
		{ body: { token: 5, jamo: NEAR } },
		{ body: { token: '', jamo: NEAR } },
		{ body: { token: await token({ n: 6, t: 3, idx: 0 }, 'other-secret'), jamo: NEAR } },
		{ body: { token: `${n}.${t}.1.${sig}`, jamo: NEAR } },
		{ body: { token: `${n}.1.${idx}.${sig}`, jamo: NEAR } },
		{ body: { token: `${good}x`, jamo: NEAR } }
	];
	for (const input of bad) {
		const res = await call(POST, { ...input, platform });
		assert.deepEqual([res.status, res.message], [400, 'bad token'], JSON.stringify(input).slice(0, 60));
	}
	assert.equal(db.queries.length, 0);
});

test('추측이 토큰의 길이와 다르거나 자모가 아니면 D1을 읽지 않고 400 bad guess', async () => {
	const { db, platform } = setup();
	const t = await token();
	for (const jamo of [undefined, null, 5, [...BANANA.jamo], 'ㅂㅏㄴㅏㄴ', 'ㅂㅏㄴㅏㄴㅏㅏ', 'abcdef', 'ㄲㄲㄲㄲㄲㄲ', '바나나나나나', '']) {
		const res = await call(POST, { body: { token: t, jamo }, platform });
		assert.deepEqual([res.status, res.message], [400, 'bad guess'], JSON.stringify(jamo));
	}
	assert.equal(db.queries.length, 0);
});

test('길이 검사의 기준은 요청이 아니라 토큰의 n이다', async () => {
	const db = new FakeD1({ valid: ['ㅂㅏㄴㅏㄴㅏㅁ'], pool: { '1:7': [{ word: '바나나몸', jamo: 'ㅂㅏㄴㅏㄴㅏㅁ' }] } });
	const platform = platformOf({ DB: db });
	const res = await call(POST, { body: { token: await token({ n: 7, t: 1, idx: 0 }), jamo: 'ㅂㅏㄴㅏㄴㅏㅁ' }, platform });
	assert.equal(res.json.word, '바나나몸');
	assert.deepEqual(db.queries.at(-1).args, [1, 7, 0]);
	assert.equal((await call(POST, { body: { token: await token({ n: 7, t: 1, idx: 0 }), jamo: BANANA.jamo }, platform })).status, 400);
});

test('토큰의 idx가 풀 밖이면(사전 갱신 뒤 낡은 토큰) 사전에 있는 추측에서 500, 없는 추측은 invalid', async () => {
	const { db, platform } = setup();
	const stale = await token({ n: 6, t: 3, idx: 5 });
	const res = await call(POST, { body: { token: stale, jamo: NEAR }, platform });
	assert.equal(res.status, 500);
	assert.match(res.crashed.message, /pool miss t=3 n=6 idx=5/);
	assert.deepEqual((await call(POST, { body: { token: stale, jamo: 'ㅂㅏㄴㅏㄴㅂ' }, platform })).json, { ok: false, reason: 'invalid' });
	assert.equal(db.count('at'), 1);
});

test('D1 오류는 던져진다(SvelteKit이 500으로 바꾼다)', async () => {
	const { db, platform } = setup();
	db.failWith = new Error('d1 down');
	const res = await call(POST, { body: { token: await token(), jamo: NEAR }, platform });
	assert.equal(res.status, 500);
	assert.equal(res.crashed.message, 'd1 down');
});

test('KORDLE_SECRET이 없으면 dev-only-secret으로 서명한 토큰만 받는다', async () => {
	const { platform } = setup({ KORDLE_SECRET: undefined });
	assert.equal((await call(POST, { body: { token: await token(undefined, 'dev-only-secret'), jamo: NEAR }, platform })).status, 200);
	assert.equal((await call(POST, { body: { token: await token(), jamo: NEAR }, platform })).status, 400);
});

test('platform·DB가 없으면 500', async () => {
	for (const platform of [undefined, { env: {} }]) assert.equal((await call(POST, { body: {}, platform })).status, 500);
});
