"""사전 축소·백업 복구 시 이전 분할 SQL이 섞이지 않는지 검증한다."""
import ast
import contextlib
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import export_d1
from export_d1 import BATCH, MAX_N, MIN_N, THRESHOLDS, main


class ExportTests(unittest.TestCase):
    def test_smaller_dictionary_removes_stale_valid_chunks(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "words.db"
            con = sqlite3.connect(db)
            con.execute("CREATE TABLE words (word TEXT, unit TEXT, pos TEXT, familiar INTEGER, "
                        "jamo_len INTEGER, jamo TEXT, dialect INTEGER)")
            con.execute("INSERT INTO words VALUES ('바나나','단어','명사',4,6,'ㅂㅏㄴㅏㄴㅏ',0)")
            con.commit()
            con.close()
            out = Path(d) / "d1"
            out.mkdir()
            (out / "valid-03.sql").write_text("INSERT INTO valid VALUES ('옛단어');", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                main(db, out)
            self.assertEqual([p.name for p in out.glob("valid-*.sql")], ["valid-00.sql"])
            imported = sqlite3.connect(":memory:")
            for path in [out / "schema.sql", out / "valid-00.sql", out / "pool.sql"]:
                imported.executescript(path.read_text(encoding="utf-8"))
            self.assertEqual(imported.execute("SELECT jamo FROM valid").fetchall(), [("ㅂㅏㄴㅏㄴㅏ",)])
            self.assertEqual(imported.execute("SELECT count FROM pool_meta WHERE t=3 AND n=6").fetchone(), (1,))
            imported.close()


def export_to_memory(rows):
    """words 행(word, unit, pos, familiar, jamo_len, jamo, dialect)을 내보낸 뒤 D1처럼 :memory:에 임포트한다.

    돌려주는 것: (임포트된 연결, main의 stdout).
    """
    # main이 연결을 닫지 않아 Windows에서는 임시 폴더 정리가 실패하므로 정리 오류는 무시한다.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        db = Path(d) / "words.db"
        con = sqlite3.connect(db)
        con.execute("CREATE TABLE words (word TEXT, unit TEXT, pos TEXT, familiar INTEGER, "
                    "jamo_len INTEGER, jamo TEXT, dialect INTEGER)")
        con.executemany("INSERT INTO words VALUES (?,?,?,?,?,?,?)", rows)
        con.commit()
        con.close()
        out = Path(d) / "d1"
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            main(db, out)
        imported = sqlite3.connect(":memory:")
        for path in [out / "schema.sql", *sorted(out.glob("valid-*.sql")), out / "pool.sql"]:
            imported.executescript(path.read_text(encoding="utf-8"))
    return imported, stdout.getvalue()


def row(word, jamo, *, unit="단어", pos="명사", familiar=3, jamo_len=5, dialect=0):
    return (word, unit, pos, familiar, jamo_len, jamo, dialect)


class ExportPoolTests(unittest.TestCase):
    def pool(self, con, t, n):
        return [w for (w,) in con.execute("SELECT word FROM pool WHERE t=? AND n=? ORDER BY idx", (t, n))]

    def test_pool_filter_keeps_only_unit_word_noun_without_space_at_threshold_and_length(self):
        rows = [
            row("셋", "ㄱㄴㄷㄹㅁ", familiar=3),
            row("둘", "ㄱㄴㄷㄹㅂ", familiar=2),
            row("하나", "ㄱㄴㄷㄹㅅ", familiar=1),
            row("영", "ㄱㄴㄷㄹㅇ", familiar=0),
            row("미정", "ㄱㄴㄷㄹㅈ", familiar=None),
            row("구절", "ㄱㄴㄷㄹㅊ", unit="구"),
            row("달리다", "ㄱㄴㄷㄹㅋ", pos="동사"),
            row("고유", "ㄱㄴㄷㄹㅌ", pos="고유명사"),
            row("띄어 씀", "ㄱㄴㄷㄹㅍ"),
            row("넷", "ㄱㄴㄷㄹㅎ", jamo_len=4),
            row("열셋", "ㄱㄴㄷㄹㅏ", jamo_len=13),
            row("방언", "ㄱㄴㄷㄹㅑ", familiar=None, dialect=1),
            row("열둘", "ㄱㄴㄷㄹㅓ" * 2 + "ㄱㄴ", familiar=3, jamo_len=12),
        ]
        con, _ = export_to_memory(rows)
        self.assertEqual(self.pool(con, 3, 5), ["셋"])
        self.assertEqual(self.pool(con, 2, 5), ["셋", "둘"])
        self.assertEqual(self.pool(con, 1, 5), ["셋", "둘", "하나"])
        self.assertEqual(self.pool(con, 3, 12), ["열둘"])
        self.assertEqual(con.execute("SELECT COUNT(*) FROM pool WHERE n NOT BETWEEN 5 AND 12").fetchone(), (0,))
        self.assertEqual(con.execute("SELECT COUNT(*) FROM pool WHERE t NOT IN (1,2,3)").fetchone(), (0,))

    def test_pool_meta_has_a_row_for_every_threshold_and_length_with_exact_counts(self):
        con, _ = export_to_memory([row("셋", "ㄱㄴㄷㄹㅁ", familiar=3), row("둘", "ㄱㄴㄷㄹㅂ", familiar=2)])
        meta = dict(((t, n), c) for t, n, c in con.execute("SELECT t, n, count FROM pool_meta"))
        expected = {(t, n): 0 for t in THRESHOLDS for n in range(MIN_N, MAX_N + 1)}
        expected.update({(1, 5): 2, (2, 5): 2, (3, 5): 1})
        self.assertEqual(meta, expected)
        for (t, n), count in meta.items():
            self.assertEqual(con.execute("SELECT COUNT(*) FROM pool WHERE t=? AND n=?", (t, n)).fetchone(), (count,))

    def test_idx_follows_rowid_order_without_gaps_across_batches(self):
        total = BATCH + 3
        # 단어 가나다순과 rowid 순이 반대라, ORDER BY word 같은 정렬로 바뀌면 걸러진다.
        rows = [row(f"w{total - 1 - i:04d}", f"j{i:04d}") for i in range(total)]
        con, _ = export_to_memory(rows)
        got = con.execute("SELECT idx, word FROM pool WHERE t=3 AND n=5 ORDER BY idx").fetchall()
        self.assertEqual(got, [(i, f"w{total - 1 - i:04d}") for i in range(total)])
        self.assertEqual(con.execute("SELECT count FROM pool_meta WHERE t=3 AND n=5").fetchone(), (total,))

    def test_quotes_in_word_and_jamo_survive_the_sql_round_trip(self):
        evil = "x');DROP-TABLE-valid;--"
        con, _ = export_to_memory([row("도'깨비", "ㄱ'ㄴㄷㄹ"), row(evil, "ㄱㄴㄷㄹㅁ")])
        self.assertEqual(self.pool(con, 3, 5), ["도'깨비", evil])
        self.assertEqual(con.execute("SELECT jamo FROM pool WHERE word=?", ("도'깨비",)).fetchone(), ("ㄱ'ㄴㄷㄹ",))
        self.assertEqual(con.execute("SELECT jamo FROM valid ORDER BY jamo").fetchall(), [("ㄱ'ㄴㄷㄹ",), ("ㄱㄴㄷㄹㅁ",)])

    def test_valid_filters_by_length_and_dialect_and_dedups_jamo(self):
        rows = [
            row("다섯", "ㄱㄴㄷㄹㅁ", jamo_len=5),
            row("열둘", "ㄱㄴㄷㄹㅂ", jamo_len=12),
            row("넷", "ㄱㄴㄷㄹㅅ", jamo_len=4),
            row("열셋", "ㄱㄴㄷㄹㅇ", jamo_len=13),
            row("북한어", "ㄱㄴㄷㄹㅈ", dialect=1, familiar=None),
            row("헌법 재판소", "ㄱㄴㄷㄹㅊ", unit="구", familiar=None),
            row("헌법재판소", "ㄱㄴㄷㄹㅊ"),
        ]
        con, _ = export_to_memory(rows)
        self.assertEqual(
            sorted(j for (j,) in con.execute("SELECT jamo FROM valid")),
            sorted(["ㄱㄴㄷㄹㅁ", "ㄱㄴㄷㄹㅂ", "ㄱㄴㄷㄹㅊ"]),
        )

    def test_valid_is_split_into_files_that_together_hold_every_row_once(self):
        rows = [row(f"w{i}", f"j{i:03d}") for i in range(7)]
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d, \
                mock.patch.object(export_d1, "ROWS_PER_FILE", 3), mock.patch.object(export_d1, "BATCH", 2):
            db = Path(d) / "words.db"
            con = sqlite3.connect(db)
            con.execute("CREATE TABLE words (word TEXT, unit TEXT, pos TEXT, familiar INTEGER, "
                        "jamo_len INTEGER, jamo TEXT, dialect INTEGER)")
            con.executemany("INSERT INTO words VALUES (?,?,?,?,?,?,?)", rows)
            con.commit()
            con.close()
            out = Path(d) / "d1"
            with contextlib.redirect_stdout(io.StringIO()):
                main(db, out)
            names = sorted(p.name for p in out.glob("valid-*.sql"))
            self.assertEqual(names, ["valid-00.sql", "valid-01.sql", "valid-02.sql"])
            imported = sqlite3.connect(":memory:")
            imported.executescript((out / "schema.sql").read_text(encoding="utf-8"))
            for name in names:
                imported.executescript((out / name).read_text(encoding="utf-8"))
            self.assertEqual(imported.execute("SELECT COUNT(*), COUNT(DISTINCT jamo) FROM valid").fetchone(), (7, 7))

    def test_printed_pool_size_block_matches_pool_meta(self):
        con, stdout = export_to_memory([row("셋", "ㄱㄴㄷㄹㅁ", familiar=3), row("하나", "ㄱㄴㄷㄹㅂ", familiar=1)])
        block = stdout.split("POOL_SIZE = ", 1)[1]
        printed = ast.literal_eval(block)
        meta = {(t, n): c for t, n, c in con.execute("SELECT t, n, count FROM pool_meta")}
        self.assertEqual(printed, meta)


if __name__ == "__main__":
    unittest.main()
