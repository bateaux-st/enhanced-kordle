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
			};
		}
	}
}

export {};
