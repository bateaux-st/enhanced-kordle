import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { compileModule } from 'svelte/compiler';

// reveal-fold.test.mjs와 같은 방식으로 실제 Game을 컴파일한다.
const file = new URL('../src/lib/game.svelte.ts', import.meta.url);
const { js } = compileModule(stripTypeScriptTypes(readFileSync(file, 'utf8')), { filename: file.pathname, generate: 'client' });
const code = js.code.replace(/from '([^']+)'/g, (_, id) =>
	`from '${id.startsWith('.') ? new URL(id + '.ts', file).href : import.meta.resolve(id)}'`);
export const { Game } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

/**
 * localStorage와 fetch를 가짜로 바꾼다. routes[url](body)가 Response(또는 그 Promise)를 돌려주고,
 * 길은 기본 응답 위에 덮어쓴다. 없는 길로 나간 요청은 테스트 버그라 던진다.
 */
export function setup(t, routes = {}) {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const values = new Map();
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
		get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null,
		getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k)
	} });
	t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage);
	const handlers = {
		'/api/game': () => Response.json({ n: 6, token: 'tok' }),
		'/api/guess': () => Response.json({ ok: true, marks: Array(6).fill('a') }),
		'/api/check': () => Response.json({ valid: true }),
		'/api/reveal': () => Response.json({ word: '정답' }),
		...routes
	};
	const calls = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		const body = JSON.parse(options.body);
		calls.push({ url, body });
		if (!handlers[url]) throw new Error(`Unexpected request: ${url} ${JSON.stringify(body)}`);
		return handlers[url](body);
	});
	return { calls, values };
}

export const serverError = () => new Response('mock failure', { status: 500 });

export async function start() {
	const game = new Game();
	game.config = { mode: 'endless', length: { kind: 'fixed', n: 6 } };
	await game.newGame();
	return game;
}
