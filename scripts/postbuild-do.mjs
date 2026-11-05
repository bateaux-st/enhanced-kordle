// adapter-cloudflare가 _worker.js를 매 빌드 템플릿으로 다시 쓰므로, 빌드 뒤에 DO export를 붙인다.
import { appendFileSync, readFileSync } from 'node:fs';

const worker = new URL('../.svelte-kit/cloudflare/_worker.js', import.meta.url);
const line = 'export { Room, Lobby } from "../../src/lib/server/mp/index.ts";';

const src = readFileSync(worker, 'utf8');
if (src.includes(line)) {
	console.log('postbuild-do: export 이미 있음');
} else {
	appendFileSync(worker, (src.endsWith('\n') ? '' : '\n') + line + '\n');
	console.log('postbuild-do: export 추가');
}
