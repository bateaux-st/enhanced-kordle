import assert from 'node:assert/strict';
import test from 'node:test';
import { installLocalStorage } from './fake-local-storage.mjs';
import { load, removeWhere, save } from '../src/lib/storage.ts';

const quota = () => { throw new DOMException('quota', 'QuotaExceededError'); };

test('load: 저장된 JSON은 파싱해 돌려주고 없으면 fallback', (t) => {
	installLocalStorage(t, { 'nkordle:config': '{"mode":"daily"}' });
	assert.deepEqual(load('config', null), { mode: 'daily' });
	const fb = { mode: 'free' };
	assert.equal(load('missing', fb), fb);
});

test('load: 손상된 JSON은 던지지 않고 fallback 그대로', (t) => {
	installLocalStorage(t, { 'nkordle:config': '{bad' });
	const fb = { mode: 'free' };
	assert.equal(load('config', fb), fb);
});

test('load: getItem이 던져도 fallback', (t) => {
	installLocalStorage(t, {}, { getItem: () => { throw new Error('denied'); } });
	assert.equal(load('config', 7), 7);
});

// 값이 JSON null이면 fallback이 아니라 null이 나가 Game의 settings 읽기(.maxTries)가 TypeError로 부팅을 막는다.
test('load: JSON null은 fallback으로 처리한다', { todo: '앱 버그: 손으로 고친 null이 그대로 나간다' }, (t) => {
	installLocalStorage(t, { 'nkordle:settings': 'null' });
	assert.deepEqual(load('settings', {}), {});
});

test('save: 접두사를 붙여 JSON으로 쓴다', (t) => {
	const values = installLocalStorage(t);
	save('config', { a: 1 });
	assert.equal(values.get('nkordle:config'), '{"a":1}');
});

test('save: setItem이 용량 초과로 던져도 던지지 않고 기존 값이 남는다', (t) => {
	const values = installLocalStorage(t, { 'nkordle:config': '{"a":0}' }, { setItem: quota });
	assert.doesNotThrow(() => save('config', { a: 1 }));
	assert.equal(values.get('nkordle:config'), '{"a":0}');
});

test('localStorage가 없는 환경에서 load·save·removeWhere는 아무 일도 하지 않는다', (t) => {
	installLocalStorage(t);
	delete globalThis.localStorage;
	assert.equal(load('x', 7), 7);
	assert.doesNotThrow(() => save('x', 1));
	assert.doesNotThrow(() => removeWhere(() => true));
});

test('removeWhere: 접두사를 뗀 키로 판정하고 뒤에서부터 지워 건너뛰는 키가 없다', (t) => {
	// 'zzzzzzz:daily:y'는 접두사(8자)를 잘라내면 'daily:y'가 되어, 접두사 확인이 없으면 판정을 통과해 지워진다.
	const values = installLocalStorage(t, {
		'nkordle:daily:2026-01-01:t': '1', 'nkordle:daily:2026-01-02:t': '1', 'nkordle:config': '1',
		'nkordle:daily:2026-01-03:t': '1', 'other:daily:x': '1', 'zzzzzzz:daily:y': '1'
	});
	const seen = [];
	removeWhere((k) => (seen.push(k), k.startsWith('daily:')));
	assert.deepEqual([...values.keys()].sort(), ['nkordle:config', 'other:daily:x', 'zzzzzzz:daily:y']);
	assert.equal(seen.length, 4);
	assert.ok(seen.every((k) => !k.startsWith('nkordle:')));
});
