import type { Mark } from '$lib/types';

/** 하드모드 위반: pos는 초록 자리를 다르게 채운 것, missing은 노랑 자모를 빼먹은 것. */
export type HardViolation = { kind: 'pos'; pos: number; jamo: string } | { kind: 'missing'; jamo: string };

/**
 * 하드모드 검증 — 지금까지 받은 초록·노랑을 다음 추측이 다시 쓰는지 본다.
 * 노랑은 **자모 종류만** 요구하고 개수는 세지 않는다(사용자 결정). 정답에 ㅏ가 셋이어도
 * 노랑 ㅏ 하나를 받았으면 추측에 ㅏ 하나로 통과한다 — 12자모까지 가는 게임에서 개수까지
 * 강제하면 남는 칸이 거의 없어 시도가 사실상 한 갈래로 좁아진다.
 * 힌트로 밝힌 칸은 제약이 아니다(초록·노랑 판정만 대상).
 */
export function hardViolation(rows: string[], marks: Mark[][], guess: string): HardViolation | null {
	const fixed: (string | undefined)[] = []; // 초록: 자리 → 자모
	const required = new Set<string>(); // 노랑: 자모 종류

	rows.forEach((row, r) => {
		[...row].forEach((j, i) => {
			if (marks[r][i] === 'c') fixed[i] = j;
			else if (marks[r][i] === 'p') required.add(j);
		});
	});

	// 왼쪽 칸부터 알려주는 게 사용자가 고치기 쉽다.
	for (let i = 0; i < fixed.length; i++) {
		if (fixed[i] && guess[i] !== fixed[i]) return { kind: 'pos', pos: i, jamo: fixed[i]! };
	}
	for (const jamo of required) {
		if (!guess.includes(jamo)) return { kind: 'missing', jamo };
	}
	return null;
}
