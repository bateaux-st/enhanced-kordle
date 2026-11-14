import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeToken } from '../src/lib/server/token.ts';
import { call, FakeD1, loadRoute, platformOf } from './route-runtime.mjs';

const { POST } = await loadRoute('api/hint');

const SECRET = 'test-secret';
// ㅂㅏㄴㅏㄴㅏ: ㅏ는 1·3·5번, ㄴ은 2·4번 자리에 있다.
const BANANA = { word: '바나나', jamo: 'ㅂㅏㄴㅏㄴㅏ' };
const AT_SQL = 'SELECT word, jamo FROM pool WHERE t = ? AND n = ? AND idx = ?';

const token = (a = { n: 6, t: 3, idx: 0 }, secret = SECRET) => encodeToken(a, secret);

function setup(over = {}) {
	const db = new FakeD1({ pool: { '3:6': [BANANA] } });
	return { db, platform: platformOf({ DB: db, ...over }) };
}

test('이미 찾은 자리(known)를 뺀 첫 자리를 알려 주고 다 찾았으면 400', async () => {
	const { platform } = setup();
	const t = await token();
	const pos = async (jamo, known) => call(POST, { body: { token: t, jamo, known }, platform });
	assert.deepEqual((await pos('ㅏ', [])).json, { pos: 1 });
	assert.deepEqual((await pos('ㅏ', [1])).json, { pos: 3 });
	assert.deepEqual((await pos('ㅏ', [1, 3])).json, { pos: 5 });
	assert.deepEqual((await pos('ㄴ', [2])).json, { pos: 4 });
	assert.deepEqual((await pos('ㅂ', [])).json, { pos: 0 });
	const done = await pos('ㅏ', [1, 3, 5]);
	assert.deepEqual([done.status, done.message], [400, 'no unknown position']);
});

test('known이 없거나 정수 배열이 아니면 빈 목록으로 본다(구버전 클라이언트)', async () => {
	const { platform } = setup();
	const t = await token();
	for (const known of [undefined, null, 'ㅏ', [1.5], ['1'], [null], { 0: 1 }]) {
		const res = await call(POST, { body: { token: t, jamo: 'ㅏ', known }, platform });
		assert.deepEqual(res.json, { pos: 1 }, JSON.stringify(known));
	}
});

test('조회는 정답 풀 한 행(t, n, idx)뿐이고 valid는 읽지 않는다', async () => {
	const { db, platform } = setup();
	await call(POST, { body: { token: await token(), jamo: 'ㅏ' }, platform });
	assert.deepEqual(db.queries, [{ sql: AT_SQL, args: [3, 6, 0] }]);
});

test('정답에 없는 자모는 400 jamo not in answer', async () => {
	const { db, platform } = setup();
	const res = await call(POST, { body: { token: await token(), jamo: 'ㅋ' }, platform });
	assert.deepEqual([res.status, res.message], [400, 'jamo not in answer']);
	assert.equal(db.queries.length, 1, '정답을 읽은 뒤에 가른다');
});

test('토큰이 잘못이면 D1을 읽지 않고 400 bad token(자모 검사보다 먼저)', async () => {
	const { db, platform } = setup();
	const good = await token();
	for (const input of [{ raw: 'not json' }, { raw: 'null' }, { body: { jamo: 'ㅏ' } }, { body: { token: 5, jamo: 'ㅏ' } }, { body: { token: await token(undefined, 'other'), jamo: 'ㅏ' } }, { body: { token: `${good}x`, jamo: 'bad' } }]) {
		const res = await call(POST, { ...input, platform });
		assert.deepEqual([res.status, res.message], [400, 'bad token'], JSON.stringify(input).slice(0, 50));
	}
	assert.equal(db.queries.length, 0);
});

test('자모가 아니면 D1을 읽지 않고 400 bad jamo', async () => {
	const { db, platform } = setup();
	const t = await token();
	for (const jamo of ['a', 'ㄲ', 'ㅏㅏ', '', '가', 5]) {
		const res = await call(POST, { body: { token: t, jamo }, platform });
		assert.deepEqual([res.status, res.message], [400, 'bad jamo'], JSON.stringify(jamo));
	}
	assert.equal(db.queries.length, 0);
});

// isJamo가 jamo.length를 먼저 읽어 undefined·null이면 TypeError가 난다(src 수정은 이번 범위 밖).
test('jamo가 없거나 null이면 500이 아니라 400 bad jamo', { todo: 'api/hint: isJamo(undefined)가 TypeError를 던져 500이 된다' }, async () => {
	const { platform } = setup();
	const t = await token();
	for (const body of [{ token: t }, { token: t, jamo: null }]) {
		const res = await call(POST, { body, platform });
		assert.deepEqual([res.status, res.message], [400, 'bad jamo'], JSON.stringify(body));
	}
});

test('토큰의 idx가 풀 밖이면 500, D1 오류도 던져진다', async () => {
	const { db, platform } = setup();
	const stale = await call(POST, { body: { token: await token({ n: 6, t: 3, idx: 9 }), jamo: 'ㅏ' }, platform });
	assert.equal(stale.status, 500);
	assert.match(stale.crashed.message, /pool miss t=3 n=6 idx=9/);
	db.failWith = new Error('d1 down');
	assert.equal((await call(POST, { body: { token: await token(), jamo: 'ㅏ' }, platform })).crashed.message, 'd1 down');
});

test('KORDLE_SECRET이 없으면 dev-only-secret으로 서명한 토큰만 받고, platform이 없으면 500', async () => {
	const { platform } = setup({ KORDLE_SECRET: undefined });
	assert.equal((await call(POST, { body: { token: await token(undefined, 'dev-only-secret'), jamo: 'ㅏ' }, platform })).status, 200);
	assert.equal((await call(POST, { body: { token: await token(), jamo: 'ㅏ' }, platform })).status, 400);
	assert.equal((await call(POST, { body: {}, platform: undefined })).status, 500);
});
