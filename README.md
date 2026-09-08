# n자 꼬들

한국어 단어를 **자모로 풀어쓴 열**을 맞히는 워들. [원작 꼬들](https://kordle.kr)의 6자 규칙을 5~12자로 확장하고, 게임 모드와 사전을 넓혔다.

- 자모 수 **5~12** 직접 선택 또는 랜덤
- 게임 모드 5종: **하루 1개** · **일일 등반**(매일 같은 5→12자 코스) · **랜덤 무한** · **등반 · 연속 클리어** · **등반 · 길이 상승**
- 판정 사전 120만 표제어(표준국어대사전 · 한국어기초사전 · 우리말샘 · 위키백과 띄어 쓴 제목), 정답 풀은 익숙한 명사만
- 힌트(노란 자모의 실제 위치), 포기, 등반 결과 피라미드, 물리 키보드(두벌식 자리, 한/영 무관)

유지·개발하려면 [`docs/HANDOFF.md`](docs/HANDOFF.md)(배경·결정·절차·기준 수치)와 [`AGENTS.md`](AGENTS.md)(규칙)를 먼저 읽는다. 배포 후 확인은 `python3 scripts/smoke.py <URL>`.

## 자모 규칙

게임이 세는 자모는 **24종**(자음 14 + 모음 10)이다.

| 원칙 | 예 |
|---|---|
| 쌍자음·겹받침은 자모 둘 | 까 = ㄱㄱㅏ, 닭 = ㄷㅏㄹㄱ |
| 합성 모음은 기본 모음으로 | 개 = ㄱㅏㅣ, 왜 = ㅇㅗㅏㅣ |
| ㅑㅕㅛㅠ는 한 자모 | 여 = ㅇㅕ |

## 실행

Cloudflare Workers + D1에서 돈다. 서버가 무상태(진행은 브라우저 localStorage, 정답은 서명 토큰)라 엣지 어디서 실행돼도 같고, 잠들지 않는다. 무료 한도(하루 10만 요청, D1 읽기 500만 행)로 충분하다.

### 배포 (처음 한 번)

```bash
pnpm install
npx wrangler login                          # Cloudflare 계정 (무료, 카드 불필요)
npx wrangler d1 create kordle               # 출력된 database_id를 wrangler.jsonc에 넣는다
python3 export_d1.py kordle.db d1/          # kordle.db → D1 임포트용 SQL (아래 "사전 만들기")
d1/import.sh --remote                       # 약 56만 + 3.6만 행, 몇 분
npx wrangler secret put KORDLE_SECRET       # 임의의 긴 문자열 (openssl rand -base64 32)
pnpm run deploy                                 # → https://enhanced-kordle.<계정>.workers.dev
```

이후 코드가 바뀌면 `pnpm run deploy`만. 사전이 바뀌면 `export_d1.py` → `d1/import.sh --remote`.

커스텀 도메인은 Cloudflare 대시보드 → Workers → 설정 → 도메인 및 경로에서 붙인다(DNS·TLS 무료).

### 로컬 개발

```bash
pnpm install
cp .dev.vars.example .dev.vars              # KORDLE_SECRET
python3 export_d1.py kordle.db d1/ && d1/import.sh --local   # 로컬 D1 (.wrangler/state)
pnpm dev                                    # http://localhost:5173 — D1은 로컬 에뮬레이션
pnpm preview                                # wrangler dev: 실제 Workers 런타임으로 확인
```

| 설정 | 어디에 | 뜻 |
|---|---|---|
| `KORDLE_SECRET` | `wrangler secret` / `.dev.vars` | 정답 토큰 서명 키. 바꾸면 진행 중 게임이 전부 무효가 된다 |
| `DB` | `wrangler.jsonc` d1_databases | 사전 D1 바인딩 |

## 사전 만들기

`kordle.db`(약 210MB)는 저장소에 없다. 원본 네 종을 받아 `build_dict.py`로 만들고, 서버가 쓰는 부분만 `export_d1.py`로 D1에 넣는다.

| 소스 | 받는 곳 | 형식 | 크기 |
|---|---|---|---|
| 표준국어대사전 | [stdict.korean.go.kr](https://stdict.korean.go.kr) → 사전 내려받기 (xls) | LibreOffice로 CSV 변환 | 270MB |
| 한국어기초사전 | [spellcheck-ko/korean-dict-nikl](https://github.com/spellcheck-ko/korean-dict-nikl) `krdict/` | LMF XML | 370MB |
| 우리말샘 | 같은 저장소 `opendict/` | XML | 1.8GB |
| 한국어 위키백과 | [dumps.wikimedia.org/kowiki](https://dumps.wikimedia.org/kowiki/) `page.sql.gz` | MySQL dump | 117MB |

```bash
# 표준국어대사전 xls → csv
soffice --headless --convert-to 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true' \
    --outdir dict/stdict dict/*.xls

python3 build_dict.py kordle.db \
    --stdict dict/stdict \
    --krdict dict/nikl/krdict \
    --opendict dict/nikl/opendict \
    --kowiki dict/kowiki/kowiki-YYYYMMDD-page.sql.gz
```

약 1분. 소스는 각각 선택이라 표준국어대사전만으로도 만들 수 있다.

D1에는 `words` 전체(120만 행)가 아니라 두 테이블만 올린다 — 판정용 자모열 `valid`(56만 행)와 정답 풀을 `(임계값, n, idx) → 단어`로 미리 펼친 `pool`(3.6만 행). D1은 읽은 행 수로 한도를 세므로 모든 조회를 PK 한 행으로 만든 것이다. 합쳐서 약 30MB.

### 정답 풀

판정은 전체 사전(방언·북한어 제외)으로 넓게, 정답은 좁게 고른다. 정답 후보는 표준국어대사전 명사에 **익숙함 점수**(`familiar`)를 매겨 임계값 이상만 쓴다.

| 신호 | 점수 |
|---|---|
| 한국어기초사전 등급 | 초급 +4 · 중급 +3 · 고급 +2 |
| 위키백과에 3KB 이상 문서 | +2 |
| 표준국어대사전 뜻 4개 이상 | +1 |
| 전문 분야 표시 | −1 |
| 인명 · 지명 · 책명 | 제외 |

하루 1개 · 등반 길이 상승은 `≥3`(약 1.2만), 랜덤 무한 · 등반 연속 클리어는 `≥2`(약 2.5만). 임계값은 `src/lib/server/dict.ts`의 `POOL_THRESHOLD`(같은 값이 `export_d1.py`의 `THRESHOLDS`에도 있어야 한다), 가중치는 `build_dict.py`의 `Entry.familiar()`.

## 구조

```
build_dict.py            사전 빌드 (자모 분해 · 4소스 병합 · familiar 점수) → kordle.db
export_d1.py             kordle.db → D1용 SQL (valid · pool · pool_meta)
wrangler.jsonc           Workers 설정 (D1 바인딩, 정적 자산)
src/lib/server/dict.ts   D1 조회 · 정답 풀 임계값
src/lib/server/token.ts  정답을 (n, 임계값, idx)로 HMAC 서명 (Web Crypto) — 서버는 무상태
src/lib/server/judge.ts  워들 판정
src/routes/api/          game · guess · check · hint · reveal
src/lib/game.svelte.ts   클라이언트 상태 (진행·통계·설정은 localStorage)
```

## 데이터 출처

- 표준국어대사전 · 한국어기초사전 · 우리말샘 — 국립국어원, [CC BY-SA 2.0 KR](https://creativecommons.org/licenses/by-sa/2.0/kr/)
- 한국어 위키백과 — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- UI는 [꼬들](https://kordle.kr)을 따랐다.
