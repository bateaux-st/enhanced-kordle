import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { compileModule } from 'svelte/compiler';

// daily.test.mjs와 같은 방식으로 실제 Game을 컴파일한다.
const file = new URL('../src/lib/game.svelte.ts', import.meta.url);
const { js } = compileModule(stripTypeScriptTypes(readFileSync(file, 'utf8')), { filename: file.pathname, generate: 'client' });
const code = js.code.replace(/from '([^']+)'/g, (_, id) =>
	`from '${id.startsWith('.') ? new URL(id + '.ts', file).href : import.meta.resolve(id)}'`);
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

// win이면 모든 마크가 c, 아니면 a. word를 실을지는 서버 몫이라 mock이 직접 정한다.
function setup(t, { win, word }) {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const values = new Map();
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
		get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null,
		getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k)
	} });
	t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage);
	const urls = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		urls.push(url);
		const body = JSON.parse(options.body);
		if (url === '/api/game') return Response.json({ n: 6, token: 'tok' });
		if (url === '/api/guess') {
			return Response.json(win
				? { ok: true, marks: Array(6).fill('c'), ...(word && { word }) }
				: { ok: true, marks: Array(6).fill('a') });
		}
		if (url === '/api/reveal') return Response.json({ word: '정답' });
		throw new Error(`Unexpected request: ${url} ${JSON.stringify(body)}`);
	});
	return urls;
}

async function start() {
	const game = new Game();
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	return game;
}

test('승리 응답에 word가 있으면 reveal을 부르지 않고 그 값을 정답으로 쓴다', async (t) => {
	const urls = setup(t, { win: true, word: '바나나' });
	const game = await start();
	game.current = 'ㄱ'.repeat(game.n);
	await game.submit();
	assert.equal(game.status, 'won');
	assert.equal(game.answer, '바나나');
	assert.ok(!urls.includes('/api/reveal'));
	assert.equal(game.stats.won, 1);
});

test('승리 응답에 word가 없으면 reveal로 받아 온다', async (t) => {
	const urls = setup(t, { win: true });
	const game = await start();
	game.current = 'ㄱ'.repeat(game.n);
	await game.submit();
	assert.equal(game.status, 'won');
	assert.equal(game.answer, '정답');
	assert.equal(urls.filter((u) => u === '/api/reveal').length, 1);
});

test('시도를 모두 쓴 패배는 reveal을 부른다', async (t) => {
	const urls = setup(t, { win: false });
	const game = await start();
	for (let i = 0; i < game.maxTries; i++) {
		game.current = 'ㄱ'.repeat(game.n);
		await game.submit();
	}
	assert.equal(game.status, 'lost');
	assert.equal(game.answer, '정답');
	assert.equal(urls.filter((u) => u === '/api/reveal').length, 1);
});

test('포기는 reveal을 부른다', async (t) => {
	const urls = setup(t, { win: false });
	const game = await start();
	await game.giveUp();
	assert.equal(game.status, 'lost');
	assert.equal(game.answer, '정답');
	assert.equal(urls.filter((u) => u === '/api/reveal').length, 1);
});
