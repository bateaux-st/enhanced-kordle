// Playwright webServer가 실행한다. 클라이언트 번들을 빌드하고 그대로 정적 서빙한다.
// 빌드 로그는 실패했을 때만 보여 준다(프리렌더가 wrangler 플랫폼 프록시를 띄워 경고가 길다).
import { spawn, spawnSync } from 'node:child_process';

const port = process.argv[2];
const vite = ['node_modules/vite/bin/vite.js'];
const config = ['-c', 'e2e/vite.config.ts'];

const build = spawnSync(process.execPath, [...vite, 'build', ...config], { encoding: 'utf8' });
if (build.status !== 0) {
	process.stderr.write(`${build.stdout}\n${build.stderr}\n`);
	process.exit(build.status ?? 1);
}

const preview = spawn(process.execPath, [...vite, 'preview', ...config, '--port', port, '--strictPort'], { stdio: 'inherit' });
preview.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => preview.kill());
