/** 칸 판정: correct(자리까지 맞음) / present(자모만 맞음) / absent(없음). */
export type Mark = 'c' | 'p' | 'a';

export type GameMode = 'daily' | 'endless' | 'climb-streak' | 'climb-length';

/** n을 고르는 방식. climb-length에서는 시작 길이를 뜻한다. */
export type LengthMode = { kind: 'fixed'; n: number } | { kind: 'random' };

export const MODE_LABEL: Record<GameMode, string> = {
	daily: '하루 1개',
	endless: '랜덤 무한',
	'climb-streak': '등반 · 연속 클리어',
	'climb-length': '등반 · 길이 상승'
};

// ---- API 계약 ----

export interface NewGameRequest {
	/** daily는 날짜로 정답이 정해지고 나머지는 매 호출 새 정답. 모드에 따라 정답 풀 범위도 달라진다. */
	mode: GameMode;
	/** 없으면 5~12에서 고른다(daily는 날짜 기준, random은 무작위). */
	n?: number;
}
export interface NewGameResponse {
	token: string;
	n: number;
}

export interface GuessRequest {
	token: string;
	/** 자모 24종으로 이루어진 문자열, 길이 n. */
	jamo: string;
}
export type GuessResponse = { ok: true; marks: Mark[] } | { ok: false; reason: 'invalid' };

/** 제출 전 사전 유효성만 확인. 정답과 무관해 토큰이 없다. */
export interface CheckRequest {
	jamo: string;
}
export interface CheckResponse {
	valid: boolean;
}

export interface RevealRequest {
	token: string;
}
export interface RevealResponse {
	word: string;
}
