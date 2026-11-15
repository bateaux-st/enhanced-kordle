import assert from 'node:assert/strict';
import test from 'node:test';
import { Game, setup } from './game-mock.mjs';

// 손으로 고치거나 옛 버전이 남긴 localStorage 값이 어긋나도 Game은 저장본이 없는 것처럼 뜬다.
const DEFAULT_CONFIG = { mode: 'daily', length: { kind: 'fixed', n: 6 } };

const brokenConfigs = {
	'length 없는 객체': '{"mode":"daily"}',
	숫자: '5',
	문자열: '"daily"',
	배열: '[]',
	'모르는 mode': '{"mode":"nope","length":{"kind":"random"}}',
	'n 없는 fixed': '{"mode":"daily","length":{"kind":"fixed"}}',
	'객체가 아닌 length': '{"mode":"daily","length":5}'
};

for (const [name, raw] of Object.entries(brokenConfigs)) {
	test(`config가 ${name}이면 기본 설정으로 뜬다`, (t) => {
		const { values } = setup(t);
		values.set('nkordle:config', raw);
		const game = new Game();
		assert.deepEqual(game.config, DEFAULT_CONFIG);
	});
}

test('정상 config는 그대로 복원된다', (t) => {
	const { values } = setup(t);
	for (const config of [
		{ mode: 'endless', length: { kind: 'fixed', n: 7 } },
		{ mode: 'climb-streak', length: { kind: 'random' } }
	]) {
		values.set('nkordle:config', JSON.stringify(config));
		assert.deepEqual(new Game().config, config);
	}
});
