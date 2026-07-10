# 작업 현황 · 인수인계

> 2026-07-10 기준. **세션이 끊겨도 이 문서만 읽고 이어갈 수 있게** 쓴다.
> 상세한 결함 목록·근거는 [hardening-backlog.md](hardening-backlog.md), 아키텍처는 [architecture/](architecture/README.md).

---

## 0. 30초 요약

전체 검수(분야별 에이전트 5종 + Codex) → 발견 → 수정 → Codex 재검수를 반복했다.
테스트 **52건 → 276건**, `npm audit` **5건(critical 1·high 1) → 0건**.

- `main`: 프로덕션. **`dev`가 48커밋 앞서 있다. 아직 배포 안 함.**
- `dev`: 미병합 브랜치 **없음**. MEDIUM 이상 데이터 정합 항목을 전부 해결했다 —
  B-3(저장소 손상) · B-5(거래별 요율) · B-4(주 경계 KST) · B-7(결정적 행 id) · B-6(백업 검증) · B-2b(아이템 병합).
  전 항목 Codex PASS. 테스트 276건 · 빌드 통과 · `npm audit` 0건.

**배포하려면 §5의 세 가지를 먼저 해야 한다.**

---

## 1. 브랜치 상태

```
main ──────────────── (프로덕션, https://maplemvpcalculator.com)
  └─ dev (34 commits ahead)          worktree: C:\Users\82108\Documents\Claude\Projects\MVP작
       ├─ cb7c203  merge: 전체 검수
       ├─ 37fd1bc  merge: tombstone + 낙관적 동시성 제어
       ├─ 4dd6ec3  merge: 저장소 손상 방어 (B-3)
       ├─ fedf954  merge: 거래별 요율 스냅샷 + 발효일 규칙 이력 (B-5)
       ├─ e8dabe0  merge: 주 경계·'오늘'을 KST 로 고정 (B-4)
       ├─ ...      merge: 구버전 원장 행에 결정적 id (B-7)
       ├─ ...      merge: 백업 파일 검증 + 전부-아니면-전무 복원 (B-6)
       └─ ...      merge: 자주 쓰는 아이템도 진짜 병합 (B-2b)
```

`dev`는 다른 워크트리에 체크아웃돼 있어 이쪽(`C:\Users\82108\orca\workspaces\MVP작\dev`)에서
`git checkout dev` 가 안 된다. 병합은 `git -C "C:/Users/82108/Documents/Claude/Projects/MVP작" merge --no-ff <branch>`.
⚠️ **`git checkout dev -- .` 을 쓰지 말 것** — 브랜치 전환이 아니라 dev 의 파일 내용을 현재 워크트리에 덮어쓴다.
새 작업은 `git checkout -b <feature> dev` 로 딴다.

**다음 액션**: §4 백로그에서 고를 것. 미병합 브랜치는 없다.

---

## 2. 해결한 것 (요약)

### 공개 서비스·수익화 준비
- `public/privacy.html` · `terms.html` — 코드에서 확정한 실제 수집 항목 기반. 위탁·국외이전 명시.
- `public/robots.txt` · `sitemap.xml`, 넥슨 무관 고지(푸터+양 페이지), canonical/og 절대 URL.

### 보안
- **`feedback` rate limit** — RLS는 "누가"만 통제하고 "얼마나 자주"는 통제하지 않았다.
  DB 트리거로 출처당 10분/5건 + 위조 불가능한 전역 익명 백스톱 100건/10분.
  `x-forwarded-for`는 신뢰 프록시가 **뒤에 덧붙이므로 마지막 항목**을 읽는다(첫 항목은 공격자가 심은 값).
- `security definer` 함수의 `search_path` 축소, dev 의존성 취약점 0건.

### 데이터 정합 (가장 중요)
- **계정 간 원장 유입(CRITICAL)** — 로그아웃이 로컬을 안 지우고 병합이 소유자를 무시해,
  공용 브라우저에서 A의 거래가 B 계정으로 영구 유입됐다. `mvpDataOwnerUid` 마커로 병합 게이팅.
- **삭제 전파(tombstone)** — `ledger.deleted = { 항목id: 삭제시각 }`. 삭제 우선 병합.
- **낙관적 동시성 제어** — 서버 `updated_at`을 버전으로 쓰는 조건부 쓰기.
  무조건 upsert였을 때 stale 탭이 남의 거래와 삭제 표식을 통째로 덮어썼다.
