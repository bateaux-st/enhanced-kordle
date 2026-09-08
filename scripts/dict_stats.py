#!/usr/bin/env python3
"""kordle.db의 기준 수치를 뽑는다 — docs/HANDOFF.md §9 표와 같은 항목, 같은 순서.

    python3 scripts/dict_stats.py kordle.db

사전을 다시 만든 뒤 이 출력으로 §9를 갱신한다. 문서 수치와 실제가 다를 때 "장애인가, 문서 미갱신인가"를
가르는 도구이기도 하다 — 이 스크립트가 낸 값이 사전의 사실이고, 문서는 그 기록이다.
"""
import sqlite3
import sys

POOL = "unit = '단어' AND pos = '명사' AND word NOT LIKE '% %' AND familiar >= ? AND jamo_len = ?"  # export_d1.py와 동일
THRESHOLDS = (2, 3)
NS = range(5, 13)

con = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else "kordle.db")
q = lambda s, *a: con.execute(s, a).fetchone()[0]

print(f"words 행                          {q('SELECT COUNT(*) FROM words'):,}")
print(f"  src&1 (표준국어대사전)           {q('SELECT COUNT(*) FROM words WHERE src & 1'):,}   ← xls를 다시 변환하지 않았으면 350,600이어야 한다")
print(f"  dialect=1 (방언·북한어)          {q('SELECT COUNT(*) FROM words WHERE dialect = 1'):,}")
print(f"valid (5~12자모, dialect=0, distinct) {q('SELECT COUNT(DISTINCT jamo) FROM words WHERE jamo_len BETWEEN 5 AND 12 AND dialect = 0'):,}")
for t in THRESHOLDS:
    sizes = [q(f"SELECT COUNT(*) FROM words WHERE {POOL}", t, n) for n in NS]
    print(f"pool t={t}  합계 {sum(sizes):,}   n=5..12: " + " · ".join(f"{s:,}" for s in sizes))
print("familiar 분포 (명사 후보, 공백 없음, 5~12자모):")
rows = con.execute(
    "SELECT familiar, COUNT(*) FROM words WHERE unit='단어' AND pos='명사' AND word NOT LIKE '% %' "
    "AND jamo_len BETWEEN 5 AND 12 GROUP BY familiar ORDER BY familiar IS NOT NULL, familiar"
).fetchall()
print("  " + " · ".join(f"{'NULL' if f is None else f} {c:,}" for f, c in rows))
print("확인 단어 (familiar / pos):")
for w in ("고양이", "컴퓨터", "순량", "니나놋집", "세종", "뒤처리되다"):
    r = con.execute("SELECT familiar, pos FROM words WHERE word = ?", (w,)).fetchone()
    print(f"  {w:8} {r[0] if r else '없음'} / {r[1] if r else ''}")
