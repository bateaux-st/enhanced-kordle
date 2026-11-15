// e2e 전용 빌드. adapter-cloudflare는 wrangler 설정과 .dev.vars를 읽고 Windows에서 산출물 삭제가 EPERM으로 실패하는 일이 있어 빼고,
// 아무것도 안 하는 어댑터로 .svelte-kit/output(프리렌더된 셸 + 클라이언트 번들)만 만든다.
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			adapter: { name: 'e2e-noop', adapt() {} }
		})
	]
});
