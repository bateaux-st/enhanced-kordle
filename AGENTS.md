# AGENTS.md — enhanced-kordle

에이전트가 이 레포에서 작업할 때의 규칙. 배경·절차·수치는 [`docs/HANDOFF.md`](docs/HANDOFF.md)를 **먼저 읽는다**. 사용자용 소개는 `README.md`.

## 이 프로젝트는

한국어 워들(자모 24종 풀어쓰기). SvelteKit + Svelte 5 runes, Cloudflare Workers + D1. 서버는 무상태(정답은 HMAC 토큰, 진행은 localStorage). 토이 프로젝트 — 사용자 계정 없음, 마이그레이션 없음.

운영: https://enhanced-kordle.bateaux.workers.dev · 배포는 수동 `pnpm run deploy`.

## 두 가지 작업 흐름 — 어느 쪽인지 먼저 정한다

| | 코드 변경 (UI·API·규칙) | 사전 변경 (원본 갱신·`familiar`·풀 조건) |
|---|---|---|
| 어디서 | 워크트리 어디서나 | **`~/projects/kordle`** — 원본 `dict/`·`kordle.db`는 거기에만 있다 (HANDOFF §3) |
| 절차 | `pnpm check` → `pnpm run deploy` → smoke | `cp kordle.db kordle.$(date +%F).db` → `build_dict.py` → `export_d1.py` → `smoke.py POOL_SIZE` 갱신 → `d1/import.sh --local` + 로컬 smoke → `d1/import.sh --remote` → 운영 smoke (HANDOFF §6.3) |
| 배포 | `pnpm run deploy` 필요 | **불필요** — Worker는 D1을 즉시 본다 |
| 둘 다 바뀌면 | **D1 먼저**, 코드 나중 (HANDOFF §6.6) | |

smoke: `python3 scripts/smoke.py https://enhanced-kordle.bateaux.workers.dev`. 통과 → 커밋·push. 깨지면 **HANDOFF §6.2 판단표**로 원인을 분류한다 — 대부분 롤백이 정답이 아니다(UA 403, 임포트 직후 10초, `POOL_SIZE`/`EXPECTED_T` 미갱신은 장애가 아님). 깨진 회차는 커밋하지 않는다.

## 반드시

- 정답 풀 조건(`familiar` 임계값, 후보 SQL)을 바꾸면 **`src/lib/server/dict.ts`의 `POOL_THRESHOLD`와 `export_d1.py`의 `POOL`/`THRESHOLDS`를 함께** 고친다. `THRESHOLDS`는 값을 **추가**한다(빼면 그 t를 쓰는 다른 모드가 `pool miss` 500). 런북: HANDOFF §6.6.
- 새 게임 모드는 HANDOFF §6.7 체크리스트대로 — `types.ts`, `dict.ts`(`POOL_THRESHOLD`가 곧 서버 allowlist), `game.svelte.ts`(`isClimb`/`isDaily`, 통계), `api/game`, `ModeModal.svelte`, `+page.svelte` 버튼 분기, `smoke.py EXPECTED_T`.
- `scripts/smoke.py`의 기대값 셋(`EXPECTED_T`, `POOL_SIZE`, `MODE_FOR_T`)은 코드·사전과 짝이다. 사전이나 임계값을 바꾸면 같은 커밋에서 갱신한다. `POOL_SIZE`는 `export_d1.py`가 마지막에 출력하는 블록을 붙인다.
- 요청의 범위가 여러 가지로 읽히면(예: "통계에 안 잡히게" — 저장 안 함인지 표시만 안 함인지) **구현 전에 사용자에게 확인**한다. 자료에 없는 결정을 추측으로 메우지 않는다.
- D1 조회는 PK 한 행으로만 짠다(`valid.jamo`, `pool(t,n,idx)`, `pool_meta(t,n)`). `COUNT`·`OFFSET`·범위 스캔 금지 — 읽은 행 수가 무료 한도다.
- 운영 URL을 스크립트로 칠 때 `User-Agent`를 브라우저처럼 넣는다. Python 기본 UA는 Cloudflare가 403을 준다 — **장애가 아니다**.
- 커밋 메시지에 AI 생성 표기(Co-Authored-By 등)를 넣지 않는다. author 이메일은 레포 로컬 설정(`bateaux.st@gmail.com`)을 따른다.

## 절대

- `build_dict.py`의 `SPLIT` 맵과 `src/lib/jamo.ts`의 `JAMO`(자모 24종, `ㄲ`=`ㄱㄱ`)를 바꾸지 않는다. 바꾸면 모든 단어의 자모 수가 달라져 사전·풀·토큰·통계가 전부 무효다.
- 데일리 시드 문자열(`n:${day}`, `${day}:${n}`, `${day}:${n}:climb`)과 토큰 payload 형식(`n.t.idx`)을 바꾸지 않는다. 바꾸면 그날 데일리가 바뀌고 진행 중 게임이 깨진다.
- `KORDLE_SECRET`을 사용자 지시 없이 재생성하지 않는다. 모든 토큰이 무효가 된다.
- localStorage 키 형식(`nkordle:` 접두, `daily:<날짜>:<토큰>`, `dclimb:<날짜>`, `stats:<mode>`, `best:<mode>:<lengthKey>`, `config`, `settings`)을 바꾸지 않는다. 사용자 진행·통계가 사라진다.
- `+page.ts`의 `ssr = false; prerender = true` 둘 중 하나를 빼지 않는다.
- 서버 모듈 최상위에서 I/O(DB 열기 등)를 하지 않는다. SvelteKit이 빌드 중 서버 모듈을 로드한다.
- 이미 기각된 제안을 다시 올리지 않는다: 위키백과 본문 빈도 분석, 정답 풀에 우리말샘/위키 포함, 위키 붙여 쓴 제목을 판정 사전에 추가, Docker/NAS 배포 복원, GitHub Pages 정적 전환 (근거는 HANDOFF §5.2, §11).

## 검증 명령

```bash
pnpm check                                                    # 타입·svelte 검사
pnpm dev                                                      # 로컬 (D1은 .wrangler/state, d1/import.sh --local 필요)
python3 scripts/smoke.py http://localhost:5173                # 로컬 smoke
pnpm run deploy                                               # 빌드 + wrangler deploy  (pnpm deploy 아님)
python3 scripts/smoke.py https://enhanced-kordle.bateaux.workers.dev
npx wrangler deployments list && npx wrangler rollback <id>   # 코드 롤백 (D1 데이터는 되돌리지 않음 — HANDOFF §6.2)
```

smoke는 **API만** 검증한다. 힌트 횟수·통계·모달 같은 UI 동작은 `pnpm dev`로 브라우저에서 직접 본다.

## 코드 스타일

- 한국어 주석. "무엇"을 반복하는 주석은 쓰지 않고, 결정·트레이드오프·외부 제약·순서 의존이 있는 곳에만 "왜"를 남긴다.
- Svelte 5 runes(`$state`, `$derived`, `$props`), 이벤트는 `onclick` 속성. 상태는 `Game` 클래스(`game.svelte.ts`) 한 곳.
- 원작 꼬들의 Tailwind 팔레트 값을 `app.css` CSS 변수로 옮겨 쓴다. Tailwind는 쓰지 않는다.
- 요청받지 않은 기능·추상화·설정 옵션을 넣지 않는다.
