# n자 꼬들

한국어 단어를 **자모로 풀어쓴 열**을 맞히는 워들. [원작 꼬들](https://kordle.kr)의 6자 규칙을 5~12자로 확장하고, 게임 모드와 사전을 넓혔다.

- 자모 수 **5~12** 직접 선택 또는 랜덤
- 게임 모드 4종: **하루 1개** · **랜덤 무한** · **등반 · 연속 클리어** · **등반 · 길이 상승**(5자부터 12자까지)
- 판정 사전 120만 표제어(표준국어대사전 · 한국어기초사전 · 우리말샘 · 위키백과 띄어 쓴 제목), 정답 풀은 익숙한 명사만
- 힌트(노란 자모의 실제 위치), 포기, 등반 결과 피라미드, 물리 키보드(두벌식 자리, 한/영 무관)

## 자모 규칙

게임이 세는 자모는 **24종**(자음 14 + 모음 10)이다.

| 원칙 | 예 |
|---|---|
| 쌍자음·겹받침은 자모 둘 | 까 = ㄱㄱㅏ, 닭 = ㄷㅏㄹㄱ |
| 합성 모음은 기본 모음으로 | 개 = ㄱㅏㅣ, 왜 = ㅇㅗㅏㅣ |
| ㅑㅕㅛㅠ는 한 자모 | 여 = ㅇㅕ |

## 실행

### Docker Compose (배포)

```bash
cp .env.example .env            # KORDLE_SECRET을 임의 값으로 (openssl rand -base64 32)
# kordle.db를 준비한다 — 아래 "사전 만들기"
docker compose up -d --build     # http://localhost:3000
```

`kordle.db`는 이미지에 넣지 않고 볼륨으로 마운트한다. 사전을 다시 만들면 `docker compose restart`만 하면 된다.

### 시놀로지 NAS에 배포

`main`에 push되면 GitHub Actions가 이미지를 `ghcr.io/bateaux-st/enhanced-kordle:latest`로 올린다(`.github/workflows/image.yml`). NAS는 빌드하지 않고 이 이미지를 받는다.

1. **이미지 확인** — 레포가 공개라 이미지도 공개로 올라간다(`docker manifest inspect ghcr.io/bateaux-st/enhanced-kordle:latest`가 로그인 없이 된다). 레포를 비공개로 바꾸면 NAS에서 `docker login ghcr.io`가 필요하다.
2. **폴더 준비** — File Station에서 `docker/kordle` 폴더를 만들고 세 파일을 넣는다:
   - `compose.yaml` ← [`deploy/nas/compose.yaml`](deploy/nas/compose.yaml)
   - `.env` ← `KORDLE_SECRET=<임의의 긴 문자열>` 한 줄 (`openssl rand -base64 32`)
   - `kordle.db` ← [Releases](../../releases)의 `kordle.db.gz`를 받아 풀기. SSH라면:
     ```bash
     cd /volume1/docker/kordle
     wget https://github.com/bateaux-st/enhanced-kordle/releases/latest/download/kordle.db.gz
     gunzip kordle.db.gz
     ```
3. **Container Manager → 프로젝트 → 생성** — 이름 `kordle`, 경로 `/docker/kordle`, "기존 docker-compose.yml 사용" 선택 → 실행. `http://<NAS IP>:3000`에서 확인.
4. **외부 노출** — 제어판 → 외부 액세스 → DDNS에서 `xxx.synology.me` 등록 → 로그인 포털 → 고급 → 리버스 프록시: 소스 `kordle.xxx.synology.me:443`(HTTPS) → 대상 `localhost:3000`. 보안 → 인증서에서 Let's Encrypt 발급 후 그 도메인에 지정. 공유기에서 443을 NAS로 포워딩.

**업데이트**: 코드가 바뀌면 Container Manager → 프로젝트 → `kordle` → 작업 → 빌드(이미지 pull) 후 재시작. 사전만 바뀌면 `kordle.db`를 교체하고 컨테이너 재시작.

### 로컬 개발

```bash
pnpm install
pnpm dev                          # http://localhost:5173
```

Node 22.13 이상이 필요하다 (내장 `node:sqlite`를 쓴다. 네이티브 모듈 없음).

| 환경변수 | 기본값 | 뜻 |
|---|---|---|
| `KORDLE_SECRET` | `dev-only-secret` | 정답 토큰 서명 키. 바꾸면 진행 중 게임이 전부 무효가 된다 |
| `KORDLE_DB` | `kordle.db` | 사전 DB 경로 |
| `PORT` | `3000` | 서버 포트 |

## 사전 만들기

`kordle.db`(약 210MB)는 저장소에 없다. 원본 네 종을 받아 `build_dict.py`로 만든다.

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

### 정답 풀

판정은 전체 사전(방언·북한어 제외)으로 넓게, 정답은 좁게 고른다. 정답 후보는 표준국어대사전 명사에 **익숙함 점수**(`familiar`)를 매겨 임계값 이상만 쓴다.

| 신호 | 점수 |
|---|---|
| 한국어기초사전 등급 | 초급 +4 · 중급 +3 · 고급 +2 |
| 위키백과에 3KB 이상 문서 | +2 |
| 표준국어대사전 뜻 4개 이상 | +1 |
| 전문 분야 표시 | −1 |
| 인명 · 지명 · 책명 | 제외 |

하루 1개 · 등반 길이 상승은 `≥3`(약 1.2만), 랜덤 무한 · 등반 연속 클리어는 `≥2`(약 2.5만). 임계값은 `src/lib/server/dict.ts`의 `POOL_THRESHOLD`, 가중치는 `build_dict.py`의 `Entry.familiar()`.

## 구조

```
build_dict.py            사전 빌드 (자모 분해 · 4소스 병합 · familiar 점수)
src/lib/server/dict.ts   사전 조회 · 정답 풀
src/lib/server/token.ts  정답을 (n, 임계값, idx)로 HMAC 서명 — 서버는 무상태
src/lib/server/judge.ts  워들 판정
src/routes/api/          game · guess · check · hint · reveal
src/lib/game.svelte.ts   클라이언트 상태 (진행·통계·설정은 localStorage)
```

## 데이터 출처

- 표준국어대사전 · 한국어기초사전 · 우리말샘 — 국립국어원, [CC BY-SA 2.0 KR](https://creativecommons.org/licenses/by-sa/2.0/kr/)
- 한국어 위키백과 — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- UI는 [꼬들](https://kordle.kr)을 따랐다.
