import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_ALPHABET, CODE_RE } from '../src/lib/mp/rules.ts';
import { isCode, newCode } from '../src/lib/server/mp/code.ts';
import { seeded } from './mp-helpers.mjs';

test('알파벳은 32자: 대문자 24 + 숫자 8, 0 O 1 I 없음', () => {
	assert.equal(CODE_ALPHABET.length, 32);
	assert.equal(new Set(CODE_ALPHABET).size, 32);
	assert.equal([...CODE_ALPHABET].filter((c) => /[A-Z]/.test(c)).length, 24);
	assert.equal([...CODE_ALPHABET].filter((c) => /[0-9]/.test(c)).length, 8);
	for (const bad of '0O1I') assert.ok(!CODE_ALPHABET.includes(bad), bad);
});

test('새 코드는 항상 6자이고 알파벳 안에서만 나온다', () => {
	const rng = seeded(3);
	for (let i = 0; i < 2000; i++) {
		const code = newCode(rng);
		assert.equal(code.length, 6);
		assert.match(code, CODE_RE);
		assert.ok(isCode(code));
	}
});

test('난수 함수는 알파벳 크기로 호출되고 경계 값에서도 범위를 벗어나지 않는다', () => {
	assert.equal(newCode(() => 0), 'AAAAAA');
	assert.equal(newCode((max) => (assert.equal(max, 32), max - 1)), '999999');
});

test('isCode: 소문자·길이 다름·혼동 문자·문자열이 아닌 값을 거부한다', () => {
	assert.ok(isCode('ABC234'));
	assert.ok(!isCode('abc234'));
	assert.ok(!isCode('ABC2345'));
	assert.ok(!isCode('ABC23'));
	assert.ok(!isCode(''));
	for (const bad of ['ABC230', 'ABCO34', 'ABC134', 'ABCI34']) assert.ok(!isCode(bad), bad);
	assert.ok(!isCode('ABC234\n'));
	assert.ok(!isCode(null));
	assert.ok(!isCode(123456));
});
