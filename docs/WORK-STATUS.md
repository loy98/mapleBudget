# 작업 현황 · 인수인계

> 2026-07-10 기준. **세션이 끊겨도 이 문서만 읽고 이어갈 수 있게** 쓴다.
> 상세한 결함 목록·근거는 [hardening-backlog.md](hardening-backlog.md), 아키텍처는 [architecture/](architecture/README.md).

---

## 0. 30초 요약

전체 검수(분야별 에이전트 5종 + Codex) → 발견 → 수정 → Codex 재검수를 반복했다.
테스트 **52건 → 144건**, `npm audit` **5건(critical 1·high 1) → 0건**.

- `main`: 프로덕션. **`dev`가 16커밋 앞서 있다. 아직 배포 안 함.**
- `dev`: 검수 결과 반영본. 전체 검수 + tombstone + 낙관적 동시성 제어까지 병합됨.
- `feature/storage-corruption-guard`: **병합 대기.** 커밋 6개. Codex PASS. 테스트 144건 통과.

**배포하려면 §5의 세 가지를 먼저 해야 한다.**

---

## 1. 브랜치 상태

```
main ──────────────── (프로덕션, https://maplemvpcalculator.com)
  └─ dev (16 commits ahead)          worktree: C:\Users\82108\Documents\Claude\Projects\MVP작
       ├─ cb7c203  merge: 전체 검수
       ├─ 37fd1bc  merge: tombstone + 낙관적 동시성 제어
       └─ feature/storage-corruption-guard (미병합, 6 commits)
                                     worktree: C:\Users\82108\orca\workspaces\MVP작\dev
```

`dev`는 다른 워크트리에 체크아웃돼 있어 이쪽에서 `git checkout dev`가 안 된다.
병합은 `git -C "C:/Users/82108/Documents/Claude/Projects/MVP작" merge --no-ff <branch>`.

**다음 액션**: `feature/storage-corruption-guard`를 `dev`에 병합 (사용자 확인 필요).

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

## 3. 다음 작업: B-5 (권장)

### 무엇이 문제인가

**과거 거래를 계산할 때 '현재 계산기 설정'을 소급 적용한다.**

`src/components/logtab/useLedgerDerived.js:10`
```js
const env = { fee: calc.f, effD: calc.effD, mileageR: calc.mileageR };
```
이 `env`가 `ledgerStats` / `weeklyMeso` / `weeklyItems` / `itemSummary`로 흘러가고,
`cumNow` → `weeklyAch`도 현재 `mileageR`을 받는다. 거래 행에는 **그때의 요율이 남아 있지 않다.**

### 실측 영향 (거래 10건 기준)

| 바꾼 설정 | 과거 숫자 변화 |
|---|---|
| MVP 등급 무등급→브론즈 (수수료 5%→3%) | 판매 실수령 메소 11.400억 → **11.640억** (+2.1%) |
| 마일리지 비율 30%→20% | **13주 누적 과금 41,300원 → 47,200원** (+14%) |
| 충전 할인 0%→10% | 과거 구매 실지출 41,300원 → **37,170원** (−10%) |

**13주 누적 과금(`cum`)은 `estGrade`의 입력이다.** 즉 마일리지 비율을 바꾸면 화면에 표시되는
추정 등급 자체가 바뀔 수 있다. MVP 등급 드롭다운은 사용자가 승급할 때마다 정상적으로 바꾸는 값이다.

> ⚠️ 손익(`st.profit`)은 **변하지 않는다**. `profit = cashWon - spend` 이고 수수료는 둘 중 어디에도
> 들어가지 않는다. (초기 검수 보고서의 "손익이 뛴다"는 서술은 실측 결과 사실이 아니다.)

### 어떤 요율이 어디에 쓰이나

| 버킷 | 쓰이는 요율 | 영향받는 값 |
|---|---|---|
| `buys` | `mileageR` (행의 `mil`이 true일 때), `effD` | `ach`(실적), `spend`(실지출), `cum` |
| `sells` | `fee` | `sold`(판매 실수령 메소) |
| `cashes` | (행의 `rate`) | 이미 행 단위로 저장됨 — **선례** |
| `spends` | 없음 | — |

### 설계 제안

**`cashes.rate`가 이미 선례다.** 현금화는 억당 환율을 행마다 저장하고, 구 데이터(`won` 직접 입력)는
`rate`가 없으면 `won`으로 폴백한다(`ledger.js` `cashWonOf`). 같은 패턴을 나머지에 적용한다.

1. **거래 생성 시 요율 스냅샷을 남긴다** (`EntryForm.commit`, `LogTab.addEntryOn`)
   - `buys`: `_mr` (그때의 mileageR), `_effD`
   - `sells`: `_fee`
