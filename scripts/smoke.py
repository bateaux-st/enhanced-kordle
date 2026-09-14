#!/usr/bin/env python3
"""배포(또는 dev 서버)가 살아 있고 규칙대로 동작하는지 확인하는 스모크 테스트.

    python3 scripts/smoke.py https://enhanced-kordle.bateaux.workers.dev
    python3 scripts/smoke.py http://localhost:5173        # pnpm dev (로컬 D1)

의존성 없음(표준 라이브러리). 실패하면 exit 1과 함께 어느 검사가 깨졌는지 찍는다.
기대값은 docs/HANDOFF.md "기준 수치"와 같은 근거에서 나온다 — 사전을 다시 만들면 여기 pool 크기도 갱신한다.

주의: Cloudflare는 User-Agent가 없는(또는 python-urllib 같은) 요청에 403을 준다. 브라우저 UA를 붙인다.
"""
import json
import hashlib
from datetime import datetime, timedelta, timezone
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173").rstrip("/")
HDR = {"content-type": "application/json", "User-Agent": "Mozilla/5.0 (smoke)"}

# ---- 기대값. 아래 셋은 서버 코드·export_d1.py와 짝이다. 바꿀 때 함께 바꾼다. ----

# 모드별 정답 풀 임계값. src/lib/server/dict.ts POOL_THRESHOLD 와 같아야 한다.
EXPECTED_T = {"daily": 3, "daily-climb": 3, "climb-length": 3, "endless": 1, "climb-streak": 1}

# 정답 풀 크기 (t, n) → count. `python3 export_d1.py kordle.db d1/` 가 마지막에 이 블록을 그대로 출력한다 — 복사해 붙인다.
# 사전(kordle.db)이나 풀 조건이 바뀌면 바뀐다. 2026-09-11 기준(전문 분야 감점 면제·무한 T=1).
POOL_SIZE = {
    (1, 5): 6813, (1, 6): 9536, (1, 7): 4358, (1, 8): 5701, (1, 9): 4943, (1, 10): 2325, (1, 11): 1472, (1, 12): 908,
    (2, 5): 5050, (2, 6): 7383, (2, 7): 3424, (2, 8): 4388, (2, 9): 3739, (2, 10): 1581, (2, 11): 933, (2, 12): 525,
    (3, 5): 3121, (3, 6): 3701, (3, 7): 1461, (3, 8): 1511, (3, 9): 1271, (3, 10): 548, (3, 11): 293, (3, 12): 174,
}

# 풀 크기 검사에 쓸 대표 모드: 임계값 t를 쓰는 모드 중 랜덤(비데일리)인 것 하나. 새 t가 생기면 여기도 추가.
MODE_FOR_T = {t: next(m for m, tt in EXPECTED_T.items() if tt == t and not m.startswith("daily")) for t in set(EXPECTED_T.values())}

failures = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def post(path, body):
    req = urllib.request.Request(f"{BASE}/api/{path}", json.dumps(body).encode(), HDR)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None


def get(path):
    req = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": HDR["User-Agent"]})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.read().decode("utf-8", "replace")


print(f"smoke → {BASE}")

# 1. 정적 셸
st, html = get("/")
check("GET / → 200", st == 200)
check("셸 HTML에 lang=ko", 'lang="ko"' in html)

# 2. 판정 사전 — 규칙별 대표 케이스
cases = [
    ("ㅂㅏㄴㅏㄴㅏ", True, "표준국어대사전 단어(바나나)"),
    ("ㅎㅓㄴㅂㅓㅂㅅㅗㅇㅜㅓㄴ", True, "우리말샘 '구'를 붙여 친 것(헌법소원) — jamo 키 판정"),
    ("ㅊㅣㅁㅏㅣㄱ", True, "우리말샘 신조어(치맥)"),
    ("ㅅㅅㅏㄴㅅㅑㄷㅏㅣㅁ", True, "위키백과 띄어 쓴 제목(싼샤 댐)"),
    ("ㄱㅣㅁㅇㅕㄴㅇㅏ", True, "NIADic 인명(김연아)"),
    ("ㅅㅡㅌㅏㅂㅓㄱㅅㅡ", True, "NIADic 브랜드(스타벅스)"),
    ("ㄱㅏㅍㅕㅇㅇㅡㅂ", True, "NIADic 장소(가평읍)"),
    ("ㄱㅓㅅㅣㄹㄱㅜㅁㄷㅗㄴ", False, "우리말샘 방언(거실굼돈)은 제외"),
    ("ㅋㅋㅋㅋㅋㅋ", False, "사전에 없는 열"),
]
for jamo, expect, why in cases:
    st, r = post("check", {"jamo": jamo})
    check(f"check {jamo} valid={expect}", st == 200 and r and r["valid"] == expect, why)
st, _ = post("check", {"jamo": "ㅂㅏ"})
check("check 4자모 이하 → 400", st == 400)

