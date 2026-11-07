import type { Mark } from './types.ts';

/**
 * 보드의 노란 자모 중 행·칸 순으로 처음 나온 후보와, 보드에서 이미 초록으로 확인된 그 자모의 자리.
 * 정답에 같은 자모가 여러 개면 키보드 색(최고 판정)은 초록이어도 노란 칸이 남을 수 있어 보드 칸을 직접 본다.
 *
 * 정답을 모르는 쪽(솔로 클라이언트)이 쓰므로 판정만으로 후보를 가른다. judge는 노랑을 남은 개수만큼만 주기 때문에
 * 한 줄의 초록+노랑 개수는 정답 속 개수 이하이고, 그 최댓값이 초록 자리 수보다 크면 아직 못 찾은 자리가 반드시 있다.
 */
export function pickHint(rows: string[], marks: Mark[][]): { jamo: string; known: number[] } | null {
	const green = new Map<string, Set<number>>();
	const floor = new Map<string, number>();
	rows.forEach((row, r) => {
		const seen = new Map<string, number>();
		[...row].forEach((jamo, i) => {
			const m = marks[r][i];
			if (m === 'a') return;
			seen.set(jamo, (seen.get(jamo) ?? 0) + 1);
			if (m === 'c') green.set(jamo, (green.get(jamo) ?? new Set()).add(i));
		});
		for (const [jamo, n] of seen) floor.set(jamo, Math.max(floor.get(jamo) ?? 0, n));
	});

	for (let r = 0; r < rows.length; r++) {
		const row = [...rows[r]];
		for (let i = 0; i < row.length; i++) {
			if (marks[r][i] !== 'p') continue;
			const known = green.get(row[i]) ?? new Set<number>();
			if ((floor.get(row[i]) ?? 0) > known.size) return { jamo: row[i], known: [...known].sort((a, b) => a - b) };
		}
	}
	return null;
}

/** 정답에서 jamo가 나오는 자리 중 known에 없는 첫 자리. 없으면 -1. */
export function hintPos(answerJamo: string, jamo: string, known: readonly number[]): number {
	return [...answerJamo].findIndex((j, i) => j === jamo && !known.includes(i));
}

/** 요청 본문의 known. 구버전 클라이언트는 보내지 않으므로 없거나 형식이 틀리면 빈 목록으로 본다. */
export function parseKnown(raw: unknown): number[] {
	return Array.isArray(raw) && raw.every((v) => Number.isInteger(v)) ? raw : [];
}
