import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeToken } from '../src/lib/server/token.ts';
import { call, FakeD1, loadRoute, platformOf } from './route-runtime.mjs';

const { POST } = await loadRoute('api/reveal');

const SECRET = 'test-secret';
const AT_SQL = 'SELECT word, jamo FROM pool WHERE t = ? AND n = ? AND idx = ?';
const POOL = { '3:6': [{ word: '바나나', jamo: 'ㅂㅏㄴㅏㄴㅏ' }, { word: '나바나', jamo: 'ㄴㅏㅂㅏㄴㅏ' }], '1:7': [{ word: '바나나몸', jamo: 'ㅂㅏㄴㅏㄴㅏㅁ' }] };

const token = (a = { n: 6, t: 3, idx: 0 }, secret = SECRET) => encodeToken(a, secret);

function setup(over = {}) {
	const db = new FakeD1({ pool: POOL });
	return { db, platform: platformOf({ DB: db, ...over }) };
}

test('토큰이 가리키는 (t, n, idx)의 단어를 주고 조회는 풀 한 행이다', async () => {
	const { db, platform } = setup();
	assert.deepEqual((await call(POST, { body: { token: await token() }, platform })).json, { word: '바나나' });
	assert.deepEqual((await call(POST, { body: { token: await token({ n: 6, t: 3, idx: 1 }) }, platform })).json, { word: '나바나' });
	assert.deepEqual((await call(POST, { body: { token: await token({ n: 7, t: 1, idx: 0 }) }, platform })).json, { word: '바나나몸' });
	assert.deepEqual(db.queries, [
		{ sql: AT_SQL, args: [3, 6, 0] },
		{ sql: AT_SQL, args: [3, 6, 1] },
		{ sql: AT_SQL, args: [1, 7, 0] }
	]);
});

test('응답에는 단어만 있고 자모열은 싣지 않는다', async () => {
	const { platform } = setup();
	assert.deepEqual(Object.keys((await call(POST, { body: { token: await token() }, platform })).json), ['word']);
});

test('토큰이 없거나 위조·다른 시크릿·깨졌으면 D1을 읽지 않고 400 bad token', async () => {
	const { db, platform } = setup();
	const good = await token();
	const [n, t, , sig] = good.split('.');
	for (const input of [{ raw: 'not json' }, { raw: '' }, { raw: 'null' }, { body: {} }, { body: { token: 6 } }, { body: { token: await token(undefined, 'other-secret') } }, { body: { token: `${n}.${t}.1.${sig}` } }, { body: { token: 'invalid' } }]) {
		const res = await call(POST, { ...input, platform });
		assert.deepEqual([res.status, res.message], [400, 'bad token'], JSON.stringify(input).slice(0, 50));
	}
	assert.equal(db.queries.length, 0);
});

test('풀 밖 idx와 D1 오류는 던져진다(SvelteKit이 500으로 바꾼다)', async () => {
	const { db, platform } = setup();
	const stale = await call(POST, { body: { token: await token({ n: 6, t: 3, idx: 2 }) }, platform });
	assert.equal(stale.status, 500);
	assert.match(stale.crashed.message, /pool miss t=3 n=6 idx=2/);
	db.failWith = new Error('d1 down');
	assert.equal((await call(POST, { body: { token: await token() }, platform })).crashed.message, 'd1 down');
});

test('KORDLE_SECRET이 없으면 dev-only-secret으로 서명한 토큰만 받고, platform이 없으면 500', async () => {
	const { platform } = setup({ KORDLE_SECRET: undefined });
	assert.equal((await call(POST, { body: { token: await token(undefined, 'dev-only-secret') }, platform })).status, 200);
	assert.equal((await call(POST, { body: { token: await token() }, platform })).status, 400);
	for (const p of [undefined, { env: {} }]) assert.equal((await call(POST, { body: {}, platform: p })).status, 500);
});
