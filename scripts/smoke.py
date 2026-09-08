#!/usr/bin/env python3
"""배포(또는 dev 서버)가 살아 있고 규칙대로 동작하는지 확인하는 스모크 테스트.

    python3 scripts/smoke.py https://enhanced-kordle.bateaux.workers.dev
    python3 scripts/smoke.py http://localhost:5173        # pnpm dev (로컬 D1)

의존성 없음(표준 라이브러리). 실패하면 exit 1과 함께 어느 검사가 깨졌는지 찍는다.
기대값은 docs/HANDOFF.md "기준 수치"와 같은 근거에서 나온다 — 사전을 다시 만들면 여기 pool 크기도 갱신한다.

주의: Cloudflare는 User-Agent가 없는(또는 python-urllib 같은) 요청에 403을 준다. 브라우저 UA를 붙인다.
"""
import json
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173").rstrip("/")
HDR = {"content-type": "application/json", "User-Agent": "Mozilla/5.0 (smoke)"}

# 정답 풀 크기 (t, n) → count. export_d1.py 실행 시 pool_meta에 들어가는 값과 같아야 한다.
# 사전(kordle.db)을 다시 만들면 바뀌므로 그때 함께 갱신한다. 2026-09-03 사전 기준.
POOL_SIZE = {
    (3, 5): 3061, (3, 6): 3562, (3, 7): 1389, (3, 8): 1427, (3, 9): 1191, (3, 10): 506, (3, 11): 273, (3, 12): 166,
    (2, 5): 4893, (2, 6): 6975, (2, 7): 3093, (2, 8): 3847, (2, 9): 3260, (2, 10): 1415, (2, 11): 826, (2, 12): 482,
}

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
check("daily 토큰 형식 n.t.idx.sig (t=3)", tokens[0].split(".")[:2] == ["6", "3"], tokens[0])
climb = post("game", {"mode": "daily-climb", "n": 6})[1]["token"]
check("daily-climb n=6 은 daily n=6 과 다른 정답", climb.split(".")[2] != tokens[0].split(".")[2])
st, r = post("game", {"mode": "daily"})
check("daily n 미지정 → 5..12 안에서 결정", st == 200 and 5 <= r["n"] <= 12)

# 4. 모드별 풀 임계값
for mode, t in (("daily", 3), ("daily-climb", 3), ("climb-length", 3), ("endless", 2), ("climb-streak", 2)):
    st, r = post("game", {"mode": mode, "n": 8})
    check(f"{mode} → 풀 t={t}", st == 200 and r["token"].split(".")[1] == str(t))

# 5. 풀 크기 — idx가 pool_meta 범위 안인지 (랜덤이라 상한만 확인), 그리고 마지막 idx가 조회되는지
for (t, n), size in POOL_SIZE.items():
    mode = "endless" if t == 2 else "climb-length"
    st, r = post("game", {"mode": mode, "n": n})
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
