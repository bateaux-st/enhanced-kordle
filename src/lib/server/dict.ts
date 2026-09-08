import type { GameMode } from '$lib/types';

// 정답 풀: 표준국어대사전 명사 중 익숙함 점수(familiar, build_dict.py의 Entry.familiar)가 임계값 이상인 것.
// 하루 하나인 데일리와 12자까지 올라가는 길이 상승은 깨끗하게(≥3), 계속 도는 무한·연속 클리어는 넓게(≥2).
// 풀은 export_d1.py가 (t, n, idx) → word로 미리 펼쳐 두므로 (n, threshold, idx)가 항상 같은 단어를 가리킨다.
export const POOL_THRESHOLD: Record<GameMode, number> = {
	daily: 3,
	'daily-climb': 3,
	'climb-length': 3,
	endless: 2,
	'climb-streak': 2
};

// D1(Cloudflare SQLite). 모든 조회가 PK 한 행이라 읽은 행 수 기준 무료 한도(하루 500만)를 거의 쓰지 않는다.
// 판정은 자모열로 한다 — 공백을 버린 자모열이라 '헌법 재판소'와 '헌법재판소'가 같은 키로 맞는다.
// valid 테이블은 네 사전(표준국어대사전·한국어기초사전·우리말샘·위키백과 띄어 쓴 제목)에서
// 방언/북한어만 빼고 만든 것이다 (export_d1.py).
export function dict(db: D1Database) {
	return {
		async isValidJamo(jamo: string): Promise<boolean> {
			return (await db.prepare('SELECT 1 FROM valid WHERE jamo = ?').bind(jamo).first()) !== null;
		},
		async answerCount(threshold: number, n: number): Promise<number> {
			const row = await db.prepare('SELECT count FROM pool_meta WHERE t = ? AND n = ?').bind(threshold, n).first<{ count: number }>();
			return row?.count ?? 0;
		},
		async answerAt(threshold: number, n: number, idx: number): Promise<{ word: string; jamo: string }> {
			const row = await db
				.prepare('SELECT word, jamo FROM pool WHERE t = ? AND n = ? AND idx = ?')
				.bind(threshold, n, idx)
				.first<{ word: string; jamo: string }>();
			if (!row) throw new Error(`pool miss t=${threshold} n=${n} idx=${idx}`);
			return row;
		}
	};
}
