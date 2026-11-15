// SvelteKit 라우트 핸들러를 Node에서 부르는 도구. .test.mjs가 아니라서 테스트로 실행되지 않는다.
// 라우트·src/lib/server/env.ts는 $lib 별칭을 쓰므로 loader.mjs 뒤에 동적 import해야 한다.
import { isHttpError } from '@sveltejs/kit';
import './loader.mjs';
import { FakeD1 } from './do-runtime.mjs';

export { FakeD1 };

/** src/routes/<path>/+server.ts(또는 src/hooks.server.ts)의 export들. */
export const loadRoute = (path) => import(new URL(`../src/routes/${path}/+server.ts`, import.meta.url).href);
export const loadHooks = () => import(new URL('../src/hooks.server.ts', import.meta.url).href);

/** platform.env. over에 undefined를 주면 그 바인딩이 없는 환경이 된다. */
export const platformOf = (over = {}) => ({ env: { DB: new FakeD1(), KORDLE_SECRET: 'test-secret', ...over } });

/**
 * 핸들러를 부르고 SvelteKit이 클라이언트에 줄 모양으로 돌려준다.
 * error()가 던진 HttpError는 { status, message }, 그 밖의 예외는 SvelteKit이 500으로 바꾸므로 { status: 500, crashed }.
 */
export async function call(handler, { method = 'POST', body, raw, platform, params = {}, url = 'https://kordle.test/api/x' } = {}) {
	const init = { method };
	if (method !== 'GET') init.body = raw ?? (body === undefined ? undefined : JSON.stringify(body));
	try {
		const res = await handler({ request: new Request(url, init), platform, params, url: new URL(url) });
		return { status: res.status, json: await res.json(), headers: res.headers };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, message: e.body.message };
		return { status: 500, crashed: e };
	}
}

/** DO 네임스페이스 대역. methods(이름)가 그 DO 스텁의 메서드 구현을 돌려준다. 호출은 calls에 쌓인다. */
export function fakeNs(methods) {
	const ns = {
		names: [],
		calls: [],
		idFromName(name) {
			ns.names.push(name);
			return { name };
		},
		get(id) {
			const impl = methods(id.name);
			return Object.fromEntries(
				Object.entries(impl).map(([method, fn]) => [
					method,
					(...args) => {
						ns.calls.push({ name: id.name, method, args });
						return fn(...args);
					}
				])
			);
		}
	};
	return ns;
}
