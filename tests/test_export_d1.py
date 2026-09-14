"""사전 축소·백업 복구 시 이전 분할 SQL이 섞이지 않는지 검증한다."""
import contextlib
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path

from export_d1 import main


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
            (out / "valid-03.sql").write_text("INSERT INTO valid VALUES ('옛단어');")
            with contextlib.redirect_stdout(io.StringIO()):
                main(db, out)
            self.assertEqual([p.name for p in out.glob("valid-*.sql")], ["valid-00.sql"])
            imported = sqlite3.connect(":memory:")
            for path in [out / "schema.sql", out / "valid-00.sql", out / "pool.sql"]:
                imported.executescript(path.read_text())
            self.assertEqual(imported.execute("SELECT jamo FROM valid").fetchall(), [("ㅂㅏㄴㅏㄴㅏ",)])
            self.assertEqual(imported.execute("SELECT count FROM pool_meta WHERE t=3 AND n=6").fetchone(), (1,))
            imported.close()


if __name__ == "__main__":
    unittest.main()
