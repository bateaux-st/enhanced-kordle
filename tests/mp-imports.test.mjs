import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// DO 번들(wrangler)과 Node 테스트가 모두 풀 수 있어야 하는 import 규칙(MULTIPLAYER_TASKS §3.3, §6 (e)-1).
//  1. src/lib/server/mp/**와 그것이 끌어오는 파일은 $lib·$app 값 import 금지 (import type만 허용, 인라인 { type X } 금지)
//  2. mp 안의 상대 import는 .ts 확장자까지
//  3. cloudflare:*·@sveltejs/kit은 room.ts·lobby.ts·index.ts만

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mpDir = join(root, 'src', 'lib', 'server', 'mp');
const SHELL = new Set(['room.ts', 'lobby.ts', 'index.ts']);

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** import/export-from/동적 import를 뽑는다. typeOnly는 `import type`·`export type`. */
function importsOf(src) {
	const code = stripComments(src);
	const found = [];
	for (const m of code.matchAll(/\b(import|export)\s+(type\s+)?([^;'"]*?)\sfrom\s*(['"])([^'"]+)\4/g)) {
		found.push({ spec: m[5], typeOnly: Boolean(m[2]), inlineType: /\btype\s+\w/.test(m[3]) });
	}
	for (const m of code.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) found.push({ spec: m[2], typeOnly: false, inlineType: false });
	for (const m of code.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) found.push({ spec: m[2], typeOnly: false, inlineType: false });
	return found;
}

/** 한 파일의 위반 목록. inMp면 상대 경로 확장자 규칙을, pure면 cloudflare/kit 규칙을 더한다. */
function violationsOf(src, { inMp, pure }) {
	const out = [];
	for (const { spec, typeOnly, inlineType } of importsOf(src)) {
		const alias = spec === '$lib' || spec === '$app' || spec.startsWith('$lib/') || spec.startsWith('$app/');
		if (alias && !typeOnly) out.push(inlineType ? `인라인 type 지정자는 값 import로 남을 수 있음: ${spec}` : `$lib·$app 값 import: ${spec}`);
		if (pure && !typeOnly && (spec.startsWith('cloudflare:') || spec === '@sveltejs/kit' || spec.startsWith('@sveltejs/kit/'))) out.push(`순수 모듈의 런타임 import: ${spec}`);
		if (inMp && !typeOnly && spec.startsWith('.') && !spec.endsWith('.ts')) out.push(`상대 import에 .ts 확장자 필요: ${spec}`);
	}
	return out;
}

function listTs(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		return e.isDirectory() ? listTs(p) : e.name.endsWith('.ts') ? [p] : [];
	});
}

/** mp/**의 모든 .ts에서 상대 import를 따라가며 방문한 파일 -> 위반. */
function scanTree() {
	const seen = new Map();
	const queue = listTs(mpDir);
	while (queue.length) {
		const file = queue.pop();
		if (seen.has(file)) continue;
		const inMp = file.startsWith(mpDir);
		const rel = relative(root, file).replaceAll('\\', '/');
		const violations = violationsOf(readFileSync(file, 'utf8'), { inMp, pure: inMp && !SHELL.has(file.slice(mpDir.length + 1)) });
		seen.set(file, violations.map((v) => `${rel}: ${v}`));
		for (const { spec } of importsOf(readFileSync(file, 'utf8'))) {
			if (!spec.startsWith('.')) continue;
			const target = [resolve(dirname(file), spec), resolve(dirname(file), spec + '.ts')].find((p) => p.endsWith('.ts') && existsSync(p));
			if (target) queue.push(target);
			else seen.set(`${file}->${spec}`, [`${rel}: 풀 수 없는 상대 import: ${spec}`]);
		}
	}
	return seen;
}

test('src/lib/server/mp/**와 상대 import 대상에 $lib·$app 값 import와 규칙 위반이 없다', () => {
	const seen = scanTree();
	assert.deepEqual([...seen.values()].flat(), []);
});

test('스캔이 실제로 파일을 훑는다: mp 파일과 재사용 모듈이 대상에 들어 있다', () => {
	const names = new Set([...scanTree().keys()].map((p) => relative(root, p).replaceAll('\\', '/')));
	for (const f of [
		'src/lib/server/mp/room.ts',
		'src/lib/server/mp/reduce.ts',
		'src/lib/server/mp/session.ts',
		'src/lib/server/dict.ts',
		'src/lib/server/judge.ts',
		'src/lib/hard.ts',
		'src/lib/jamo.ts',
		'src/lib/mp/rules.ts',
		'src/lib/mp/protocol.ts'
	]) assert.ok(names.has(f), f);
});

test('검사기: 값 import·재export·동적 import·부수효과 import의 $lib/$app을 잡는다', () => {
	const bad = [
		"import { x } from '$lib/a';",
		"import x from '$lib/a';",
		"import * as x from '$app/environment';",
		"export * from '$lib/z';",
		"export { y } from '$lib/z';",
		"import '$app/x';",
		"const m = await import('$app/y');",
		'import {\n\tz\n} from "$lib/multi";',
		"import { type X } from '$lib/types';",
		"import { type X, y } from '$lib/types';"
	];
	for (const src of bad) assert.equal(violationsOf(src, { inMp: false, pure: false }).length, 1, src);
});

test('검사기: import type·export type과 주석·문자열 속 예시는 통과시킨다', () => {
	const ok = [
		"import type { X } from '$lib/types';",
		"import type X from '$lib/types';",
		"export type { X } from '$lib/types';",
		"// import { x } from '$lib/a';\nconst a = 1;",
		"/* import { x } from '$lib/a'; */",
		'const url = "https://example.com/$lib";',
		"export const x = 1;\nimport type { A } from '../a.ts';"
	];
	for (const src of ok) assert.deepEqual(violationsOf(src, { inMp: true, pure: true }), [], src);
});

test('검사기: mp 안 상대 import의 .ts 누락과 순수 모듈의 cloudflare·kit import를 잡는다', () => {
	assert.equal(violationsOf("import { a } from './a';", { inMp: true, pure: true }).length, 1);
	assert.equal(violationsOf("import { a } from './a.ts';", { inMp: true, pure: true }).length, 0);
	assert.equal(violationsOf("import type { A } from './a';", { inMp: true, pure: true }).length, 0);
	assert.equal(violationsOf("import { DurableObject } from 'cloudflare:workers';", { inMp: true, pure: true }).length, 1);
	assert.equal(violationsOf("import { DurableObject } from 'cloudflare:workers';", { inMp: true, pure: false }).length, 0);
	assert.equal(violationsOf("import { error } from '@sveltejs/kit';", { inMp: true, pure: true }).length, 1);
	assert.equal(violationsOf("import { a } from './a';", { inMp: false, pure: false }).length, 0, 'mp 밖 파일에는 확장자 규칙을 걸지 않는다');
});
