#!/usr/bin/env python3
"""국립국어원 사전 세 종과 위키백과 제목을 자모 분해해 하나의 SQLite 사전으로 적재한다.

    python3 build_dict.py kordle.db --stdict dict/stdict --krdict dict/nikl/krdict --opendict dict/nikl/opendict \
        --kowiki dict/kowiki/kowiki-20260901-page.sql.gz

소스 (모두 선택, 최소 하나):
  --stdict   표준국어대사전 xls를 LibreOffice로 변환한 UTF-8 CSV 디렉터리
             soffice --headless --convert-to 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true' \
                 --outdir <csv_dir> dict/*.xls
  --krdict   한국어기초사전 LMF XML 디렉터리 (github.com/spellcheck-ko/korean-dict-nikl/krdict)
  --opendict 우리말샘 XML 디렉터리 (같은 저장소의 opendict)
  --kowiki   한국어 위키백과 page.sql.gz (dumps.wikimedia.org/kowiki/<날짜>/). 일반 문서 제목 중
             띄어 쓴 것만 '구'로 넣는다 — 공백 없는 제목은 65%가 인명이라 판정 공간을 무의미하게 넓힌다.

같은 표기는 한 행으로 합치고 출처를 src 비트로 남긴다. 판정 사전은 넓게, 정답 풀은 src/level/pos로 좁히는 구조.
"""
import argparse
import csv
import gzip
import re
import sqlite3
from pathlib import Path
from xml.etree import ElementTree as ET

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

SRC_STDICT, SRC_KRDICT, SRC_OPENDICT, SRC_KOWIKI = 1, 2, 4, 8
LEVEL_RANK = {"초급": 0, "중급": 1, "고급": 2}

# MediaWiki page 테이블 INSERT 튜플: (page_id, page_namespace, 'page_title', page_is_redirect, page_is_new,
#   page_random, 'page_touched', 'page_links_updated'|NULL, page_latest, page_len, ...
WIKI_ROW = re.compile(
    r"\((\d+),(-?\d+),'((?:[^'\\]|\\.)*)',(\d),\d+,[\d.e-]+,'\d+',(?:'\d+'|NULL),\d+,(\d+),"
)
WIKI_PAREN = re.compile(r"\s*\([^()]*\)$")  # '스트라이드 (음악)' 의 동음이의 꼬리

HOMONYM = re.compile(r"\(\d+\)$")
SPACES = re.compile(r"\s+")
SYLLABLE_OR_SPACE = re.compile(r"^[가-힣 ]+$")
# 원본 XML에 0x08 같은 제어 문자가 섞여 있어 그대로 넣으면 파서가 죽는다.
XML_CTRL = re.compile(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]")
# 표준국어대사전 품사 열은 '「1」명사\n「2」부사\n' 꼴 — 첫 품사만 취한다. '의존 명사', '관·명'도 한 토큰.
POS_TOKEN = re.compile(r"[가-힣·]+(?: [가-힣·]+)*")


def clean_pos(raw):
    m = POS_TOKEN.search(raw or "")
    if not m or m.group() == "품사 없음":
        return None
    return m.group()


def normalize(raw):
    """사전 표기 기호를 걷어내고 어휘만 남긴다. 대상이 아니면 None."""
    w = HOMONYM.sub("", raw).strip()
    # 앞뒤 하이픈은 접사·어미 표시(-ㄴ가, 가-)로, 단독으로 쓰이는 단어가 아니다.
    if not w or w.startswith("-") or w.endswith("-"):
        return None
    w = w.replace("^", " ").replace("·", " ").replace("-", "")
    w = SPACES.sub(" ", w).strip()
    # 한자·로마자·낱자모(ㄱ, ㅏ)·옛한글이 남은 표제어는 자모 분해 대상이 아니다.
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


class _CleanXML:
    def __init__(self, path):
        self.f = open(path, "rb")

    def read(self, n=-1):
        return XML_CTRL.sub(b"", self.f.read(n))


def iter_xml(path, tag):
    for _, el in ET.iterparse(_CleanXML(path)):
        if el.tag == tag:
            yield el
            el.clear()


# ---- 소스별 리더: dict(word=원표기, unit, pos, level, dialect, senses, domains, wiki_len, flag_only) 를 낸다 ----

