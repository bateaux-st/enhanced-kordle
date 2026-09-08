#!/usr/bin/env python3
"""kordle.db에서 서버가 실제로 쓰는 것만 D1(Cloudflare SQLite) 임포트용 SQL로 뽑는다.

    python3 export_d1.py kordle.db d1/

산출물 (d1/ 아래):
  schema.sql        테이블 정의 (먼저 실행)
  valid-NN.sql      판정용 자모열. 5~12자모, 방언·북한어 제외, 중복 제거 → 약 56만 행
  pool.sql          정답 풀을 (임계값 t, 자모 수 n, idx) → word로 미리 펼친 것 + 풀 크기(pool_meta)

임포트:
  for f in d1/schema.sql d1/valid-*.sql d1/pool.sql; do npx wrangler d1 execute kordle --remote --file=$f; done
  (로컬 개발용은 --local)

words 전체(120만 행, 213MB)를 옮기지 않는 이유: D1은 읽은 행 수로 한도를 세는데(무료 하루 500만),
COUNT/OFFSET 방식은 OFFSET만큼 행을 읽는다. 펼쳐 두면 모든 조회가 PK 한 행이다. 결과 크기 ~30MB.
"""
import sqlite3
import sys
from pathlib import Path

# dict.ts의 정답 풀 조건과 같아야 한다. 순서도 rowid — 기존 토큰의 (t, n, idx)가 같은 단어를 가리키게.
POOL = "unit = '단어' AND pos = '명사' AND word NOT LIKE '% %' AND familiar >= ? AND jamo_len = ?"
THRESHOLDS = (2, 3)   # dict.ts POOL_THRESHOLD 에 쓰이는 값들
MIN_N, MAX_N = 5, 12
BATCH = 500           # 한 INSERT에 묶는 행 수
ROWS_PER_FILE = 200_000  # wrangler 업로드 한도를 넘지 않게 파일 분할


def q(s):
    return "'" + s.replace("'", "''") + "'"


def main(db_path, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)

    (out / "schema.sql").write_text(
        "DROP TABLE IF EXISTS valid;\n"
        "DROP TABLE IF EXISTS pool;\n"
        "DROP TABLE IF EXISTS pool_meta;\n"
        "CREATE TABLE valid (jamo TEXT PRIMARY KEY) WITHOUT ROWID;\n"
        "CREATE TABLE pool (t INTEGER NOT NULL, n INTEGER NOT NULL, idx INTEGER NOT NULL, "
        "word TEXT NOT NULL, jamo TEXT NOT NULL, PRIMARY KEY (t, n, idx)) WITHOUT ROWID;\n"
        "CREATE TABLE pool_meta (t INTEGER NOT NULL, n INTEGER NOT NULL, count INTEGER NOT NULL, "
        "PRIMARY KEY (t, n)) WITHOUT ROWID;\n",
        encoding="utf-8",
    )

    # valid
    rows = con.execute(
        "SELECT DISTINCT jamo FROM words WHERE jamo_len BETWEEN ? AND ? AND dialect = 0 ORDER BY jamo",
        (MIN_N, MAX_N),
    ).fetchall()
    for fi in range(0, len(rows), ROWS_PER_FILE):
        chunk = rows[fi:fi + ROWS_PER_FILE]
        with open(out / f"valid-{fi // ROWS_PER_FILE:02d}.sql", "w", encoding="utf-8") as f:
            for bi in range(0, len(chunk), BATCH):
                vals = ",".join(f"({q(j)})" for (j,) in chunk[bi:bi + BATCH])
                f.write(f"INSERT INTO valid VALUES {vals};\n")
    print(f"valid: {len(rows):,}행 → {-(-len(rows) // ROWS_PER_FILE)}개 파일")

    # pool + pool_meta
    total = 0
    with open(out / "pool.sql", "w", encoding="utf-8") as f:
        for t in THRESHOLDS:
            for n in range(MIN_N, MAX_N + 1):
                items = con.execute(
                    f"SELECT word, jamo FROM words WHERE {POOL} ORDER BY rowid", (t, n)
                ).fetchall()
                f.write(f"INSERT INTO pool_meta VALUES ({t},{n},{len(items)});\n")
                for bi in range(0, len(items), BATCH):
                    vals = ",".join(
                        f"({t},{n},{bi + k},{q(w)},{q(j)})" for k, (w, j) in enumerate(items[bi:bi + BATCH])
                    )
                    f.write(f"INSERT INTO pool VALUES {vals};\n")
                total += len(items)
    print(f"pool: {total:,}행 (t={THRESHOLDS}, n={MIN_N}..{MAX_N})")
    print("크기:", ", ".join(f"{p.name} {p.stat().st_size / 2**20:.1f}MB" for p in sorted(out.iterdir())))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
