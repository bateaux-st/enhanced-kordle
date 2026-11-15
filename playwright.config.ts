import { defineConfig } from '@playwright/test';

// 개발 서버(5173)·wrangler(8787)와 겹치지 않는 포트.
const PORT = 4789;

export default defineConfig({
	testDir: './e2e',
	testMatch: '**/*.spec.ts',
	fullyParallel: true,
	retries: 0,
	// 코어가 적거나 다른 작업이 도는 컴퓨터에서 첫 로드가 5초를 넘기는 일이 있어 기본보다 넉넉히 둔다. 통과하는 테스트는 그만큼 기다리지 않는다.
	expect: { timeout: 10_000 },
	forbidOnly: true,
	reporter: [['list']],
	use: {
		baseURL: `http://localhost:${PORT}`,
		viewport: { width: 1280, height: 800 },
		locale: 'ko-KR',
		timezoneId: 'Asia/Seoul',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	projects: [
		{ name: 'desktop', testIgnore: '**/*.mobile.spec.ts' },
		{ name: 'mobile', testMatch: '**/*.mobile.spec.ts', use: { viewport: { width: 390, height: 844 }, hasTouch: true } }
	],
	// vite dev는 import.meta.env.DEV라 멀티 클라이언트가 소켓을 열지 않는다. 빌드한 번들을 정적으로 서빙한다.
	webServer: {
		command: `node e2e/serve.mjs ${PORT}`,
		port: PORT,
		reuseExistingServer: false,
		timeout: 90_000
	}
});
