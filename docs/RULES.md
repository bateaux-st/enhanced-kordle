# 게임 규칙 명세: n자 꼬들

이 문서는 운영 중인 n자 꼬들(개인 5모드 + 멀티플레이 협동·경쟁)의 **규칙 기준 문서**다. 구현은 이 문서를 따라야 한다.

- 규칙을 바꾸는 변경은 **같은 PR에서 이 문서를 먼저 고치고**, 구현과 테스트가 뒤따른다.
- 이 문서와 코드가 다르면 버그다. 어느 쪽을 고칠지는 사용자가 정한다. 다른 곳을 가리키는 규칙 ID(`S-HINT-2` 등)는 코드 주석·테스트·PR에서 그대로 쓸 수 있다.
- 최초 판은 커밋 `94d3a16`의 코드를 읽어 거꾸로 정리했다(2026-11-16). 기존 문서(`README.md`, `HANDOFF.md`, `MULTIPLAYER*.md`)와 다른 곳은 코드를 따랐다.
- 코드 자체가 모순되거나 규칙으로 정해져 있지 않은 곳은 본문에 현재 동작을 쓰고 [`미결·모순`](#미결모순) 절의 항목(`U-n`)으로 링크했다. 그 항목은 사용자가 결정하기 전까지 어느 쪽도 정답이 아니다.

규칙이 아닌 것(아키텍처, 배포, 사전 빌드 절차, 불변 규칙이 필요한 운영상 이유)은 [`HANDOFF.md`](HANDOFF.md)에 있고, 호환을 깨면 안 되는 형식(토큰 payload, 데일리 시드 문자열, localStorage 키)은 아래 규칙에서 **규범 링크**로 HANDOFF 해당 절을 가리킨다.

## 읽는 법

- 규칙 하나에 ID 하나, 검증 가능한 주장 하나. ID는 `절약어-주제-번호`. 번호는 재사용하지 않는다(규칙을 지우면 번호를 비워 둔다).
- 시간은 모두 ms 정수다. 경계는 규칙에 포함·제외를 적었다. "N 이상/이하/넘으면/미만"은 글자 그대로 읽는다.
- 근거 열은 고칠 위치다(파일 경로와 상수·함수 이름, 줄 번호는 쓰지 않는다). 파일은 `src/lib/` 기준이며 `server/mp/`는 `src/lib/server/mp/`, `mp/`는 `src/lib/mp/`다.
- 검증 열: `t:<이름>`은 `tests/<이름>.test.mjs`(`(py)`가 붙으면 `tests/<이름>.py`), `e:<이름>`은 `e2e/<이름>.spec.ts`, `코드만`은 테스트가 이 규칙을 직접 고정하지 않아 코드로만 확인했다는 뜻이다. 검증 열의 이름은 그 파일에 해당 동작을 확인하는 케이스가 있다는 뜻이지 모든 경계를 덮는다는 뜻은 아니다.
- 화면에 보이는 문구가 규칙의 일부인 곳은 문구를 그대로 적었다(따옴표 안). 문구를 바꾸는 것도 규칙 변경이다.
- 사용자가 직접 정한 결정은 별도로 표시하지 않았다. 결정의 날짜와 배경은 [`MULTIPLAYER.md`](MULTIPLAYER.md), [`HANDOFF.md`](HANDOFF.md) §11·§12에 있다.

용어. **판**: 보드 하나(솔로 등반에서는 스테이지 하나, 협동·경쟁 단판에서는 게임 전체). **풀이 중**: 상태가 `playing`. **접속자**: `connected`가 참인 참가자. **자리**: 방의 플레이어 목록에 든 항목(끊긴 사람 포함).

---

## C. 공통 기본

### C-JAMO 자모와 풀어쓰기

규범: [`HANDOFF.md` §4.1](HANDOFF.md). 바꾸면 모든 단어의 자모 수가 달라져 사전·풀·토큰·통계가 전부 무효가 된다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| C-JAMO-1 | 게임이 세는 자모는 24종이다: ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ(14) ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ(10). | `jamo.ts` `JAMO` | t:test_decompose(py) |
| C-JAMO-2 | 단어는 완성형 음절을 초성·중성·종성으로 나눈 뒤, 24종에 없는 자모를 아래 표대로 풀어 쓴다. 공백은 버린다. 초성·종성 ㅇ은 자모 ㅇ 하나로 센다. | `build_dict.py` `SPLIT`, `decompose` | t:test_decompose(py) |
| C-JAMO-3 | 쌍자음은 같은 자모 둘이다: ㄲ=ㄱㄱ, ㄸ=ㄷㄷ, ㅃ=ㅂㅂ, ㅆ=ㅅㅅ, ㅉ=ㅈㅈ. | `SPLIT` | t:test_decompose(py) |
| C-JAMO-4 | 겹받침은 자음 둘이다: ㄳ=ㄱㅅ, ㄵ=ㄴㅈ, ㄶ=ㄴㅎ, ㄺ=ㄹㄱ, ㄻ=ㄹㅁ, ㄼ=ㄹㅂ, ㄽ=ㄹㅅ, ㄾ=ㄹㅌ, ㄿ=ㄹㅍ, ㅀ=ㄹㅎ, ㅄ=ㅂㅅ. | `SPLIT` | t:test_decompose(py) |
| C-JAMO-5 | 합성 모음·ㅐㅔ류는 기본 모음으로 푼다: ㅐ=ㅏㅣ, ㅒ=ㅑㅣ, ㅔ=ㅓㅣ, ㅖ=ㅕㅣ, ㅘ=ㅗㅏ, ㅙ=ㅗㅏㅣ, ㅚ=ㅗㅣ, ㅝ=ㅜㅓ, ㅞ=ㅜㅓㅣ, ㅟ=ㅜㅣ, ㅢ=ㅡㅣ. ㅑㅕㅛㅠ는 풀지 않는다. | `SPLIT` | t:test_decompose(py) |
| C-JAMO-6 | 예: 까=ㄱㄱㅏ, 닭=ㄷㅏㄹㄱ, 개=ㄱㅏㅣ, 왜=ㅇㅗㅏㅣ, 꽃=ㄱㄱㅗㅊ, 값=ㄱㅏㅂㅅ, 의=ㅇㅡㅣ, 얘=ㅇㅑㅣ, 바나나=ㅂㅏㄴㅏㄴㅏ. | `tests/test_decompose.py` | t:test_decompose(py) |
| C-JAMO-7 | 자모열이 같은 서로 다른 단어(도끼/독기)는 게임에서 구분하지 않는다. | `HANDOFF.md` §4.1 | 코드만 |

### C-LEN 단어 길이

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| C-LEN-1 | 단어 길이는 풀어쓴 자모 수다. 허용 범위는 5 이상 12 이하다(양끝 포함). | `jamo.ts` `MIN_N`, `MAX_N` | t:api-game, t:api-check |
| C-LEN-2 | 5 미만이거나 12 초과인 길이는 어느 모드에서도 정답이 되지 않는다. 멀티 설정의 길이 범위도 같다(`LENGTH_MIN`=5, `LENGTH_MAX`=12). | `mp/rules.ts` `LENGTH_MIN`, `LENGTH_MAX` | t:mp-members |

### C-JUDGE 판정

규범: [`HANDOFF.md` §4.9](HANDOFF.md). 솔로 서버(`/api/guess`), 경쟁, 협동이 같은 함수를 쓴다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| C-JUDGE-1 | 추측의 칸마다 `c`(자모와 자리가 맞음), `p`(자모는 있으나 자리가 다름), `a`(정답에 없음) 중 하나를 받는다. | `types.ts` `Mark` | t:api-guess |
| C-JUDGE-2 | 1차: 같은 자리의 자모가 정답과 같으면 `c`로 확정한다. 정답에서 `c`로 쓰이지 않은 자리의 자모를 개수 표에 센다. | `server/judge.ts` `judge` | t:api-guess |
| C-JUDGE-3 | 2차: `c`가 아닌 칸을 왼쪽부터 보며, 그 자모의 남은 개수가 1 이상이면 `p`로 하고 1 줄인다. 0이면 `a`다. | `judge` | t:api-guess |
| C-JUDGE-4 | 예: 정답 ㅂㅏㄴㅏㄴㅏ, 추측 ㄴㅏㄴㅂㅏㅇ → `p c c p p a`. | `judge` | 코드만 |
| C-JUDGE-5 | 모든 칸이 `c`이면 정답이다. | `judge.ts` `guessResponse` | t:api-guess |
| C-JUDGE-6 | 칸의 색은 자모 위치에 붙는다. 한 자모가 한 줄에 여러 번 나와도 정답 속 개수만큼만 `c`·`p`를 받는다(C-JUDGE-2, 3의 결과). | `judge` | t:api-guess |

### C-DICT 판정 사전과 정답 풀

플레이어 관점: **추측으로 낼 수 있는 단어**(판정 사전)는 넓고, **정답으로 나오는 단어**(정답 풀)는 좁다. 사전을 만드는 절차와 결정 배경은 [`HANDOFF.md` §5](HANDOFF.md).

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| C-DICT-1 | 추측이 유효한지는 공백을 뺀 자모열이 판정 사전에 있는지로만 정한다. 같은 자모열이면 띄어 쓴 단어와 붙여 쓴 단어가 같은 키로 맞는다. | `server/dict.ts` `isValidJamo` | t:dict |
| C-DICT-2 | 판정 사전은 표준국어대사전, 한국어기초사전, 우리말샘, 위키백과 띄어 쓴 제목, NIADic 명사를 합친 것이다. 인명·브랜드·장소도 들어 있다. 방언·북한어로 표시된 표기는 뺀다. | `dict.ts` 주석, `HANDOFF.md` §5.1 | 코드만 |
| C-DICT-3 | 정답 풀은 표준국어대사전의 단어 단위 명사 중 공백이 없고 익숙함 점수(`familiar`)가 임계값 t 이상인 것이다. 판정 사전에만 있는 표기(NIADic 신규 등)는 정답으로 나오지 않는다. | `export_d1.py` `POOL`, `HANDOFF.md` §5.2 | t:test_export_d1(py) |
| C-DICT-4 | 모드별 임계값 t: `daily` 3, `daily-climb` 3, `climb-length` 3, `endless` 1, `climb-streak` 1. 멀티플레이(협동·경쟁 전부)는 별도 상수 3이다. | `server/dict.ts` `POOL_THRESHOLD`, `server/mp/room.ts` `MP_POOL_T` | t:api-game, t:mp-room-d1 |
| C-DICT-5 | 서버가 받는 솔로 모드 목록은 `POOL_THRESHOLD`의 키다. 그 밖의 값(`constructor` 같은 객체 키 포함)은 모드가 아니다. | `routes/api/game/+server.ts` | t:api-game |
| C-DICT-6 | 임계값을 바꾸면 `POOL_THRESHOLD`와 `export_d1.py`의 `POOL`·`THRESHOLDS`를 함께 바꾼다. `THRESHOLDS`는 값을 추가만 한다. | `AGENTS.md`, `HANDOFF.md` §6.6 | t:dict |
| C-DICT-7 | 풀에서 정답을 읽을 때는 `(t, n, idx)` 한 행만 읽는다. 풀 크기도 `(t, n)` 한 행이다. COUNT·OFFSET·범위 조회는 쓰지 않는다. | `dict.ts` | t:dict |

### C-HARD 하드 모드 규칙 (솔로·멀티 공통)

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| C-HARD-1 | 하드 모드에서는 같은 판의 지난 모든 행이 준 제약을 다음 추측이 지켜야 한다. | `hard.ts` `hardViolation` | t:hard |
| C-HARD-2 | 초록 제약: 어느 행에서든 `c`를 받은 자리는 그 자모를 같은 자리에 다시 써야 한다. | `hardViolation` | t:hard |
| C-HARD-3 | 노랑 제약: 어느 행에서든 `p`를 받은 자모는 추측 안 어딘가에 들어 있어야 한다. 자모 종류만 보고 개수는 세지 않는다. | `hardViolation` | t:hard |
| C-HARD-4 | 회색(`a`)과 힌트로 밝힌 칸은 제약이 아니다. 첫 추측에는 제약이 없다. | `hardViolation` | t:hard |
| C-HARD-5 | 위반이 여럿이면 하나만 돌려준다. 초록 자리 위반을 왼쪽 칸부터 먼저 보고, 없으면 노랑 자모를 "행 순서, 같은 행 안에서는 왼쪽 순서"로 처음 나온 것부터 본다. | `hardViolation` | t:hard |
| C-HARD-6 | 위반 문구: 초록은 `{자리+1}번째 칸은 {자모}입니다`, 노랑은 `{자모}을(를) 포함해야 합니다`. 솔로 토스트와 멀티 오류 메시지가 같은 문구다. | `game.svelte.ts` `submit`, `server/mp/comp.ts` `checkGuess` | t:mp-comp, e:solo-rules |

### C-HINT 힌트 고르기 (솔로·멀티 공통)

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| C-HINT-1 | 힌트는 노란 칸(`p`)이 있어야 줄 수 있다. 후보는 보드의 칸을 행 순서, 같은 행 안에서는 왼쪽 순서로 훑어 처음 만난 `p` 칸의 자모 중, 아래 C-HINT-2의 조건을 만족하는 것이다. | `hint.ts` `pickHint` | t:hint |
| C-HINT-2 | 자모 J가 후보가 되려면, 한 행에서 J가 `c` 또는 `p`를 받은 칸 수의 최댓값(모든 행에 걸쳐)이 J가 지금까지 `c`를 받은 서로 다른 자리 수보다 커야 한다(아직 못 찾은 자리가 있다). | `pickHint` | t:hint |
| C-HINT-3 | 힌트가 알려 주는 것은 정답에서 J가 나오는 자리 중 이미 초록으로 확인된 자리(`known`)를 뺀 첫 자리(0부터)다. 모든 자리를 알면 힌트가 없다. | `hint.ts` `hintPos` | t:hint |
| C-HINT-4 | 후보가 없거나 줄 자리가 없으면 힌트를 쓸 수 없다. 키보드 색(자모별 최고 판정)이 아니라 보드 칸으로 고른다. | `pickHint` | t:hint |
| C-HINT-5 | 힌트는 시도 횟수를 쓰지 않고, 정답 자체를 알려 주지 않으며, 입력 행의 그 칸에 자모를 흐리게(점선) 미리 보여 줄 뿐이다. | `components/Board.svelte`, `game.svelte.ts` `hints` | e:solo-rules |

---

## S. 솔로 (개인 플레이)

### S-MODE 모드

솔로는 5개 모드다. 서버 계약(`GameMode`)과 화면 이름은 아래와 같다.

| 모드 id | 화면 이름 | 정답 풀 t | 시도 횟수 | 길이 | 한 판이 끝난 뒤 |
|---|---|---|---|---|---|
| `daily` | 하루 1개 | 3 | 6 고정 | 5~12 고르기 또는 랜덤(날짜가 정함) | 통계 창만. 같은 길이는 오늘 다시 풀 수 없다 |
| `daily-climb` | 일일 등반 | 3 | 6 고정 | 5자에서 시작해 12자까지 고정 코스, 고를 수 없음 | 결과 창만. 오늘 다시 시작할 수 없다 |
| `endless` | 랜덤 무한 | 1 | 설정값 4~10 | 5~12 고르기 또는 판마다 랜덤 | "다음 단어" |
| `climb-streak` | 등반 · 연속 클리어 | 1 | 설정값 4~10 | 5~12 고르기 또는 스테이지마다 랜덤 | 맞히면 "다음 스테이지", 틀리면 "처음부터" |
| `climb-length` | 등반 · 길이 상승 | 3 | 설정값 4~10 | 시작 길이 5~12 고르기 또는 랜덤 | 맞히면 "다음 스테이지"(12자는 완주), 틀리면 "처음부터" |

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-MODE-1 | 모드 설명 문구(모드 선택 창): daily `하루에 한 단어. 모두 같은 문제, 6회 고정.` / daily-climb `하루에 한 코스. 5자에서 12자까지 모두 같은 순서, 6회 고정.` / endless `끝없이 새 단어. 통계만 쌓입니다.` / climb-streak `연속으로 맞힌 스테이지 수를 올립니다. 실패하면 1로.` / climb-length `맞힐 때마다 한 자모씩 길어져 12자까지. 실패하면 처음으로.` | `components/ModeModal.svelte` | e:solo-modals |
| S-MODE-2 | 모드 선택 창은 모드 하나와 길이(`랜덤` 또는 5~12)를 고르고 `시작`을 누르면 그 설정으로 **즉시 새 판을 시작**한다. 진행 중이던 판은 이어지지 않는다. 일일 등반은 길이 칸이 없고 설정에는 고정 길이 5로 저장된다. 길이 칸의 제목은 climb-length에서 `시작 길이`, 나머지는 `자모 수`다. | `ModeModal.svelte`, `game.svelte.ts` `setConfig` | e:solo-modals |
| S-MODE-3 | 마지막으로 시작한 모드와 길이(`config`)를 저장하고 다음 방문의 첫 판에 쓴다. 저장값이 없거나 모드가 알려진 값이 아니거나 길이가 `random`·`fixed(숫자)`가 아니면 `daily`와 고정 6을 쓴다. 숫자가 5~12인지는 보지 않는다([U-18](#u-18)). | `game.svelte.ts` `loadConfig` | t:game-stored-shape, e:solo-modals |
| S-MODE-4 | 앱은 방문할 때마다 개인/멀티 선택 화면에서 시작한다(기억하지 않는다). 주소에 `?room=` 이 있으면 선택 화면을 건너뛰고 멀티로 간다. | `routes/+page.svelte` | 코드만 |
| S-MODE-5 | 모드나 설정이 바뀌면 통계(`stats:<모드>`), 최고 스테이지(`best:<모드>:<길이키>`), 등반 시간 기록(`climbtime:<모드>:<길이키>`)을 새 설정 것으로 다시 읽는다. 길이키는 `fixed-<n>` 또는 `random`이다. | `game.svelte.ts` `loadRecords`, `lengthKey`, `configKey` | 코드만 |
| S-MODE-6 | 모드 줄은 `{화면 이름} · {길이}`를 보이고, 등반 모드는 ` · 스테이지 {번호}`, 하드 모드가 켜져 있으면 ` · 하드`를 덧붙인다. 길이는 고정이면 `{n}자`, 랜덤이면 `랜덤`, 일일 등반은 `5→12자`다. | `routes/+page.svelte` | e:solo-rules |

### S-LEN 길이를 정하는 법

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-LEN-1 | 길이를 고정한 설정은 그 길이로 새 판을 요청한다. | `game.svelte.ts` `fixedN` | e:solo-modals |
| S-LEN-2 | 비데일리에서 길이가 `랜덤`이면 요청에 `n`을 싣지 않고, 서버가 5부터 12 중 하나를 `5 + (난수 % 8)`로 정한다. endless는 판마다, climb-streak은 스테이지마다 새로 정한다. | `routes/api/game/+server.ts` | t:api-game, e:solo-modals |
| S-LEN-3 | 데일리에서 길이가 `랜덤`이면 `n`을 싣지 않고, 서버가 날짜로 `n = 5 + seededIndex("n:{날짜}", 8)`을 정한다. 시드 문자열은 규범이다([`HANDOFF.md` §4.3](HANDOFF.md)). | `api/game/+server.ts`, `server/token.ts` `seededIndex` | t:api-game |
| S-LEN-4 | climb-length에서 시작 길이는 설정(고정 또는 랜덤 한 번)이고, 이후 스테이지는 직전 길이 + 1이다. 시작이 12자이면 첫 스테이지가 마지막이다. | `game.svelte.ts` `startRound`, `nextStage` | e:solo-climb |
| S-LEN-5 | climb-streak의 다음 스테이지는 설정의 길이 규칙을 다시 적용한다(고정이면 같은 길이, 랜덤이면 새로 추첨). | `game.svelte.ts` `nextStage` | 코드만 |

### S-DAILY 데일리 (daily, daily-climb)

규범(시드·순열·토큰): [`HANDOFF.md` §4.3, §4.4](HANDOFF.md). 아래 규칙은 그 규범을 전제로 한다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-DAILY-1 | 데일리의 날짜는 한국 시간(`Asia/Seoul`)의 `YYYY-MM-DD`이고 날짜는 한국 자정(00:00)에 바뀐다. | `day.ts` `todayKST` | t:day |
| S-DAILY-2 | 같은 날짜·같은 모드·같은 길이는 모든 사람에게 같은 단어이고, 서버는 같은 요청에 같은 토큰을 준다. 길이가 다르면 다른 단어다. | `api/game/+server.ts`, `token.ts` `dailyIndex` | t:api-game, t:daily-parity |
| S-DAILY-3 | 일일 등반은 같은 날짜·같은 길이라도 daily와 다른 단어다(시드에 `:climb`가 붙는다). | `dailyIndex` | t:api-game |
| S-DAILY-4 | 클라이언트의 `dailyDay`는 페이지를 연 시점의 한국 날짜로 고정된다. 자정이 지나도 같은 탭은 그 날짜로 요청·저장한다. 새로고침으로 앱을 다시 만들 때만 날짜가 바뀐다. | `game.svelte.ts` `dailyDay` | t:daily, e:solo-daily |
| S-DAILY-5 | 데일리 요청은 `day`를 싣는다. 서버는 `day`가 `YYYY-MM-DD` 형식이고 달력에 있는 날짜이고 서버의 오늘(한국) 이하이면 받는다. 어긴 값은 400 `invalid daily day`다. 과거 날짜는 얼마나 오래됐든 받는다(하한 없음, [U-5](#u-5)). `day`를 생략하면 서버의 오늘이다. | `day.ts` `validDailyDay`, `api/game/+server.ts` | t:day, t:api-game |
| S-DAILY-6 | 서버는 비데일리 모드 요청의 `day`를 읽지 않는다. | `api/game/+server.ts` | t:daily, t:api-game |
| S-DAILY-7 | 데일리 계열의 시도 횟수는 6으로 고정이고 설정의 시도 횟수는 무시한다. | `game.svelte.ts` `DAILY_TRIES`, `maxTries` | 코드만 |
| S-DAILY-8 | 데일리 계열의 한 판은 `(날짜, 토큰)`으로 식별한다. 추측을 받아들일 때마다, 힌트를 쓸 때마다, 판이 끝날 때마다 `rows`, `marks`, `status`, `answer`, `hints`를 저장한다. 판을 시작만 하고 아직 아무것도 하지 않은 보드는 저장하지 않는다. | `game.svelte.ts` `saveDaily`, `dailyKey` | e:solo-daily |
| S-DAILY-9 | 데일리 판을 다시 열면(새로고침·다른 탭) 저장된 `rows`, `marks`, `status`, `answer`, `hints`를 복원한다. 끝난 판(`won`·`lost`)은 끝난 채로 복원되고 다시 풀 수 없다. 저장본이 형식에 맞지 않으면 없는 것으로 보고 새 판으로 시작한다. | `enterRound`, `validDailySave` | t:game-stored-shape, e:solo-daily |
| S-DAILY-10 | 오래된 날짜의 저장본은 오늘 진행을 저장할 때 지운다. 키의 날짜가 `dailyDay`보다 작은 `daily:`·`dclimb:` 키만 지우고, 같거나 큰 날짜의 키는 남긴다. | `saveDaily`, `saveDailyClimb` | e:solo-daily |
| S-DAILY-11 | 다음 코스까지의 남은 시간은 `ceil((문제 날짜의 다음 한국 자정 − 지금) / 1000)`초이고 0 아래로 내려가지 않는다. 0이 되면 `새 일일 문제가 준비되었습니다. 새로고침하면 풀 수 있습니다.`를, 아니면 `다음 단어까지 HH:MM:SS`를 보인다. 날짜 기준은 "지금"이 아니라 문제 날짜다. | `day.ts` `dailySecondsLeft`, `components/Countdown.svelte` | t:day, e:solo-daily |
| S-DAILY-12 | 데일리가 끝나면 1200ms 뒤 통계 창이 자동으로 열린다. 그 사이에 사용자가 다른 창을 열었으면 덮지 않는다. | `routes/+page.svelte` | e:solo-daily |

### S-DCLIMB 일일 등반 (daily-climb)

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-DCLIMB-1 | 코스는 항상 5자에서 시작해 한 스테이지에 한 자모씩 늘어 12자에서 끝난다. 모두 같은 순서다. | `game.svelte.ts` `startRound`, `nextStage` | e:solo-climb |
| S-DCLIMB-2 | 코스 진행(`stage`, `n`, `climbWords`와 시간 필드)은 `dclimb:<날짜>`에 저장한다. 앱을 다시 열면 저장된 스테이지·길이에서 이어 간다. 저장본이 없거나 형식이 틀리면 1스테이지 5자 새 코스로 시작한다. | `startRound`, `validClimbSave` | t:game-stored-shape |
| S-DCLIMB-3 | 스테이지를 맞히면 "다음 스테이지"로 길이를 +1 해 이어 가고 `dclimb`를 저장한다. 12자를 맞히면 완주(S-CLIMB-4)다. 한 스테이지라도 틀리거나 포기하면 그 날의 코스는 끝나고 "결과"만 열 수 있다. 오늘 다시 시작하는 버튼은 없다. | `routes/+page.svelte` | e:solo-climb |
| S-DCLIMB-4 | 스테이지별 판은 daily와 같은 저장(S-DAILY-8, 9)을 쓰므로, 맞힌 스테이지와 실패한 스테이지 모두 새로고침 뒤 같은 상태로 복원된다. | `enterRound` | e:solo-daily |
| S-DCLIMB-5 | 일일 등반의 결과 창은 "다시 등반" 대신 다음 코스까지의 카운트다운(S-DAILY-11)을 보인다. | `components/ClimbModal.svelte` | 코드만 |

### S-CLIMB 등반 공통 (climb-streak, climb-length, daily-climb)

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-CLIMB-1 | 스테이지 번호는 1에서 시작하고, 다음 스테이지 요청이 성공했을 때만 1 늘어난다. | `game.svelte.ts` `nextStage` | t:game-failures |
| S-CLIMB-2 | 스테이지를 맞히면(`won`) 다음 스테이지로 가는 버튼 `다음 스테이지`가 열린다. 완주(S-CLIMB-4) 때는 `다시 등반`이 열린다. | `routes/+page.svelte` | e:solo-climb |
| S-CLIMB-3 | 스테이지에서 시도를 모두 쓰거나 포기하면(`lost`) 등반이 끝난다. 스테이지 번호는 끝난 그대로 남고, `처음부터`를 누르면 스테이지 1·빈 기록으로 새로 시작한다(일일 등반 제외, S-DCLIMB-3). | `routes/+page.svelte`, `resetRun` | e:solo-climb |
| S-CLIMB-4 | climb-length와 daily-climb에서 길이 12의 스테이지를 맞히면 완주다. 완주 토스트는 `12자까지 완주!`(2500ms)다. climb-streak에는 끝이 없다. | `game.svelte.ts` `finish` | e:solo-climb |
| S-CLIMB-5 | 스테이지 클리어 토스트는 `스테이지 {번호} 클리어`(2000ms), 실패·포기 토스트는 `정답: {단어}`(3000ms)다. | `finish` | 코드만 |
| S-CLIMB-6 | 등반이 끝나면(실패 또는 완주) 1200ms 뒤 등반 결과 창이 자동으로 열린다. 그 사이에 다른 창이 열려 있으면 덮지 않는다. | `routes/+page.svelte` | e:solo-climb |
| S-CLIMB-7 | 등반 결과의 피라미드는 맞힌 스테이지의 정답을 맞힌 순서대로 쌓는다. 실패한 스테이지의 정답은 쌓지 않고 `멈춘 곳의 정답: {단어}`로 따로 보인다. 제목은 완주 `12자 완주!`, 한 개 이상 클리어 `스테이지 {클리어 수}까지 올랐습니다`, 0개 `첫 스테이지에서 멈췄습니다`다. | `ClimbModal.svelte` | e:solo-climb |
| S-CLIMB-8 | 등반 최고 스테이지(`best:<모드>:<길이키>`)는 클리어한 스테이지 번호가 지금 최고보다 클 때만 올라간다. | `game.svelte.ts` `finish` | 코드만 |
| S-CLIMB-9 | 등반의 힌트는 스테이지(판)마다 한 번이다(S-HINT-1). 멀티 등반은 등반 전체에서 한 번이다([U-2](#u-2)). | `game.svelte.ts` `clearBoard` | 코드만 |

### S-ENDLESS 랜덤 무한

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-ENDLESS-1 | 한 판이 끝나면(맞힘·실패·포기) `다음 단어` 버튼으로 새 정답을 받는다. 횟수 제한이 없고 통계만 쌓인다. | `routes/+page.svelte` | e:solo-play |

### S-ROUND 한 판의 상태

상태는 `loading` → `playing` → `won` 또는 `lost`다.

| 사건 | 이전 상태 | 이후 상태 | 비고 |
|---|---|---|---|
| 새 판 요청 시작(첫 판·모드 변경) | 무엇이든 | `loading`, 보드·입력·정답·힌트 비움 | 일일 등반은 저장된 코스 위치를 먼저 읽는다 |
| 새 판 응답 성공 | `loading` | `playing` | 데일리 저장본이 있으면 저장된 `status`로 복원 |
| 새 판 응답 실패 | `loading` | `loading` 유지, `loadFailed` | S-FAIL-1 |
| 모든 칸이 `c`인 추측 수락 | `playing` | `won` | |
| 추측 수락 후 행 수 ≥ 시도 횟수이고 정답이 아님 | `playing` | `lost` | 정답 판정이 시도 횟수 판정보다 먼저다 |
| 포기 확정 | `playing` | `lost` | S-GIVE |
| `다음 단어`·`다음 스테이지`·`처음부터` 성공 | `won`·`lost` | `loading` → `playing` | 요청이 끝날 때까지 끝난 판이 그대로 보인다 |

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-ROUND-1 | 글자 입력·삭제·제출·힌트·포기는 상태가 `playing`이고 요청이 진행 중(`busy`)이 아닐 때만 받는다. 그 밖에는 조용히 무시한다. | `game.svelte.ts` `type`, `back`, `submit`, `hint`, `giveUp` | e:solo-modals |
| S-ROUND-2 | 새 판·다음 스테이지 요청 중에 같은 버튼을 다시 눌러도 요청은 한 번만 나간다. | `newGame`, `nextStage` | t:game-failures |
| S-ROUND-3 | 한 판이 끝난 뒤 버튼(우선순위 순서): daily `통계` / endless `다음 단어` / 클리어했고 완주가 아님 `다음 스테이지` / daily-climb(실패 또는 완주) `결과` / 그 밖(등반 실패·완주) `처음부터`(완주는 `다시 등반`). | `routes/+page.svelte` | e:solo-climb, e:solo-play |

### S-TRY 시도 횟수

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-TRY-1 | 설정의 시도 횟수는 4 이상 10 이하(양끝 포함)이고 기본값은 6이다. 설정 창은 1씩 늘리고 줄이며, 4에서 줄이기·10에서 늘리기는 비활성이다. 설정 창 문구: `4~10회. 바꾸는 즉시 적용됩니다. 하루 1개 모드는 6회로 고정.` | `game.svelte.ts` `MIN_TRIES`, `MAX_TRIES`, `DEFAULT_TRIES`, `components/SettingsModal.svelte` | e:solo-modals |
| S-TRY-2 | 설정을 바꾸면 진행 중인 판에도 즉시 적용된다. 판의 끝은 "추측을 하나 수락한 뒤 행 수가 시도 횟수 이상인지"로 정하므로, 이미 쌓인 행 수 이상으로 낮추면 다음 추측을 수락한 직후 판이 끝난다([U-1](#u-1)). | `game.svelte.ts` `maxTries`, `submit` | 코드만 |
| S-TRY-3 | 시도 횟수는 추측이 수락되어 행이 늘 때만 쓴다. 길이 부족, 사전에 없는 단어, 하드 모드 위반, 서버 오류로 거절된 제출은 쓰지 않는다. | `submit` | e:solo-rules, e:solo-play |

### S-INPUT 입력과 제출

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-INPUT-1 | 입력은 자모 24종만 받는다. 물리 키보드는 `KeyboardEvent.code`로 두벌식 자리를 자모로 바꾼다(한/영 상태와 무관): Q=ㅂ W=ㅈ E=ㄷ R=ㄱ T=ㅅ Y=ㅛ U=ㅕ I=ㅑ / A=ㅁ S=ㄴ D=ㅇ F=ㄹ G=ㅎ H=ㅗ J=ㅓ K=ㅏ L=ㅣ / Z=ㅋ X=ㅌ C=ㅊ V=ㅍ B=ㅠ N=ㅜ M=ㅡ. Enter는 제출, Backspace는 삭제다. | `jamo.ts` `CODE_TO_JAMO`, `routes/+page.svelte` | e:solo-play |
| S-INPUT-2 | Ctrl·Meta·Alt가 눌린 키 입력은 무시한다. 창(모달)이 열려 있는 동안 글자 입력은 보드에 들어가지 않고 Esc는 창을 닫는다. | `routes/+page.svelte` `onkeydown` | e:solo-modals |
| S-INPUT-3 | 화면 키보드의 배열: 윗줄 ㅂㅈㄷㄱㅅㅛㅕㅑ, 가운뎃줄 ㅁㄴㅇㄹㅎㅗㅓㅏㅣ, 아랫줄 Enter ㅋㅌㅊㅍㅠㅜㅡ Backspace. | `jamo.ts` `KEY_ROWS` | 코드만 |
| S-INPUT-4 | 입력 중인 행은 판의 길이 n까지만 채워진다. n자가 되는 순간 `/api/check`를 한 번 불러 사전 여부를 알아본다. 응답이 올 때 현재 입력이 요청한 입력과 같을 때만 반영한다. 응답이 `valid:false`이면 행을 빨간 글자로 표시한다. 확인 요청이 실패하면 아무 표시도 하지 않는다(제출 때 서버가 다시 거른다). | `game.svelte.ts` `type`, `checkCurrent` | t:game-check-race, e:solo-play, e:solo-failures |
| S-INPUT-5 | Backspace는 마지막 자모를 지우고 빨간 표시도 푼다. | `back` | e:solo-play |
| S-INPUT-6 | 제출(Enter)의 평가 순서와 거절: ① 입력 길이 < n이면 토스트 `자모가 부족합니다` + 흔들림, 요청 없음. ② 빨간 표시(사전에 없음)가 켜져 있으면 `사전에 없는 단어입니다` + 흔들림, 요청 없음. ③ 하드 모드이고 위반이면 C-HARD-6 문구(2500ms) + 흔들림, 요청 없음. ④ `/api/guess` 요청. 서버가 `ok:false`(사전에 없음)이면 행을 빨갛게 표시하고 ②와 같은 토스트·흔들림. ⑤ 수락되면 행·판정을 보드에 더하고 입력과 빨간 표시를 비운다. | `game.svelte.ts` `submit` | e:solo-play, e:solo-rules, e:solo-guess-rejected |
| S-INPUT-7 | 키보드 키의 색은 그 자모가 지금까지 받은 최고 판정이다(`c` > `p` > `a`). | `game.svelte.ts` `keyStates` | e:solo-play |
| S-INPUT-8 | 토스트 지속 시간은 기본 1500ms다. 하드 모드 위반과 힌트 위치 알림은 2500ms, 승리 토스트 `정답입니다`는 2000ms다. | `showToast` 호출부 | 코드만 |

### S-HARD 하드 모드 (솔로)

제약 계산은 C-HARD다. 여기는 켜고 끄는 규칙이다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-HARD-1 | 하드 모드는 설정의 전역 스위치(`settings.hard`, 기본 꺼짐)이고 모든 솔로 모드(데일리 포함)에 적용된다. | `game.svelte.ts` `hard` | e:solo-modals |
| S-HARD-2 | 켜기는 판이 `playing`이 아니거나(끝난 판·로딩) 추측이 아직 하나도 없을 때만 된다. 끄기는 언제나 된다. 켤 수 없을 때 스위치는 비활성이고 `진행 중인 판에는 켤 수 없습니다. 다음 판을 시작하면 켤 수 있습니다.`를 보인다. | `canEnableHard`, `setHard`, `SettingsModal.svelte` | e:solo-modals |
| S-HARD-3 | 하드 모드 설정 설명 문구: `초록 자모는 그 자리에, 노란 자모는 어디든 반드시 다시 써야 합니다.` | `SettingsModal.svelte` | 코드만 |

### S-HINT 힌트 (솔로)

선택 규칙은 C-HINT다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-HINT-1 | 힌트는 한 판에 한 번이다. 판은 보드 하나이므로 등반에서는 스테이지마다 새로 한 번 쓸 수 있다. 쓴 판에서는 버튼이 `힌트 사용함`으로 잠기고, 쓴 판에서 다시 요청하면(버튼 우회 포함) 토스트 `힌트는 한 판에 한 번입니다`. | `game.svelte.ts` `hint`, `hintUsed` | e:solo-rules |
| S-HINT-2 | 힌트를 쓴 판인지는 보드에 밝혀진 칸이 하나라도 있는지(`hints`가 비어 있지 않은지)로 안다. 데일리 계열은 `hints`를 저장하므로 새로고침 뒤에도 쓴 것으로 이어진다. | `game.svelte.ts` `hintUsed`, `DailySave` | e:solo-daily |
| S-HINT-3 | 판정에 노란 칸이 없으면 힌트 요청을 서버에 보내지 않고 토스트 `힌트를 줄 노란 자모가 없습니다`. | `hint` | e:solo-rules |
| S-HINT-4 | 요청은 `/api/hint`로 `{token, jamo, known}`을 보낸다. 서버는 ① 토큰 검증(실패 400 `bad token`) ② `jamo`가 자모 24종 중 하나인지(아니면 400 `bad jamo`) ③ 그 자모가 정답에 있는지(없으면 400 `jamo not in answer`) ④ `known`을 정수 배열로 읽고(아니면 빈 목록) 정답에서 `known`에 없는 첫 자리를 찾는다(없으면 400 `no unknown position`) 순서로 보고, 성공하면 `{pos}`(0부터)를 준다. | `routes/api/hint/+server.ts`, `hint.ts` `parseKnown` | t:api-hint |
| S-HINT-5 | 성공하면 입력 행의 `pos` 칸에 그 자모를 흐리게 보이고(그 칸이 비어 있는 동안) 토스트 `{자모}은(는) {pos+1}번째 칸`(2500ms)을 띄운다. 힌트는 시도·하드 모드 제약·통계에 영향이 없다. | `hint`, `Board.svelte` | e:solo-rules |
| S-HINT-6 | 힌트 요청이 실패하면 토스트 `서버에 연결할 수 없습니다`를 띄우고 힌트는 쓰지 않은 것으로 남는다. | `hint` | e:solo-failures |
| S-HINT-7 | 힌트는 하드 모드와 무관하게 쓸 수 있고, 판이 `playing`일 때만 쓸 수 있다. | `hint` | 코드만 |

### S-GIVE 포기

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-GIVE-1 | `포기` 버튼은 판이 `playing`일 때만 보인다. 첫 클릭은 라벨을 `정말 포기?`로 바꾸고, 3000ms 안에 다시 눌러야 확정한다. 3000ms가 지나면 첫 클릭 이전 상태로 돌아간다. | `routes/+page.svelte` `giveUp` | e:solo-play |
| S-GIVE-2 | 확정하면 판은 `lost`가 되고 정답을 서버에서 받아 공개한다(`정답: {단어}`, 3000ms). 등반에서는 그 스테이지 시간을 실패 시간으로 잰다(S-TIME-4). | `game.svelte.ts` `giveUp`, `finish` | e:solo-play |
| S-GIVE-3 | 정답 확인(`/api/reveal`)이 실패하면 판은 `lost`로 남고 정답은 공개되지 않으며 토스트 `서버에 연결할 수 없습니다`를 띄운다. 이때 통계와 데일리 저장은 갱신되지 않는다([U-4](#u-4)). | `finish` | t:game-failures (상태·토스트만), e:solo-failures |

### S-STAT 통계

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-STAT-1 | 통계는 모드별로 저장하고(`stats:<모드>`) 길이별로는 나누지 않는다. 항목: 플레이 수, 이긴 수, 현재 연승, 최다 연승, 시도 분포(`dist[k]` = k+1번째 시도에 맞힌 횟수). | `game.svelte.ts` `Stats`, `recordStats` | e:solo-modals |
| S-STAT-2 | 판이 끝나 정답을 받은 뒤 한 번 기록한다: 플레이 +1. 이기면 이긴 수 +1, 연승 +1, 최다 연승 = max(최다, 연승), `dist[행 수 − 1]` +1. 지면(시도 소진 또는 포기) 연승을 0으로 한다. | `recordStats` | e:solo-play |
| S-STAT-3 | 등반 모드는 스테이지 하나가 한 번의 플레이다. 연승은 연속으로 맞힌 스테이지 수다. 데일리 모드의 연승은 "날짜 연속"이 아니라 플레이 연속이다. | `finish` | 코드만 |
| S-STAT-4 | 통계 창: 플레이, 승률 %(`round(이긴 수 / 플레이 × 100)`, 플레이 0이면 0), 현재 연승, 최다 연승, 시도 분포 막대(막대 수는 max(시도 횟수, 저장된 분포 길이)). 등반 모드는 `최고 스테이지 {n} · 현재 {n}`을 덧붙인다. 방금 이긴 판의 막대를 강조한다. | `components/StatsModal.svelte` | e:solo-modals |
| S-STAT-5 | 멀티플레이 결과는 개인 통계에 기록하지 않는다. | `server/mp/**`·`components/mp/**`에 통계 기록이 없다 | 코드만 |
| S-STAT-6 | 저장된 통계가 형식에 맞지 않으면 빈 통계로 시작한다. | `game.svelte.ts` `validStats` | t:game-stored-shape |

### S-TIME 등반 소요 시간

적용 모드는 등반 3종(`climb-streak`, `climb-length`, `daily-climb`)이다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-TIME-1 | 스테이지 시간의 시작은 그 스테이지의 보드가 뜬 시각(새 판 응답을 받아 `playing`이 된 순간)이다. 탭이 숨겨져도 흐른다. | `game.svelte.ts` `enterRound` | e:solo-climb |
| S-TIME-2 | 스테이지 시간의 끝은 판이 끝나는 추측(또는 포기)을 처리하기 시작한 순간이다. 정답 확인(`reveal`) 응답을 기다리는 시간은 넣지 않는다. 시간은 `max(0, 끝 − 시작)`ms다. | `finish` | 코드만 |
| S-TIME-3 | 클리어한 스테이지의 시간은 스테이지 번호 순서로 기록한다. 총 시간은 클리어한 스테이지 시간의 합이고, 하나라도 시간을 모르면 총 시간도 모른다(`-`). 진행 중 화면의 총 시간은 클리어한 합 + 지금 스테이지의 흐른 시간이다. | `climbtime.ts` `totalOf`, `components/ClimbClock.svelte` | t:climbtime, e:solo-climb |
| S-TIME-4 | 실패·포기로 끝난 스테이지의 시간은 총 시간에 넣지 않는다. 그 시간은 `멈춘 스테이지 {번호} · {시간}`으로만 보인다. | `finish`, `ClimbModal.svelte` | e:solo-climb |
| S-TIME-5 | 시간 표기: 소수 초는 버리고 `m:ss`, 1시간 이상이면 `h:mm:ss`, 시간을 모르면 `-`. | `climbtime.ts` `formatTime` | t:climbtime |
| S-TIME-6 | 스테이지 최고 시간(`stages[스테이지]`)은 그 스테이지의 이전 기록이 있고 이번 시간이 그보다 **엄격하게 짧을 때** 갱신되고 `최고` 표시를 받는다. 첫 클리어는 기록만 만들고 표시가 없다. 같은 시간은 갱신이 아니다. | `climbtime.ts` `applyClear` | t:climbtime |
| S-TIME-7 | 최고 기록(`best`)은 `{스테이지, 총 시간}`이다. 클리어 스테이지가 더 높으면 갱신하고, 같으면 총 시간이 엄격하게 짧을 때 갱신한다. 총 시간을 모르는 클리어는 비교에서 빠진다. 갱신하면 그 판의 결과에 `새 기록`을 표시한다. | `applyClear`, `isBetterBest` | t:climbtime |
| S-TIME-8 | 시간 기록이 생기기 전부터 최고 스테이지(`best:`)만 있던 사용자는, 그 스테이지 미만의 클리어로 `best`가 덮이지 않는다. 같은 스테이지부터는 시간으로 갱신한다. | `applyClear` `legacyBestStage` | t:climbtime |
| S-TIME-9 | 시간 기록은 `climbtime:<모드>:<길이키>`에 `{best, stages}`로 저장한다(형식 규범: [`HANDOFF.md` §7](HANDOFF.md)). 일일 등반은 스테이지 시작 시각(`stageStartAt`), 각 스테이지 시간, 실패 시간, 최고 표시를 `dclimb:<날짜>`에 같이 저장해 새로고침 뒤에도 시간이 이어진다. 저장된 시작 시각부터의 경과로 계속 센다(꺼져 있던 시간도 흐른다). 시작 시각을 모르는 옛 저장본은 `-`로 보인다. | `saveDailyClimb`, `enterRound` | t:game-stored-shape, e:solo-daily |
| S-TIME-10 | 비데일리 등반은 새로고침하면 진행 중인 스테이지의 시간이 이어지지 않는다(판이 이어지지 않기 때문이다, S-SAVE-2). | `startRound` | 코드만 |
| S-TIME-11 | 스테이지 사이의 대기(클리어한 판을 보다가 `다음 스테이지`를 누르기까지)는 시간에 들어가지 않는다. 다음 스테이지 시간은 새 보드가 뜰 때부터 센다. | `game.svelte.ts` `nextStage`, `enterRound` | 코드만 |

### S-SAVE 저장과 복원

키 형식과 값은 규범이다: [`HANDOFF.md` §7](HANDOFF.md). 접두 `nkordle:`. 형식을 바꾸면 사용자 기록이 사라진다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-SAVE-1 | 브라우저에 두는 솔로 데이터: `config`, `settings`(시도 횟수·하드·테마), `stats:<모드>`, `best:<모드>:<길이키>`, `climbtime:<모드>:<길이키>`, `daily:<날짜>:<토큰>`, `dclimb:<날짜>`. 멀티는 `mp-session` 하나뿐이다(M-ID-6). | `storage.ts`, `game.svelte.ts` | t:storage, t:game-stored-shape |
| S-SAVE-2 | 새로고침 뒤 이어지는 것: 설정, 통계, 최고 기록, 마지막 모드. 데일리·일일 등반의 판과 코스 진행. 이어지지 않는 것: 비데일리 모드에서 풀던 판(추측·힌트·입력). | `game.svelte.ts` | 코드만 |
| S-SAVE-3 | 저장값이 JSON이 아니거나 `null`이거나 형식이 틀리면 기본값을 쓰고 던지지 않는다. 저장 쓰기가 실패해도(용량 초과 등) 게임은 계속된다. | `storage.ts`, `validDailySave`, `validClimbSave`, `validStats` | t:storage, t:game-stored-shape |
| S-SAVE-4 | 테마 설정: `system`(기기 설정 따름), `light`, `dark`. 설정 저장값에 `theme`가 없으면 `system`이다. | `game.svelte.ts` `Theme` | e:solo-modals |

### S-FAIL 서버 요청 실패

실패란 네트워크 오류 또는 2xx가 아닌 응답이다. 복원 뒤 `busy`는 항상 풀린다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-FAIL-1 | 보여 줄 이전 판이 없는 상태(첫 판, 모드를 바꿔 시작)에서 새 판 요청이 실패하면 토스트 없이 상태를 `loading`으로 두고 빈 보드 자리에 `게임을 불러오지 못했습니다.`와 `다시 시도` 버튼을 보인다. 버튼은 요청 중 비활성이다. | `game.svelte.ts` `startRound`, `routes/+page.svelte` | t:game-failures, e:solo-failures |
| S-FAIL-2 | 끝난 판 화면에서 다음 판(`다음 단어`·`다음 스테이지`·`처음부터`) 요청이 실패하면 보드·스테이지·시간·저장본을 바꾸지 않고 토스트 `서버에 연결할 수 없습니다`만 띄운다. 같은 버튼으로 다시 시도한다. | `startRound`, `nextStage` | t:game-failures, e:solo-failures |
| S-FAIL-3 | 추측(`/api/guess`)·힌트·정답 확인 요청이 실패하면 토스트 `서버에 연결할 수 없습니다`를 띄운다. 추측 실패는 입력 행을 그대로 둔다. | `submit`, `hint`, `giveUp` | e:solo-play, e:solo-failures |

### S-API 서버 계약 (솔로)

모든 솔로 엔드포인트는 POST이고 JSON 본문을 받는다. 정답은 HMAC 서명 토큰(`n.t.idx.서명`, payload 형식은 [`HANDOFF.md` §4.3](HANDOFF.md) 규범)으로만 주고받는다. 서버는 진행 상태를 저장하지 않는다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| S-API-1 | `/api/game {mode, n?, day?}` → `{token, n}`. 검사 순서: ① 본문이 JSON이고 `mode`가 문자열이며 `POOL_THRESHOLD`의 키 → 아니면 400 `bad request`. ② `n`이 있으면 5 이상 12 이하 정수 → 아니면 400 `n must be 5..12`. ③ 데일리 모드의 `day`(S-DAILY-5). ④ 풀 크기가 0이면 500(토큰을 내주지 않는다). 데일리는 날짜로, 그 밖은 난수로 `idx`를 정한다. | `routes/api/game/+server.ts` | t:api-game |
| S-API-2 | `/api/check {jamo}` → `{valid}`. 길이가 5 이상 12 이하이고 모두 자모 24종일 때만 사전을 조회한다. 아니면 사전을 읽지 않고 400 `bad jamo`. 토큰이 필요 없다. | `routes/api/check/+server.ts` | t:api-check |
| S-API-3 | `/api/guess {token, jamo}`. 검사 순서: ① 토큰 서명이 맞지 않으면 400 `bad token`. ② `jamo`가 문자열, 길이가 토큰의 `n`과 같음(요청이 아니라 토큰 기준), 모두 자모 24종 → 아니면 400 `bad guess`. ③ 사전에 없으면 `{ok:false, reason:'invalid'}`(정답 풀을 읽지 않는다). ④ 판정 `{ok:true, marks}`. 모든 칸이 `c`이면 `word`(정답 단어)를 함께 준다. | `routes/api/guess/+server.ts`, `server/judge.ts` | t:api-guess |
| S-API-4 | `/api/reveal {token}` → `{word}`. 토큰만 맞으면 정답을 준다. 승리 판에서는 클라이언트가 `guess` 응답의 `word`를 쓰고 `reveal`을 부르지 않는다. 서버는 그 토큰의 판이 끝났는지 모르므로 진행 중인 판의 정답도 준다([U-3](#u-3)). | `routes/api/reveal/+server.ts`, `game.svelte.ts` `finish` | t:api-reveal, t:reveal-fold |
| S-API-5 | 토큰의 `idx`가 풀 밖이면(사전을 다시 만든 뒤의 낡은 토큰) 사전에 있는 추측·힌트·reveal은 500이다. | `dict.ts` `answerAt` | t:api-guess, t:api-hint, t:api-reveal |
| S-API-6 | `KORDLE_SECRET`이 없으면 `dev-only-secret`으로 서명한다(개발용). 운영 시크릿은 사용자 지시 없이 바꾸지 않는다. | `server/env.ts` | t:api-game |
| S-API-7 | 솔로 `/api/*`는 D1·시크릿 바인딩(`platform`)이 없으면 500이다(입력 검사보다 먼저). | `server/env.ts` `ctx` | t:api-check, t:api-game |

---

## M. 멀티플레이

멀티플레이는 방(Room) 단위다. 협동과 경쟁 두 종류, 단판과 등반 두 게임이 있고, 정답과 규칙은 모두 서버(Durable Object)가 정한다. 개인 플레이의 `/api/*`·localStorage와는 별개 경로다. 구조와 운영 절차는 [`MULTIPLAYER.md`](MULTIPLAYER.md), 프로토콜 타입은 `mp/protocol.ts`.

멀티플레이의 정답 풀은 항상 t=3이다(C-DICT-4). 같은 방의 모두가 같은 정답(단판)이나 같은 단어 순서(등반)를 받고, 정답은 판이 끝나기 전에 어떤 참가자에게도 가지 않는다(M-VIS-4).

### M-ID 닉네임과 임시 계정

계정은 없다. 서버가 발급한 임시 계정 토큰의 `uid`가 방 안의 신원이다. 토큰 형식은 규범이다: [`MULTIPLAYER.md` §7](MULTIPLAYER.md).

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-ID-1 | 닉네임은 NFC로 정규화하고 앞뒤 공백을 지운 뒤 길이(코드포인트)가 5 이상 12 이하(양끝 포함)일 때만 받는다. 문자 종류는 제한하지 않는다([U-6](#u-6)). | `mp/rules.ts` `normalizeName`, `NAME_MIN`, `NAME_MAX` | t:mp-token, t:mp-room-socket |
| M-ID-2 | 같은 방에 같은 이름이 이미 있으면(자기 자신은 제외) `이름(2)`, `이름(3)`… 순으로 접미사를 붙여 비어 있는 첫 이름으로 한다. 접미사를 포함해 12자를 넘지 않게 이름 앞부분을 잘라 맞춘다. 확정된 이름은 입장 응답(`welcome`)으로 알린다. | `server/mp/members.ts` `uniqueName` | t:mp-members |
| M-ID-3 | 토큰: `mp1.<uid>.<이름 base64url>.<발급 시각(초)>.<서명>`. `uid`는 16바이트 난수의 base64url 22자, 서명은 `HMAC-SHA256(KORDLE_SECRET, "mp1.<uid>.<이름>.<발급 시각>")`의 base64url 앞 32자다. 솔로 정답 토큰(`n.t.idx.서명`)과 접두어 `mp1.`로 갈라진다. | `server/mp/session.ts` | t:mp-token |
| M-ID-4 | 토큰은 서명·형식이 맞고 `now − 발급 시각×1000 ≤ 24시간`일 때 유효하다(24시간째까지 유효, 그 뒤 거절). 이름이 토큰 안에서 규칙에 맞지 않으면(옛 4자 이하 이름 등) 무효다. | `session.ts` `verify`, `SESSION_TTL_MS` | t:mp-token |
| M-ID-5 | 입장(`hello`)마다 갱신한다: 유효한 토큰이면 같은 `uid`로 발급 시각을 `now`로 바꾸고 새 이름으로 다시 서명한다. 토큰이 없거나 만료·변조면 거절하지 않고 새 `uid`로 발급한다. 새 토큰은 입장 직후 첫 스냅샷에만 `session{token, exp}`로 실린다. `exp = 발급 시각(초) × 1000 + 24시간`. | `session.ts` `refresh`, `room.ts` `hello` | t:mp-token, t:mp-room-socket |
| M-ID-6 | 브라우저에는 `nkordle:mp-session` 하나만 둔다: `{token?, name, exp?}`. 부팅 때 형식이 틀리거나 `exp < now`이면 지우고 닉네임을 다시 묻는다(`exp = now`는 유효). 닉네임이 5자 미만인 옛 기록은 없는 것으로 보되 지우지 않는다. 게임 데이터(추측·초안·투표·결과)는 브라우저에 저장하지 않는다. | `mp/identity.ts` | t:mp-identity |
| M-ID-7 | `나가기`는 세션을 지우지 않는다. `임시 계정 지우기`만 키를 지우고 닉네임을 다시 묻는다. | `identity.ts` `clearSession` | t:mp-identity, e:mp-lobby |
| M-ID-8 | 닉네임이 규칙에 맞지 않는 `hello`는 오류 `forbidden` `닉네임은 5~12자여야 합니다`를 보낸 뒤 소켓을 1008로 닫고 자리를 만들지 않는다. 방 만들기(`POST /api/room`)는 400 `bad name`이다. 입력 칸은 12자까지 받고 5자 미만이면 `5자 이상 입력하세요`를 보인다. | `room.ts` `hello`, `routes/api/room/+server.ts`, `NickModal.svelte` | t:mp-room-socket, t:api-room, e:mp-lobby |

### M-ROOM 방 만들기와 입장

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-ROOM-1 | 방 코드는 6자이고 문자는 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`(32자, `0 O 1 I` 제외)뿐이다. 서버와 `/ws/<코드>`는 형식이 다른 코드를 404로 거절한다. 입력 화면은 소문자를 대문자로 바꾸고 허용 문자 밖은 지운다. | `rules.ts` `CODE_ALPHABET`, `CODE_RE`, `hooks.server.ts` | t:mp-code, t:hooks-server, e:mp-lobby |
| M-ROOM-2 | 방 만들기 `POST /api/room {token?, name, settings?}` → `{code, session}`. 검사 순서: ① 방 바인딩 없음 503 ② 이름(400 `bad name`) ③ 토큰이 있는데 문자열이 아님(400 `bad token`) ④ 설정이 있으면 M-SET-2로 검증(400 `bad settings`), 없으면 기본 설정(M-SET-1). 유효하지 않은 토큰은 거절하지 않고 새 `uid`로 발급한다. | `routes/api/room/+server.ts` | t:api-room |
| M-ROOM-3 | 코드는 난수로 정하고 이미 쓰이고 있으면 새 코드로 최대 5번 다시 시도한다. 5번 모두 실패하면 503 `could not allocate a room code`. | `api/room/+server.ts` | t:api-room |
| M-ROOM-4 | 방이 만들어지면 만든 사람이 방장 자리를 예약한다(접속 전이므로 끊긴 사람과 같이 취급: 접속자 0, 끊긴 시각 = 만든 시각). 만든 사람이 5000ms 안에 입장하면 방장을 유지하고, 오지 않으면 먼저 입장한 사람이 방장을 이어받는다(M-HOST-2). 아무도 입장하지 않으면 30000ms 뒤 방이 사라진다(M-LIFE-1). | `state.ts` `initRoom` | t:mp-timers |
| M-ROOM-5 | 입장 전 확인 `GET /api/room/<코드>`는 방 요약을 주고(`cache-control: no-store`) 없는 방·형식 틀린 코드는 404다. 코드로 입장하는 화면은 요약에 따라 `진행 중인 방입니다. 게임이 끝나면 들어갈 수 있습니다`(`inProgress`), `방이 가득 찼습니다`(`players ≥ max`), `없는 방입니다`(404), `서버에 연결할 수 없습니다`를 입장 전에 알린다. 저장된 닉네임이 있는 링크 입장(`?room=코드`)은 이 확인 없이 바로 접속하고 서버의 거절(M-ROOM-7)을 따른다. | `api/room/[code]/+server.ts`, `LobbyView.svelte`, `MultiApp.svelte` | t:api-room-code, e:mp-lobby |
| M-ROOM-6 | 방은 자리를 최대 5개 가진다(`MAX_PLAYERS`). 시작에는 접속자가 2명 이상이어야 한다(`MIN_PLAYERS`, M-START-1). | `rules.ts` | t:mp-members |
| M-ROOM-7 | 입장(`hello`) 처리 순서: ① 닉네임 검증(M-ID-8). ② 같은 `uid`의 자리가 있으면 그 자리로 돌아온다. 단 그 자리가 `left`(스스로 나간 자리)이고 방이 `playing`이면 거절한다(닫힘 코드 4002). ③ 같은 `uid`의 자리가 없으면, 방이 `playing`이면 거절(4002). ④ 자리 수가 5 이상이면 방장이 아니고 끊긴 지 60000ms 이상(`now − 끊긴 시각 ≥ 60000`)인 사람의 자리를 먼저 비운다. 그래도 5 이상이면 거절(4001). ⑤ 성공하면 자리를 만들거나 되살린다. 거절한 소켓은 해당 코드로 닫는다. | `members.ts` `join`, `evictStale`, `room.ts` | t:mp-members, t:mp-room-socket |
| M-ROOM-8 | 입장에 성공하면: 접속자 0 표시(`emptySince`)를 지우고, 방장이 비어 있으면 입장한 사람이 방장이 된다. 같은 자리로 돌아온 경우 이름은 이번 `hello`의 이름으로 다시 정하고(M-ID-2), 준비는 해제한다. 같은 `uid`의 다른 소켓은 모두 4000(`replaced`)으로 닫아 자리를 넘겨받는다. 응답 순서: `welcome`, `chat_history`, 스냅샷(`session` 포함). | `members.ts` `join`, `room.ts` `hello` | t:mp-room-socket, t:mp-members |
| M-ROOM-9 | 이미 입장한 소켓의 두 번째 `hello`는 오류 `forbidden` `이미 입장했습니다`, 입장 전 소켓의 다른 메시지는 오류 `forbidden` `먼저 입장해야 합니다`다. 없는 방에 연결된 소켓은 첫 메시지에서 4004로 닫힌다. 자리를 잃은 소켓(방에 없는 `pid`)의 메시지도 4004로 닫는다. | `room.ts` `webSocketMessage`, `act` | t:mp-room-socket, t:mp-room-lifecycle |
| M-ROOM-10 | 잘못된 메시지(JSON이 아니거나, 객체가 아니거나, 모르는 `type`, 필드 타입·범위·길이 위반, 원문 4096자 초과)는 오류 `forbidden` `잘못된 요청입니다`만 돌려주고 소켓·상태는 그대로다. 바이너리는 무시한다. | `server/mp/parse.ts`, `room.ts` | t:mp-parse, t:mp-room-socket |
| M-ROOM-11 | 같은 `uid`의 자리가 있고 판이 끝난 뒤(대기실·결과)이면 언제든 돌아온다. 나가기로 자리가 삭제된 사람과 `내보내고 시작`으로 삭제된 사람은 새 입장자로 취급한다(M-ROOM-7 ③④). | `members.ts` | t:mp-members |

### M-PHASE 방의 단계 전이

방의 단계는 `lobby`(대기실), `playing`(게임 중), `result`(결과) 셋이고 이 전이밖에 없다. `playing`에서 `lobby`로 바로 가는 길은 없다.

| 사건 | 이전 단계 | 이후 단계 | 조건과 부수 효과 |
|---|---|---|---|
| 방 생성 | 없음 | `lobby` | 설정 = 요청 값 또는 기본값, 준비·게임 없음 |
| `start` 수락 | `lobby` | `playing` | M-START. 그 시점의 모든 자리가 참가자가 되고(`inGame`), 설정은 복사본이 게임에 고정된다 |
| 경쟁: 마지막 풀이 중 참가자가 끝남 | `playing` | `result` | M-COMP-9. 순위표 고정, 준비 전원 해제, 나가기로 떠난 자리 삭제 |
| 협동: 정답 / 시도 소진 / 제한 시간 / 방장 포기 | `playing` | `result` | M-COOP-13. 명단 고정, 준비 전원 해제, 나가기로 떠난 자리 삭제 |
| `again` 또는 `next` 수락 | `result` | `lobby` | 설정 유지(`next`는 교체 가능), 게임 데이터 폐기, 전원 준비·`inGame` 해제 |
| 방 소멸 | 어느 단계든 | 없음 | M-LIFE-1 |

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-PHASE-1 | 게임은 시작 때의 설정 복사본으로 끝까지 진행한다. 진행 중에는 설정을 바꿀 수 없다(M-SET-3). | `comp.ts`·`coop.ts` `startGame` | t:mp-members |
| M-PHASE-2 | 등반은 스테이지가 이어지는 동안 한 게임이다. 스테이지 사이에 단계는 바뀌지 않는다. | `climb.ts` | t:mp-climb |
| M-PHASE-3 | `result`에서 `lobby`로 돌아올 때 이전 판의 정답·순위표·패널·보드는 스냅샷에서 사라진다. 끊긴 채 남은 사람은 자리를 지키고, 결과 중 들어온 사람은 준비 전 참가자로 들어와 있다. | `members.ts` `backToLobby` | t:mp-members, t:mp-snapshot |

### M-HOST 방장

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-HOST-1 | 방장은 하나다(`hostPid`). 방장만 할 수 있는 것: 설정 변경, 시작, 결과에서 `again`·`next`, 방장 넘기기, 협동의 제안·투표 마감과 포기, 경쟁에서 끊긴 사람 강제 탈락. | `members.ts`, `coop.ts`, `comp.ts` | t:mp-members, t:mp-coop, t:mp-comp |
| M-HOST-2 | 방장이 끊기면 `끊긴 시각 + 5000`ms에 도달한 시점(`now ≥ 끊긴 시각 + 5000`, 정확히 5000ms째 포함)에 입장 순으로 접속 중인 다음 사람이 방장이 된다. 접속 중인 다른 사람이 없으면 승계하지 않고 방장 자리를 유지한다. 5000ms 안에 같은 `uid`로 돌아오면 방장이 유지된다. | `members.ts` `hostSuccessionAt`, `succeedHost`, `HOST_GRACE_MS` | t:mp-timers, t:mp-room-alarm |
| M-HOST-3 | 방장이 `나가기`하면 유예 없이 입장 순으로 접속 중인 다음 사람이 방장이 된다. 접속 중인 사람이 없으면 방장이 비고, 다음에 입장한 사람이 방장이 된다. | `members.ts` `leave`, `join` | t:mp-members |
| M-HOST-4 | 방장이 접속해 있는 동안에는 시스템이 방장을 바꾸지 않는다(방장이 아무것도 하지 않아도 자동 교체·자동 시작이 없다). 강퇴 기능은 없다([U-11](#u-11)). | `members.ts` | 코드만 |
| M-HOST-5 | 방장 넘기기(`transfer {pid}`): 평가 순서 ① 보낸 사람이 방장이 아니면 `forbidden` `방장만 방장을 넘길 수 있습니다` ② 단계가 `playing`이면 `phase` `게임 중에는 방장을 넘길 수 없습니다` ③ 대상이 방에 없거나 자기 자신이거나 접속 중이 아니면 `forbidden` `접속 중인 다른 참가자에게만 넘길 수 있습니다`. 성공하면 새 방장과 옛 방장의 준비를 풀고(옛 방장은 준비 안 함 상태의 일반 참가자) 나머지의 준비는 유지한다. 되받기·연속 넘기기에 제한은 없다. | `members.ts` `transferHost` | t:mp-members, e:mp-waiting |
| M-HOST-6 | 자리에서 방장이 바뀌면 로비 목록의 방장 이름도 바뀐다(요약이 바뀐 것이므로 M-LIFE-6). | `rooms.ts` `summarize` | t:mp-members |

### M-READY 준비와 재촉

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-READY-1 | 준비(`ready {on}`): 방에 있는 사람이 `playing`이 아닌 단계에서 토글한다. 평가 순서 ① 방에 없음 `forbidden` `방에 없는 사람입니다` ② `playing`이면 `phase` `게임 중에는 준비를 바꿀 수 없습니다` ③ 방장이면 `forbidden` `방장은 준비하지 않습니다`. 결과 단계에서도 받아들인다([U-16](#u-16)). | `members.ts` `setReady` | t:mp-members |
| M-READY-2 | 준비가 해제되는 경우: 접속이 끊길 때, 입장·재입장할 때, 설정 값이 실제로 바뀔 때(전원), `again`·`next`(전원), 게임이 끝날 때(전원), 방장 넘기기(옛·새 방장). | `members.ts`, `comp.ts` `settle`, `coop.ts` `endGame` | t:mp-members, t:mp-comp, t:mp-coop |
| M-READY-3 | 재촉(`nudge`): 방장이 아닌 사람이 방장에게 보낸다. 평가 순서 ① 방에 없거나 방장이 비었거나 보낸 사람이 방장이면 `forbidden` `방장에게만 재촉할 수 있습니다` ② `playing`이면 `phase` `게임 중에는 재촉할 수 없습니다` ③ 같은 사람의 이전 재촉이 있고 `now − 이전 재촉 시각 < 30000`이면 `cooldown` `{올림(남은 ms/1000)}초 뒤에 다시 재촉할 수 있습니다`(정확히 30000ms째는 허용). 성공하면 방장에게만 `{type:'nudge', from:<보낸 사람 이름>}`이 간다. 다른 사람은 그 사이에도 재촉할 수 있다(쿨다운은 사람마다). 방장이 끊겨 있어도 성공으로 처리된다([U-17](#u-17)). | `members.ts` `nudge`, `NUDGE_COOLDOWN_MS` | t:mp-members, t:mp-room-socket, e:mp-waiting |

### M-START 시작

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-START-1 | 시작 가능 여부는 이 순서로 본다: ① 단계가 `lobby`가 아니면 불가(`phase`) ② 방장이 접속 중이 아니면 불가(`no_host`) ③ 접속자가 2명 미만이면 불가(`alone`) ④ 접속 중인 방장 외 사람 중 준비하지 않은 사람이 1명 이상이면 불가(`waiting`, 그 수가 대기 인원) ⑤ 그 밖에는 가능. 끊긴 사람은 세지 않고 시작을 막지도 않는다. | `members.ts` `canStart` | t:mp-members |
| M-START-2 | 시작(`start`) 처리 순서: ① 보낸 사람이 방장이 아니면 `forbidden` `방장만 시작할 수 있습니다` ② M-START-1을 어기면 오류(단계 `phase` `이미 시작했습니다`, 나머지 `forbidden`: `방장이 접속 중이어야 합니다` / `두 명 이상 모여야 시작할 수 있습니다` / `{n}명이 아직 준비하지 않았습니다`) ③ 정답 조회에 실패했거나 등반인데 12자까지 한 스테이지라도 정답을 못 읽었으면 `unavailable` `서버에 연결할 수 없습니다`(상태 불변, 방장에게만) ④ 시작. | `reduce.ts` `start` | t:mp-members, t:mp-room-d1 |
| M-START-3 | 시작 길이가 `랜덤`이면 시작 때 5 이상 12 이하에서 하나를 정하고, 그 길이(등반은 12자까지 모든 길이)마다 풀(t=3)에서 정답을 하나씩 무작위로 읽는다. 단판은 모든 참가자에게 같은 정답이고 등반은 모든 참가자가 같은 단어 순서다. | `comp.ts` `chooseStartN`, `room.ts` `lookupStart` | t:mp-comp, t:mp-room-d1 |
| M-START-4 | 대기실에서 방장이 시작을 요청하면 인원을 세기 전에 응답 없는 소켓을 먼저 정리한다(M-CONN-4, 방장의 소켓은 제외). 거절될 요청은 정답 조회를 하지 않는다. | `room.ts` `act` | t:mp-room-d1 |
| M-START-5 | 시작 때 방에 있는 모든 자리가 참가자다(끊긴 사람 포함). `start`에 `kickDisconnected:true`가 실리면 끊긴 자리를 방에서 삭제하고 시작한다. 방장 화면은 끊긴 사람이 있으면 시작 버튼을 `{이름} 내보내고 시작`(여럿이면 `{이름} 외 {n}명 내보내고 시작`)으로 바꾸고 항상 `kickDisconnected:true`로 보낸다([U-7](#u-7)). | `members.ts` `removeDisconnected`, `WaitingRoom.svelte`, `MultiApp.svelte` | t:mp-members, e:mp-waiting |
| M-START-6 | 시작 불가 사유 문구(방장 화면): `혼자서는 시작할 수 없습니다`(alone), `{n}명 대기 중`(waiting), `방장이 접속해야 합니다`(no_host). | `WaitingRoom.svelte` | e:mp-waiting |
| M-START-7 | 결과 → 대기실: `again {}`은 설정을 그대로, `next {settings?}`는 설정이 있으면 교체하고 방장에게만 `{type:'opensettings'}`을 보낸다. 둘 다 방장만 되고(`forbidden` `방장만 다음 게임을 고를 수 있습니다`), 단계가 `result`가 아니면 `phase` `결과 화면에서만 고를 수 있습니다`. 설정 값이 틀리면 결과에 머문다. | `members.ts` `backToLobby`, `reduce.ts` | t:mp-members, t:mp-room-socket |

### M-SET 방 설정

| 설정 | 값 | 기본값 | 뜻 |
|---|---|---|---|
| `kind` | `coop` / `comp` | `comp` | 협동 / 경쟁 |
| `game` | `single` / `climb` | `single` | 단판 / 등반 |
| `length` | 5~12 정수 또는 `random` | 6 | 단판은 길이, 등반은 시작 길이 |
| `tries` | 4~10 정수 | 6 | 판(등반은 스테이지)마다의 시도 횟수 |
| `hard` | 불리언 | `false` | 하드 모드(C-HARD) |
| `hints` | 불리언 | `true` | 힌트 허용 |
| `timer` | 불리언 | `false` | 제한 시간 사용(M-TIME) |
| `pick` | `vote` / `roulette` | `vote` | 협동 후보 선택 방식. 경쟁에서는 의미가 없고 값은 저장한다 |

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-SET-1 | 방 설정의 기본값은 위 표다(`DEFAULT_SETTINGS`). 방을 만들 때 설정을 주지 않으면 기본값으로 만들어진다. | `mp/rules.ts` | t:mp-parse, t:api-room |
| M-SET-2 | 설정은 모든 필드가 위 표의 범위일 때만 받는다. 하나라도 어긋나면 통째로 거절한다. 알려진 필드만 복사하고 모르는 필드는 버린다. 통신으로 온 설정이 틀리면 메시지 전체가 `잘못된 요청입니다`(M-ROOM-10)다. | `rules.ts` `parseSettings`, `parse.ts` | t:mp-parse, t:api-room |
| M-SET-3 | 설정 변경(`settings`)은 방장만, `playing`이 아닌 단계(대기실·결과)에서 할 수 있다. 평가 순서 ① 방장이 아니면 `forbidden` `방장만 설정을 바꿀 수 있습니다` ② `playing`이면 `phase` `게임 중에는 설정을 바꿀 수 없습니다`. 화면의 설정 창은 대기실에서만 연다([U-12](#u-12)). | `members.ts` `applySettings` | t:mp-members |
| M-SET-4 | 설정 값이 현재와 다를 때만 바뀐다. 같은 값이면 아무 일도 없고 준비도 유지된다. 실제로 바뀌면 전원의 준비를 푼다(방장 포함). | `members.ts` `applySettings`, `rules.ts` `sameSettings` | t:mp-members, e:mp-waiting |
| M-SET-5 | 설정 창의 설명 문구: 종류 협동 `한 보드에 단어를 제안하고 골라 함께 풉니다.` / 경쟁 `같은 정답을 각자 풉니다.`; 선택 방식 투표 `자기 제안에도 투표할 수 있습니다. 20초 안에 정하고, 동률이면 돌림판.` / 돌림판 `제안 중 하나를 무작위로 고릅니다.`; 게임 단판 `한 단어.` / 등반 `시작 길이에서 12자까지 한 자모씩 올라갑니다.`; 하드 `초록 자모는 그 자리에, 노란 자모는 어디든 반드시 다시 써야 합니다.`; 힌트 `노란 자모 하나의 실제 위치를 알려줍니다. ` + (등반: `등반 전체에서 방 전체가 한 번.`(협동) / `등반 전체에서 한 사람이 한 번.`(경쟁); 단판: `한 판에 한 번.`(협동) / `한 사람에 한 번.`(경쟁)); 제한 시간 `단판 180초. 등반은 180초에서 스테이지마다 15초씩 줄어 60초까지.` | `components/mp/RoomSettings.svelte` | 코드만 |

### M-MSG 메시지 권한과 거절

클라이언트 → 서버 메시지의 종류는 규범이다(`mp/protocol.ts` `ClientMsg`). 거절은 **보낸 사람에게만** `{type:'error', code, msg}`로 돌아오고 상태는 바뀌지 않으며 스냅샷도 따라오지 않는다. 오류 `code`는 `invalid`(입력 값), `hard`(하드 모드 위반), `forbidden`(권한·대상), `phase`(단계·상태), `cooldown`(대기), `unavailable`(서버 문제)이다. 서버는 모든 메시지를 처리하기 전에 그 시점까지 만료된 마감을 먼저 처리한다(M-TIME-2).

| 메시지 | 누가 | 언제 | 비고 |
|---|---|---|---|
| `hello` | 아직 자리 없는 소켓 | 언제나 | M-ROOM-7~9 |
| `ready` | 자리 있는 사람 | `playing`이 아닐 때, 방장 제외 | M-READY-1 |
| `nudge` | 방장이 아닌 사람 | `playing`이 아닐 때 | M-READY-3 |
| `leave` | 자리 있는 사람 | 언제나 | M-LEAVE |
| `settings` | 방장 | `playing`이 아닐 때 | M-SET-3 |
| `start` | 방장 | `lobby` | M-START |
| `again`, `next` | 방장 | `result` | M-START-7 |
| `transfer` | 방장 | `playing`이 아닐 때 | M-HOST-5 |
| `guess`, `giveup`(본인) | 경쟁 참가자 | `playing` | 협동 방에서 `guess`는 `phase` `경쟁 게임에서만 쓸 수 있습니다` |
| `eliminate` | 방장 | `playing`, 경쟁 | 협동 방에서는 `phase` `경쟁 게임에서만 쓸 수 있습니다` |
| `hint` | 참가자 | `playing` | 경쟁은 즉시, 협동은 힌트 투표 열기 |
| `draft`, `propose`, `unpropose`, `pass`, `vote`, `close`, `hintvote` | 협동 참가자 | `playing` | 경쟁 방·게임 없음에서는 `phase` `협동 게임에서만 쓸 수 있습니다` |
| `giveup`(협동) | 방장 | `playing` | M-COOP-14 |
| `chat` | 자리 있고 나가지 않은 사람 | 언제나 | M-CHAT-1 |

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-MSG-1 | 단계가 안 맞는 메시지는 오류 `phase`다. 게임이 없거나(대기실) 결과 단계일 때 `guess`·`hint`·`giveup`은 `phase` `진행 중인 게임이 없습니다`, 협동 게임의 결과 단계에서 협동 전용 메시지는 `phase` `진행 중인 협동 게임이 없습니다`가 된다. | `server/mp/reduce.ts`, `comp.ts`, `coop.ts` | t:mp-coop, t:mp-comp |
| M-MSG-2 | 닫기 코드: 4000 같은 `uid`의 새 소켓이 자리를 넘겨받음, 4001 정원 초과, 4002 진행 중이라 입장 불가(또는 나간 사람의 재입장), 4004 없는 방(또는 자리 없음), 4005 방 소멸, 1008 닉네임 규칙 위반, 1001 응답 없는 소켓 정리, 1000 나가기. 클라이언트는 4000·4001·4002·4004·4005·1008에서는 재접속하지 않는다. | `protocol.ts` `CLOSE`, `client.svelte.ts` `TERMINAL` | t:mp-room-socket, t:mp-client |
| M-MSG-3 | 입장 거절 안내 문구: 4001 `방이 가득 찼습니다`, 4002 `진행 중인 방입니다. 게임이 끝나면 들어갈 수 있습니다`, 4004·4005 `없는 방입니다`, 1008 `닉네임은 5~12자여야 합니다`. 같은 계정의 다른 탭이 접속하면(4000) 이 탭은 `다른 탭에서 접속했습니다`를 보이고 다시 붙지 않는다. | `MultiApp.svelte`, `ConnectionOverlay.svelte` | e:mp-lobby, e:mp-connection |

### M-LEAVE 나가기

`나가기`는 자리를 버리는 것이고, 연결이 끊기는 것(M-CONN)과 다르다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-LEAVE-1 | `leave`를 받으면 그 사람의 소켓을 1000(`left`)으로 닫는다. 대기실·결과에서는 자리를 삭제한다. | `reduce.ts`, `members.ts` `leave`, `room.ts` `deliver` | t:mp-members, t:mp-room-lifecycle |
| M-LEAVE-2 | 게임 중(`playing`)에 참가자가 나가면 자리는 남기고 끊김 상태 + `left` 표시로 둔다. 이름이 결과 순위표·명단에 남게 하려는 것이다. 게임이 끝나는 순간(결과 진입) `left` 자리를 모두 삭제한다. | `members.ts` `leave`, `comp.ts` `settle`, `coop.ts` `endGame` | t:mp-comp, t:mp-coop |
| M-LEAVE-3 | 경쟁에서 풀이 중인 사람이 나가면 그 즉시 `eliminated`(탈락)로 끝난다. 이미 끝난 사람이나 참가자가 아닌 사람이 나가면 게임에는 영향이 없다. | `comp.ts` `forfeit` | t:mp-comp |
| M-LEAVE-4 | 협동에서 나간 사람의 제안·초안·투표·패스는 지워지고 집계 대상에서 빠진다. 힌트 투표를 연 사람이 나가면 그 투표는 `moot`로 접는다. 투표 단계의 처리는 M-COOP-VOTE-9. 처리 뒤 진행 조건을 다시 본다(M-COOP-3). | `coop.ts` `forfeit` | t:mp-coop, t:mp-coop-pass-hint |
| M-LEAVE-5 | 나간 사람은 그 판이 끝날 때까지(`playing`) 같은 `uid`로 돌아올 수 없다(4002). 판이 끝난 뒤에는 새 입장자로 들어올 수 있다. | `members.ts` `join` | t:mp-members, t:mp-room-socket |
| M-LEAVE-6 | 스냅샷에서 `left: true`는 스스로 나간 사람에게만 붙는다. 끊김이나 방장의 탈락 처리는 붙지 않는다. 결과 단계에서 나간 사람은 자리가 삭제된다. | `snapshot.ts` | t:mp-snapshot |
| M-LEAVE-7 | 게임 중 나가기는 확인 창을 거친다. 이미 끝난 판에서는 바로 나간다. | `MpGame.svelte` `leave` | e:mp-comp |
| M-LEAVE-8 | 전원이 나가서 자리가 0개가 되면 방이 즉시 사라진다(M-LIFE-1). | `timers.ts` `abandoned`, `reduce.ts` | t:mp-timers, t:mp-room-lifecycle |

### M-CONN 접속과 끊김

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-CONN-1 | 소켓이 닫히거나 오류가 나면 그 자리는 끊김 상태가 된다: 접속자에서 빠지고, 끊긴 시각을 기록하고, 준비를 푼다. 같은 자리에 열린 다른 소켓이 있으면(탭 넘겨받기 직후) 끊김이 아니다. 같은 소켓의 닫힘과 오류가 함께 와도 끊김은 한 번만 처리한다. | `room.ts` `gone`, `members.ts` `disconnect` | t:mp-room-socket |
| M-CONN-2 | 끊긴 사람의 자리는 방이 있는 동안 남는다. 같은 `uid`로 다시 입장하면 같은 자리로 돌아온다(M-ROOM-7). 돌아오면 준비는 해제된다. | `members.ts` `join` | t:mp-members |
| M-CONN-3 | 클라이언트는 25000ms마다 문자열 `ping`을 보내고, 서버는 방을 깨우지 않고 `pong`으로 자동 응답한다. | `rules.ts` `HEARTBEAT_MS`, `room.ts` | t:mp-room-alarm |
| M-CONN-4 | 무응답 소켓 정리: 마지막 자동 응답 시각(응답이 없으면 접속 시각)에서 `now − 그 시각 > 45000`이면 그 소켓을 1001로 닫고 그 자리를 끊김으로 처리한다. **정확히 45000ms는 정상이고 45001ms부터 정리 대상이다.** | `timers.ts` `isStaleSocket`, `room.ts` `reapStale`, `SOCKET_IDLE_MS` | t:mp-timers, t:mp-room-alarm |
| M-CONN-5 | 소켓 정리 점검은 소켓이 있을 때만, 마지막 점검 시각에서 게임 중 45000ms, 대기실·결과 180000ms 뒤에 한다. 방장이 대기실에서 시작을 요청하면 그 소켓을 뺀 나머지에 대해 한 번 더 점검한다. | `timers.ts` `reapCheckAt`, `REAP_CHECK_PLAYING_MS`, `REAP_CHECK_IDLE_MS` | t:mp-timers, t:mp-room-alarm |
| M-CONN-6 | 서버가 재시작되면 저장된 접속 상태를 믿지 않는다. 열린 소켓이 없는 접속자는 끊김으로 바꾸고, 그 사이 지난 마감을 먼저 처리한 뒤 협동 진행 조건을 다시 본다. | `members.ts` `reconcile`, `room.ts` `reconcileSockets` | t:mp-members, t:mp-room-lifecycle |
| M-CONN-7 | 경쟁 자동 탈락: 풀이 중인 참가자가 끊긴 채 `max(끊긴 시각, 게임 시작 시각) + 60000`ms에 도달하면(`now ≥` 그 시각) 그 사람만 `eliminated`가 되고 기록 시각은 그 시각이다. 대기실에서 끊긴 채 시작을 맞은 사람은 게임 시작부터 센다. 60000ms 안에 돌아오면 탈락하지 않는다. 탈락한 뒤 돌아와도 되살아나지 않는다(탈락 상태의 자리로 돌아온다). 접속 중이거나 이미 끝난 사람은 대상이 아니다. | `comp.ts` `eliminationAt`, `DISCONNECT_GRACE_MS` | t:mp-timers, e:mp-connection |
| M-CONN-8 | 협동에서는 끊김으로 탈락하지 않는다. 끊긴 사람은 집계 대상에서만 빠지고 이미 낸 제안은 남는다(M-COOP-2). | `coop.ts` `countable` | t:mp-timers, t:mp-coop |
| M-CONN-9 | 클라이언트는 연결이 끊기면 즉시 한 번, 2000ms 뒤 한 번 다시 붙는다. 그래도 안 되면 멈추고(`lost`) 사용자가 `다시 연결`을 누르거나 숨은 탭이 다시 보이면 시도 횟수를 처음부터 센다. 서버가 보낸 닫기 코드(M-MSG-2)에서는 재시도하지 않는다. 재접속은 같은 토큰으로 `hello`를 다시 보낸다. | `mp/client.svelte.ts` | t:mp-client, e:mp-connection |
| M-CONN-10 | 클라이언트는 스냅샷의 `seq`가 지금까지 받은 값보다 **낮으면** 버리고 같거나 높으면 받아들인다. 서버 시계 보정은 최근 받아들인 스냅샷의 `now − 로컬 시각`을 쓴다. | `client.svelte.ts` `receive` | t:mp-client |
| M-CONN-11 | 소켓 정리(45000ms 초과)와 끊김 유예(60000ms)는 별개의 시계다. 반쯤 끊긴 소켓은 정리될 때 비로소 끊김이 되므로, 그 클라이언트의 탈락(M-CONN-7)은 "마지막 응답 + 정리 지연 + 60000ms" 뒤에 일어난다([U-9](#u-9)). | `timers.ts`, `comp.ts` | t:mp-room-alarm |

### M-LIFE 방의 수명과 목록

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-LIFE-1 | 방은 다음 중 하나가 되면 사라진다: ① 자리가 0개(전원이 나가기로 떠남) → 즉시. ② 접속자가 0명인 상태가 30000ms 이어짐(`now ≥ 접속자가 0이 된 시각 + 30000`). 접속자가 0이 된 시각은 방 생성 직후도 포함하며, 누군가 입장하면 지운다. 방이 있는 동안 끊긴 사람이 30000ms 안에 돌아오면 방은 남는다. | `timers.ts` `tick`, `abandoned`, `EMPTY_ROOM_MS` | t:mp-timers, t:mp-room-lifecycle |
| M-LIFE-2 | 경쟁 게임 중 전원이 나가기로 떠나면 게임이 끝나는 순간(M-COMP-9) 나간 자리가 치워져 ①로 즉시 사라진다. 나가기와 끊김이 섞여 자리가 남으면 ①이 아니라 ②(30초)를 따른다. 협동은 게임이 끝나기 전에는 나간 자리를 치우지 않으므로 전원이 나가기로 떠나도 ②(30초)를 따른다([U-13](#u-13)). | `comp.ts` `settle`, `timers.ts`, `coop.ts` `forfeit` | t:mp-timers (경쟁·섞임만) |
| M-LIFE-3 | 사라질 때: 알람과 저장 데이터를 지우고, 공개 목록에서 빼고, 열려 있던 소켓을 4005로 닫고(입장 전 소켓 포함), 채팅 기록을 비운다. 이후 그 코드는 없는 방이다. | `room.ts` `destroy` | t:mp-room-lifecycle |
| M-LIFE-4 | 공개 목록에는 접속자가 1명 이상인 방만 낸다. 방 생성 직후(방장 예약만 있음), 모두 나가기로 떠난 방, 접속자가 0인 방은 목록에서 빠진다. 접속자가 돌아오면 다시 난다. | `rooms.ts` `isListed` | t:mp-rooms |
| M-LIFE-5 | 목록 항목(방 요약): 코드, 방장 이름(방장이 없으면 빈 문자열), `kind`, `game`, `players`(**접속자 수**, 끊긴 자리는 세지 않는다), `max`(=5), `inProgress`(`playing`), `length`, `tries`, `hard`, `timer`, 서버가 받은 시각 `updatedAt`. | `rooms.ts` `summarize` | t:mp-rooms |
| M-LIFE-6 | 방은 요약이 바뀔 때(접속 인원·방장·종류·게임·진행 여부·길이·시도·하드·제한 시간)만 즉시 목록에 알린다. 준비 토글은 알리지 않는다. 접속자가 있는 동안 300000ms마다 다시 알린다(심장박동). | `rooms.ts` `sameSummary`, `rules.ts` `LOBBY_REFRESH_MS` | t:mp-rooms, t:mp-room-alarm |
| M-LIFE-7 | 목록은 마지막 알림 이후 `now − updatedAt > 750000`인 방을 지운다(정확히 750000ms는 남는다). 재시작으로 소켓 없이 남은 방은 알리지 않으므로 이 시간 뒤 빠진다. | `rooms.ts` `listRooms`, `LOBBY_STALE_MS` | t:mp-rooms, t:mp-lobby-do |
| M-LIFE-8 | 목록 정렬: 입장 가능한 방(`inProgress`가 아니고 `players < max`) 먼저, 그 안에서 `updatedAt`이 최신인 순. 최대 50개. | `rooms.ts` `listRooms`, `LOBBY_LIST_MAX` | t:mp-rooms, t:mp-lobby-do |
| M-LIFE-9 | 목록 태그: `진행 중`(`inProgress`) → `가득`(`players ≥ max`) → `대기 중`. `대기 중`이 아닌 방은 목록에서 눌러 입장할 수 없다. 이유 문구: 진행 중 `진행 중인 방입니다. 게임이 끝나면 들어갈 수 있습니다`, 가득 `방이 가득 찼습니다`. 가득 여부는 접속자 수 기준이라 서버의 자리 수 기준 거절(M-ROOM-7 ④)과 어긋날 수 있다([U-8](#u-8)). | `LobbyView.svelte` | e:mp-lobby |
| M-LIFE-10 | 목록 구독은 `/ws-lobby` WebSocket이다. 구독한 소켓은 접속 직후 현재 목록을 한 번 받고, 이후 목록 내용(코드별 요약, 순서·`updatedAt` 제외)이 바뀔 때만 전체 목록을 받는다. 소켓이 끊긴 동안만 보이는 탭에서 `GET /api/rooms`를 15000ms마다 부르고, 재연결은 3000ms에서 60000ms까지 지수 백오프다. 클라이언트는 마지막 응답 뒤 `Date.now() − 마지막 응답 > 75000`이면(정확히 75000ms는 정상) 반쯤 끊긴 소켓으로 보고 버린 뒤 폴링과 재연결로 넘어간다. | `server/mp/lobby.ts`, `mp/lobby-feed.ts`, `rules.ts` `LOBBY_FALLBACK_POLL_MS` | t:mp-lobby-do, t:lobby-feed, e:mp-lobby |

### M-TIME 제한 시간과 마감 처리

제한 시간을 끄면(`timer:false`) 판·스테이지에 마감이 없고 시간으로 끝나지 않는다. 투표 20초(M-COOP-VOTE-2)와 힌트 투표 30초(M-CHINT-2)는 제한 시간 설정과 무관하게 항상 걸린다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-TIME-1 | 마감 시각은 단판은 `게임 시작 + 180000`, 등반은 스테이지 k(1부터)에서 `시작 + 제한(k)`이다. 제한(k) = `max(60000, 180000 − 15000 × (k − 1))`. 스테이지 k+1의 마감은 스테이지 k를 클리어한 시각 + 2000(`STAGE_CLEAR_MS`) + 제한(k+1)이다. 경쟁은 사람마다, 협동은 방의 공유 보드 하나가 마감을 가진다. | `server/mp/climb.ts` `stageLimitMs`, `stageDeadline`, `rules.ts` | t:mp-timers |
| M-TIME-2 | 마감은 `now ≥ 마감 시각`에서 만료한다. 서버는 어떤 메시지를 처리하든 그 앞에서 만료된 마감을 먼저 처리한다. 그래서 마감 시각 정각(또는 그 뒤)에 도착한 제출·제안은 거절되고(`phase`), 1ms 전에 도착한 것은 받는다. | `timers.ts` `tick`, `reduce.ts` | t:mp-timers |
| M-TIME-3 | 한 번의 처리에서 여러 마감이 지났으면 이 순서로 처리한다: 방 소멸(자리 0개, 접속자 0 30000ms) → 방장 승계 → 경쟁 참가자별 만료(M-COMP-8) → 협동 공유 보드 마감 → 협동 투표 마감 → 협동 힌트 투표 마감. 판이 끝나는 마감이 먼저이므로 끝난 판의 투표·힌트 투표는 이미 접혀 있다. 같은 시각으로 다시 처리해도 결과가 같다. | `timers.ts` `tick` | t:mp-timers, t:mp-coop-vote |
| M-TIME-4 | 알람이 늦거나 방이 오래 잠들어 여러 마감이 한꺼번에 지났어도, 각 사람·판의 종료 시각은 **마감 시각**으로 기록한다(처리한 시각이 아니다). 순위 입력이 흔들리지 않게 하려는 것이다. | `comp.ts` `expireCompPlayers` | t:mp-timers |
| M-TIME-5 | 제한 시간 만료의 결과: 경쟁은 그 사람만 `timeout`(등반은 그 높이에서 멈춤), 협동은 게임 전체가 `lost` / `timeout`(등반은 등반 전체)이다. | `comp.ts`, `coop.ts` `expireDeadline` | t:mp-timers |
| M-TIME-6 | 등반 제한 시간 표: 스테이지 1은 180000, 2는 165000, 3은 150000, 4는 135000, 5는 120000, 6은 105000, 7은 90000, 8은 75000ms다. 스테이지는 시작 길이에서 12자까지 최대 8개라 하한 60000ms에는 닿지 않는다([U-10](#u-10)). | `climb.ts` | t:mp-timers |
| M-TIME-7 | 무입력 경고(클라이언트에서만): 지금 입력할 것이 있는 사람 화면에서 마지막 입력(또는 경고 닫기) 뒤 60000ms가 지나면 `진행 중입니다` 경고창을 띄운다. 경고는 자동 포기·퇴장으로 이어지지 않고, 닫고 입력하면 이어진다. 대상: 경쟁은 내가 `playing`일 때, 협동은 내가 접속 중 참가자이고 제안 단계에서 제안도 패스도 안 했거나 투표 단계에서 내 표가 없을 때. 끊긴 동안, 모달·채팅·강제 탈락 확인 창이 열려 있는 동안은 세지 않는다. | `MpGame.svelte` `idleTarget`, `rules.ts` `coopNeedsInput` | e:mp-comp, e:mp-coop, t:mp-coop-pass-hint |

### M-COMP 경쟁

참가자 각자가 개인 보드를 풀고, 정답은 같다(단판) 또는 단어 순서가 같다(등반). 시도 횟수·하드·힌트 설정은 모두에게 같다.

참가자의 상태(`CompStatus`)와 전이:

| 상태 | 화면 문구 | 들어가는 사건 |
|---|---|---|
| `playing` | `진행 중`(남의 패널에서는 `풀이 중`, 끊겼으면 `접속 끊김`) | 시작 |
| `solved` | `정답` | 모든 칸이 `c`인 추측이 수락됨(단판, 또는 등반의 12자 스테이지) |
| `failed` | `실패`(등반에서는 `탈락`으로 표시, [U-15](#u-15)) | 정답이 아닌 추측이 수락되어 행 수 ≥ 시도 횟수 |
| `gaveup` | `포기` | 본인이 `giveup` |
| `timeout` | `시간 초과` | 자기 보드 마감 또는 등반 유예 마감에 도달(M-TIME) |
| `eliminated` | `탈락`(스스로 나갔으면 `나감`) | 끊김 60000ms(M-CONN-7), 방장의 강제 탈락, 나가기 |

`playing` 외 상태는 끝난 것이다. 끝난 사람은 되살아나지 않고 더 이상 제출·힌트·포기를 할 수 없다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-COMP-1 | 시작 때 방의 모든 자리가 같은 길이·같은 정답의 빈 개인 보드로 시작한다. 한 사람의 제출은 다른 사람의 보드에 영향이 없고, 같은 단어는 같은 색을 받는다. | `server/mp/comp.ts` `startGame` | t:mp-comp |
| M-COMP-2 | 제출(`guess`)의 평가 순서와 거절: ① 단계가 `playing`이 아니거나 게임이 경쟁이 아니면 `phase`(경쟁이 아니면 `경쟁 게임에서만 쓸 수 있습니다`, 게임 없음 `진행 중인 게임이 없습니다`) ② 이번 게임 참가자가 아니면 `forbidden` `이번 게임 참가자가 아닙니다` ③ 이미 끝났으면 `phase` `이미 끝났습니다` ④ 길이가 보드의 n이 아니거나 자모 24종 밖이면 `invalid` `자모가 부족합니다` ⑤ 사전 조회에 실패했으면 `unavailable` `서버에 연결할 수 없습니다` ⑥ 사전에 없으면 `invalid` `사전에 없는 단어입니다` ⑦ 하드 모드 위반이면 `hard`(C-HARD-6 문구). 거절은 보드를 바꾸지 않는다. | `comp.ts` `applyGuess`, `checkGuess` | t:mp-comp, e:mp-comp |
| M-COMP-3 | 사전 조회는 요청을 받은 시점에 하고, 적용은 그 뒤 동기 구간에서 상태를 다시 검증한다. 조회를 기다리는 사이 포기·탈락 등으로 상태가 바뀌었으면 ③ 이하로 거절된다. | `room.ts` `act` | t:mp-room-d1 |
| M-COMP-4 | 추측이 수락되면 행·판정(C-JUDGE)을 보드에 더한다. 모든 칸이 `c`이면 클리어(`cleared` +1)다. 단판이거나 등반의 12자 스테이지이면 `solved`로 끝나고 기록 시각·시도 수(= 그 보드의 행 수)를 남기고 완료 순서(`finishOrder`)에 추가한다. 등반의 12자 미만이면 M-CLIMB-2. 정답이 아니고 행 수 ≥ 시도 횟수이면 `failed`다. 정답 판정이 시도 횟수 판정보다 먼저다. | `comp.ts` `applyGuess`, `finish` | t:mp-comp |
| M-COMP-5 | 힌트(`hint`): 평가 순서 ① 참가자·풀이 중 확인(M-COMP-2 ①~③과 같다) ② 방의 힌트 설정이 꺼져 있으면 `forbidden` `힌트를 쓸 수 없는 방입니다` ③ 이미 썼으면 `forbidden`(단판 `힌트는 한 판에 한 번입니다`, 등반 `힌트는 등반 전체에서 한 번입니다`) ④ C-HINT로 줄 힌트가 없으면 `forbidden` `힌트를 줄 노란 자모가 없습니다` ⑤ 그 즉시 내 보드에 힌트 칸을 적용한다. 힌트는 1인 1회이고 남에게는 영향이 없다. | `comp.ts` `useHint`, `hintFor`, `climb.ts` `hintUsedMsg` | t:mp-comp, t:mp-climb |
| M-COMP-6 | 포기(`giveup`)는 본인만 할 수 있고 풀이 중일 때만 된다(M-COMP-2 ①~③과 같은 거절). 상태는 `gaveup`이다. 나머지는 계속 진행한다. 확정은 두 번 눌러야 한다. | `comp.ts` `giveUp`, `MpGame.svelte` | t:mp-comp, e:mp-comp |
| M-COMP-7 | 방장 강제 탈락(`eliminate {pid}`): 평가 순서 ① 방장이 아니면 `forbidden` `방장만 탈락시킬 수 있습니다` ② 대상이 방에 없으면 `forbidden` `방에 없는 사람입니다` ③ 대상이 접속 중이면 `forbidden` `접속 중인 사람은 탈락시킬 수 없습니다` ④ 대상이 풀이 중이 아니면 M-COMP-2 ①~③ 거절 ⑤ `eliminated`. 끊긴 지 60000ms가 되기 전에도 할 수 있다. | `comp.ts` `eliminate` | t:mp-comp, e:mp-comp |
| M-COMP-8 | 마감 처리: 풀이 중인 사람마다 `자기 보드 마감`과 `등반 유예 마감` 중 이른 것(timeout 시각)과 끊김 탈락 시각(M-CONN-7)을 비교한다. 끊김 탈락 시각이 timeout 시각보다 **엄격하게 이르면** `eliminated`, 같거나 늦으면 `timeout`이다. 지난 시각에 도달한 사람만 처리하고, 종료 시각은 그 마감 시각이다. | `comp.ts` `earliestEnd`, `expireCompPlayers` | t:mp-timers (두 시각이 정확히 같은 경우는 코드만) |
| M-COMP-9 | 모든 참가자가 풀이 중이 아니게 되는 순간(정답·실패·포기·만료·탈락·나가기 어느 경우든) 순위표를 고정하고 `result`로 넘어간다. 게임 종료 시각을 기록하고 준비를 전원 해제하고 나가기로 떠난 자리를 삭제한다. 남은 사람이 모두 끝나면 등반 유예 마감을 기다리지 않는다. 끊긴 사람 때문에 기다리던 판은 그 사람이 탈락하는 순간 끝난다. | `comp.ts` `settle`, `isOver` | t:mp-comp, t:mp-timers |
| M-COMP-10 | 끝난 사람은 남은 사람의 진행(색만)과 현재 순위(M-RANK-8)를 본다. | `snapshot.ts` | t:mp-snapshot, e:mp-comp |
| M-COMP-11 | 멀티 결과는 솔로 통계에 기록하지 않는다(S-STAT-5). | 없음 | 코드만 |

### M-CLIMB 등반 (경쟁·협동 공통)

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-CLIMB-1 | 등반의 스테이지는 시작 길이 n0에서 12까지 길이가 1씩 늘어 간다(스테이지 번호는 1부터). 시작 때 n0~12 모든 길이의 정답을 읽어 두고, 하나라도 못 읽으면 시작하지 않는다(M-START-2 ③). 12자는 마지막 스테이지다. | `climb.ts` `stageLengths`, `hasAllStages` | t:mp-climb, t:mp-room-d1 |
| M-CLIMB-2 | 12자 미만 스테이지를 클리어하면 서버가 기다리지 않고 **즉시** 다음 스테이지 보드로 바꾼다: 번호 +1, 길이 +1, 행·판정·힌트 칸은 비우고, 클리어 횟수와 "힌트를 썼음"은 이어 가고, 시도 횟수는 설정값 그대로 새로 센다. | `climb.ts` `climbUp` | t:mp-climb |
| M-CLIMB-3 | 방금 클리어한 스테이지의 마지막 모습(`lastClear`: 스테이지, 길이, 행, 판정, 클리어 시각)을 스냅샷에 싣는다. 클라이언트는 그 시각부터 약 2000ms(`STAGE_CLEAR_MS`) 그 보드를 보여 준 뒤 새 스테이지를 그린다. 다음 클리어가 오면 덮어쓰고, 12자 완주에는 새로 만들지 않는다. | `climb.ts`, `protocol.ts` `StageClearView` | t:mp-snapshot, e:mp-comp |
| M-CLIMB-4 | 12자 스테이지를 클리어하면 완주다. 경쟁은 `solved`, 협동은 게임이 `won`/`solved`로 끝난다. | `comp.ts`, `coop.ts` `submit` | t:mp-climb |
| M-CLIMB-5 | 한 스테이지의 시도를 다 쓰면 등반이 끝난다. 경쟁은 그 사람이 `failed`(높이는 클리어 수로 확정), 협동은 게임이 `lost`/`tries`다. | `comp.ts`, `coop.ts` | t:mp-climb |
| M-CLIMB-6 | 멀티 등반의 힌트는 등반 전체에서 한 번이다(경쟁은 사람마다, 협동은 방 전체). 스테이지가 바뀌면 힌트 칸은 비워지지만 "썼음"은 남는다([U-2](#u-2)). | `climb.ts` `climbUp` | t:mp-climb |
| M-CLIMB-7 | 경쟁 등반은 독립 등반이다. 같은 단어 순서를 각자 자기 속도로 오르고 서로 기다리지 않는다. 첫 완주자(12자 클리어)가 나오면 그 시각 + 60000ms(`CLIMB_GRACE_MS`)에 유예 마감(`graceEnd`)이 생긴다. 이미 유예가 열려 있으면 마감을 바꾸지 않는다. | `comp.ts` `applyGuess` | t:mp-climb |
| M-CLIMB-8 | 유예 마감에 도달하면(`now ≥ graceEnd`) 그때까지 풀이 중인 사람은 유예 마감 시각으로 `timeout`이 되어 높이가 확정된다. 개인 마감이 유예보다 이르면 그 마감에 멈춘다. 유예 중 완주하면 완주 순서대로 순위가 정해진다. 유예가 끝난 뒤 도착한 제출은 거절되고 완주로 치지 않는다. 아무도 완주하지 못하고 전원 실패하면 유예 없이 그 시점에 끝난다. | `comp.ts` `expireCompPlayers` | t:mp-climb, t:mp-timers, e:mp-comp |

### M-RANK 순위 (경쟁)

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-RANK-1 | 정답자(`solved`)가 모든 미정답자보다 위다. | `server/mp/rank.ts` `standings` | t:mp-rank |
| M-RANK-2 | 단판의 정답자 순서: 시도 수(그 보드의 행 수)가 적은 쪽, 같으면 완료 시각(ms)이 이른 쪽. 둘 다 같을 때만 공동 순위다. | `rank.ts` `standings` | t:mp-rank |
| M-RANK-3 | 등반의 완주자 순서는 완주를 처리한 순서(`finishOrder`)다. 같은 ms에 끝나도 순서가 갈리고 공동 순위가 없다. | `rank.ts` | t:mp-rank |
| M-RANK-4 | 미정답자(`failed`·`gaveup`·`timeout`·`eliminated`, 끝났든 풀이 중이든)는 상태와 무관하게 지표로만 비교한다. 순서: ① (등반만) 높이 = 클리어한 스테이지 수, 큰 쪽이 위 ② 초록 자리 수 = 현재 스테이지 보드의 모든 행에서 `c`를 받은 서로 다른 자리 수, 큰 쪽 ③ 노랑 자모 종류 수 = 현재 보드의 모든 행에서 `p`를 받은 서로 다른 자모 종류 수, 큰 쪽 ④ 시도 수 = 현재 보드의 행 수, 적은 쪽. 모두 같으면 공동이다. 단판은 ①을 비교하지 않는다([U-14](#u-14)). | `rank.ts` `metrics`, `cmpMetrics` | t:mp-rank |
| M-RANK-5 | 공동 순위: 바로 앞 사람과 비교해 0이면 같은 순위 숫자를 쓰고, 다음 사람은 사람 수만큼 건너뛴다(1, 2, 2, 4). 공동인 사람은 모두 `tied`로 표시한다. 같은 순위 안의 표시 순서는 게임 참가자 목록 순(시작 때의 자리 순)이다. | `rank.ts` `place` | t:mp-rank, e:mp-result |
| M-RANK-6 | 순위표 항목: `pid`, 순위표를 만든 시점의 이름, `rank`, `tied`, 그 시점의 상태, 시도 수(보드 행 수), 완료 순서(`finishOrder`: 정답자끼리 1부터, 공동이어도 1·2·3, 정답이 아니면 없음), 등반이면 높이. 단판 순위표에는 높이가 없다. | `rank.ts`, `protocol.ts` `Standing` | t:mp-rank |
| M-RANK-7 | 결과 단계의 순위표는 판이 끝난 시점에 고정된다. 이후 사람이 나가도 바뀌지 않고 이름·상태·시도·높이는 순위표가 들고 있다. | `comp.ts` `settle` | t:mp-comp |
| M-RANK-8 | 진행 중 잠정 순위: 내 상태가 `playing`이 아니게 되면 진행 중에도 순위표(M-RANK-1~5로 지금 상태를 계산한 것)를 받는다. 풀이 중인 사람은 받지 못한다. | `snapshot.ts` `compView` | t:mp-snapshot |
| M-RANK-9 | 잠정 순위 표시(클라이언트): 서버 순위표 중 끝난 사람(상태 `playing` 아님)끼리만 순위 숫자를 다시 매긴다(공동은 1, 1, 3). 풀이 중인 사람은 숫자 없이 끝난 사람 아래에 서버 순서대로 둔다. | `mp/live-rank.ts` | t:mp-live-rank, e:mp-comp |

### M-VIS 누가 무엇을 보는가

서버는 변경 때마다 사람별로 개인화한 전체 스냅샷을 보낸다. 상태를 복사해 지우는 방식이 아니라 필요한 필드만 골라 만든다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-VIS-1 | 경쟁에서 남의 보드는 `{stage, n, marks, status, cleared}`만 보인다. 추측 자모열(`rows`)·힌트 칸·힌트 사용 여부는 보내지 않는다. | `server/mp/snapshot.ts` `panelOf` | t:mp-snapshot, e:mp-comp |
| M-VIS-2 | 내 보드는 행, 판정, 힌트 칸, 힌트 사용 여부, 마감, 사용한 시도, 끝난 시각, `lastClear`를 모두 본다. | `snapshot.ts` `ownBoardOf` | t:mp-snapshot |
| M-VIS-3 | 경쟁 순위표는 `result`이거나 내가 끝났을 때만 본다(M-RANK-8). | `snapshot.ts` | t:mp-snapshot |
| M-VIS-4 | 정답 단어는 `result`에서만, 도달한 스테이지(등반은 참가자 중 가장 높이 오른 길이, 협동은 공유 보드의 길이)까지만 보낸다. 진행 중에는 먼저 끝난 사람을 포함해 누구에게도 보내지 않는다. | `snapshot.ts` `reachedAnswers` | t:mp-snapshot, t:mp-climb |
| M-VIS-5 | 스냅샷에는 어느 시점에도 `uid`·토큰이 없다. | `snapshot.ts` | t:mp-snapshot |
| M-VIS-6 | 참가자 목록 항목: `pid`, 이름, 접속 여부, 준비 여부, 방장 여부, 이번 게임 참가 여부(`inGame`), 스스로 나갔으면 `left`, 경쟁이면 패널. 시작 가능 여부·대기 인원·시작 불가 사유·끊긴 사람 목록(`host`)은 방장에게만 보낸다. | `snapshot.ts` `personalize` | t:mp-snapshot |
| M-VIS-7 | 결과 중에 들어온 사람은 이번 게임 참가자가 아니다(`inGame:false`). 게임 보드 없이(`me:null`) 순위표와 정답만 받고 대기실로 돌아가면 준비 전 참가자다. | `snapshot.ts` | t:mp-snapshot, t:mp-climb, e:mp-result |
| M-VIS-8 | 협동은 모두가 같은 것을 본다: 공유 보드, 모두의 확정 제안과 초안과 패스한 사람, 투표 단계의 후보(자모열과 제안자), 후보별 득표수, 투표를 마친 사람 목록, 내 표. 누가 어느 후보에 찍었는지는 보내지 않는다. | `snapshot.ts` `stepView` | t:mp-snapshot |

### M-COOP 협동

참가자 전원이 공유 보드 하나를 푼다. 한 행은 **제안 → (선택·투표) → 판정** 순이고, 판정 뒤 제안·초안·투표·패스는 모두 비우고 다음 행의 제안 단계로 돌아간다.

행 단계의 전이:

| 사건 | 이전 | 이후 |
|---|---|---|
| 게임 시작 / 한 행이 판정된 뒤 | 없음 | `propose`(제안·초안·패스 비어 있음) |
| 집계 대상 전원이 제안 또는 패스(M-COOP-9)하고 제안이 1개 이상 | `propose` | 후보가 1개: 즉시 판정. 후보가 2개 이상이고 `pick=roulette`: 서버가 난수로 하나를 골라 즉시 판정. `pick=vote`: `vote` |
| 집계 대상 전원이 패스(제안 0개) | `propose` | `propose` 유지, 패스 모두 해제, `passResetAt` 갱신 |
| 방장 `close`(제안 1개 이상) | `propose` | 위와 같은 분기 |
| 집계 대상 전원 투표 / 방장 `close` / 투표 마감 도달 | `vote` | 표를 집계해 하나를 골라 판정(M-COOP-VOTE-5) |
| 나간 사람 때문에 후보가 1개로 줄음 | `vote` | 선택 없이 그 후보로 즉시 판정 |
| 나간 사람 때문에 후보가 0개로 줄음 | `vote` | `propose`(비어 있음) |
| 판정으로 게임 종료 | 어느 단계든 | 단계 없음(`step: null`) |

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-COOP-1 | 협동의 모든 메시지(`draft`·`propose`·`unpropose`·`pass`·`vote`·`close`·`hint`·`hintvote`·`giveup`)는 `playing` 단계의 협동 게임에서 이번 게임 참가자(자리가 있고 `inGame`이며 나가지 않은 사람)만 보낼 수 있다. 게임이 없으면 `phase` `진행 중인 협동 게임이 없습니다`, 참가자가 아니면 `forbidden` `이번 게임 참가자가 아닙니다`. | `server/mp/coop.ts` `member` | t:mp-coop |
| M-COOP-2 | **집계 대상**은 이번 게임 참가자 중 접속 중이고 나가지 않은 사람이다. 끊긴 사람은 기다리지도 탈락시키지도 않는다. 이미 낸 제안·표는 끊겨도 남는다. | `coop.ts` `countable` | t:mp-coop, t:mp-timers |
| M-COOP-3 | 집계 조건(전원 제안·전원 투표·힌트 투표 과반)은 메시지가 올 때뿐 아니라 접속 끊김·나가기·재접속·소켓 정리로 접속자가 바뀔 때마다 다시 평가한다. 접속 중인 집계 대상이 0명이면 진행하지 않고 기다린다. 같은 상태에서 다시 평가해도 결과가 같다. | `coop.ts` `advance` | t:mp-coop |
| M-COOP-4 | 접속자가 바뀌어 "접속 중 전원이 이미 제안했다"가 참이 되면 그 시점에 진행한다(예: 마지막 미제안자가 끊김, 이미 제안한 사람이 돌아옴). | `coop.ts` `advance`, `room.ts` `gone`, `hello` | t:mp-coop |
| M-COOP-5 | 초안(`draft {jamo}`): 제안 단계에서만(아니면 `phase` `제안 단계가 아닙니다`). 길이가 보드의 n 이하이고 자모 24종만이면 받고(아니면 `invalid` `자모 수가 맞지 않습니다`) 전원에게 보인다. 빈 문자열은 내 초안을 지운다. 같은 내용을 다시 보내면 아무 일도 없다. 초안은 확정 제안을 바꾸지 않는다. | `coop.ts` `draft` | t:mp-coop, e:mp-coop |
| M-COOP-6 | 제안(`propose {jamo}`): 제안 단계에서만(아니면 `phase` `제안 단계가 아닙니다`). 길이·자모·사전·하드 모드 검사는 경쟁 제출(M-COMP-2 ④~⑦)과 같은 순서·같은 문구다(공유 보드의 지난 행 기준). 통과하면 내 제안을 그 단어로 확정하고 내 초안도 그 단어로 한다. 마감 전에는 다시 보내 덮어쓸 수 있다. 같은 단어를 다시 보내면 아무 일도 없다. 제안은 시도 횟수를 쓰지 않는다. | `coop.ts` `propose`, `comp.ts` `checkGuess` | t:mp-coop, e:mp-coop |
| M-COOP-7 | 제안 취소(`unpropose`): 내 확정 제안을 거둔다. 내 초안은 거둔 단어로 남아 남들에게는 다시 입력 중으로 보인다. 평가 순서: 참가자 확인(M-COOP-1) → 투표 단계이면 `phase` `이미 투표가 시작됐습니다` → 확정 제안이 없으면(패스 포함) `forbidden` `제안한 상태가 아닙니다`. 취소한 뒤 다시 제안하거나 패스할 수 있다. 접속 중 전원이 제안하면 곧바로 선택 단계로 넘어가므로 취소는 남이 아직 제안 중일 때만 가능하다. | `coop.ts` `unpropose` | t:mp-coop-vote, e:mp-coop |
| M-COOP-8 | 패스(`pass {on}`): 이번 행만 제안하지 않고 넘어간다. 평가 순서: 참가자 확인 → 제안 단계가 아니면 `phase` `제안 단계가 아닙니다` → 이미 같은 상태면 아무 일도 없다 → `on:false`는 패스를 푼다 → 내 제안이 이미 있으면 `forbidden` `이미 제안해서 패스할 수 없습니다` → 제안이 0개이고 나를 뺀 모든 집계 대상이 이미 패스했으면 `forbidden` `제안이 하나도 없어 패스할 수 없습니다` → 패스한다(내 초안은 지운다). 패스한 뒤 제안하면 패스가 풀린다. 제안을 취소하면 패스할 수 있다. 접속 중인 집계 대상이 나 하나뿐이고 제안이 0개이면 "나를 뺀 모든 집계 대상"이 비어 있어 항상 위 조건에 걸리므로 패스할 수 없고 제안해야 한다. | `coop.ts` `pass` | t:mp-coop-pass-hint, e:mp-coop |
| M-COOP-9 | 제안 단계는 다음 중 하나로 끝난다: ① 집계 대상 전원이 제안했거나 패스했다(제안이 1개 이상일 때). ② 방장이 `close`한다. ③ 위 ①이 참인데 제안이 0개(전원 패스)이면 진행하지 않고 패스를 모두 풀어 다시 받는다(`passResetAt` 갱신, 화면 토스트 `모두 패스해서 다시 제안합니다`). 제안 단계에는 시간 제한이 없다. | `coop.ts` `advanceStep` | t:mp-coop-pass-hint, t:mp-coop |
| M-COOP-10 | 방장의 마감(`close`): 평가 순서 ① 게임이 없으면 `phase` `진행 중인 협동 게임이 없습니다` ② 방장이 아니면 `forbidden` `방장만 마감할 수 있습니다` ③ 제안 단계이고 제안이 0개이면 `forbidden` `제안이 하나도 없습니다`. 제안 단계면 제안 1개 이상으로 마감하고(참가자 수·패스와 무관), 투표 단계면 지금까지의 표로 집계한다. | `coop.ts` `close` | t:mp-coop, t:mp-coop-pass-hint |
| M-COOP-11 | 후보: 같은 자모열의 제안은 후보 하나로 합치고 제안자를 모두 기록한다. 후보 번호는 제안이 제안 기록에 처음 들어온 순서다(덮어쓰기는 자리를 유지하고, 취소했다 다시 제안하면 맨 뒤). | `coop.ts` `mergeProposals` | t:mp-coop |
| M-COOP-12 | 판정(`submit`): 고른 후보를 공유 보드에 더하고 판정(C-JUDGE)한다. 정답이면 클리어(`cleared` +1)다. 단판이거나 12자 스테이지의 클리어는 게임 `won`(사유 `solved`)이고, 등반의 12자 미만은 M-CLIMB-2로 다음 스테이지다(열린 힌트 투표는 `moot`로 접는다). 정답이 아니고 행 수 ≥ 시도 횟수이면 게임 `lost`(사유 `tries`)다. 정답 판정이 시도 횟수 판정보다 먼저다. 직전에 고른 결과(`lastPick`: 후보, 제안자, 고른 번호, 방식 `single`·`vote`·`roulette`, 동률이면 득표수, 시각)를 스냅샷에 남긴다. 클라이언트는 그 시각부터 약 1500ms 돌림판 연출을 보이고, 서버는 그 연출을 기다리지 않고 이미 보드에 반영한다. | `coop.ts` `submit` | t:mp-coop, t:mp-climb, e:mp-coop |
| M-COOP-13 | 협동 게임이 끝나는 경우와 사유: 정답(`won`/`solved`), 시도 소진(`lost`/`tries`), 공유 보드 제한 시간(`lost`/`timeout`), 방장 포기(`lost`/`giveup`). 끝나면 열린 힌트 투표를 `moot`로 접고, 제안 단계를 비우고, `result`로 넘어가고, 준비를 전원 해제하고, 나가기로 떠난 자리를 삭제하고, 그 시점의 참가자 명단(중간에 나간 사람 포함)을 결과에 고정한다. | `coop.ts` `endGame` | t:mp-coop |
| M-COOP-14 | 포기(`giveup`)는 방장만 할 수 있다(`forbidden` `방장만 포기할 수 있습니다`, 게임이 없으면 `phase`). 공유 판 전체가 실패로 끝난다(등반이면 등반 전체). 확정은 두 번 눌러야 한다. | `coop.ts` `giveUp` | t:mp-coop, e:mp-coop |
| M-COOP-15 | 협동 등반은 공유 보드로 스테이지를 이어 가고 실패 또는 12자 완주로 끝난다(M-CLIMB). 스테이지마다 제안·투표 단계가 새로 시작한다. | `coop.ts` | t:mp-climb |
| M-COOP-16 | 협동 방에서 `guess`·`eliminate`는 `phase` `경쟁 게임에서만 쓸 수 있습니다`, 경쟁 게임이 있거나 게임이 없는(대기실) 방에서 협동 전용 메시지(`draft`·`propose`·`unpropose`·`pass`·`vote`·`close`·`hintvote`)는 `phase` `협동 게임에서만 쓸 수 있습니다`로 거절한다. | `reduce.ts` | t:mp-coop |

### M-COOP-VOTE 선택과 투표

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-COOP-VOTE-1 | 선택 방식(`pick`)은 `vote`(투표)와 `roulette`(돌림판)다. 돌림판은 후보가 2개 이상이면 투표 없이 서버가 후보 수로 난수를 뽑아 하나를 즉시 판정한다. 후보가 하나뿐이면 방식과 무관하게 선택 없이 바로 판정한다. | `coop.ts` `closePropose` | t:mp-coop |
| M-COOP-VOTE-2 | 투표 단계에 들어가는 순간 마감 시각 = 진입 시각 + 20000ms(`VOTE_MS`)를 건다. 방 제한 시간 설정과 무관하게 항상 걸린다. | `coop.ts` `closePropose`, `rules.ts` | t:mp-coop-vote |
| M-COOP-VOTE-3 | 투표(`vote {candidate}`)의 평가 순서: ① 참가자 확인(M-COOP-1) ② 투표 단계가 아니면 `phase` `투표 단계가 아닙니다` ③ 없는 후보 번호이면 `invalid` `없는 후보입니다`. 한 사람이 한 표이고 집계 전까지 다른 후보로 바꿀 수 있다. 같은 표를 다시 보내면 아무 일도 없다. | `coop.ts` `vote` | t:mp-coop |
| M-COOP-VOTE-4 | 자기 제안에도 투표할 수 있다. 패스한 사람(제안이 없는 사람)도 모든 후보에 투표할 수 있고 그 표를 기다린다. | `coop.ts` `vote` | t:mp-coop, t:mp-coop-pass-hint |
| M-COOP-VOTE-5 | 투표 단계는 다음 중 하나로 끝난다: ① 접속 중인 집계 대상 전원이 표를 던졌다 ② 방장 `close` ③ `now ≥ 투표 마감 시각`. 끝나면 그 시점의 표를 모두 센다(이미 던지고 끊긴 사람의 표 포함). 최다 득표 후보가 하나이면 그 후보(방식 `vote`), 동률이면 **최다 득표를 같이 한 후보들 중에서만** 서버가 난수로 하나를 고른다(방식 `roulette`, 득표수 기록). 아무도 안 찍었으면 모든 후보가 0표 동률이라 전 후보가 돌림판 대상이다. | `coop.ts` `closeVote` | t:mp-coop, t:mp-coop-vote |
| M-COOP-VOTE-6 | 투표 마감 시각에 접속 중인 집계 대상이 0명이면 집계하지 않고 마감만 그 시각 + 20000ms로 민다(끊김 유예 안에 돌아온 사람이 표도 못 찍고 한 행을 잃지 않게). | `coop.ts` `expireVote` | t:mp-coop-vote |
| M-COOP-VOTE-7 | 방 제한 시간(공유 보드 마감)이 투표 마감보다 먼저거나 같으면 판이 시간 초과로 끝나고 투표는 집계하지 않는다(M-TIME-3). 제한 시간이 켜진 방에서도 투표 마감은 따로 걸린다. | `timers.ts` `tick` | t:mp-coop-vote |
| M-COOP-VOTE-8 | 투표 마감 처리도 어떤 메시지를 처리하기 전에 먼저 일어난다. 같은 시각으로 다시 처리해도 결과가 같다. | `reduce.ts`, `coop.ts` `expireVote` | t:mp-coop-vote |
| M-COOP-VOTE-9 | 투표 중에 나간 사람의 표는 지운다. 후보의 제안자가 모두 나갔으면 그 후보는 사라지고 남은 후보 번호는 당겨지며 표의 번호도 맞춘다(사라진 후보에 던진 표는 버린다). 남은 후보가 0개면 제안 단계로, 1개면 선택 없이 즉시 판정, 2개 이상이면 투표 단계를 유지한다. | `coop.ts` `forfeit` | t:mp-coop, t:mp-coop-vote |
| M-COOP-VOTE-10 | 후보가 줄어 투표 단계를 다시 꾸려도 마감은 처음 그대로다(20000ms로 늘어나지 않는다). 다음 행의 투표 단계는 새 마감을 받는다. | `coop.ts` `forfeit` | t:mp-coop-vote |
| M-COOP-VOTE-11 | 투표 중 화면은 득표수를 실시간으로 보이고 누가 어디에 찍었는지는 보이지 않는다. 남은 시간은 마감 시각까지로 센다. | `snapshot.ts` `stepView` | t:mp-snapshot, e:mp-coop |

### M-CHINT 협동 힌트 투표

경쟁의 힌트(M-COMP-5)는 즉시 적용되지만 협동의 힌트는 투표로 정한다. 힌트 고르기는 C-HINT다.

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-CHINT-1 | 힌트 요청(`hint`)의 평가 순서: ① 참가자 확인(M-COOP-1) ② 힌트 설정이 꺼져 있으면 `forbidden` `힌트를 쓸 수 없는 방입니다` ③ 이미 썼으면 `forbidden`(단판 `힌트는 한 판에 한 번입니다`, 등반 `힌트는 등반 전체에서 한 번입니다`) ④ 이미 열린 투표가 있으면 `forbidden` `이미 힌트 투표가 진행 중입니다` ⑤ 가장 최근 투표가 부결·시간 만료이고 `now < 그 시각 + 10000`이면 `cooldown` `부결된 직후라 잠시 뒤에 다시 요청할 수 있습니다`(정확히 10000ms째는 허용) ⑥ 줄 힌트가 없으면 `forbidden` `힌트를 줄 노란 자모가 없습니다` ⑦ 투표를 연다. 참가자 누구나(방장 아니어도) 제안 단계·투표 단계 어디서든 요청할 수 있고 단계는 그대로다. | `server/mp/coop.ts` `useHint` | t:mp-coop-pass-hint, t:mp-coop |
| M-CHINT-2 | 투표는 열릴 때 요청한 사람이 찬성 1표로 들어가고 마감 시각 = 요청 시각 + 30000ms(`HINT_VOTE_MS`)다. 게임은 멈추지 않는다. `now ≥ 마감`이면 부결(`timeout`)한다. | `coop.ts` `useHint`, `expireHintVote` | t:mp-coop-pass-hint, e:mp-coop |
| M-CHINT-3 | **투표권자**는 지금 접속 중인 집계 대상(M-COOP-2)이다. 득표는 투표권자의 표만 센다(끊긴 사람·나간 사람의 표, 끊긴 요청자의 찬성 포함 안 함). 통과에 필요한 찬성 수는 `⌊투표권자 수 / 2⌋ + 1`이다. | `coop.ts` `hintTally` | t:mp-coop-pass-hint |
| M-CHINT-4 | 판정(투표가 열릴 때, 표가 바뀔 때, 접속자가 바뀔 때마다): 투표권자가 0명이면 기다린다(마감이 부결한다). `찬성 × 2 > 투표권자 수`이면 통과. 아니고 `반대 × 2 ≥ 투표권자 수`이면 부결(`failed`; 남은 표가 모두 찬성이어도 과반이 안 되는 경우). 그 밖에는 열려 있다. 투표하지 않은 사람은 찬성으로 세지 않는다. | `coop.ts` `settleHintVote` | t:mp-coop-pass-hint |
| M-CHINT-5 | 투표권자 수별 기준: 1명 → 통과 1표(요청자 혼자이면 요청 즉시 통과), 2명 → 통과 2표·반대 1표면 부결, 3명 → 통과 2표·반대 2표면 부결, 4명 → 통과 3표·반대 2표면 부결, 5명 → 통과 3표·반대 3표면 부결. | `settleHintVote` | t:mp-coop-pass-hint |
| M-CHINT-6 | 통과하면 **통과한 시점의** 보드에 힌트가 들어간다: C-HINT로 힌트를 다시 계산해 칸을 적용하고, "힌트를 썼음"으로 하고, 쓴 사람을 요청자로 기록한다(`passed`). 그 사이 줄 힌트가 없어졌으면 `moot`로 접고 힌트는 쓴 것이 아니다. | `coop.ts` `settleHintVote` | t:mp-coop-pass-hint |
| M-CHINT-7 | 투표(`hintvote {yes}`)의 평가 순서: ① 참가자 확인 ② 열린 투표가 없으면 `phase` `진행 중인 힌트 투표가 없습니다` ③ 요청한 사람이면 `forbidden` `요청한 사람은 찬성으로 정해져 있습니다` ④ 같은 표면 아무 일도 없고, 다르면 바꾼다(집계 전까지 바꿀 수 있다). | `coop.ts` `hintVote` | t:mp-coop-pass-hint |
| M-CHINT-8 | 투표가 접히는 경우(`moot`): 판이 끝날 때, 등반이 다음 스테이지로 넘어갈 때, 요청자가 나갈 때, 통과했는데 줄 힌트가 없을 때. 같은 스테이지에서 행이 제출되는 것은 접는 이유가 아니다(힌트는 통과 시점의 최신 보드에 들어간다). | `coop.ts` | t:mp-coop-pass-hint |
| M-CHINT-9 | 쿨다운은 부결(`failed`)·시간 만료(`timeout`) 뒤에만 걸린다. 통과·`moot` 뒤에는 걸리지 않는다. 통과한 뒤에는 요청도 투표도 받지 않는다(판당 1회, 등반은 등반 전체에서 1회). | `coop.ts` | t:mp-coop-pass-hint |
| M-CHINT-10 | 열린 투표는 득표수·필요 수·투표권자 수·마감·내 표만 스냅샷에 싣고 누가 찍었는지는 보내지 않는다. 가장 최근에 끝난 투표의 결과(시각·`passed`/`failed`/`timeout`/`moot`)도 싣는다. 투표 중에는 힌트 버튼이 `힌트 투표 중`으로 잠긴다. | `snapshot.ts` `hintVoteView` | t:mp-coop-pass-hint |

### M-CHAT 채팅

| ID | 규칙 | 근거 | 검증 |
|---|---|---|---|
| M-CHAT-1 | 자리가 있고 나가지 않은 사람은 단계와 무관하게(대기실·게임 중·결과, 경쟁 중에도) 방 전원에게 채팅을 보낼 수 있다. 자리가 없거나 나간 사람은 `forbidden` `채팅할 수 없습니다`로 거절되고 기록하지 않는다. | `server/mp/chat.ts` `post` | t:mp-chat |
| M-CHAT-2 | 본문은 이 순서로 다듬는다: ① NFC ② 줄바꿈·탭·`U+2028`·`U+2029`를 공백으로 ③ 제어문자와 보이지 않는 서식 문자(제로폭 공백, 양방향 제어, 소프트 하이픈, 단어 결합자, BOM, 눈에 안 보이는 결합·선택·태그 문자)를 제거(이모지용 ZWJ·ZWNJ·`U+FE0F`는 남긴다) ④ 연달아 오는 결합 문자는 3개까지만 ⑤ 앞뒤 공백 제거. 걷어 낸 뒤 코드포인트가 1 이상 100 이하이고, 공백·ZWJ/ZWNJ·`U+FE0F`·한글 채움 문자·점자 빈칸만 남지 않았을 때만 받는다. 길이는 걷어 낸 뒤에 재므로 보이지 않는 문자로 길이를 채울 수 없다. | `mp/rules.ts` `normalizeChat`, `CHAT_MAX` | t:mp-chat |
| M-CHAT-3 | 본문이 M-CHAT-2에 맞지 않는 메시지는 `잘못된 요청입니다`(M-ROOM-10)로 거절된다. 클라이언트는 규칙에 안 맞는 본문을 보내지 않는다. | `parse.ts`, `client.svelte.ts` `sendChat` | t:mp-chat, t:mp-parse |
| M-CHAT-4 | 속도 제한: 같은 계정(`uid`, 방에 새로 들어와 `pid`가 바뀌어도 같은 계정)이 `now − 이전 받아들인 시각 < 5000`인 메시지를 5개 보낸 상태에서 또 보내면 `cooldown` `채팅을 너무 빨리 보내고 있습니다`로 거절한다. 정확히 5000ms 전의 메시지는 창 밖이다. 거절된 시도는 창에 세지 않는다. 사람마다 따로 센다. | `chat.ts` `post`, `CHAT_WINDOW_MS`, `CHAT_BURST` | t:mp-chat, t:mp-room-socket, e:mp-chat |
| M-CHAT-5 | 받아들인 채팅은 자리가 있고 열린 소켓 전원(보낸 사람 포함)에게 `{type:'chat', msg:{id, pid, name, text, at}}`로 방송한다. `name`은 방의 현재 이름, `at`은 서버 시각이다. 스냅샷에 싣지 않고 거절은 보낸 사람에게만 `error`로 간다. | `chat.ts` `planChat` | t:mp-chat |
| M-CHAT-6 | 서버는 최근 30개(`CHAT_HISTORY`)만 메모리에 두고 저장하지 않는다. 방 상태에 들어가지 않는다. 방이 쉬었다 깨면 기록이 비고 방이 사라지면 지운다. 입장·재접속 직후 오래된 것부터 `chat_history`로 보낸다(비어 있을 수 있다). `id`는 1부터 하나씩 늘어난다. | `chat.ts` `ChatLog` | t:mp-chat, t:mp-room-lifecycle |
| M-CHAT-7 | 클라이언트는 최근 100줄(`CHAT_KEEP`, 시스템 줄 포함)만 메모리에 둔다. 입장·퇴장·방장 변경 줄은 서버가 만들지 않고 클라이언트가 스냅샷 비교로 로컬 시스템 줄로 넣는다. 본문은 텍스트로만 그린다. | `mp/chat-feed.ts` | t:mp-chat, e:mp-chat |
| M-CHAT-8 | 채팅은 방 상태·저장·스냅샷 순번을 바꾸지 않는다. | `room.ts` `act` | t:mp-room-socket |

---

## 규칙 상수 표

값은 코드와 글자 그대로 같아야 한다. 값을 바꾸는 변경은 이 표와 해당 규칙 문장을 함께 고친다.

### 공통·솔로

| 상수 | 값 | 뜻 | 정의 위치 |
|---|---|---|---|
| `MIN_N` | `5` | 단어 길이 하한(자모 수, 포함) | `src/lib/jamo.ts` |
| `MAX_N` | `12` | 단어 길이 상한(포함) | `src/lib/jamo.ts` |
| `DEFAULT_TRIES` | `6` | 솔로 시도 횟수 기본값 | `src/lib/game.svelte.ts` |
| `DAILY_TRIES` | `6` | 데일리 계열 시도 횟수(고정) | `src/lib/game.svelte.ts` |
| `MIN_TRIES` | `4` | 솔로 시도 횟수 설정 하한 | `src/lib/game.svelte.ts` |
| `MAX_TRIES` | `10` | 솔로 시도 횟수 설정 상한 | `src/lib/game.svelte.ts` |
| `DAILY_DEDUP_START` | `'2026-10-04'` | 이 날짜 이상의 데일리부터 같은 (모드, n)에서 정답 반복 방지. 바꾸면 그날 정답이 바뀐다 | `src/lib/server/token.ts` |
| `MP_POOL_T` | `3` | 멀티플레이 정답 풀 임계값 | `src/lib/server/mp/room.ts` |
| `POOL_THRESHOLD` | `{ daily: 3, 'daily-climb': 3, 'climb-length': 3, endless: 1, 'climb-streak': 1 }` | 솔로 모드별 정답 풀 임계값 | `src/lib/server/dict.ts` |

### 멀티플레이 인원·방·이름

| 상수 | 값 | 뜻 | 정의 위치 |
|---|---|---|---|
| `MAX_PLAYERS` | `5` | 방의 자리 수 상한 | `src/lib/mp/rules.ts` |
| `MIN_PLAYERS` | `2` | 시작에 필요한 접속자 수 | `src/lib/mp/rules.ts` |
| `NAME_MIN` | `5` | 닉네임 최소 길이(코드포인트, 포함) | `src/lib/mp/rules.ts` |
| `NAME_MAX` | `12` | 닉네임 최대 길이(포함) | `src/lib/mp/rules.ts` |
| `CODE_ALPHABET` | `'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'` | 방 코드 문자 | `src/lib/mp/rules.ts` |
| `CODE_LENGTH` | `6` | 방 코드 길이 | `src/lib/mp/rules.ts` |
| `CODE_RE` | `/^[A-HJ-NP-Z2-9]{6}$/` | 방 코드 형식 | `src/lib/mp/rules.ts` |
| `LENGTH_MIN` | `5` | 방 설정 길이 하한 | `src/lib/mp/rules.ts` |
| `LENGTH_MAX` | `12` | 방 설정 길이 상한, 등반의 마지막 스테이지 길이 | `src/lib/mp/rules.ts` |
| `TRIES_MIN` | `4` | 방 설정 시도 횟수 하한 | `src/lib/mp/rules.ts` |
| `TRIES_MAX` | `10` | 방 설정 시도 횟수 상한 | `src/lib/mp/rules.ts` |
| `DEFAULT_SETTINGS` | `{ kind: 'comp', game: 'single', length: 6, tries: 6, hard: false, hints: true, timer: false, pick: 'vote' }` | 방 설정 기본값 | `src/lib/mp/rules.ts` |
| `SESSION_TTL_MS` | `86_400_000` | 임시 계정 토큰 유효 시간(24시간, 슬라이딩). 코드는 `24 * 60 * 60 * 1000` | `src/lib/mp/rules.ts` |

### 멀티플레이 시간

| 상수 | 값 | 뜻 | 정의 위치 |
|---|---|---|---|
| `NUDGE_COOLDOWN_MS` | `30_000` | 같은 사람의 재촉 간격 | `src/lib/mp/rules.ts` |
| `HOST_GRACE_MS` | `5_000` | 방장이 끊긴 뒤 승계까지 | `src/lib/mp/rules.ts` |
| `EMPTY_ROOM_MS` | `30_000` | 접속자 0명이 이어지면 방 소멸 | `src/lib/mp/rules.ts` |
| `DISCONNECT_GRACE_MS` | `60_000` | 경쟁 끊김 자동 탈락, 정원이 찼을 때 끊긴 자리 회수 | `src/lib/mp/rules.ts` |
| `IDLE_WARNING_MS` | `60_000` | 무입력 경고(클라이언트) | `src/lib/mp/rules.ts` |
| `HINT_VOTE_MS` | `30_000` | 협동 힌트 투표 제한 | `src/lib/mp/rules.ts` |
| `VOTE_MS` | `20_000` | 협동 후보 투표 제한 | `src/lib/mp/rules.ts` |
| `HINT_VOTE_COOLDOWN_MS` | `10_000` | 부결·만료 뒤 힌트 재요청 대기 | `src/lib/mp/rules.ts` |
| `CLIMB_GRACE_MS` | `60_000` | 경쟁 등반 첫 완주 뒤 유예 | `src/lib/mp/rules.ts` |
| `TIME_LIMIT_MS` | `180_000` | 단판 한 판 전체·등반 1스테이지 제한 | `src/lib/mp/rules.ts` |
| `CLIMB_STEP_MS` | `15_000` | 등반 스테이지마다 줄어드는 제한 | `src/lib/mp/rules.ts` |
| `CLIMB_MIN_LIMIT_MS` | `60_000` | 등반 제한 시간 하한 | `src/lib/mp/rules.ts` |
| `STAGE_CLEAR_MS` | `2_000` | 클리어 연출 시간. 다음 스테이지 제한은 이 뒤부터 센다 | `src/lib/mp/rules.ts` |
| `SOCKET_IDLE_MS` | `45_000` | 자동 응답이 이 시간을 **넘게** 없는 소켓은 정리 | `src/lib/mp/rules.ts` |
| `REAP_CHECK_PLAYING_MS` | `45_000` | 게임 중 소켓 정리 점검 주기 | `src/lib/mp/rules.ts` |
| `REAP_CHECK_IDLE_MS` | `180_000` | 대기실·결과 소켓 정리 점검 주기 | `src/lib/mp/rules.ts` |
| `HEARTBEAT_MS` | `25_000` | 클라이언트 ping 주기 | `src/lib/mp/rules.ts` |
| `LOBBY_FALLBACK_POLL_MS` | `15_000` | 로비 소켓이 끊긴 동안 목록 폴링 주기 | `src/lib/mp/rules.ts` |
| `LOBBY_STALE_MS` | `750_000` | 이 시간을 **넘게** 알림이 없으면 목록에서 제거 | `src/lib/mp/rules.ts` |
| `LOBBY_REFRESH_MS` | `300_000` | 방이 목록에 다시 알리는 주기 | `src/lib/mp/rules.ts` |
| `RETRY_DELAY_MS` | `2_000` | 클라이언트 재접속 두 번째 시도까지 | `src/lib/mp/client.svelte.ts` |
| `RETRY_MIN_MS` | `3_000` | 로비 소켓 재연결 백오프 시작 | `src/lib/mp/lobby-feed.ts` |
| `RETRY_MAX_MS` | `60_000` | 로비 소켓 재연결 백오프 상한 | `src/lib/mp/lobby-feed.ts` |
| `DEAD_MS` | `75_000` | 로비 소켓 pong 무응답 한도(`HEARTBEAT_MS × 3`) | `src/lib/mp/lobby-feed.ts` |

### 멀티플레이 채팅·형식·목록

| 상수 | 값 | 뜻 | 정의 위치 |
|---|---|---|---|
| `CHAT_MAX` | `100` | 채팅 본문 최대 길이(코드포인트) | `src/lib/mp/rules.ts` |
| `CHAT_HISTORY` | `30` | 서버 메모리에 남기는 최근 채팅 수 | `src/lib/mp/rules.ts` |
| `CHAT_KEEP` | `100` | 클라이언트가 들고 있는 채팅 줄 수 | `src/lib/mp/rules.ts` |
| `CHAT_WINDOW_MS` | `5_000` | 채팅 속도 제한 창 | `src/lib/mp/rules.ts` |
| `CHAT_BURST` | `5` | 창 안에서 받아들이는 채팅 수 | `src/lib/mp/rules.ts` |
| `LOBBY_WS_PATH` | `'/ws-lobby'` | 로비 목록 구독 소켓 경로 | `src/lib/mp/rules.ts` |
| `LOBBY_LIST_MAX` | `50` | 목록에 내는 방 수 상한 | `src/lib/mp/rules.ts` |
| `MAX_RAW_LENGTH` | `4096` | 파싱하는 클라이언트 메시지 원문 길이 상한(이 길이 이하만) | `src/lib/server/mp/parse.ts` |
| `PREFIX` | `'mp1'` | 임시 계정 토큰 접두어 | `src/lib/server/mp/session.ts` |
| `SIG_LEN` | `32` | 임시 계정 토큰 서명 길이 | `src/lib/server/mp/session.ts` |

---

## 미결·모순

아래는 현재 코드의 동작이 **규칙으로서 모순이거나 비어 있거나 이상해 보이는** 곳이다. 본문에는 현재 코드 동작을 썼다. 어느 쪽이 정답인지는 정하지 않았고, 결정은 사용자가 한다. 각 항목은 충돌하는 규칙 ID를 적는다.

| ID | 현재 코드 동작 | 왜 문제인가 | 관련 규칙 |
|---|---|---|---|
| <a id="u-1"></a>U-1 | 시도 횟수 설정은 진행 중인 판에도 즉시 적용되고, 판의 끝은 "추측을 하나 수락한 뒤 행 수 ≥ 시도 횟수"로만 정한다. 이미 4행이 있는데 한도를 4로 낮추면 다음 추측까지 받은 뒤에 끝난다. 저장된 `settings.maxTries`는 읽을 때 범위 검사를 하지 않아 손으로 고친 값(예: 99)이 그대로 쓰인다(`setTries`만 4~10으로 자른다). | 설정 범위(4~10)가 쓰는 쪽에서 지켜지지 않는다. 판 도중 변경의 의미가 규칙으로 정해져 있지 않다. | S-TRY-1, S-TRY-2 |
| <a id="u-2"></a>U-2 | 힌트 횟수의 단위가 다르다. 솔로 등반은 스테이지마다 한 번이고, 멀티 등반은 등반 전체에서 한 번이다. | 같은 "등반 힌트"의 값이 모드에 따라 다르다. 의도인지 확인이 필요하다. | S-HINT-1, S-CLIMB-9, M-CLIMB-6 |
| <a id="u-3"></a>U-3 | 솔로 서버는 진행 상태를 모르므로 힌트 횟수(판당 1회)와 `reveal`(토큰만 있으면 승패와 무관하게 정답을 줌)을 서버가 강제하지 않는다. `/api/hint`는 정답에 든 자모이기만 하면 노란 칸을 받았는지와 무관하게 위치를 준다. | S-HINT-1·S-GIVE의 규칙이 클라이언트에서만 지켜진다. 코드 주석은 "개인 게임이라 치팅 방어보다 단순한 쪽을 택했다"고 한다. | S-HINT-1, S-HINT-4, S-API-4 |
| <a id="u-4"></a>U-4 | 정답 확인(`reveal`)이 실패하면 판은 `lost`가 되지만 통계·데일리 저장·정답 공개는 이뤄지지 않는다. 데일리를 새로고침하면 마지막으로 저장된 `playing` 상태(마지막 추측 이전)가 복원되어 같은 판을 다시 풀 수 있다. | 졌는데 통계에 안 남고, 데일리는 마지막 시도를 되돌려 받을 수 있다. | S-GIVE-3, S-STAT-2, S-DAILY-9 |
| <a id="u-5"></a>U-5 | `/api/game`은 서버의 오늘 이하의 날짜면 얼마나 오래됐든 받는다(`DAILY_DEDUP_START` 이전도). 화면은 항상 페이지를 연 날짜만 보낸다. | "지난 날짜 허용 범위"가 정의돼 있지 않아 API만으로 임의의 과거 데일리를 풀 수 있다. | S-DAILY-5 |
| <a id="u-6"></a>U-6 | 닉네임은 길이(코드포인트 5~12)와 앞뒤 공백만 검사한다. 제어문자·보이지 않는 서식 문자·결합 문자 연속 등은 거르지 않는다. 채팅 본문에는 같은 종류의 걸러내기가 있다. | 보이지 않는 글자만으로 이름이 되거나, 표시 순서를 뒤집는 문자가 이름에 들어갈 수 있다. 채팅과 기준이 다르다. | M-ID-1, M-CHAT-2 |
| <a id="u-7"></a>U-7 | 서버는 끊긴 사람이 있어도 방장이 `kickDisconnected` 없이 시작하는 것을 받아들이고, 그 사람들은 참가자로 게임에 들어간다. 방장 화면은 끊긴 사람이 있으면 항상 "내보내고 시작"만 보이고 `kickDisconnected:true`로 보낸다. | 서버 규칙(시작을 막지 않는다)과 화면 규칙(끊긴 사람은 항상 내보낸다)이 다르다. | M-START-1, M-START-5 |
| <a id="u-8"></a>U-8 | 목록의 인원수·`가득` 태그는 접속자 수 기준이고, 서버의 정원 판정은 자리 수(끊긴 자리 포함, 끊긴 지 60000ms 이상이면 회수) 기준이다. 접속자 4명 + 끊긴 지 60초 안의 1명이면 목록은 `대기 중`(4/5)인데 입장하면 4001로 거절된다. | 같은 "가득"이 두 곳에서 다르게 정의된다. | M-LIFE-5, M-LIFE-9, M-ROOM-7 |
| <a id="u-9"></a>U-9 | 끊김은 두 시계로 정해진다. 서버가 반쯤 끊긴 소켓을 정리하는 시점(마지막 응답 + 45000ms 초과, 점검 주기는 게임 중 45000ms·대기실 180000ms)과 끊김 유예(60000ms)다. 침묵한 클라이언트는 정리될 때 비로소 끊긴 것이 되므로, 경쟁 탈락은 최대 약 45000 + 45000 + 60000ms(게임 중) 뒤에, 대기실·결과의 방장 승계와 목록 인원은 최대 약 180000 + 45000ms 뒤에 일어난다. | "끊긴 지 60초"라는 규칙이 사용자가 체감하는 시간과 맞지 않을 수 있다. 값 자체가 규칙인지 결과일 뿐인지 정해져 있지 않다. | M-CONN-4, M-CONN-5, M-CONN-7, M-CONN-11 |
| <a id="u-10"></a>U-10 | 등반 제한 시간의 하한 60000ms(`CLIMB_MIN_LIMIT_MS`)는 스테이지가 최대 8개(5자~12자)라 180000 − 15000 × 7 = 75000ms가 가장 짧아 닿지 않는다. | 하한 규칙이 실제로는 적용되지 않는다. | M-TIME-1, M-TIME-6 |
| <a id="u-11"></a>U-11 | 강퇴가 없다. 방장이 접속한 채 아무것도 하지 않으면 시스템이 바꾸지 않는다(대기실에서 재촉 외에 수단이 없다). 제한 시간을 끈 협동 방에서는 방장만 포기할 수 있어 방장이 잠수하면 게임을 끝낼 수 없다(투표 단계만 20000ms 자동 마감). | 정해지지 않은 것이다(`MULTIPLAYER.md` §9 "강퇴 방식 미확정"). | M-HOST-4, M-COOP-14 |
| <a id="u-12"></a>U-12 | 서버는 방장의 설정 변경을 `playing`이 아니면(결과 단계 포함) 받아들인다. 화면의 설정 창은 대기실에서만 연다. 결과 단계에서 방 설정이 바뀌어도 이미 끝난 게임에 고정된 설정은 그대로이고, 로비 목록의 요약은 바뀐 방 설정을 따른다. | 결과 단계의 설정 변경이 규칙으로 정해져 있지 않다. | M-SET-3, M-PHASE-1 |
| <a id="u-13"></a>U-13 | 경쟁은 게임 중 전원이 나가기로 떠나면 즉시(자리가 치워져) 사라지지만, 협동은 나간 자리를 게임이 끝날 때까지 치우지 않아 접속자 0 30000ms 뒤에 사라진다. | 같은 "전원 나가기"가 종류에 따라 즉시와 30초로 다르다. | M-LIFE-1, M-LIFE-2, M-LEAVE-8 |
| <a id="u-14"></a>U-14 | 경쟁 순위에서 실패·포기·시간 초과·탈락은 모두 같은 미정답자로 보고 지표(높이·초록·노랑·시도)만 비교한다. 포기하거나 끊겨 탈락한 사람이 시도를 다 쓰고 실패한 사람보다 위일 수 있다. | 상태가 순위에 영향을 주지 않는 것이 의도인지 확인이 필요하다. | M-RANK-4 |
| <a id="u-15"></a>U-15 | 등반에서 `failed`(스테이지 실패)와 `eliminated`(탈락)가 둘 다 `탈락`으로 표시된다. 스스로 나간 사람만 `나감`이 따로 보인다. | 화면만으로 실패와 끊김·강제 탈락을 구분할 수 없다. | M-COMP 상태 표 |
| <a id="u-16"></a>U-16 | 서버는 결과 단계에서도 `ready`를 받아들이지만 다음 대기실로 돌아갈 때 전원 해제된다. | 결과 단계의 준비 토글이 아무 효과 없이 받아들여진다. | M-READY-1, M-READY-2 |
| <a id="u-17"></a>U-17 | 재촉은 방장이 끊겨 있어도(방장 자리는 있고 소켓만 없음) 받아들여지고 보낸 사람의 쿨다운이 소모된다. 알림을 받을 소켓이 없으면 그 재촉은 아무에게도 가지 않는다. | 받는 사람이 없는 재촉이 성공으로 처리된다. | M-READY-3 |
| <a id="u-18"></a>U-18 | 저장된 `config`는 모드와 길이의 모양만 검사하고 `fixed`의 `n`이 5~12인지는 보지 않는다. 손으로 고친 범위 밖 값이면 첫 판 요청이 400 `n must be 5..12`로 실패해 `게임을 불러오지 못했습니다.`만 남고, 모드 선택 창에서 새로 시작해야 풀린다. | 저장값 검사가 길이 범위(C-LEN-1)를 지키지 않는다. | S-MODE-3, S-FAIL-1, C-LEN-1 |
