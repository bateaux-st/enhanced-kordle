// 테스트용 모듈 해석 훅 한 곳. cloudflare:workers는 빈 DurableObject로, SvelteKit이 풀어 주는 $lib 별칭과
// 확장자 없는 상대 import(src/lib/server/env.ts의 './dict')는 src/lib 아래 .ts 파일로 푼다.
// 정적 import는 링크 단계에서 풀리므로, 이 파일을 import한 뒤 src를 동적 import해야 한다.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LIB = fileURLToPath(new URL('../src/lib/', import.meta.url));
const DURABLE_OBJECT = 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }';

const probe = (base) => [`${base}.ts`, `${base}/index.ts`].find((p) => existsSync(p));
const resolved = (path) => ({ url: pathToFileURL(path).href, shortCircuit: true });

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'cloudflare:workers') return { url: DURABLE_OBJECT, shortCircuit: true };
		if (specifier.startsWith('$lib/')) {
			const path = probe(LIB + specifier.slice('$lib/'.length));
			if (path) return resolved(path);
		}
		if (specifier.startsWith('.') && !/\.\w+$/.test(specifier) && context.parentURL?.startsWith('file:')) {
			const path = probe(fileURLToPath(new URL(specifier, context.parentURL)));
			if (path) return resolved(path);
		}
		return nextResolve(specifier, context);
	}
});
