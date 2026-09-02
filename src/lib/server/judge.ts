import type { Mark } from '$lib/types';

/**
 * 워들 판정. 같은 자모가 여러 번 나올 때 present는 정답에 남은 개수만큼만 준다.
 * 예) 정답 ㄱㅏㄱㅅㅣ, 추측 ㄱㄱㄱㅏㅏ → c a p p a  (ㄱ은 정답에 2개: 첫째 c, 둘째 a... 셋째 p 순이 아니라
 * correct를 먼저 확정하고 남은 ㄱ 1개를 왼쪽부터 present로 배분한다.)
 */
export function judge(answer: string, guess: string): Mark[] {
	const marks: Mark[] = new Array(guess.length).fill('a');
	const remaining = new Map<string, number>();

	for (let i = 0; i < guess.length; i++) {
		if (guess[i] === answer[i]) marks[i] = 'c';
		else remaining.set(answer[i], (remaining.get(answer[i]) ?? 0) + 1);
	}
	for (let i = 0; i < guess.length; i++) {
		if (marks[i] === 'c') continue;
		const left = remaining.get(guess[i]) ?? 0;
		if (left > 0) {
			marks[i] = 'p';
			remaining.set(guess[i], left - 1);
		}
	}
	return marks;
}
