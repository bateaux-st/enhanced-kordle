import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/lib/mp/rules.ts';
import { MAX_RAW_LENGTH, parseClientMsg } from '../src/lib/server/mp/parse.ts';

const p = (v) => parseClientMsg(typeof v === 'string' ? v : JSON.stringify(v));

test('올바른 메시지는 필요한 필드만 복사해 돌려준다', () => {
	assert.deepEqual(p({ type: 'hello', name: '철수', token: 'mp1.x', extra: 1 }), { type: 'hello', token: 'mp1.x', name: '철수' });
	assert.deepEqual(p({ type: 'hello', name: '철수' }), { type: 'hello', token: undefined, name: '철수' });
	assert.deepEqual(p({ type: 'ready', on: true }), { type: 'ready', on: true });
	assert.deepEqual(p({ type: 'guess', jamo: 'ㄴㅏㄴㅂㅏㅇ', pid: 'x' }), { type: 'guess', jamo: 'ㄴㅏㄴㅂㅏㅇ' });
	assert.deepEqual(p({ type: 'start' }), { type: 'start', kickDisconnected: undefined });
	assert.deepEqual(p({ type: 'start', kickDisconnected: true }), { type: 'start', kickDisconnected: true });
	assert.deepEqual(p({ type: 'eliminate', pid: 'pabc1234' }), { type: 'eliminate', pid: 'pabc1234' });
	for (const type of ['nudge', 'leave', 'hint', 'giveup', 'close', 'again']) assert.deepEqual(p({ type }), { type });
	assert.deepEqual(p({ type: 'settings', settings: DEFAULT_SETTINGS }), { type: 'settings', settings: DEFAULT_SETTINGS });
});

test('JSON이 아니거나 객체가 아니거나 type을 모르면 null', () => {
	for (const bad of ['', 'ping', '{', '[]', 'null', '42', '"x"', { type: 'nope' }, { type: 1 }, {}]) assert.equal(p(bad), null, JSON.stringify(bad));
});

test('필드 타입·길이가 어긋나면 null', () => {
	const bad = [
		{ type: 'hello' },
		{ type: 'hello', name: 5 },
		{ type: 'hello', name: 'x'.repeat(65) },
		{ type: 'hello', name: '철수', token: 7 },
		{ type: 'hello', name: '철수', token: 'x'.repeat(513) },
		{ type: 'ready', on: 'yes' },
		{ type: 'ready' },
		{ type: 'guess' },
		{ type: 'guess', jamo: '' },
		{ type: 'guess', jamo: 'ㄴㅏㄴㅂㅏㅇㅇㅇㅇㅇㅇㅇㅇ' },
		{ type: 'guess', jamo: '난방' },
		{ type: 'guess', jamo: 'ㄴㅏㄴㅂㅏA' },
		{ type: 'guess', jamo: ['ㄴ'] },
		{ type: 'start', kickDisconnected: 1 },
		{ type: 'settings' },
		{ type: 'settings', settings: { ...DEFAULT_SETTINGS, tries: 99 } },
		{ type: 'vote', candidate: -1 },
		{ type: 'vote', candidate: 1.5 },
		{ type: 'eliminate' },
		{ type: 'eliminate', pid: '' },
		{ type: 'eliminate', pid: 'p'.repeat(17) }
	];
	for (const m of bad) assert.equal(p(m), null, JSON.stringify(m));
});

test('너무 긴 원문은 파싱하지 않는다', () => {
	assert.equal(p(JSON.stringify({ type: 'hello', name: 'x', pad: 'y'.repeat(MAX_RAW_LENGTH) })), null);
});

test('next는 설정이 있으면 검사해서 복사하고, 범위 밖이면 거절한다', () => {
	assert.deepEqual(p({ type: 'next' }), { type: 'next' });
	assert.deepEqual(p({ type: 'next', settings: { ...DEFAULT_SETTINGS, extra: 1 } }), { type: 'next', settings: DEFAULT_SETTINGS });
	assert.equal(p({ type: 'next', settings: { ...DEFAULT_SETTINGS, tries: 99 } }), null);
});

test('기본 설정은 제한 시간을 끈다(5단계 전까지 서버가 집행하지 않는다)', () => {
	assert.equal(DEFAULT_SETTINGS.timer, false);
});
