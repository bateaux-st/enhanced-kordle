# 인수인계 — n자 꼬들 (enhanced-kordle)

이 문서는 **이 레포를 처음 받은 사람/에이전트가 다른 정보 없이 유지·개발할 수 있게** 쓴 것이다. 짧은 규칙은 [`AGENTS.md`](../AGENTS.md), 사용자용 소개는 [`README.md`](../README.md). 여기는 그 뒤에 있는 "왜"와 "어디를 만지면 무엇이 깨지는가", 그리고 검증에 쓰는 기준 수치를 담는다.

마지막 갱신: 2026-09-08. 이후 바뀐 것은 `git log`가 우선한다.

---

## 1. 무엇인가

한국어 워들. 단어를 **자모 24종으로 풀어쓴 열**을 맞힌다. [원작 꼬들](https://kordle.kr)(6자 고정)을 5~12자 가변 + 게임 모드 5종으로 확장했고, 사전을 국립국어원 3종 + 위키백과로 넓혔다. 토이 프로젝트다 — 사용자 계정 없음, 서버 상태 없음, 트래픽 미미.

- 운영: **https://enhanced-kordle.bateaux.workers.dev** (Cloudflare Workers + D1)
- 코드: https://github.com/bateaux-st/enhanced-kordle (`main` 단일 브랜치, 배포는 수동 `pnpm run deploy`)
- 스택: SvelteKit 2 + Svelte 5(runes) + TypeScript, adapter-cloudflare, D1, Python 3(사전 빌드)

## 2. 아키텍처

```
브라우저 ─ GET /            → 정적 셸 HTML (빌드 때 프리렌더, Cloudflare Assets)
        ─ GET /_app/*      → JS/CSS (immutable, 해시 파일명)
        ─ POST /api/game   → Worker: 정답 좌표 (n, t, idx) 결정 → HMAC 서명 토큰
        ─ POST /api/check  → Worker: 자모열이 사전에 있나 (D1 valid)
        ─ POST /api/guess  → Worker: 토큰 검증 → 정답 조회(D1 pool) → 워들 판정
        ─ POST /api/hint   → Worker: 특정 자모의 정답 내 첫 위치
        ─ POST /api/reveal → Worker: 정답 단어
```

**서버는 상태가 없다.** 진행·통계·설정은 전부 브라우저 `localStorage`. 정답은 서버가 기억하지 않고 **(n, t, idx)를 HMAC으로 서명한 토큰**을 클라이언트가 들고 다니며 매 요청에 보낸다. 따라서 Worker가 어느 엣지에서 몇 개 떠도 상관없고, 재배포해도 진행 중 게임이 유지된다. 단 `KORDLE_SECRET`이 바뀌면 모든 토큰이 무효다.

**정답 좌표의 뜻**: `t`는 정답 풀 임계값(§5), `n`은 자모 수, `idx`는 그 (t, n) 풀 안에서의 순번. D1 `pool` 테이블이 `(t, n, idx) → word, jamo`를 미리 펼쳐 두고 있어 조회가 PK 한 행이다.

### 파일 지도

| 파일 | 역할 | 만질 때 주의 |
|---|---|---|
| `build_dict.py` | 원본 4소스 → `kordle.db` (자모 분해, 병합, `familiar` 점수) | `SPLIT` 맵·`normalize`·`Entry.familiar()`는 전부 §4 불변 규칙에 걸림 |
| `export_d1.py` | `kordle.db` → D1 임포트 SQL (`valid`, `pool`, `pool_meta`) | `POOL`·`THRESHOLDS`는 `dict.ts`와 **동일해야 함** |
| `d1/import.sh` | 위 SQL을 D1에 실행 (`--local`/`--remote`) | `schema.sql`이 `DROP TABLE`로 시작 → 원격 임포트 중 10초쯤 서비스가 빈 사전을 본다 |
| `wrangler.jsonc` | Worker 이름, D1 바인딩(`DB`), 정적 자산 | `database_id`는 계정에 묶임 |
| `src/lib/jamo.ts` | 자모 24종, 키보드 배열, 물리키 매핑 | `JAMO` 순서·구성은 `build_dict.py`와 같은 집합 |
| `src/lib/types.ts` | `GameMode`, API 계약 | 모드를 추가하면 `POOL_THRESHOLD`·`MODE_LABEL`·`isClimb/isDaily`도 |
| `src/lib/day.ts` | KST 날짜 | 서버·클라이언트 공용. 바꾸면 데일리 저장 키가 어긋남 |
| `src/lib/server/dict.ts` | D1 조회, `POOL_THRESHOLD` | 모든 조회는 PK 한 행이어야 함(§6) |
| `src/lib/server/token.ts` | HMAC 토큰, 시드 해시 (Web Crypto) | payload 형식 `n.t.idx` |
| `src/lib/server/judge.ts` | 워들 2-pass 판정 | 순수 함수. 바꾸면 게임 규칙이 바뀐다 |
| `src/lib/server/env.ts` | `platform.env`에서 D1·시크릿 | Workers 밖에서 불리면 500 |
| `src/routes/api/*/+server.ts` | 5개 엔드포인트 (`game`·`check`·`guess`·`hint`·`reveal`) | 전부 `async`, `platform` 필수. 서버가 받는 모드 allowlist는 별도 목록이 아니라 **`POOL_THRESHOLD`의 키**다(`body.mode in POOL_THRESHOLD`, 아니면 400) |
| `src/routes/+page.ts` | `ssr=false, prerender=true` | 둘 다 있어야 정적 셸이 나온다 |
| `src/lib/game.svelte.ts` | 클라이언트 상태 머신(`Game` 클래스) | localStorage 스키마(§7) |
| `src/routes/+page.svelte` | 화면 조립, 물리 키보드, 하단 액션 버튼(힌트·포기·다음 단어/스테이지·결과), 종료 시 자동 모달 | 모드별 종료 후 버튼 분기가 여기 있다 |
| `src/lib/components/` | `Board` `Keyboard` `Header` `Modal` `ModeModal`(모드 선택) `SettingsModal` `HelpModal` `StatsModal`(통계) `ClimbModal`(등반 결과 피라미드) `Countdown` — 모두 `.svelte` | 원작 꼬들 Tailwind 팔레트 값을 `src/app.css` CSS 변수로 옮김 |
| `scripts/smoke.py` | 배포 후 회귀 검증 | 사전을 다시 만들면 `POOL_SIZE` 갱신 |

## 3. 계정·자격·환경

| 항목 | 값 | 비고 |
|---|---|---|
| GitHub | `bateaux-st` (bateaux.st@gmail.com) | `gh auth status`. 커밋 author도 이 이메일(레포 로컬 `git config user.email`) |
| Cloudflare | bateaux.st@gmail.com, account `899b84b6eb4c6c890b3f80b2736bb161` | `npx wrangler whoami`. 이메일 인증 완료 |
| workers.dev 서브도메인 | `bateaux` | 계정 전체에 하나. 바꾸면 URL이 바뀐다 |
| Worker | `enhanced-kordle` | `wrangler.jsonc` `name` |
| D1 | `kordle`, id `49c1a78d-3a43-45ef-bdaf-e683f8bc8bb5` | 무료 플랜 |
| 시크릿 | `KORDLE_SECRET` | `wrangler secret put`으로만 존재. 값은 어디에도 기록되어 있지 않다 — **분실해도 재생성하면 되지만 진행 중 게임이 전부 무효** |
| 로컬 도구 | Node 22.17, pnpm 10.28, wrangler 4.129, Python 3.10, LibreOffice(`soffice`) | Node 22.13+ 필수(과거 `node:sqlite` 때 요건; 지금은 Workers라 빌드에만 필요) |

### 데이터 경로 규칙 (워크트리에서 작업할 때)

사전 원본과 `kordle.db`는 git 밖이라 **메인 체크아웃 `~/projects/kordle/`에만** 있다. `.herdr/worktrees/...` 같은 워크트리에서 `build_dict.py`/`export_d1.py`를 그대로 치면 `dict/`·`kordle.db`가 없어 실패한다. 둘 중 하나:
- 사전 작업은 `cd ~/projects/kordle`에서 한다 (코드 변경은 워크트리, 데이터 작업은 메인 — 이 문서의 명령은 전부 메인 체크아웃 기준 상대경로).
- 또는 워크트리에서 `ln -s ~/projects/kordle/dict dict && ln -s ~/projects/kordle/kordle.db kordle.db` (둘 다 gitignore 대상이라 커밋에 안 잡힌다).

로컬 원본 데이터(git 밖, `~/projects/kordle/`):
- `kordle.db` 213MB — 사전 빌드 산출물. 없으면 §8로 재생성(≈1분)
- `dict/1582087_*.xls` 표준국어대사전 원본 15개(270MB, 2026-08 내려받음), `dict/stdict/*.csv` 변환본 15개
- `dict/nikl/krdict/001.xml`~`011.xml`(11개, 370MB), `dict/nikl/opendict/0050000.xml`~`1200000.xml` + `1204559.xml`(25개, 1.8GB) — spellcheck-ko/korean-dict-nikl 2026-06 덤프
- `dict/kowiki/kowiki-20260901-page.sql.gz`(117MB)
- 이 파일들이 없는 환경에서는 §8의 다운로드 절차부터. **`git clone`으로 korean-dict-nikl을 받으면 5분 넘게 걸려 타임아웃된다** — raw 파일 직접 다운로드.

## 4. 불변 규칙 — 깨지면 어떻게 되는가

### 4.1 자모 24종 · `SPLIT` 맵

게임 자모는 자음 14 + 모음 10 = **24종**. `ㄲ`=`ㄱㄱ`, `ㅆ`=`ㅅㅅ`(쌍자음은 같은 자모 둘), `ㄼ`=`ㄹㅂ`, `ㅐ`=`ㅏㅣ`, `ㅙ`=`ㅗㅏㅣ`. `ㅑㅕㅛㅠ`는 한 자모. 이 규칙은 `build_dict.py`의 `SPLIT`와 `src/lib/jamo.ts`의 `JAMO`에 있다.

- 바꾸면 모든 단어의 `jamo_len`이 바뀌어 **"n자 단어" 집합 자체가 달라진다** → 사전·풀·토큰·통계 전부 무효. 실제로 초기에 쌍자음을 별개 자모(29종)로 잡고 사전을 두 번 다시 만든 적이 있다.
- 부작용으로 `도끼`/`독기`처럼 자모열이 같아지는 쌍이 70그룹 있다. 게임에서 구분 불가 — 알려진 한계.

### 4.2 정답 풀 조건은 **두 곳**에 있다

```
src/lib/server/dict.ts   POOL_THRESHOLD = { daily: 3, 'daily-climb': 3, 'climb-length': 3, endless: 2, 'climb-streak': 2 }
export_d1.py             POOL = "unit = '단어' AND pos = '명사' AND word NOT LIKE '% %' AND familiar >= ? AND jamo_len = ?"
                         THRESHOLDS = (2, 3)
```

서버는 `pool` 테이블에 미리 펼쳐진 것만 본다. 조건을 바꾸려면 `export_d1.py` 수정 → 실행 → `d1/import.sh --remote` → `scripts/smoke.py`의 `POOL_SIZE` 갱신. `dict.ts`만 바꾸면 **없는 t를 조회해 `pool miss` 500**이 난다.

### 4.3 풀 순서와 데일리 시드는 안정적이어야 한다

- `pool`의 `idx`는 `kordle.db`의 `rowid` 순서다. 사전을 다시 만들면(소스 갱신 등) 순서가 바뀌어 **그날 데일리 정답이 바뀐다**. 재임포트는 KST 자정 직후에 하거나 하루 어긋남을 감수한다.
- 데일리 시드 문자열: n 결정 `n:${day}`, 정답 `${day}:${n}`, 일일 등반 `${day}:${n}:climb`. `:climb` 접미가 없으면 등반 6자 = 데일리 6자(스포일러). `day`는 KST `YYYY-MM-DD`.
- 토큰 payload는 `n.t.idx`. 예전 형식 `n.idx`는 이미 무효다(정답 풀을 모드별로 나눌 때 바뀜).

### 4.4 데일리 계열은 6회 고정, 저장·복원

`isDaily` = `daily` | `daily-climb`. 시도 횟수 6 고정(모두 같은 조건), 진행은 localStorage에 저장·복원. 다른 모드는 설정값 4~10.

### 4.5 D1 조회는 PK 한 행만

D1 무료 한도는 **읽은 행 수**(하루 500만)다. `COUNT(*)`·`OFFSET`·범위 스캔은 그만큼 행을 읽는다. 그래서 `words`(120만 행)를 D1에 두지 않고 `valid`(PK jamo)·`pool`(PK t,n,idx)·`pool_meta`(PK t,n)로 펼쳤다. 새 조회를 추가할 때도 PK 조회로 만들 것.

### 4.6 서버 모듈 최상위에서 I/O 하지 않는다

SvelteKit은 **빌드 중** 라우트 분석을 위해 서버 모듈을 로드한다. Node 시절 `dict.ts`가 모듈 최상위에서 DB 파일을 열어 빌드가 실패한 적이 있다. Workers에서는 `platform.env`가 요청 시점에만 있으니 자연히 지켜지지만, 원칙으로 남긴다.

### 4.7 프리렌더 셸

`+page.ts`: `ssr = false` + `prerender = true`. 상태가 전부 클라이언트에 있어 SSR은 hydration 불일치만 만들고, 프리렌더로 HTML을 정적 자산으로 내면 Worker는 `/api`에만 실행된다. 하나만 빼면 첫 화면이 Worker를 거친다.

### 4.8 물리 키보드는 `e.code`

한글 IME가 켜져 있으면 `e.key`가 `Process`나 조합 중 글자가 된다. `KeyQ`→`ㅂ`처럼 물리 자리(`e.code`)로 매핑해 한/영 상태와 무관하게 동작한다. 배열은 원작 꼬들의 두벌식(ㅐㅔ 제외) 24키.

### 4.9 판정은 표준 워들 2-pass

`judge.ts`: 1차로 자리까지 맞는 `c` 확정, 정답의 남은 자모를 개수 맵에 두고 2차로 왼쪽부터 남은 만큼만 `p`. 쌍자음이 `ㄱㄱ`으로 펴져 같은 자모 중복이 흔하므로 카운트가 중요하다. 예: 정답 `ㅂㅏㄴㅏㄴㅏ`, 추측 `ㄴㅏㄴㅂㅏㅇ` → `p c c p p a`.

### 4.10 힌트는 한 판에 한 번, 포기는 두 번 눌러 확정

`hints`(위치→자모)가 비어 있지 않으면 사용한 것. 데일리 저장에 포함되어 복원 후에도 제한이 이어진다. 힌트 대상은 `keyStates`가 `p`인 첫 자모, 서버가 정답 내 첫 위치를 준다. 포기는 3초 안에 두 번 클릭.

## 5. 사전과 정답 풀 — 결정 기록

### 5.1 판정 사전 (넓게)

| src 비트 | 출처 | 채택 범위 | 행 수(신규) |
|---|---|---|---|
| 1 | 표준국어대사전 (xls) | 구성 단위 `단어`·`구` | 350,600 |
| 2 | 한국어기초사전 (LMF XML) | `lexicalUnit` 단어·구. `vocabularyLevel` 초/중/고급 보존 | +916 |
| 4 | 우리말샘 (XML) | `word_unit` 어휘·구. `type` 방언·북한어는 `dialect=1`로 표시만 | +606,389 |
| 8 | 한국어 위키백과 `page.sql` | ns0 비리다이렉트 제목 중 **띄어 쓴 것만** 구로 추가. 붙여 쓴 제목은 65%가 인명이라 행을 만들지 않고 기존 단어에 `wiki_len`만 표시 | +248,306 |

합계 1,206,211행. 같은 표기는 한 행으로 병합(`Entry.merge`): `단어`가 하나라도 있으면 단어, src는 OR, level은 가장 쉬운 것, dialect는 AND(일반어 출처가 하나라도 있으면 0).

판정 조회는 `jamo` 열(공백 제거 자모열)로 한다 → `헌법 재판소`(구)를 `헌법재판소`로 붙여 쳐도 통과. `dialect=1`은 판정에서 제외(`거실굼돈` 거부).

원본 XML에 0x08 제어 문자가 섞여 있어 파서 앞에서 걷어낸다(`_CleanXML`). 표준국어대사전 품사 열은 `「1」명사\n「2」부사` 꼴이라 첫 토큰만 취한다(`clean_pos`).

### 5.2 정답 풀 (좁게) — `familiar` 점수

"익숙한 단어"를 직접 재는 데이터가 없어 **독립 출처 세 곳의 합의**로 대신했다(`Entry.familiar()`):

| 신호 | 점수 | 근거 |
|---|---|---|
| 기초사전 등급 | 초급 +4 · 중급 +3 · 고급 +2 | 국립국어원이 학습자용으로 선별. **고급도 단독으로 믿을 만함**(`냉각수 수확량 완치`) |
| 위키백과 3KB+ 문서 | +2 | 백과 항목이 될 개념어. **3KB 미만은 0점** — 동음이의 안내·토막글이 많아 `사쿠라 화조 청천`류 노이즈 |
| 표준국어대사전 뜻 4개↑ | +1 | 다의어=기본어휘 경향. 약한 신호(단독이면 `화석빙 청묘`) |
| 전문 분야 표시 | −1 | 『의학』『불교』 등. 등급·위키가 있으면 살아남음(`고양이`는 『동물』이지만 초급) |
| 인명·지명·책명·고유명 일반 | NULL(제외) | 표준국어대사전 `전문 분야` 열 |
| 표준국어대사전에 없음 | NULL | 정답은 표준국어대사전 명사에서만 |

정답 후보 = `unit='단어' AND pos='명사' AND 공백 없음 AND familiar >= T`. 사용자가 고른 임계값: **데일리·일일 등반·길이 상승 T=3, 무한·연속 클리어 T=2**.

기각된 대안(다시 제안하지 말 것, 사용자가 이미 결정):
- 위키백과 본문 빈도 분석(1GB 덤프 + 형태소) — "안 하는 게 맞다"
- 국립국어원 학습용 어휘 목록 5,965개 단독 — 기초사전 등급이 상위 호환
- 정답 풀에 우리말샘/위키 포함 — 생소어 증가
- 위키 붙여 쓴 제목을 판정 사전에 추가 — 3음절 판정 공간 +44%, 사실상 이름 아무거나 통과

알려진 잔여 이슈(결정 안 됨, 필요시 사용자에게):
- `unit='단어'`인데 공백이 남은 표기 192개(`앵글로 색슨족`류, 원본 `^`/`·` 치환 결과). 정답 풀은 `NOT LIKE '% %'`로 이미 제외.
- 정답 풀은 명사만이라 `-하다/-되다` 문제는 사라졌지만, 명사 중에도 `-적`(`기본적 과학성`)이 T=2에 섞인다.

## 6. 배포·운영 절차

### 6.1 코드 배포

```bash
pnpm install
pnpm check                 # svelte-check 0 errors 여야 함
pnpm run deploy            # vite build && wrangler deploy  (※ `pnpm deploy`는 pnpm 내장 명령이라 다른 것)
python3 scripts/smoke.py https://enhanced-kordle.bateaux.workers.dev
```

`wrangler login`이 안 된 환경이면 먼저 `npx wrangler login`(브라우저) 또는 `CLOUDFLARE_API_TOKEN` 환경변수.

### 6.2 롤백과 "smoke가 깨졌을 때" 판단표

코드와 데이터는 따로 되돌린다.
- **코드**: `npx wrangler deployments list` → `npx wrangler rollback <version-id>`. D1은 건드리지 않는다.
- **D1 데이터**: 되돌리는 명령이 없다. 이전 `kordle.db`(§6.3의 보존본)로 `export_d1.py` → `d1/import.sh --remote`가 검증된 복구 경로. `npx wrangler d1 export kordle --remote --output <파일>`로 스냅샷(40MB, 한 행씩 INSERT)을 받아둘 수는 있지만 그 파일로 되살리는 절차는 **검증되지 않았다**(DROP 없이 CREATE만 들어 있고 60만 문장이라 분할 필요).

배포 직후 `scripts/smoke.py`가 깨지면 **먼저 어느 검사가 깨졌는지 보고** 아래에서 찾는다. 전부 롤백하는 게 정답인 경우는 드물다.

| 증상 | 뜻 | 조치 |
|---|---|---|
| 페이지 `000`/SSL 오류, 모두 실패 | 신규 `workers.dev` 서브도메인 TLS 발급 중, 또는 네트워크 | 1~2분 후 재시도. 서브도메인을 안 바꿨다면 네트워크 |
| 모두 `403` | UA 봇 필터 | 스크립트 UA 확인. **장애 아님** |
| `check`/`guess` 판정만 실패, 직전에 `import.sh --remote`를 돌렸음 | DROP→INSERT 사이 빈 사전 | 30초 후 1회 재시도. 계속 실패면 `import.sh --remote`를 **처음부터** 다시(파일 단위로 순차 실행되어 중간 실패는 부분 상태를 남긴다; `schema.sql`이 DROP이라 재실행이 곧 초기화) |
| `game`이 200인데 `guess`/`reveal`/`hint`가 500 (`pool miss`) | `dict.ts POOL_THRESHOLD`의 t가 D1 `pool`에 없음 | 코드가 아니라 **데이터** 불일치. `export_d1.py THRESHOLDS` 확인 → 재임포트. 코드 롤백으로는 안 고쳐진다(옛 코드가 다른 t를 쓰면 그건 고쳐질 수 있으나 원인 해결이 아님) |
| 코드 변경 직후 API가 400/500, 데이터는 안 건드렸음 | 코드 회귀 | `wrangler rollback` → 로컬에서 재현 |
| `pool t=… idx<N`만 실패, 다른 건 통과 | `smoke.py POOL_SIZE`가 사전과 안 맞음 | 사전을 바꿨으면 `export_d1.py` 출력으로 `POOL_SIZE` 갱신. **장애 아님** |
| `daily 토큰 형식 (t=…)`/`모드 → 풀 t=…`만 실패 | `smoke.py EXPECTED_T`가 `dict.ts`와 안 맞음 | 임계값을 바꿨으면 smoke 갱신. **장애 아님** |
| 데일리 정답이 어제와 다른 단어가 됐다(사용자 신고) | 사전 재임포트/풀 조건 변경으로 `idx`가 가리키는 단어가 바뀜 | **정상**(§4.3). 자정 지나면 사라진다 |
| 사용자에게 "서버에 연결할 수 없습니다" 토스트, 새 게임은 됨 | 시크릿 교체 또는 토큰 형식 변경으로 **옛 토큰 무효** | 정상 부작용. 새 게임 시작하면 해결 |
| 구버전으로 롤백했더니 어떤 사용자만 "서버에 연결할 수 없습니다" | 그 사용자의 `localStorage config.mode`가 롤백된 코드에 없는 모드 → 서버 400 | 사용자가 "모드 바꾸기"로 다른 모드를 고르면 복구. 롤백 전에 고려할 것 |

`pnpm check → deploy → smoke` 순서라 smoke 실패 시점에는 이미 운영에 나가 있다. 사용자가 몇 명뿐인 토이라 감수하는 것이지만, 크게 바꿀 때는 `pnpm dev` + `python3 scripts/smoke.py http://localhost:5173`으로 로컬 D1에서 먼저 돌린다.

### 6.3 사전 갱신 (사전만 바뀌면 코드 배포는 필요 없다)

```bash
cd ~/projects/kordle                                    # 데이터는 메인 체크아웃에만 있다 (§3)
cp kordle.db kordle.$(date +%F).db                       # 이전 사전 보존 — D1 복구 재료 (*.db는 gitignore)
python3 build_dict.py kordle.db --stdict dict/stdict --krdict dict/nikl/krdict \
    --opendict dict/nikl/opendict --kowiki dict/kowiki/kowiki-YYYYMMDD-page.sql.gz   # ≈1분
python3 export_d1.py kordle.db d1/        # ≈10초, 19MB SQL. 마지막에 smoke.py용 POOL_SIZE 블록을 출력한다
#   → scripts/smoke.py 의 POOL_SIZE 를 그 출력으로 교체, docs/HANDOFF.md §9 기준 수치도 갱신
d1/import.sh --local && pnpm dev && python3 scripts/smoke.py http://localhost:5173   # 로컬 검증
d1/import.sh --remote                     # ≈10초. schema.sql이 DROP TABLE → 그 사이 운영은 빈 사전
python3 scripts/smoke.py https://enhanced-kordle.bateaux.workers.dev
git commit -am "사전 YYYY-MM-DD: ..." && git push   # smoke 통과 후. 커밋 대상은 smoke.py·HANDOFF 수치(사전 파일은 git 밖)
```

- 재임포트 후 **그날 데일리 정답이 바뀔 수 있다**(§4.3). 자정 직후 권장.
- 서버 코드는 바뀌지 않으므로 `pnpm run deploy`는 **불필요**. Worker는 D1의 내용을 즉시 본다.
- **정상 변화 범위** — 다음은 장애가 아니다: 위키 덤프만 바꿨으면 `src&1`(표준국어대사전) 350,600은 그대로여야 하고, `valid`는 소폭(수천) 증가, `pool` 크기는 `familiar`의 위키 신호가 움직여 각 (t,n)에서 **±수 %** 변한다. 표준국어대사전 xls를 다시 변환했는데 350,600이 아니면 그쪽(csv 변환)이 잘못된 것. 어느 (t,n) 풀이 절반 이하로 줄거나 두 배가 되면 `Entry.familiar()`나 소스 파일 누락을 의심한다.

### 6.4 시크릿 교체

`openssl rand -base64 32 | npx wrangler secret put KORDLE_SECRET`. 진행 중인 모든 게임의 토큰이 무효가 되어 클라이언트는 "서버에 연결할 수 없습니다" 토스트를 본다(새 게임 시작하면 정상). 데일리 저장 키에 토큰이 들어 있어 그날 데일리 진행은 새로 시작된다.

### 6.5 로컬 개발

```bash
cp .dev.vars.example .dev.vars
python3 export_d1.py kordle.db d1/ && d1/import.sh --local     # .wrangler/state 에 로컬 D1
pnpm dev            # vite dev — adapter-cloudflare가 platform.env를 로컬 D1로 에뮬레이션
pnpm preview        # wrangler dev — 실제 workerd 런타임
```

### 6.6 정답 풀 임계값 변경 (예: 데일리 T 3→4)

1. `export_d1.py`의 `THRESHOLDS`에 새 값을 **추가**한다 — `(2, 3)` → `(2, 3, 4)`. 기존 값을 빼면 그 t를 쓰는 다른 모드가 `pool miss` 500을 낸다. 쓰지 않게 된 t는 나중에 지워도 되지만 남겨둬도 비용은 D1 30MB에 몇 MB 더일 뿐이다.
2. `python3 export_d1.py kordle.db d1/` → `d1/import.sh --remote` **먼저**. 새 t의 행이 D1에 있어야 새 코드가 안전하다. 옛 코드는 새 행을 안 보므로 순서상 무해.
3. `src/lib/server/dict.ts POOL_THRESHOLD`에서 해당 모드만 바꾼다.
4. `scripts/smoke.py`: `EXPECTED_T`(모드→t), `POOL_SIZE`(export 출력 블록으로 교체). `MODE_FOR_T`는 `EXPECTED_T`에서 자동 유도되지만 새 t를 쓰는 비데일리 모드가 하나도 없으면 `next()`가 실패한다 — 그 경우 데일리 모드로 매핑을 직접 넣는다.
5. `pnpm check` → `pnpm run deploy` → smoke. 통과 후 `README.md`(정답 풀 표)·`docs/HANDOFF.md` §4.2·§9 수치 갱신 → 커밋·push.
6. 부작용: 그날 데일리 정답이 바뀐다(다른 t의 풀이라 `idx`가 다른 단어). 이미 플레이한 사용자는 저장 키에 토큰이 들어 있어 **새 판처럼 보인다**(진행 초기화). 장애 아님. 자정 직후에 하면 아무도 못 느낀다.

### 6.7 새 게임 모드 추가 체크리스트

`GameMode`는 서버·클라이언트가 같은 타입을 쓴다. 빠뜨리기 쉬운 순서로:

| 위치 | 할 것 |
|---|---|
| `src/lib/types.ts` | `GameMode` 유니언에 id 추가(영문 kebab, 예 `practice`), `MODE_LABEL`에 표시명 |
| `src/lib/server/dict.ts` | `POOL_THRESHOLD`에 값 — 이게 곧 서버 allowlist. 기존 t(2 또는 3)를 쓰면 D1 재임포트 불필요, 새 t면 §6.6 |
| `src/lib/game.svelte.ts` | `isDaily`(날짜 시드·6회·저장복원 대상인가), `isClimb`(스테이지·피라미드 대상인가)에 넣을지 판단. 통계는 `recordStats()`(played/won/streak/dist), 등반 최고 기록은 `finish()` 안 `bestStage` — 제외하려면 여기서 모드로 분기 |
| `src/routes/api/game/+server.ts` | `daily`·`daily-climb`만 날짜 시드, 나머지는 랜덤. 날짜 시드 모드를 추가하면 시드 문자열에 모드를 섞어 다른 데일리와 정답이 겹치지 않게 |
| `src/lib/components/ModeModal.svelte` | `MODES` 배열에 설명. 길이 선택 UI를 숨길 모드면 `pickable` |
| `src/routes/+page.svelte` | 종료 후 하단 버튼 분기(`다음 단어`/`다음 스테이지`/`결과`/`통계`), 자동 모달 `$effect` |
| `StatsModal.svelte` / `ClimbModal.svelte` | 통계 표시·카운트다운(`isDaily`)·피라미드(`isClimb`) 조건이 맞는지 |
| `scripts/smoke.py` | `EXPECTED_T`에 모드 추가(자동으로 §4 검사에 포함) |
| `README.md`·`docs/HANDOFF.md` | 모드 수, §4.4, §7 |

힌트 로직 계약(바꿀 때 참고): 대상 자모 = `keyStates`에서 `p`인 첫 자모(노란 자모가 없으면 "힌트를 줄 노란 자모가 없습니다" 토스트 — 정상 동작), 서버는 그 자모의 정답 내 **첫 위치**를 줌, `hints[pos] = jamo`로 기록, `hintUsed = hints가 비어 있지 않음`으로 1회 제한. 무제한으로 바꾸려면 `hintUsed` 판정을 모드로 분기하고 이미 밝힌 자모는 `known`에서 제외(9/4 커밋 이전 코드가 그렇게 돼 있었다: `Object.values(hints)`를 known 집합으로).

"통계에 안 잡히게"처럼 범위가 여러 가지로 읽히는 요청(저장 안 함 / 표시만 안 함 / streak·dist·best 중 일부)은 **구현 전에 사용자에게 범위를 확인**한다.

## 7. 클라이언트 저장 스키마 (localStorage, 접두 `nkordle:`)

| 키 | 값 | 비고 |
|---|---|---|
| `config` | `{mode, length: {kind:'fixed', n} \| {kind:'random'}}` | 마지막 모드 |
| `settings` | `{maxTries}` | 4~10. 데일리 계열은 무시(6 고정) |
| `stats:<mode>` | `{played, won, streak, maxStreak, dist[]}` | 모드별 |
| `best:<mode>:<lengthKey>` | number | 등반 최고 스테이지. `lengthKey` = `fixed-6` / `random` |
| `daily:<YYYY-MM-DD>:<token>` | `{rows, marks, status, answer, hints}` | 데일리·일일 등반의 한 판. 저장할 때 오늘 날짜 아닌 키는 삭제 |
| `dclimb:<YYYY-MM-DD>` | `{stage, n, climbWords}` | 일일 등반 코스 위치. 다른 날짜 키 삭제 |

키 형식을 바꾸면 기존 사용자의 진행·통계가 사라진다. 마이그레이션은 없다(토이).

## 8. 원본 데이터 확보 (처음부터 재현)

```bash
# 표준국어대사전: https://stdict.korean.go.kr → 사전 내려받기 → xls 15개 → dict/
soffice --headless --convert-to 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true' --outdir dict/stdict dict/*.xls

# 한국어기초사전·우리말샘: github.com/spellcheck-ko/korean-dict-nikl — git clone은 타임아웃. raw로:
#   https://raw.githubusercontent.com/spellcheck-ko/korean-dict-nikl/master/krdict/001.xml ... 011.xml  (370MB)
#   https://raw.githubusercontent.com/spellcheck-ko/korean-dict-nikl/master/opendict/0050000.xml ... 1204559.xml (1.8GB)
#   → dict/nikl/krdict/, dict/nikl/opendict/   (파일 목록은 GitHub API /contents/krdict, /contents/opendict)

# 위키백과: https://dumps.wikimedia.org/kowiki/<YYYYMMDD>/kowiki-<YYYYMMDD>-page.sql.gz → dict/kowiki/
#   all-titles-in-ns0.gz는 리다이렉트를 구분할 수 없어 쓰지 않는다.
```

## 9. 기준 수치 (회귀 판정용, 2026-09-03 사전)

| 항목 | 값 |
|---|---|
| `words` 행 | 1,206,211 |
| 그중 `src&1`(표준국어대사전) | 350,600 — 재빌드 후 이 수가 다르면 xls→csv 변환이 잘못된 것 |
| 판정 `valid` (5~12자모, dialect=0, distinct) | 559,653 |
| `pool` 합계 | 36,366 (t=2: 24,791 / t=3: 11,575) |
| `pool` t=3 n별 (5..12) | 3061 · 3562 · 1389 · 1427 · 1191 · 506 · 273 · 166 |
| `pool` t=2 n별 (5..12) | 4893 · 6975 · 3093 · 3847 · 3260 · 1415 · 826 · 482 |
| `dialect=1` | 140,401 |
| `familiar` 분포(명사 후보) | NULL 200,948 · −1 66,165 · 0 77,794 · 1 11,265 · 2 13,216 · 3 6,562 · 4 2,671 · 5 1,647 · 6 550 · 7 145 |
| D1 크기 | ≈30MB. 임포트 ≈10초 |
| 빌드 시간 | `build_dict.py` ≈56초, `export_d1.py` ≈10초, `vite build` ≈3초 |

빠른 단어 확인: `고양이` familiar 5(초급+위키), `컴퓨터` 5, `순량` 1, `니나놋집` 0, `세종` NULL(인명), `뒤처리되다` pos=동사.

## 10. 위양성 함정 — 테스트할 때 속기 쉬운 것

- **Python `urllib` 기본 UA로 운영 URL을 치면 403.** Cloudflare 봇 필터. 서비스 장애가 아니다. `User-Agent: Mozilla/5.0`을 붙여라(`scripts/smoke.py`가 그렇게 한다). `curl`은 기본 UA로도 통과한다.
- **새 `workers.dev` 서브도메인은 TLS 인증서 발급에 1~2분** 걸린다. 그동안 `SSL handshake failure`. 서브도메인을 바꾸지 않는 한 다시 겪을 일은 없다.
- **`pnpm deploy`는 pnpm의 워크스페이스 배포 명령**이라 "A deploy is only possible from inside a workspace" 오류를 낸다. `pnpm run deploy`.
- **원격 D1 임포트 직후 10초쯤은 빈 사전** — `schema.sql`이 `DROP TABLE`. smoke가 그 순간 실패하면 잠시 후 재시도.
- **브라우저 자동화로 검증할 때** 페이지 로드 직후 1.2초 안에는 상태가 `loading`이라 키 입력이 무시된다. 데일리/등반이 종료 상태면 1.2초 뒤 결과 모달이 자동으로 뜬다.
- **dev 서버(`vite dev`)의 `Tsconfig not found`** — 워크트리 등 하위 디렉터리에서 실행할 때 상위 체크아웃의 `tsconfig.json`을 집는 rolldown 문제. 상위에도 `pnpm install`이 되어 있으면 사라진다.
- `git clone spellcheck-ko/korean-dict-nikl` 은 히스토리가 커서 5분 넘게 걸린다. raw 다운로드.
- `svelte-check` 경고 `state_referenced_locally`는 모달 초기값 캡처가 의도된 곳에 `// svelte-ignore` 주석이 있다. 지우지 말 것.
- **smoke는 API만 본다.** 힌트 횟수·통계 반영·모달 같은 클라이언트 동작은 smoke 통과와 무관하다. UI를 바꿨으면 `pnpm dev`로 브라우저에서 직접 확인한다(브라우저 자동화 시 `window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyG', ...}))`로 자모 입력 가능 — 두벌식 `code` 매핑).
- **랜덤 모드는 매 요청 다른 토큰**이 정상이다. 결정론 검사는 데일리 계열에만 의미가 있다.
- 워크트리(`.herdr/worktrees/...`)에서 `kordle.db`/`dict/`가 안 보이는 것은 정상 — 메인 체크아웃에만 있다(§3).

## 11. 하지 않기로 한 것 / 제거한 것

- **Docker/compose/NAS/ghcr 배포 경로** — 2026-09-08 제거(`git log -- Dockerfile`). Cloudflare 단일 타깃. 두 런타임을 유지하면 `dict.ts`·`token.ts`가 둘이 되어 기능마다 두 번 손대야 한다. Node 버전이 필요하면 커밋 `0c7a4bf` 직전 히스토리에 있다(`node:sqlite`, `adapter-node`, HMAC은 `node:crypto`).
- GitHub Pages 정적 전환 — 사전 2MB를 브라우저에 실어야 하고 정답이 노출된다. Cloudflare가 무료이면서 서버를 유지할 수 있어 택하지 않음.
- GitHub Actions 자동 배포 — 아직 없음. 필요하면 `cloudflare/wrangler-action` + `CLOUDFLARE_API_TOKEN` 레포 시크릿.
- 공유(이모지 격자 복사), 다크 모드, 계정/서버 저장 — 요청되지 않음.

작업 완료 기준: `pnpm check` 0 errors → 배포(또는 재임포트) → `scripts/smoke.py` 통과 → **그 다음에** 커밋·`git push`. smoke가 깨진 회차는 커밋하지 않는다(실패한 수정이 히스토리에 잘못된 의도로 남는다). 문서만 바뀐 커밋은 예외.

## 12. 타임라인 (결정 연대기)

| 날짜 | 결정 |
|---|---|
| 08-25 | 표준국어대사전 xls → `kordle.db`(35만). 자모 24종 규칙 확정(쌍자음=같은 자모 둘). 출제 풀 큐레이션은 보류 |
| 09-02 | SvelteKit 게임 구현(모드 4종 × n 선택/랜덤), HMAC 토큰 무상태 설계, Docker compose 로컬 배포. 사전 유효성 미리보기(빨간 글자) |
| 09-02~03 | 사전에 기초사전·우리말샘·위키(구만) 추가 → 120만 행. `familiar` 점수 설계, 임계값 3/2 사용자 결정 |
| 09-04 | 힌트·포기·등반 피라미드 |
| 09-07 | 일일 등반 모드, 힌트 1회 제한. GitHub `bateaux-st/enhanced-kordle`로 이전(author 이메일 재작성) |
| 09-08 | NAS 배포 준비(ghcr 워크플로우) → 같은 날 **Cloudflare Workers + D1로 전환**, Docker 경로 제거. `bateaux.workers.dev` |