- **업로드 유실·무재시도** — 플러시 부채를 payload 캡처 시점에 털고, 지수 백오프 + `online` 재시도.
- **손상된 localStorage 원본 파괴(B-3)** — 파싱 실패 시 백업 후에만 덮어쓰고, 백업 못하면 안 쓴다.

### 도메인
- **예측 '이번 주 포함' 오답** — 이번 주 실제 과금이 계획값으로 대체돼 사라졌다.
  체크박스를 켤수록 도달이 늦어지는 역설(골드 9주후 → 무등급 12주후). 지평도 14주→13주.
- 게임 규칙(수수료·마일리지 적립률·등급 기준) 하드코딩 → `app_config.rules`(순수 함수엔 인자 주입).

### 구조·접근성
- LogTab 718줄 → 85줄 조립부 + 패널 4개. 분할 전후 SSR 마크업 13,506B 동일 확인.
- 모달 Esc·포커스 트랩, `CSelect` 키보드 조작, Error Boundary.

---

## 3. 최근에 끝낸 것 (B-5 · B-4 · B-7 · B-6 · B-2b)

### B-5 — 과거 거래에 현재 설정을 소급 적용

근본 원인의 절반은 **넥슨 규칙을 사용자 설정으로 모델링한 것**이었다. `mileageRate`(마일리지 결제 비율)가
계산기에서 편집 가능해서, 바꾸면 13주 누적 과금(`cum`)이 재계산되고 **표시 등급까지 흔들렸다**
(실측 41,300 → 47,200원). `app_config.rules` 로 옮겨 편집 불가로 만드니 증상이 통째로 사라졌다.

나머지는 요율 성격별로:
- **게임 규칙**(수수료·마일리지 비율) — `rules` 가 발효일 배열 `[{effectiveFrom, ...}]` 을 받는다.
  거래 날짜에 유효한 규칙을 고른다(`resolveRuleHistory`/`rulesAt`). **규칙 값을 고치지 말고 이력을 추가할 것.**
  가장 이른 항목은 *이미 발효했을 때만* EPOCH 로 내려간다(미래 발효 규칙은 소급되지 않는다).
- **사용자 상태**(등급→수수료, 충전 방식→할인) — 거래 행에 스냅샷(`sells._fee`, `buys._effD`).
  `cashes.rate` 폴백과 같은 패턴. 병합에서 잃지 않는다(`keepSnapshots`).
- **구 데이터** — 과거 요율이 어디에도 없어 복원 불가. 현재 설정 폴백 + 통계 화면에 '추정치' 명시(`hasLegacyRows`).

Codex 재검수에서 나온 것들(모두 반영): malformed 스냅샷이 '수수료 0%'로 새던 문제(`hasSnapshot`),
malformed 값이 **유효한 스냅샷을 덮어쓰던** 병합 결함, 미래 발효 규칙이 지금·과거에 소급되던 결함,
`rules` 를 state 로 굳혀 자정 경계를 못 넘던 문제(`useToday` 파생으로 전환).

### B-4 — 주 경계가 브라우저 로컬 타임존 기준

`weekStartThu(dt, tz)` 로 고치지 **않았다**. 주차 함수들은 민간 날짜(Y/M/D) 연산이라 시간대를 몰라도 되고,
해석이 필요한 건 '지금이 며칠인가' 하나뿐이다. 진입점을 `src/lib/tz.js` 로 모았다 —
`tzDateStr` / `dateOf`(정오 고정) / **`nowD()`**. 주차·달력 계산부의 `new Date()` 를 전부 `nowD()` 로 바꿨다.
새 코드에서 주차·달력에 `new Date()` 를 직접 쓰지 말 것.

---

### B-7 — 구버전 원장 행의 id 재발급 → 동기화 후 중복

로드할 때마다 랜덤 `uid()` 를 붙여, 같은 백업을 연 두 기기가 같은 거래를 두 건으로 만들었다.
내용에서 유도한 결정적 id(`legacyRowId`)를 준다. **내용만 해시하면 안 된다** — "같은 날 같은 값에 두 번 산 것"이
하나로 합쳐진다(중복보다 나쁜 소실). 같은 내용의 등장 순번을 함께 넣는다.
정규화 순서가 계약이다: **날짜 zero-pad → 파생값(won→rate) → id 부여**(`canonicalizeRows`). `mergeLedger` 도 이걸 쓴다
(예전엔 id 없는 클라우드 행을 조용히 버렸다).

