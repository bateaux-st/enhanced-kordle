// 한글 단어를 게임이 쓰는 자모 24종 열로 푼다. build_dict.py의 SPLIT과 같은 규칙이다(ㄲ=ㄱㄱ, ㅐ=ㅏㅣ 등).
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
const SPLIT: Record<string, string> = {
	ㄲ: 'ㄱㄱ', ㄸ: 'ㄷㄷ', ㅃ: 'ㅂㅂ', ㅆ: 'ㅅㅅ', ㅉ: 'ㅈㅈ',
	ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ',
	ㅐ: 'ㅏㅣ', ㅒ: 'ㅑㅣ', ㅔ: 'ㅓㅣ', ㅖ: 'ㅕㅣ',
	ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅏㅣ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅓㅣ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ'
};

export function toJamo(word: string): string {
	let out = '';
	for (const ch of word) {
		const code = ch.codePointAt(0)! - 0xac00;
		if (code < 0 || code > 11171) throw new Error(`한글 음절이 아닙니다: ${ch}`);
		const parts = [CHO[Math.floor(code / 588)], JUNG[Math.floor((code % 588) / 28)], JONG[code % 28]];
		for (const p of parts) out += SPLIT[p] ?? p;
	}
	return out;
}

/** 자모 수 5~12마다 하나씩. 서로 다른 단어라 한 스테이지의 정답이 다른 스테이지와 헷갈리지 않는다. */
export const WORD_BY_N: Record<number, string> = {
	5: '사과',
	6: '바나나',
	7: '고양이',
	8: '초콜릿',
	9: '냉장고',
	10: '떡볶이',
	11: '아이스크림',
	12: '대한민국'
};

export interface Answer {
	word: string;
	jamo: string;
}

export const answerOf = (word: string): Answer => ({ word, jamo: toJamo(word) });