2. **계산부는 행의 값이 있으면 그것을, 없으면 현재 설정을 쓴다**
   ```js
   const mf = b.mil ? (b._mr != null ? +b._mr : mileageR) : 0;
   ```
3. **구 데이터는 복원할 수 없다.** 과거 시점의 수수료율·마일리지 비율은 어디에도 기록돼 있지 않다.
   → 폴백은 현재 설정. 이 사실을 UI에 명시한다(`LogTab`의 통계 하단 note).
   현재 note는 실지출(`effD`)만 언급하고 수수료·마일리지 소급은 안내하지 않는다.
4. **동기화 영향 없음** — 행에 필드가 추가될 뿐이고 `ledger`는 JSONB다. 병합은 id 기준이라 무관.

### 이 수정의 한계 (미리 알고 시작할 것)

**완전히 고칠 수 없다.** "지금부터는 정확하다 + 과거는 현재 설정 기준 추정치임을 명시"가 최선이다.
그래도 현 상태(사용자가 설정을 바꾸면 과거가 조용히 변함)보다는 낫다.

### 대안: B-4를 먼저 하는 선택

B-4(주차 경계가 브라우저 로컬 타임존)는 **깔끔하게 완결된다** — `weekStartThu(dt, tz="Asia/Seoul")` 하나.
다만 **KST 밖 사용자에게만** 영향이 있다. 한국어 UI의 메이플 도구라 대부분은 KST에 있고 무영향.
영향 범위는 B-5, 해결 가능성은 B-4. 짧고 확실한 승리를 원하면 B-4부터.

---

## 4. 남은 백로그 (우선순위)

상세는 [hardening-backlog.md](hardening-backlog.md).

| ID | 내용 | 심각도 | 비고 |
|---|---|---|---|
| **B-5** | 과거 거래에 현재 설정 소급 적용 | MEDIUM | 위 §3. 완전 수정 불가(구 데이터) |
| **B-4** | 주차 경계가 로컬 타임존 기준 (KST여야 함) | MEDIUM | KST 밖 사용자만. 수정 깔끔 |
| B-2b | `calc`/`my_items`는 여전히 last-writer-wins | MEDIUM | `my_items`에 안정 id 없음 → tombstone 필요 |
| B-6 | `importAll`이 날짜 포맷을 검증 안 함 | MEDIUM | `"2026-7-2"`가 모든 주에서 조용히 누락 |
| B-7 | 레거시 원장 행의 id 재발급 → 동기화 후 중복 | MEDIUM | 결정적 id(해시) 유도 필요 |
| B-9 | feedback rate limit의 IP 버킷은 best-effort | MEDIUM | 전역 백스톱으로 완화됨. 근본해법=Turnstile+Edge Function |
| B-8 잔여 | `visibilitychange` 플러시가 평범한 `fetch`(탭 종료 시 취소) | LOW | `sendBeacon`/`keepalive` |
| B-8 잔여 | `normalizeMyItems`: `[]`와 '없음'을 구분 못해 아이템 전체 삭제 불가 | LOW | |
| B-8 잔여 | `IconView`가 임의 http(s) 호스트 이미지 로드 | LOW | allowlist 미완 |
| B-8 잔여 | 에러 트래킹 부재 | LOW | `ErrorBoundary.componentDidCatch`에 전송 지점만 있음 |
| B-8 잔여 | `mileageRate` 상한 미검증 → 100이면 `buildPlan`에 NaN/Infinity | LOW | |
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

### Codex 재검수 (CLAUDE.md 프로토콜)

코드 변경은 예외 없이 `codex:rescue`로 재검수 → **PASS 받을 때까지 반복**.
Codex가 diff를 못 읽는 경우(한글 경로 cp949 오류)가 있으니 "파일 원문을 직접 읽어달라"고 지시할 것.
Codex의 지적이 항상 옳지는 않다 — 근거가 있으면 반박하고 그 근거를 커밋 메시지에 남긴다
(실제로 `setLedger` 무조건 호출 건은 반박이 받아들여졌다).

---

## 7. 이어서 시작하려면

```bash
cd "C:/Users/82108/orca/workspaces/MVP작/dev"
git log --oneline dev..HEAD          # 미병합 커밋 확인
npm test && npm run build
```

1. `feature/storage-corruption-guard`를 `dev`에 병합할지 사용자에게 확인
2. `dev`에서 `feature/rate-snapshot` 브랜치를 따서 §3의 B-5 설계대로 진행
3. 완료 후 Codex 재검수 → PASS → `dev` 병합
4. `main` 병합(=프로덕션 배포)은 **반드시 사용자 확인 후**. §5의 세 가지가 선행돼야 한다.
