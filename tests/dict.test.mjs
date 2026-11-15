import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dict, POOL_THRESHOLD } from '../src/lib/server/dict.ts';
import { FakeD1 } from './do-runtime.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const WORD = { word: '바나나', jamo: 'ㅂㅏㄴㅏㄴㅏ' };

test('isValidJamo: valid 테이블에 있으면 true, 없으면 false, 조회는 자모열 하나를 바인드한다', async () => {
	const db = new FakeD1({ valid: [WORD.jamo] });
	assert.equal(await dict(db).isValidJamo(WORD.jamo), true);
	assert.equal(await dict(db).isValidJamo('ㅋㅋㅋㅋㅋㅋ'), false);
	assert.deepEqual(db.queries.map((q) => q.args), [[WORD.jamo], ['ㅋㅋㅋㅋㅋㅋ']]);
});

test('answerCount: pool_meta 행의 count, 행이 없으면 0', async () => {
	const db = new FakeD1({ pool: { '3:6': [WORD, WORD, WORD] } });
	assert.equal(await dict(db).answerCount(3, 6), 3);
	assert.equal(await dict(db).answerCount(3, 7), 0);
	assert.equal(await dict(db).answerCount(1, 6), 0, '임계값이 다르면 다른 풀이다');
	assert.deepEqual(db.queries.map((q) => q.args), [[3, 6], [3, 7], [1, 6]]);
});

test('answerAt: (t, n, idx) 행을 돌려주고, 행이 없으면 좌표를 담아 던진다', async () => {
	const other = { word: '나바나', jamo: 'ㄴㅏㅂㅏㄴㅏ' };
	const db = new FakeD1({ pool: { '3:6': [WORD, other] } });
	assert.deepEqual(await dict(db).answerAt(3, 6, 1), other);
	await assert.rejects(dict(db).answerAt(3, 6, 2), /pool miss t=3 n=6 idx=2/);
	await assert.rejects(dict(db).answerAt(3, 9, 0), /pool miss t=3 n=9 idx=0/);
});

test('D1 오류는 그대로 올라온다(호출하는 셸이 처리한다)', async () => {
	const db = new FakeD1();
	db.failWith = new Error('d1 down');
	await assert.rejects(dict(db).isValidJamo('ㅂ'), /d1 down/);
	await assert.rejects(dict(db).answerCount(3, 6), /d1 down/);
});

test('모든 조회는 PK 한 행이다: WHERE 등식만 쓰고 COUNT·OFFSET·범위·정렬·LIKE가 없다', () => {
	const src = read('../src/lib/server/dict.ts');
	const sqls = [...src.matchAll(/\.prepare\(\s*'([^']+)'/g)].map((m) => m[1]);
	assert.equal(sqls.length, 3);
	for (const sql of sqls) {
		assert.match(sql, /^SELECT [\w, ]+ FROM \w+ WHERE \w+ = \?( AND \w+ = \?)*$/, sql);
		assert.doesNotMatch(sql, /COUNT\s*\(|OFFSET|LIMIT|ORDER BY|BETWEEN|LIKE|[<>]/i, sql);
	}
});

test('정답 풀 임계값은 export_d1.py가 펼치는 THRESHOLDS 안에 있고 멀티 풀(t=3)도 그렇다', () => {
	const py = read('../export_d1.py');
	const thresholds = py.match(/^THRESHOLDS\s*=\s*\(([\d,\s]+)\)/m)[1].split(',').map((x) => Number(x.trim())).filter(Number.isFinite);
	assert.ok(thresholds.length > 0);
	for (const [mode, t] of Object.entries(POOL_THRESHOLD)) assert.ok(thresholds.includes(t), `${mode}: t=${t}`);
	const mpT = Number(read('../src/lib/server/mp/room.ts').match(/const MP_POOL_T = (\d+)/)[1]);
	assert.ok(thresholds.includes(mpT), `멀티 t=${mpT}`);
});