# 3. 데일리 결정론 — 같은 요청 두 번이면 같은 토큰(정답), 데일리와 일일 등반은 다른 정답
tokens = [post("game", {"mode": "daily", "n": 6})[1]["token"] for _ in range(2)]
check("daily n=6 두 번 호출 → 같은 토큰", tokens[0] == tokens[1])
check(f"daily 토큰 형식 n.t.idx.sig (t={EXPECTED_T['daily']})", tokens[0].split(".")[:2] == ["6", str(EXPECTED_T["daily"])], tokens[0])
climb = post("game", {"mode": "daily-climb", "n": 6})[1]["token"]
check("daily-climb n=6 은 daily n=6 과 다른 정답", climb.split(".")[2] != tokens[0].split(".")[2])
st, r = post("game", {"mode": "daily"})
check("daily n 미지정 → 5..12 안에서 결정", st == 200 and 5 <= r["n"] <= 12)

# 자정 뒤 열린 탭이 요청한 이전 날짜를 실제 시드로 사용하는지 검사한다.
yesterday = (datetime.now(timezone(timedelta(hours=9))) - timedelta(days=1)).date().isoformat()
for mode in ("daily", "daily-climb"):
    st, old = post("game", {"mode": mode, "n": 6, "day": yesterday})
    st2, again = post("game", {"mode": mode, "n": 6, "day": yesterday})
    check(f"{mode} 지난 날짜 요청 결정론", st == st2 == 200 and old == again)
    seed = f"{yesterday}:6" + (":climb" if mode == "daily-climb" else "")
    expected_idx = int.from_bytes(hashlib.sha256(seed.encode()).digest()[:4], "big") % POOL_SIZE[(EXPECTED_T[mode], 6)]
    check(f"{mode} 지정 날짜 시드 유지", st == 200 and old and old["token"].split(".")[2] == str(expected_idx))
for bad_day in ("2026-02-30", "9999-12-31", "bad", None):
    st, _ = post("game", {"mode": "daily-climb", "n": 6, "day": bad_day})
    check(f"잘못된 날짜 {bad_day!r} → 400", st == 400)

# 4. 모드별 풀 임계값
for mode, t in EXPECTED_T.items():
    st, r = post("game", {"mode": mode, "n": 8})
    check(f"{mode} → 풀 t={t}", st == 200 and r["token"].split(".")[1] == str(t))
st, _ = post("game", {"mode": "no-such-mode", "n": 8})
check("알 수 없는 mode → 400", st == 400)

# 5. 풀 크기 — idx가 pool_meta 범위 안인지 (랜덤이라 상한만 확인), 그리고 마지막 idx가 조회되는지
#    어느 모드도 쓰지 않는 t(발급된 토큰 때문에 D1에만 남겨 둔 값)는 API로 뽑을 수 없어 건너뛴다.
for (t, n), size in POOL_SIZE.items():
    if t not in MODE_FOR_T:
        continue
    # 새로 발급하지 않는 t=2는 이전 토큰 지원용으로 D1에만 남는다.
    if t not in MODE_FOR_T:
        continue
    st, r = post("game", {"mode": MODE_FOR_T[t], "n": n})
    idx = int(r["token"].split(".")[2])
    check(f"pool t={t} n={n} idx<{size}", idx < size, f"idx={idx}")

# 6. 판정·정답·힌트 — 정답을 reveal로 얻어 그대로 넣으면 전부 c
st, g = post("game", {"mode": "endless", "n": 6})
tok = g["token"]
st, rv = post("reveal", {"token": tok})
check("reveal → word", st == 200 and rv and rv["word"])
st, gs = post("guess", {"token": tok, "jamo": "ㅂㅏㄴㅏㄴㅏ"})
check("guess 유효 단어 → marks 6개", st == 200 and gs["ok"] and len(gs["marks"]) == 6 and set(gs["marks"]) <= {"c", "p", "a"})
st, gs = post("guess", {"token": tok, "jamo": "ㅋㅋㅋㅋㅋㅋ"})
check("guess 사전 밖 → ok:false invalid", st == 200 and gs == {"ok": False, "reason": "invalid"})
st, gs = post("guess", {"token": tok, "jamo": "ㅂㅏㄴㅏㄴ"})
check("guess 길이 불일치 → 400", st == 400)
st, _ = post("guess", {"token": "6.2.1.AAAA", "jamo": "ㅂㅏㄴㅏㄴㅏ"})
check("위조 토큰 → 400", st == 400)
st, _ = post("reveal", {"token": "6.10384.abc"})
check("옛 형식(n.idx.sig) 토큰 → 400", st == 400)
st, h = post("hint", {"token": tok, "jamo": "ㅏ"})
check("hint → pos 또는 400(정답에 ㅏ 없음)", (st == 200 and 0 <= h["pos"] < 6) or st == 400)

print()
if failures:
    print(f"{len(failures)} FAILED: " + ", ".join(failures))
    sys.exit(1)
print("all passed")
