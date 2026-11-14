import assert from 'node:assert/strict';
import test from 'node:test';
import { call, FakeD1, loadRoute, platformOf } from './route-runtime.mjs';

const { POST } = await loadRoute('api/check');
const WORD = 'ㅂㅏㄴㅏㄴㅏ';

test('사전에 있는 자모열은 valid true, 없으면 false이고 조회는 valid 한 행이다', async () => {
	const db = new FakeD1({ valid: [WORD] });
	const platform = platformOf({ DB: db });
	assert.deepEqual((await call(POST, { body: { jamo: WORD }, platform })).json, { valid: true });
	assert.deepEqual((await call(POST, { body: { jamo: 'ㅋㅋㅋㅋㅋㅋ' }, platform })).json, { valid: false });
	assert.deepEqual(db.queries, [
		{ sql: 'SELECT 1 FROM valid WHERE jamo = ?', args: [WORD] },
		{ sql: 'SELECT 1 FROM valid WHERE jamo = ?', args: ['ㅋㅋㅋㅋㅋㅋ'] }
	]);
});

test('길이는 5자부터 12자까지 받는다', async () => {
	const db = new FakeD1();
	const platform = platformOf({ DB: db });
	for (const n of [5, 12]) assert.equal((await call(POST, { body: { jamo: 'ㅂ'.repeat(n) }, platform })).status, 200, `n=${n}`);
	assert.equal(db.queries.length, 2);
});

test('잘못된 입력은 D1을 읽지 않고 400 bad jamo', async () => {
	const db = new FakeD1();
	const platform = platformOf({ DB: db });
	const bad = [
		{ raw: 'not json' },
		{ raw: '' },
		{ raw: 'null' },
		{ body: {} },
		{ body: { jamo: 123456 } },
		{ body: { jamo: [...WORD] } },
		{ body: { jamo: 'ㅂㅏㄴㅏ' } },
		{ body: { jamo: 'ㅂ'.repeat(13) } },
		{ body: { jamo: 'abcdef' } },
		{ body: { jamo: 'ㄲㄲㄲㄲㄲ' } },
		{ body: { jamo: '바나나나나나' } },
		{ body: { jamo: '🐻🐻🐻' } }
	];
	for (const input of bad) {
		const res = await call(POST, { ...input, platform });
		assert.deepEqual([res.status, res.message], [400, 'bad jamo'], JSON.stringify(input));
	}
	assert.equal(db.queries.length, 0);
});

test('platform이나 DB 바인딩이 없으면 500(입력 검사보다 먼저)', async () => {
	for (const platform of [undefined, { env: {} }, platformOf({ DB: undefined })]) {
		const res = await call(POST, { body: { jamo: 'ㅂ' }, platform });
		assert.deepEqual([res.status, res.message], [500, 'platform bindings not available']);
	}
});

test('D1 오류는 그대로 던져진다(SvelteKit이 500으로 바꾼다)', async () => {
	const db = new FakeD1();
	db.failWith = new Error('d1 down');
	const res = await call(POST, { body: { jamo: WORD }, platform: platformOf({ DB: db }) });
	assert.equal(res.status, 500);
	assert.equal(res.crashed.message, 'd1 down');
});
