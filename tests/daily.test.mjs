import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { compileModule } from 'svelte/compiler';
import { todayKST } from '../src/lib/day.ts';

// 실제 Game의 runes를 컴파일해서 검증한다. 상태 머신을 테스트용 구현으로 대체하지 않는다.
const file = new URL('../src/lib/game.svelte.ts', import.meta.url);
const { js } = compileModule(stripTypeScriptTypes(readFileSync(file, 'utf8')), { filename: file.pathname, generate: 'client' });
const code = js.code.replace(/from '([^']+)'/g, (_, id) =>
	`from '${id.startsWith('.') ? new URL(id + '.ts', file).href : import.meta.resolve(id)}'`);
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const before = Date.parse('2026-09-13T23:59:59+09:00');
const after = Date.parse('2026-09-14T00:00:01+09:00');

function setup(t) {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: before });
	const values = new Map();
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
		get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null,
		getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k)
	} });
	t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage);
	const requests = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		const body = JSON.parse(options.body);
		if (url === '/api/game') {
			requests.push(body);
			const n = body.n ?? 6;
			return Response.json({ n, token: `${body.mode}:${body.day ?? todayKST()}:${n}` });
		}
		if (url === '/api/guess') return Response.json({ ok: true, marks: Array(body.jamo.length).fill('c') });
		if (url === '/api/reveal') return Response.json({ word: '예시' });
		throw new Error(`Unexpected request: ${url}`);
	});
	return { values, requests };
}

async function win(game) {
	game.current = 'ㄱ'.repeat(game.n);
	await game.submit();
	assert.equal(game.status, 'won');
}

test('자정 뒤 완료한 데일리는 시작 날짜로 저장하고 새로고침하면 새 문제를 받는다', async (t) => {
	const { values, requests } = setup(t);
	const game = new Game();
	await game.newGame();
	t.mock.timers.setTime(after);
	await win(game);
	assert.ok([...values.keys()].some((k) => k.startsWith('nkordle:daily:2026-09-13:')));
	assert.ok(![...values.keys()].some((k) => k.startsWith('nkordle:daily:2026-09-14:')));
	await game.newGame();
	assert.equal(game.status, 'won');
	assert.equal(requests.at(-1).day, '2026-09-13');
	const refreshed = new Game();
	await refreshed.newGame();
	assert.equal(refreshed.status, 'playing');
	assert.equal(requests.at(-1).day, '2026-09-14');
});

test('일일 등반은 자정 뒤 다음 스테이지도 이전 날짜이며 새 날짜 코스를 덮어쓰지 않는다', async (t) => {
	const { values, requests } = setup(t);
	const game = new Game();
	game.config = { mode: 'daily-climb', length: { kind: 'fixed', n: 5 } };
	await game.newGame();
	await win(game);
	t.mock.timers.setTime(after);
	await game.nextStage();
	assert.equal(requests.at(-1).day, '2026-09-13');
	assert.equal(game.n, 6);
	await win(game);
	assert.equal(JSON.parse(values.get('nkordle:dclimb:2026-09-13')).stage, 2);
	assert.ok(!values.has('nkordle:dclimb:2026-09-14'));
	const refreshed = new Game();
	refreshed.config = game.config;
	await refreshed.newGame();
	assert.equal(refreshed.stage, 1);
	assert.equal(refreshed.n, 5);
	assert.equal(refreshed.status, 'playing');
	await win(refreshed);
	const todaySave = values.get('nkordle:dclimb:2026-09-14');
	const todayKeys = [...values.keys()].filter((k) => k.startsWith('nkordle:daily:2026-09-14:'));
	await game.nextStage();
	await win(game);
	assert.equal(values.get('nkordle:dclimb:2026-09-14'), todaySave);
	assert.ok(todayKeys.every((k) => values.has(k)));
});

test('자정 뒤 시작한 랜덤 게임에는 고정 날짜를 보내지 않는다', async (t) => {
	const { requests } = setup(t);
	const game = new Game();
	t.mock.timers.setTime(after);
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	assert.equal(requests.at(-1).day, undefined);
});
