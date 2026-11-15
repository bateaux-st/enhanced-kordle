import assert from 'node:assert/strict';
import test from 'node:test';
import { installLocalStorage } from './fake-local-storage.mjs';
import { clearSession, readSession, writeName, writeSession } from '../src/lib/mp/identity.ts';

const KEY = 'nkordle:mp-session';
const NAME = '철수철수철';
const stored = (values) => JSON.parse(values.get(KEY));

test('readSession: 만료 시각 당일까지는 살리고 지나면 지운다', (t) => {
	const values = installLocalStorage(t, { [KEY]: JSON.stringify({ name: NAME, token: 't', exp: 100 }) });
	assert.deepEqual(readSession(100), { name: NAME, token: 't', exp: 100 });
	assert.ok(values.has(KEY));
	assert.equal(readSession(101), null);
	assert.equal(values.has(KEY), false);
});

test('readSession: 형식이 틀린 기록은 null로 돌려주고 지운다', (t) => {
	const bad = [{ name: NAME, token: 't' }, { name: NAME, exp: 1 }, { name: 1 }, { name: NAME, token: 5, exp: 1 }, { token: 't', exp: 1 }, 'x'];
	const values = installLocalStorage(t);
	for (const v of bad) {
		values.set(KEY, JSON.stringify(v));
		assert.equal(readSession(0), null, JSON.stringify(v));
		assert.equal(values.has(KEY), false, JSON.stringify(v));
	}
});

test('readSession: 닉네임이 최소 길이 미만인 옛 기록은 null이지만 기록은 남긴다', (t) => {
	const values = installLocalStorage(t, { [KEY]: JSON.stringify({ name: '철수철수' }) });
	assert.equal(readSession(0), null);
	assert.ok(values.has(KEY));
});

test('readSession: 저장된 것이 없으면 null', (t) => {
	installLocalStorage(t);
	assert.equal(readSession(0), null);
});

test('writeName: 살아 있는 토큰과 만료 시각은 두고 이름만 바꾼다', (t) => {
	const values = installLocalStorage(t, { [KEY]: JSON.stringify({ name: NAME, token: 't', exp: Date.now() + 60_000 }) });
	const { exp } = stored(values);
	writeName('영희영희영');
	assert.deepEqual(stored(values), { token: 't', exp, name: '영희영희영' });
});

test('writeName: 저장된 세션이 없으면 이름만 쓴다', (t) => {
	const values = installLocalStorage(t);
	writeName(NAME);
	assert.deepEqual(stored(values), { name: NAME });
});

test('writeName: 만료된 토큰은 버리고 이름만 남긴다', (t) => {
	const values = installLocalStorage(t, { [KEY]: JSON.stringify({ name: NAME, token: 't', exp: Date.now() - 1 }) });
	writeName('영희영희영');
	assert.deepEqual(stored(values), { name: '영희영희영' });
});

test('writeSession: 서버가 준 세션으로 통째로 덮어쓴다', (t) => {
	const values = installLocalStorage(t, { [KEY]: JSON.stringify({ name: NAME, token: 'old', exp: 5 }) });
	writeSession({ token: 'new', exp: 999 }, '영희영희영');
	assert.deepEqual(stored(values), { token: 'new', name: '영희영희영', exp: 999 });
});

test('clearSession: 세션 키만 지우고 다른 nkordle: 키와 접두사 없는 키는 둔다', (t) => {
	const values = installLocalStorage(t, { [KEY]: '{}', 'nkordle:config': '{}', 'mp-session': 'x' });
	clearSession();
	assert.deepEqual([...values.keys()].sort(), ['mp-session', 'nkordle:config']);
});
