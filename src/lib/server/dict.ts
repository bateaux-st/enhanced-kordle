import { DatabaseSync } from 'node:sqlite';
import { env } from '$env/dynamic/private';

// Node 22.13+ 내장 SQLite. 네이티브 빌드가 없어 Docker 이미지를 node:22 그대로 쓸 수 있다.
// API 표면이 better-sqlite3와 같아 experimental 경고가 부담되면 이 파일만 바꾸면 된다.
const db = new DatabaseSync(env.KORDLE_DB ?? 'kordle.db', { readOnly: true });

// 판정은 jamo 열로 한다 — 공백을 버린 자모열이라 '헌법 재판소'와 '헌법재판소'가 같은 키로 맞는다.
// 세 사전(표준국어대사전·한국어기초사전·우리말샘)을 합친 넓은 사전이지만, 우리말샘에 방언/북한어로만
// 실린 표기(dialect=1)는 플레이어가 "사전에 있는 단어"로 받아들이기 어려워 뺀다.
const stmtValid = db.prepare('SELECT 1 FROM words WHERE jamo = ? AND dialect = 0 LIMIT 1');

// 정답 풀은 표준국어대사전(src 비트 1)의 '단어'만 — 우리말샘까지 넣으면 생소어가 더 늘어난다.
// 순서는 rowid로 고정해 (n, idx)가 항상 같은 단어를 가리키게 한다.
const POOL = "unit = '단어' AND (src & 1) AND jamo_len = ?";
const stmtCount = db.prepare(`SELECT COUNT(*) AS c FROM words WHERE ${POOL}`);
const stmtAt = db.prepare(`SELECT word, jamo FROM words WHERE ${POOL} ORDER BY rowid LIMIT 1 OFFSET ?`);

const countCache = new Map<number, number>();

export function isValidJamo(jamo: string): boolean {
	return stmtValid.get(jamo) !== undefined;
}

export function answerCount(n: number): number {
	let c = countCache.get(n);
	if (c === undefined) {
		c = (stmtCount.get(n) as { c: number }).c;
		countCache.set(n, c);
	}
	return c;
}

export function answerAt(n: number, idx: number): { word: string; jamo: string } {
	return stmtAt.get(n, idx) as { word: string; jamo: string };
}
