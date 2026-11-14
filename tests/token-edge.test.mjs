import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeToken, encodeToken, randomIndex, seededIndex } from '../src/lib/server/token.ts';
import { issue, verify } from '../src/lib/server/mp/session.ts';

const SECRET = 'test-only-secret';
const NOW = 1_700_000_000_000;

test('정답 토큰: 서명이 base64url로 풀리지 않거나 자리가 틀리면 null이고 던지지 않는다', async () => {
	const token = await encodeToken({ n: 6, t: 3, idx: 4 }, SECRET);
	const [n, t, idx] = token.split('.');
	assert.equal(await decodeToken(`${n}.${t}.${idx}.A`, SECRET), null, '길이가 4n+1인 서명은 디코딩할 수 없다');
	assert.equal(await decodeToken(`${token}.x`, SECRET), null);
	assert.equal(await decodeToken(`-${token}`, SECRET), null);
	assert.equal(await decodeToken(`0${n}.${t}.${idx}.${token.split('.')[3]}`, SECRET), null, '서명한 적 없는 표기(앞의 0)는 거절한다');
	assert.equal(await decodeToken('', SECRET), null);
});

test('정답 토큰: 서명 길이를 줄이거나 늘려도 거절한다', async () => {
	const token = await encodeToken({ n: 6, t: 3, idx: 4 }, SECRET);
	const sig = token.split('.')[3];
	const head = token.split('.').slice(0, 3).join('.');
	assert.equal(await decodeToken(`${head}.${sig.slice(0, -2)}`, SECRET), null);
	assert.equal(await decodeToken(`${head}.${sig}AA`, SECRET), null);
});

test('randomIndex: 난수를 max로 나눈 나머지이고 max가 1이면 항상 0', (t) => {
	const draws = [0, 7, 0xffffffff];
	t.mock.method(crypto, 'getRandomValues', (arr) => {
		arr[0] = draws.shift();
		return arr;
	});
	assert.deepEqual([randomIndex(5), randomIndex(5), randomIndex(5)], [0, 2, 0]);
	assert.equal(randomIndex(1), 0);
});

test('seededIndex: 같은 시드는 같은 값, 범위는 [0, max)', async () => {
	for (const max of [1, 2, 174, 3701]) {
		const a = await seededIndex('2026-01-01:6', max);
		assert.equal(a, await seededIndex('2026-01-01:6', max));
		assert.ok(a >= 0 && a < max);
	}
});

test('세션: 디코딩할 수 없는 이름 조각은 던지지 않고 null', async () => {
	const { token } = await issue(undefined, '철수입니다', NOW, SECRET);
	const [p, uid, , iat, sig] = token.split('.');
	for (const name of ['A', '_w', '-8A', '']) assert.equal(await verify([p, uid, name, iat, sig].join('.'), NOW, SECRET), null, JSON.stringify(name));
});

test('세션: iat가 13자리 이상이거나 숫자가 아니면 거절한다', async () => {
	const { token } = await issue(undefined, '철수입니다', NOW, SECRET);
	const [p, uid, name, , sig] = token.split('.');
	for (const iat of ['1700000000000000', '17e8', '-1', '']) assert.equal(await verify([p, uid, name, iat, sig].join('.'), NOW, SECRET), null, iat);
});

test('세션: 발급 시각보다 조금 이른 시계의 isolate도 받아들인다', async () => {
	const { token } = await issue(undefined, '철수입니다', NOW, SECRET);
	assert.ok(await verify(token, NOW - 5000, SECRET));
});

test('세션: uid가 22자 base64url이 아니면 서명이 맞아도 거절한다', async () => {
	const { token } = await issue(undefined, '철수입니다', NOW, SECRET);
	const [p, , name, iat, sig] = token.split('.');
	for (const uid of ['short', 'x'.repeat(23), '!'.repeat(22)]) assert.equal(await verify([p, uid, name, iat, sig].join('.'), NOW, SECRET), null, uid);
});
