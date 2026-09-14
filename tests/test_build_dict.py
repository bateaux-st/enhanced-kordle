"""NIADic 파싱과 기존 사전·정답 풀 보존 계약. 원본 XLSX 없이 실행한다."""
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from build_dict import Entry, SRC_NIADIC, SRC_OPENDICT, SRC_STDICT, normalize, read_niadic


class NIADicTests(unittest.TestCase):
    def test_xlsx_nouns_include_names_and_brands_but_not_morphemes(self):
        strings = ["term", "tag", "category", "김연아", "ncn", "people_names", "스타벅스",
                   "brand_name", "거든요", "ecc", "먹다", "pvg", "ㆅ", "한강 공원"]
        ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        rows = [(0, 1, 2), (3, 4, 5), (6, 4, 7), (8, 9), (10, 11), (12, 4), (13, 4)]
        xml_rows = []
        for i, values in enumerate(rows, 1):
            cells = "".join(f'<c r="{col}{i}" t="s"><v>{v}</v></c>' for col, v in zip("ABC", values))
            xml_rows.append(f'<row r="{i}">{cells}</row>')
        # 범주가 없는 셀과 inlineStr도 허용해야 한다.
        xml_rows.append('<row r="8"><c r="A8" t="inlineStr"><is><t>규현</t></is></c>'
                        '<c r="B8" t="inlineStr"><is><t>ncn</t></is></c></row>')
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "NIADic.xlsx"
            with zipfile.ZipFile(path, "w") as z:
                z.writestr("xl/sharedStrings.xml", f'<sst xmlns="{ns}">' +
                           "".join(f"<si><t>{escape(s)}</t></si>" for s in strings) + "</sst>")
                z.writestr("xl/worksheets/sheet1.xml", f'<worksheet xmlns="{ns}"><sheetData>' +
                           "".join(xml_rows) + "</sheetData></worksheet>")
            entries = [r for r in read_niadic(path) if normalize(r["word"])]
        self.assertEqual([r["word"] for r in entries], ["김연아", "스타벅스", "한강 공원", "규현"])
        self.assertEqual(entries[2]["unit"], "구")

    def test_existing_dialect_is_not_reenabled(self):
        e = Entry()
        e.merge(SRC_OPENDICT, dict(word="거실굼돈", unit="단어", pos="명사", dialect=True))
        e.merge(SRC_NIADIC, dict(word="거실굼돈", unit="단어", pos="명사"))
        self.assertTrue(e.dialect)
        self.assertEqual(e.src, SRC_OPENDICT | SRC_NIADIC)

    def test_existing_answer_metadata_is_unchanged(self):
        e = Entry()
        e.merge(SRC_STDICT, dict(word="예시", unit="구", pos="부사", senses=4, general=True))
        before = {k: getattr(e, k) for k in Entry.__slots__ if k != "src"}
        score = e.familiar()
        e.merge(SRC_NIADIC, dict(word="예시", unit="단어", pos="명사"))
        self.assertEqual({k: getattr(e, k) for k in before}, before)
        self.assertEqual(e.familiar(), score)

    def test_new_names_are_valid_but_not_answers(self):
        e = Entry()
        e.merge(SRC_NIADIC, dict(word="김연아", unit="단어", pos="명사"))
        self.assertFalse(e.dialect)
        self.assertEqual(e.pos, "명사")
        self.assertIsNone(e.familiar())

    def test_learning_level_exempts_specialist_penalty(self):
        for level, expected in (("고급", 2), ("중급", 3), ("초급", 4), (None, -1)):
            with self.subTest(level=level):
                e = Entry()
                e.merge(SRC_STDICT, dict(unit="단어", pos="명사", level=level, general=False))
                self.assertEqual(e.familiar(), expected)

    def test_niadic_never_removes_an_existing_answer(self):
        """NIADic은 판정 전용이다. 어떤 범주로 등재돼 있든 기존 정답을 정답 풀에서 빼지 않는다.

        2026-09-11 결정: 범주 제외는 신규 고유명사 차단에 기여하지 않으면서(그쪽은 표준국어대사전
        밖이라 familiar=NULL) 표준국어대사전 일반명사만 1,472개 깎아 철회했다.
        """
        for extra in ({}, {"unit": "구", "pos": "고유명사"}):
            with self.subTest(extra=extra):
                e = Entry()
                e.merge(SRC_STDICT, dict(unit="단어", pos="명사", level="초급", general=True))
                self.assertEqual(e.familiar(), 4)
                e.merge(SRC_NIADIC, {"word": "감기", "unit": "단어", "pos": "명사", **extra})
                self.assertEqual(e.familiar(), 4)
                self.assertFalse(e.dialect)


if __name__ == "__main__":
    unittest.main()
