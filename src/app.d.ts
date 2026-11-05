// See https://svelte.dev/docs/kit/types#app.d.ts
/// <reference types="@cloudflare/workers-types" />
declare global {
	namespace App {
		interface Platform {
			env: {
				/** 사전 (wrangler.jsonc d1_databases) */
				DB: D1Database;
				/** 정답 토큰 서명 키 (wrangler secret / .dev.vars) */
				KORDLE_SECRET?: string;
				/** 방 하나 = DO 하나 (wrangler.jsonc durable_objects). 타입 import만 쓴다 — 값 import하면 SvelteKit 번들이 cloudflare:workers를 풀어야 한다. */
				ROOM: DurableObjectNamespace<import('./lib/server/mp/room').Room>;
				/** 공개 방 목록 싱글턴 */
				LOBBY: DurableObjectNamespace<import('./lib/server/mp/lobby').Lobby>;
			};
		}
	}
}

export {};