### B-6 — 백업 파일 검증

`data.app` 문자열 하나만 보고 그대로 썼다. 크래시는 없었지만 형태가 깨진 값은 다음 로드에서 조용히 기본값이 됐다.
`validateBackup` 이 **거절(아무것도 안 씀)** 과 **경고(복원하되 알림)** 를 구분한다.
복원은 **전부 아니면 전무** — 쓰기 전에 원본을 잡아 두고 실패 시 되돌린다. 원본을 못 읽으면 아예 쓰지 않는다.

### B-2b — 자주 쓰는 아이템도 진짜 병합

아이템에 결정적 id, 삭제 표식은 `ledger.deleted` 의 `item:<id>` 네임스페이스에.
`at`(목록에 들어온 시각)으로 '지웠다가 다시 추가'를 표현한다(표식보다 나중이면 살아남는다).
`[]` = 사용자가 비운 목록, `null` = 데이터 없음. **충돌 병합 결과는 `applyMergedSnapshot` 한 곳에서 전부 반영한다** —
하나라도 빠뜨리면 다음 업로드가 stale 값으로 서버를 덮는다.

---

## 4. 남은 백로그 (우선순위)

상세는 [hardening-backlog.md](hardening-backlog.md).

| ID | 내용 | 심각도 | 비고 |
|---|---|---|---|
| **B-9** | feedback rate limit의 IP 버킷은 best-effort | MEDIUM | **프로덕션 관찰 필요** — 배포 후 `anon:__all__` 카운터를 보고 판단 |
| B-8 잔여 | `visibilitychange` 플러시가 평범한 `fetch`(탭 종료 시 취소) | LOW | `sendBeacon`/`keepalive` |
| B-8 잔여 | `IconView`가 임의 http(s) 호스트 이미지 로드 | LOW | allowlist 미완 |
| B-8 잔여 | 에러 트래킹 부재 | LOW | `ErrorBoundary.componentDidCatch`에 전송 지점만 있음 |
| B-8 잔여 | `manW`만 `isFinite` 가드 없음, `won(-0.4)` → `"-0원"` | LOW | |
| B-8 잔여 | `computeFeePct` 조건이 `CalcTab.feeBenefit`에 재구현 | LOW | 진실 원천 이중화 |
| B-8 잔여 | `ui.jsx`(576줄) 분할 + `usePopover` 추출(5곳 복붙) | LOW | 구조 |
| B-8 잔여 | 커스텀 위젯 키보드 조작(`ItemCombo`/`DateInput`/`WeekPicker`/`YMPicker`/달력 셀) | LOW | a11y |

### 오탐으로 판단해 고치지 않은 것 (다시 제기되면 이 근거를 보라)

- **`allocateCharge`의 `C=0` 폴백이 불연속이라는 지적** — 아니다. `C→0+`이면 전액이 최고 할인 방식
  한도 안에 들어가 `dRate → topRate`로 **연속 수렴**한다. 폴백값이 바로 그 극한이다.
- **`divisor`(격주 6, 월간 3)가 `SPLITS`와 불일치라는 지적** — 아니다. 이 값은 "13주 롤링 창에
  최소 몇 번의 과금이 들어가는가"이므로 창 유지에 필요한 회당 금액의 분모로는 올바르다.
- **"등급을 올리면 과거 손익이 뛴다"** — 실측 결과 손익은 0원 변동. 판매 실수령 메소만 바뀐다.

---

## 5. 배포 전 반드시 해야 할 것 (사람이 해야 함)

1. **`PRIVACY_CONTACT_EMAIL` 치환** — `public/privacy.html`, `public/terms.html`.
   개인정보 보호책임자 연락처는 법상 필수. 개인 이메일 공개 여부는 사용자 결정이라 플레이스홀더로 뒀다.
2. **`supabase/schema.sql`을 Supabase 대시보드에서 적용** — rate limit 트리거와 `app_config.rules`는
   적용해야 반영된다. **프로덕션 DB에는 아무것도 쓰지 않았다**(CLAUDE.md 금지사항).
3. **광고 도입 시 CSP 개방** — `public/_headers`의 `script-src 'self'`가 애드센스를 전부 차단한다.
   광고 종류가 정해지면 해당 도메인만 추가할 것.

