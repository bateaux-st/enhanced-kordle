import assert from 'node:assert/strict';
import test from 'node:test';
import { isHttpError } from '@sveltejs/kit';
import './loader.mjs';
import { FakeD1 } from './do-runtime.mjs';

const { ctx } = await import('../src/lib/server/env.ts');

const thrown = (fn) => {
	try {
		fn();
	} catch (e) {
		return e;
	}
	assert.fail('던지지 않았다');
};

test('platform이나 DB 바인딩이 없으면 500 platform bindings not available', () => {
	for (const platform of [undefined, {}, { env: {} }, { env: { KORDLE_SECRET: 'x' } }]) {
		const e = thrown(() => ctx(platform));
		assert.ok(isHttpError(e));
		assert.deepEqual([e.status, e.body.message], [500, 'platform bindings not available']);
	}
});

test('D1을 dict로 감싸고 시크릿은 KORDLE_SECRET, 없으면 dev 기본값', async () => {
	const db = new FakeD1({ valid: ['ㅂㅏㄴㅏㄴㅏ'] });
	const withSecret = ctx({ env: { DB: db, KORDLE_SECRET: 'prod-secret' } });
	assert.equal(withSecret.secret, 'prod-secret');
	assert.equal(await withSecret.db.isValidJamo('ㅂㅏㄴㅏㄴㅏ'), true);
	assert.equal(db.queries.length, 1, '같은 DB 바인딩을 쓴다');
	assert.equal(ctx({ env: { DB: db } }).secret, 'dev-only-secret');
	assert.deepEqual(Object.keys(withSecret.db).sort(), ['answerAt', 'answerCount', 'isValidJamo']);
});
