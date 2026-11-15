"""자모 24종 풀어쓰기가 build_dict.decompose, src/lib/jamo.ts, scripts/smoke.py 세 곳에서 같은지 고정한다.

한 곳만 바뀌면 사전·풀·토큰·통계의 자모 수가 어긋나므로, 완성형 11,172자를 전부 대조한다.
"""
import re
import unittest

from build_dict import CHO, JONG, JUNG, SPLIT, decompose
from smoke_defs import ROOT, load_smoke

JAMO_TS = (ROOT / "src" / "lib" / "jamo.ts").read_text(encoding="utf-8")
JAMO = re.search(r"export const JAMO = '([^']+)'", JAMO_TS).group(1)
SYLLABLES = [chr(c) for c in range(0xAC00, 0xAC00 + 11172)]


class DecomposeTests(unittest.TestCase):
    def test_known_syllables(self):
        cases = {
            "바나나": "ㅂㅏㄴㅏㄴㅏ",
            "꽃": "ㄱㄱㅗㅊ",     # 쌍자음은 같은 자모 둘
            "값": "ㄱㅏㅂㅅ",       # 겹받침은 자음 둘
            "읊": "ㅇㅡㄹㅍ",
            "왜": "ㅇㅗㅏㅣ",       # ㅙ는 ㅗㅏㅣ
            "뷁": "ㅂㅜㅓㅣㄹㄱ",
            "의": "ㅇㅡㅣ",
            "얘": "ㅇㅑㅣ",         # ㅑㅕㅛㅠ는 쪼개지 않는다
            "한강 공원": "ㅎㅏㄴㄱㅏㅇㄱㅗㅇㅇㅜㅓㄴ",  # 공백은 버린다
        }
        for word, expected in cases.items():
            with self.subTest(word=word):
                self.assertEqual(decompose(word), expected)

    def test_jamo_ts_is_24_unique_letters(self):
        self.assertEqual(len(JAMO), 24)
        self.assertEqual(len(set(JAMO)), 24)

    def test_decompose_covers_exactly_the_jamo_ts_set(self):
        used = set("".join(decompose(ch) for ch in SYLLABLES))
        self.assertEqual("".join(sorted(used)), "".join(sorted(JAMO)))

    def test_every_split_output_is_a_game_jamo(self):
        for key, value in SPLIT.items():
            with self.subTest(key=key):
                self.assertTrue(set(value) <= set(JAMO))
                self.assertNotIn(key, JAMO)

    def test_every_hangul_jamo_is_game_jamo_or_split(self):
        for ch in set(CHO + JUNG + JONG) - {" "}:
            with self.subTest(ch=ch):
                self.assertTrue(ch in JAMO or ch in SPLIT)

    def test_smoke_to_jamo_matches_decompose_for_all_syllables(self):
        to_jamo = load_smoke("_HEAD", "_VOWEL", "_TAIL", "to_jamo")["to_jamo"]
        for ch in SYLLABLES:
            if to_jamo(ch) != decompose(ch):
                self.fail(f"{ch}: smoke {to_jamo(ch)!r} != build_dict {decompose(ch)!r}")

    def test_smoke_to_jamo_passes_non_syllables_through(self):
        to_jamo = load_smoke("_HEAD", "_VOWEL", "_TAIL", "to_jamo")["to_jamo"]
        self.assertEqual(to_jamo("ab ㄱ"), "ab ㄱ")


if __name__ == "__main__":
    unittest.main()
