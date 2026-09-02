#!/usr/bin/env python3
"""표준국어대사전 CSV의 '어휘' 열을 자모 분해해 SQLite 사전으로 적재한다.

입력: LibreOffice로 xls에서 변환한 UTF-8 CSV 디렉터리
출력: words 테이블 (word, unit, syllables, jamo, jamo_len)

xls -> csv 변환 (xlrd는 이 파일들의 SST 테이블에서 UnicodeDecodeError로 실패한다):
    soffice --headless \
        --convert-to csv:"Text - txt - csv (StarCalc)":44,34,76,1,,0,false,true,true \
        --outdir <csv_dir> dict/*.xls
"""
import csv
import re
import sqlite3
import sys
from pathlib import Path

csv.field_size_limit(10**9)

CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"

# 게임이 다루는 자모 24종(자음 14 + 모음 10)까지 편다. 쌍자음은 같은 자모 둘,
# 겹받침은 서로 다른 자음 둘, 나머지 중성은 기본 모음의 합성으로 본다.
# ㅑㅕㅛㅠ는 게임에서도 한 자모라 더 쪼개지 않는다.
SPLIT = {
    "ㄲ": "ㄱㄱ", "ㄸ": "ㄷㄷ", "ㅃ": "ㅂㅂ", "ㅆ": "ㅅㅅ", "ㅉ": "ㅈㅈ",
    "ㄳ": "ㄱㅅ", "ㄵ": "ㄴㅈ", "ㄶ": "ㄴㅎ", "ㄺ": "ㄹㄱ", "ㄻ": "ㄹㅁ",
    "ㄼ": "ㄹㅂ", "ㄽ": "ㄹㅅ", "ㄾ": "ㄹㅌ", "ㄿ": "ㄹㅍ", "ㅀ": "ㄹㅎ", "ㅄ": "ㅂㅅ",
    "ㅐ": "ㅏㅣ", "ㅒ": "ㅑㅣ", "ㅔ": "ㅓㅣ", "ㅖ": "ㅕㅣ",
    "ㅘ": "ㅗㅏ", "ㅙ": "ㅗㅏㅣ", "ㅚ": "ㅗㅣ", "ㅝ": "ㅜㅓ", "ㅞ": "ㅜㅓㅣ",
    "ㅟ": "ㅜㅣ", "ㅢ": "ㅡㅣ",
}

HOMONYM = re.compile(r"\(\d+\)$")
SPACES = re.compile(r"\s+")
SYLLABLE_OR_SPACE = re.compile(r"^[가-힣 ]+$")


def normalize(raw):
    """사전 표기 기호를 걷어내고 어휘만 남긴다. 대상이 아니면 None."""
    w = HOMONYM.sub("", raw).strip()
    # 앞뒤 하이픈은 접사·어미 표시(-ㄴ가, 가-)로, 단독으로 쓰이는 단어가 아니다.
    if not w or w.startswith("-") or w.endswith("-"):
        return None
    w = w.replace("^", " ").replace("·", " ").replace("-", "")
    w = SPACES.sub(" ", w).strip()
    # 한자·로마자·낱자모(ㄱ, ㅏ)가 남은 표제어는 자모 분해 대상이 아니다.
    if not w or not SYLLABLE_OR_SPACE.match(w):
        return None
    return w


def decompose(word):
    """완성형 음절열을 게임 자모 24종의 열로 편다. 공백은 버린다."""
    out = []
    for ch in word:
        if ch == " ":
            continue
        code = ord(ch) - 0xAC00
        cho, rest = divmod(code, 588)
        jung, jong = divmod(rest, 28)
        for jamo in (CHO[cho], JUNG[jung], JONG[jong]):
            if jamo != " ":
                out.append(SPLIT.get(jamo, jamo))
    return "".join(out)


def main(csv_dir, db_path):
    words = {}
    total = 0
    for path in sorted(Path(csv_dir).glob("*.csv")):
        with open(path, encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            header = next(reader)
            i_word, i_unit = header.index("어휘"), header.index("구성 단위")
            for row in reader:
                total += 1
                unit = row[i_unit]
                if unit not in ("단어", "구"):
                    continue
                word = normalize(row[i_word])
                if word is None:
                    continue
                # 같은 표기가 단어와 구 양쪽에 있으면 단어 쪽을 남긴다.
                if word not in words or unit == "단어":
                    words[word] = unit

    db = Path(db_path)
    db.unlink(missing_ok=True)
    con = sqlite3.connect(db)
    con.executescript("""
        CREATE TABLE words (
            word          TEXT PRIMARY KEY,
            unit          TEXT NOT NULL,
            syllables     INTEGER NOT NULL,
            jamo          TEXT NOT NULL,
            jamo_len      INTEGER NOT NULL,
            distinct_jamo INTEGER NOT NULL
        );
    """)
    rows = []
    for word, unit in words.items():
        jamo = decompose(word)
        rows.append((word, unit, len(word.replace(" ", "")), jamo, len(jamo), len(set(jamo))))
    con.executemany("INSERT INTO words VALUES (?,?,?,?,?,?)", rows)
    con.executescript("""
        CREATE INDEX idx_syllables ON words(syllables);
        CREATE INDEX idx_jamo_len ON words(jamo_len, distinct_jamo);
        CREATE INDEX idx_unit_syl ON words(unit, syllables);
    """)
    con.commit()
    con.close()
    print(f"원본 표제어 {total:,} → 수록 {len(rows):,}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