---

## 6. 검증 방법 (이 프로젝트 특유)

### 기본
```bash
npm test          # 144건
npm run build     # PWA precache 생성까지 확인
npm audit         # 0건이어야 함
```

### PostgreSQL 실측 (SQL/RLS를 바꿨다면 필수)

사용자 클러스터(PostgreSQL 18, 포트 5432)는 비밀번호가 필요하고 **건드리지 않는다.**
스크래치패드에 **일회용 클러스터**를 띄워 검증했다. 재현 방법:

```bash
export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"
PGDATA="<scratchpad>/pgdata"
initdb -D "$PGDATA" -U postgres -A trust -E UTF8     # 비밀번호 없음
pg_ctl -D "$PGDATA" -o "-p 55432" -l "<scratchpad>/pg.log" start
# auth.uid()/auth.role()/anon/authenticated 를 스텁으로 만든 뒤 schema.sql 적용
pg_ctl -D "$PGDATA" stop -m fast                      # 끝나면 반드시 정리
```

이 방식으로 실측 확인한 것: 트리거의 `updated_at` 증가, stale 조건부 UPDATE 0행,
ISO 문자열 왕복 일치, 중복 INSERT 23505, RLS 교차계정 거부, JSONB ms 정밀도 보존,
rate limit의 per-IP 5건 / XFF 위조 우회 차단 / 전역 백스톱 100건.

### 뮤테이션 검증 (데이터 손실 방어 코드에는 반드시)

**테스트가 통과하는 것과 테스트가 결함을 잡는 것은 다르다.**
B-3 작업 중 처음 쓴 속성 테스트는 가드를 통째로 제거해도 초록불이었다
(LCG 하위 비트의 주기가 짧아 위험 분기가 실행되지 않았다).
방어 코드를 일부러 부수고 테스트가 잡는지 확인할 것.

**타임존(B-4)도 같은 함정이다.** 개발 기계가 KST 라 로컬 기준 코드와 KST 기준 코드가 같은 답을 낸다.
게다가 **Windows 의 Node 는 `TZ=... npm test` 셸 프리픽스를 무시한다**(실측: 여전히 GMT+0900).
`src/lib/tz.test.js` 처럼 **프로세스 안에서** `process.env.TZ` 를 할당하고 `vi.setSystemTime` 으로
시계를 고정해야 결함이 드러난다.

### Codex 재검수 (CLAUDE.md 프로토콜)

코드 변경은 예외 없이 재검수 → **PASS 받을 때까지 반복**.

⚠️ **`codex:rescue` 서브에이전트가 "검수 불가"를 뱉으면 코드 문제가 아니다.**
`~/.codex/config.toml` 의 `[windows] sandbox = "elevated"` 때문에 셸을 못 띄우고
`CreateProcessWithLogonW failed: 1326` 으로 죽는다. 우회해서 직접 실행할 것:

```bash
codex exec --cd "<repo>"   -c windows.sandbox="unelevated" -c sandbox_mode="danger-full-access"   --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check   - < prompt.txt          # 프롬프트는 stdin 으로. 인자로 주면 stdin 대기로 멈춘다.
```

한글 경로라 `git diff` 출력이 cp949 로 깨진다 → 프롬프트에 "파일 원문을 Read 로 직접 읽어라"를 명시.
Codex의 지적이 항상 옳지는 않다 — 근거가 있으면 반박하고 그 근거를 커밋 메시지에 남긴다
(`setLedger` 무조건 호출 건, B-5 의 EPOCH 강등 유지 건 모두 반박이 받아들여졌다).

---

## 7. 이어서 시작하려면

```bash
cd "C:/Users/82108/orca/workspaces/MVP작/dev"
git checkout -b <feature> dev        # dev 는 다른 워크트리에 있다 (checkout dev 불가)
npm test && npm run build            # 200건 통과가 기준선
```

1. §4 백로그에서 항목을 고른다(미병합 브랜치는 없다).
2. 작업 → **Claude 자체 검수**(빌드 + 테스트 + 뮤테이션 검증) → **Codex 재검수 PASS 까지 반복**.
3. `git -C "C:/Users/82108/Documents/Claude/Projects/MVP작" merge --no-ff <feature>` 로 `dev` 병합.
4. `main` 병합(=프로덕션 배포)은 **반드시 사용자 확인 후**. §5의 세 가지가 선행돼야 한다.