SENSE_NO = re.compile(r"「\d+」")
DOMAIN = re.compile(r"『([^』]+)』")
# 고유명사 분야 — 정답 풀에서 제외한다
PROPER_DOMAINS = {"인명", "지명", "책명", "고유명 일반"}


def read_stdict(csv_dir):
    for path in sorted(Path(csv_dir).glob("*.csv")):
        with open(path, encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            header = next(reader)
            col = {name: header.index(name) for name in ("어휘", "구성 단위", "품사", "뜻풀이", "전문 분야")}
            for row in reader:
                unit = row[col["구성 단위"]]
                if unit not in ("단어", "구"):
                    continue
                dom = row[col["전문 분야"]]
                yield dict(
                    word=row[col["어휘"]], unit=unit, pos=row[col["품사"]],
                    # 뜻풀이의 「n」 번호 수 = 뜻 개수. 없으면 단의어.
                    senses=max(1, len(SENSE_NO.findall(row[col["뜻풀이"]]))),
                    # 분야 표시가 없으면 일반어 → 빈 집합. 있으면 그 분야들.
                    domains=set(DOMAIN.findall(dom)) if dom.strip() else set(),
                    general=not dom.strip(),
                )


def read_krdict(xml_dir):
    for path in sorted(Path(xml_dir).glob("*.xml")):
        for el in iter_xml(path, "LexicalEntry"):
            f = {x.get("att"): x.get("val") for x in el.findall("feat")}
            if f.get("lexicalUnit") not in ("단어", "구"):
                continue
            lemma = el.find("Lemma/feat[@att='writtenForm']")
            if lemma is None:
                continue
            level = f.get("vocabularyLevel")
            yield dict(word=lemma.get("val"), unit=f["lexicalUnit"], pos=f.get("partOfSpeech"),
                       level=level if level in LEVEL_RANK else None)


def read_opendict(xml_dir):
    for path in sorted(Path(xml_dir).glob("*.xml")):
        for el in iter_xml(path, "item"):
            wi, si = el.find("wordInfo"), el.find("senseInfo")
            unit = wi.findtext("word_unit")
            if unit == "어휘":
                unit = "단어"
            elif unit != "구":
                continue
            # 방언·북한어는 판정 사전에서 기본 제외하려고 표시만 해 둔다. 옛말은 옛한글이라 normalize에서 빠진다.
            yield dict(word=wi.findtext("word"), unit=unit, pos=si.findtext("pos"),
                       dialect=si.findtext("type") in ("방언", "북한어"))


def read_kowiki(sql_gz):
    with gzip.open(sql_gz, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            if not line.startswith("INSERT INTO"):
                continue
            for m in WIKI_ROW.finditer(line):
                # 일반 문서(ns0)만, 넘겨주기(오타·이형 표기)는 제외
                if m.group(2) != "0" or m.group(4) == "1":
                    continue
                title = m.group(3).replace("_", " ").replace("\\'", "'").replace('\\"', '"')
                word = normalize(WIKI_PAREN.sub("", title))
                if not word:
                    continue
                # 띄어 쓴 제목은 '구'로 새로 넣지만, 붙여 쓴 제목은 65%가 인명이라 새 행을 만들지 않고
                # 이미 사전에 있는 단어에 "위키 문서 있음(길이)"만 표시한다 — 익숙함 신호로 쓴다.
                yield dict(word=word, unit="구", wiki_len=int(m.group(5)), flag_only=" " not in word)


class Entry:
    __slots__ = ("unit", "src", "pos", "level", "dialect", "senses", "general", "proper", "wiki_len")

    def __init__(self):
        self.unit, self.src, self.pos, self.level = "구", 0, None, None
        self.dialect, self.senses, self.general, self.proper, self.wiki_len = True, 0, False, False, None

    def merge(self, bit, r):
        # 같은 표기가 단어와 구 양쪽에 있으면 단어 쪽을 남긴다.
        if r["unit"] == "단어":
            self.unit = "단어"
        self.src |= bit
        if self.pos is None:
            self.pos = clean_pos(r.get("pos"))
        # 등급은 가장 쉬운 쪽을 남긴다 — "중급까지"처럼 상한으로 걸러 쓰기 위해.
        lv = r.get("level")
        if lv and (self.level is None or LEVEL_RANK[lv] < LEVEL_RANK[self.level]):
            self.level = lv
        # 일반어로 등재된 출처가 하나라도 있으면 방언 표시를 지운다.
        self.dialect = self.dialect and r.get("dialect", False)
        self.senses += r.get("senses", 0)
        # 동형어 중 하나라도 분야 표시가 없으면 일반어로 본다. 고유명 분야는 하나라도 있으면 고유명사로.
        self.general = self.general or r.get("general", False)
        self.proper = self.proper or bool(r.get("domains", set()) & PROPER_DOMAINS)
        if r.get("wiki_len") is not None:
            self.wiki_len = max(self.wiki_len or 0, r["wiki_len"])

    def familiar(self):
        """익숙함 점수. 독립적인 출처 세 곳의 신호를 합친다 — 정답 풀은 이 값의 하한으로 고른다.
        고유명사(인명·지명·책명)는 None. 표준국어대사전에 없는 표기도 None(정답 풀 후보가 아니다)."""
        if self.proper or not (self.src & SRC_STDICT):
            return None
        score = {"초급": 4, "중급": 3, "고급": 2, None: 0}[self.level]
        if self.wiki_len is not None and self.wiki_len >= 3000:
            score += 2  # 짧은 문서는 동음이의 안내·토막글이 많아 3KB 이상만 인정
        if self.senses >= 4:
            score += 1
        if not self.general:
            score -= 1  # 전문 분야 표시만 있는 단어
        return score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("db")
    ap.add_argument("--stdict")
    ap.add_argument("--krdict")
    ap.add_argument("--opendict")
    ap.add_argument("--kowiki", help="page.sql.gz 파일")
    args = ap.parse_args()

    sources = [
        (SRC_STDICT, args.stdict, read_stdict),
        (SRC_KRDICT, args.krdict, read_krdict),
        (SRC_OPENDICT, args.opendict, read_opendict),
        (SRC_KOWIKI, args.kowiki, read_kowiki),
    ]
    if not any(d for _, d, _ in sources):
        ap.error("소스를 하나 이상 지정하세요")

    words = {}
    for bit, d, reader in sources:
        if not d:
            continue
        total = 0
        before = len(words)
        for r in reader(d):
            total += 1
            word = normalize(r["word"])
            if word is None:
                continue
            e = words.get(word)
            if e is None:
                if r.get("flag_only"):
                    continue
                e = words[word] = Entry()
            e.merge(bit, r)
        print(f"{reader.__name__[5:]:8} 표제어 {total:>9,} → 신규 {len(words) - before:>8,} (누적 {len(words):,})")

    db = Path(args.db)
    db.unlink(missing_ok=True)
    con = sqlite3.connect(db)
    con.executescript("""
        CREATE TABLE words (
            word          TEXT PRIMARY KEY,
            unit          TEXT NOT NULL,       -- 단어 | 구
            syllables     INTEGER NOT NULL,
            jamo          TEXT NOT NULL,       -- 자모 24종 열, 공백 제거
            jamo_len      INTEGER NOT NULL,
            distinct_jamo INTEGER NOT NULL,
            src           INTEGER NOT NULL,    -- 비트: 1 표준국어대사전, 2 한국어기초사전, 4 우리말샘, 8 위키백과
            pos           TEXT,                -- 품사 (출처 중 먼저 나온 값)
            level         TEXT,                -- 한국어기초사전 등급: 초급 | 중급 | 고급
            dialect       INTEGER NOT NULL,    -- 1: 우리말샘에 방언/북한어로만 등재
            senses        INTEGER NOT NULL,    -- 표준국어대사전 뜻 개수(동형어 합산)
            wiki_len      INTEGER,             -- 같은 제목의 위키백과 문서 길이(바이트), 없으면 NULL
            familiar      INTEGER              -- 익숙함 점수(Entry.familiar). 고유명사·표준국어대사전 밖은 NULL
        );
    """)
    rows = []
    for word, e in words.items():
        jamo = decompose(word)
        rows.append((word, e.unit, len(word.replace(" ", "")), jamo, len(jamo), len(set(jamo)),
                     e.src, e.pos, e.level, int(e.dialect), e.senses, e.wiki_len, e.familiar()))
    con.executemany("INSERT INTO words VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.executescript("""
        CREATE INDEX idx_jamo ON words(jamo);
        CREATE INDEX idx_pool ON words(unit, pos, jamo_len, familiar);
    """)
    con.commit()
    con.close()
    print(f"수록 {len(rows):,}")


if __name__ == "__main__":
    main()
