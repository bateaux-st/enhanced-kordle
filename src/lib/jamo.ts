/** 게임이 다루는 자모 24종. build_dict.py의 분해 결과와 같은 집합이어야 한다. */
export const JAMO = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ';

export const MIN_N = 5;
export const MAX_N = 12;

/** 원작 꼬들의 키보드 배열 — 두벌식에서 ㅐㅔ를 뺀 24키. */
export const KEY_ROWS: string[][] = [
	[...'ㅂㅈㄷㄱㅅㅛㅕㅑ'],
	[...'ㅁㄴㅇㄹㅎㅗㅓㅏㅣ'],
	['Enter', ...'ㅋㅌㅊㅍㅠㅜㅡ', 'Backspace']
];

/** 물리 키보드(KeyboardEvent.code) → 자모. IME 상태와 무관하게 동작하도록 code 기준. */
export const CODE_TO_JAMO: Record<string, string> = {
	KeyQ: 'ㅂ', KeyW: 'ㅈ', KeyE: 'ㄷ', KeyR: 'ㄱ', KeyT: 'ㅅ', KeyY: 'ㅛ', KeyU: 'ㅕ', KeyI: 'ㅑ',
	KeyA: 'ㅁ', KeyS: 'ㄴ', KeyD: 'ㅇ', KeyF: 'ㄹ', KeyG: 'ㅎ', KeyH: 'ㅗ', KeyJ: 'ㅓ', KeyK: 'ㅏ', KeyL: 'ㅣ',
	KeyZ: 'ㅋ', KeyX: 'ㅌ', KeyC: 'ㅊ', KeyV: 'ㅍ', KeyB: 'ㅠ', KeyN: 'ㅜ', KeyM: 'ㅡ'
};

export const isJamo = (ch: string) => ch.length === 1 && JAMO.includes(ch);
