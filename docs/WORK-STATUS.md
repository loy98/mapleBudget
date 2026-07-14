# 작업 현황 · 인수인계

> **2026-07-14 기준.** 세션이 끊겨도 이 문서만 읽고 이어갈 수 있게 쓴다.
> 상세한 결함 목록·근거는 [hardening-backlog.md](hardening-backlog.md), 아키텍처는 [architecture/](architecture/README.md).

---

## 0. 30초 요약

**미병합 브랜치 없음. `dev` = `main` = 프로덕션 배포 완료.** 테스트 **466건**(19파일) 전부 통과.

2026-07-14 세션의 발단은 "원더베리 가격을 DB에서 고쳤는데 반영이 안 된다"는 리포트였다.
파고 보니 **아이템 데이터 모델 자체가 잘못**돼 있었고, 그걸 고치는 데까지 갔다.

1. **캐시 가격 정정** — 원더베리 3,900 → **5,400** 및 **마일리지 불가**(공식 고지 확인).
   가격 오류보다 마일리지 쪽이 계산에 더 큰 영향이었다 — 있지도 않은 30% 절감을 반영해 실비용을 과소평가하고 있었다.
   프리미엄 성형 5,500 → 3,500. 아이템 기본 목록 7종 → **23종**.
2. **계산기 '현재 누적 실적' 모드 분리** — `직접 입력`(시나리오) / `내 기록 사용`(원장 13주 누적). §3
   진행률 링이 늘 0%로 보이던 원인이었다(링은 `curAchieved/tierAmt` 인데 기본값 0, 사이드바 'MVP 등급'은 수수료 전용).
3. **자주 쓰는 아이템 카테고리 UI** — 헤어·성형/코디·스타일/카르마/펫/기타 필터 탭.
4. **🔴 아이템 소유권 분리 (가장 중요)** — §2.
5. 가이드(`public/guide.html`) 전면 재작성 + 앱 내 설명 문체 정비.

---

## 1. 브랜치 상태

```
main = dev = 7ea30d9   (프로덕션 https://maplemvpcalculator.com, Cloudflare 자동배포 확인 완료)
```

미병합 브랜치 없음. `dev` 는 다른 워크트리(`C:\Users\82108\Documents\Claude\Projects\MVP작`)에 체크아웃돼 있어
orca 트리에서 `git checkout dev` 가 안 된다 → `git checkout -b <feature> origin/dev` 로 딴다.
`main` 병합은 detached HEAD 에서:
`git checkout --detach origin/main && git merge --no-ff origin/dev && git push origin HEAD:main`

**다음 액션**: §5 백로그. 미병합 브랜치는 없다.

---

## 2. 🔴 아이템 소유권 분리 — 사고와 그 수습

### 무슨 일이 있었나

기본 아이템(운영자)과 유저가 추가한 아이템이 **`user_data.my_items` 배열 하나에 섞여** 있었다.
그래서 운영자가 기본값(가격 등)을 고치려면 그 배열을 **통째로 덮어쓰는** 수밖에 없었다 —
`app_config.config.force` 에 `"defaultItems"` 를 넣는 방식.

그 덮어쓰기가 **유저가 직접 추가한 아이템을 삭제 표식도 없이 지웠다.**
2026-07-14 실제로 사고가 났고 사용자의 커스텀 아이템 2종이 사라졌다.
(거래 기록의 품목명으로 역추적해 이름·가격을 복원했다. 원장은 force 대상이 아니라 무사했다.)

### 어떻게 고쳤나 — 소유자가 다르면 저장소도 다르다

| | 저장소 | 소유자 |
|---|---|---|
| 카탈로그(기본 아이템) | `app_config.defaultItems` | 운영자. **유저 데이터로 복사하지 않는다** |
| 내 아이템 | `user_data.my_items` | 유저. 운영자는 건드리지 않는다 |

화면 목록은 `src/lib/items.js` 의 `composeItems(catalog, myItems)` 가 만든다(같은 **이름**이면 내 것이 카탈로그를 가림).

→ **아이템에서 `force` 라는 개념 자체가 사라졌다.** 이제 `app_config.defaultItems` 만 고치면
재배포도 force 도 없이 전원에게 즉시 반영되고, 유저가 추가·수정한 것은 사라지지 않는다.

### 설계의 핵심: 새 동기화 규칙을 만들지 않았다

숨김도 수정본도 전부 **`my_items` 의 '행'** 으로 표현했다. 그래서 기존 합집합 병합·tombstone·`at` 순서 규칙이
그대로 적용된다(`cloud.js mergeMyItems` 무수정). 새 병합 규칙을 만들었다면 그게 새로운 데이터 손실 경로가 됐을 것이다.

| 동작 | 표현 |
|---|---|
| 기본값 수정 | 같은 이름의 행 추가(`origin:"user"`) → 카탈로그를 가림. "수정됨" 배지 |
| 숨기기 | `hidden:true` 행 추가 |
| 되돌리기 / 숨김해제 | **그 행을 삭제**(`deleteMyItem`) → 카탈로그 원본이 다시 보임 |

### 절대 되돌리지 말아야 할 두 가지

1. **`normalizeMyItems` 가 `DEFAULT_ITEMS` 를 시딩하게 만들지 말 것.** 그게 사고의 근원이다.
   지금은 데이터가 없으면 `[]` 를 반환한다.
2. **`origin:"user"` 가드를 빼지 말 것.** 마이그레이션이 이름만 보고 지우면,
   유저가 만든 수정본(카탈로그와 **같은 이름을 갖는 게 정상**)이 다음 로드에서 지워진다 → 수정 기능 자체가 성립하지 않는다.

### 마이그레이션 (`planItemMigration`, 멱등)

`my_items` 에 남은 옛 기본값 복사본을 걷어낸다. **판정은 값으로 한다:**

- 카탈로그와 **값이 같은** 행(`cash`/`mAllowed`/`cat`/`icon` 비교 — `differsFromBase`) → 정보 없는 순수 복사본.
  삭제 표식과 함께 제거(다른 기기의 복사본까지 정리).
- 하나라도 **다른** 행 → 유저가 손댔을 수 있다. **지우지 않고** `origin:"user"` 를 찍어 '수정됨'으로 살린다.

> 처음엔 이름만 보고 지웠는데 Codex 가 잡았다. 구버전 UI 는 기본 아이템을 직접 편집할 수 있었으므로
> 그렇게 고쳐 둔 행은 이름이 같아도 **유저의 의도가 담긴 데이터**다. 이름만 보고 지우면 그 편집이 조용히 사라진다 —
> **마이그레이션이 같은 사고를 한 번 더 반복할 뻔했다.**
>
> **원칙: 지우는 건 되돌릴 수 없고 배지는 되돌릴 수 있다. 확신이 없으면 지우지 않는다.**

### 실측 검증 (프로덕션)

배포 전 실제 클라우드 데이터로 드라이런 → 배포 후 결과 확인 → 숨기기/다시표시/수정/되돌리기를 **실제로 클릭**해 확인.

- 클라우드 `my_items`: **25 → 2개**(커스텀만, 둘 다 `origin:"user"`), 아이템 삭제 표식 23개
- 화면은 그대로 **25개**(카탈로그 23 + 내 것 2)
- 새로고침해도 유령 '수정됨' 행 없음 → **멱등성 실전 확인**

---

## 3. 계산기 '현재 누적 실적' 모드 (`settings.curSource`)

- `"manual"`(기본) — 직접 입력. 시나리오만 돌려보는 순수 계산.
- `"ledger"` — 거래 기록의 13주 누적(`cumNow`)을 실적으로 사용. 입력칸은 읽기 전용.

기본이 `"manual"` 인 이유: 기록이 0건인 첫 방문자가 `"ledger"` 로 시작하면 **입력칸이 잠긴 채 0원**이라
계산기를 시험해 볼 수가 없다. 기록이 쌓이면 UI 가 전환을 안내한다.

화면과 계산이 갈라지지 않게 **CalcTab 은 `c.cur` 를 읽는다**(분기를 UI 에서 재구현하지 않는다 — `hasFeeBenefit` 과 같은 규칙).
App 이 `calcSettings` 에서 `curAchieved` 를 원장 누적으로 갈아끼워 `computeCalc` 에 넘긴다.
`settings.curAchieved`(직접 입력값)는 지우지 않고 **보존**한다 — 모드를 되돌리면 그대로 돌아온다.

---

## 4. app_config 운영 (재배포 없이 수정)

```sql
-- 아이템 추가/가격 수정: force 불필요. 새로고침이면 전원 반영
update app_config set config = jsonb_set(config,'{defaultItems}','[...]'::jsonb), updated_at=now() where id=1;

-- 시세 변경
update app_config set config = jsonb_set(config,'{mesoRate}','3200'::jsonb), updated_at=now() where id=1;
```

현재 `force = ["mesoRate","giftRatio","marketRatio"]` (시세 스칼라만).

> ⚠️ **`force` 에 `"defaultItems"` 를 넣지 말 것 — 유저 아이템을 지운다.**
> 그리고 force 는 1회성 플래그가 **아니다**. 페이지를 열 때마다 매번 적용된다.

### 아이템 가격의 출처 규칙

넥슨은 상시 판매가를 공개 웹으로 내놓지 않는다. **판매 공지(`maplestory.nexon.com/News/CashShop/Sale/NNN`)에
가격이 적힌 것만 '공식'** 이고, 나머지는 커뮤니티 출처다(`constants.js` 의 `DEFAULT_ITEMS` 주석에 항목별로 표기).

**근거 없는 가격을 추측으로 채우지 말 것** — 계산기가 조용히 틀린 답을 낸다.
아직 미확인: 로얄 스타일 쿠폰 45개(99,000 으로 넣었으나 **묶음 할인 여부 미확인** — 개당가 배수로 추정하지 않았다).

---

## 5. 남은 백로그

| ID | 내용 | 심각도 | 비고 |
|---|---|---|---|
| **B-9** | feedback rate limit 의 IP 버킷은 best-effort | MEDIUM | 프로덕션 관찰 항목. `feedback_throttle` 의 `anon:__all__` 카운터를 보고 상한 조정. 근본해법 = Turnstile + Edge Function |

### 오탐으로 판단해 고치지 않은 것 (다시 제기되면 이 근거를 보라)

- **`allocateCharge` 의 `C=0` 폴백이 불연속이라는 지적** — 아니다. `C→0+` 이면 전액이 최고 할인 방식
  한도 안에 들어가 `dRate → topRate` 로 **연속 수렴**한다. 폴백값이 바로 그 극한이다.
- **`divisor`(격주 6, 월간 3)가 `SPLITS` 와 불일치라는 지적** — 아니다. 이 값은 "13주 롤링 창에
  최소 몇 번의 과금이 들어가는가"이므로 창 유지에 필요한 회당 금액의 분모로는 올바르다.
- **"등급을 올리면 과거 손익이 뛴다"** — 실측 결과 손익은 0원 변동. 판매 실수령 메소만 바뀐다.

---

## 6. 검증 방법 (이 프로젝트 특유)

### 기본
```bash
npm test          # 466건. "Tests" 줄만 보지 말고 "Test Files" 줄도 볼 것(아래 참고)
npm run build     # PWA precache 생성까지 확인
npm audit         # 0건이어야 함
```

### 프로덕션 데이터를 건드리는 변경(마이그레이션 등)은 반드시 드라이런

배포 전에 **실제 클라우드 데이터를 읽어(읽기 전용) 판정만 재현**해 결과를 확인한다.
아이템 마이그레이션은 이 방식으로 "순수 복사본 23개 삭제 / 커스텀 2개 보존"을 배포 전에 확인했다.
테스트가 아무리 많아도 **실제 데이터 형태와 다르면 아무것도 보장하지 않는다.**

### 서비스워커(PWA) 캐시 — 배포 확인의 함정

새 번들을 배포해도 **서비스워커가 옛 번들을 캐시에서 준다.** "배포했는데 화면이 안 바뀐다"가 정상이다.

- 프로덕션 확인: `curl https://maplemvpcalculator.com/` → `assets/index-*.js` 해시를 뽑아
  **그 파일 안에 새 문자열이 있는지** grep. (배포 중이면 에셋이 404 → SPA 폴백으로 `index.html`(~4.6KB)이 온다. 크기로 구분된다.)
- 브라우저 강제 갱신: `getRegistrations().unregister()` + `caches.delete()` 후 reload.
  ⚠️ **그 직후의 그 탭은 CSS 가 안 먹은 것처럼 보일 수 있다(일시적).** 새 탭에서 다시 볼 것 — 한 번 헛다리를 짚었다.

### 브라우저 실측 (Chrome MCP)

DOM 을 직접 조회하는 편이 스크린샷보다 정확하다(스크롤 아티팩트에 속지 않는다).
⚠️ **버튼을 `querySelector('button')` 로 잡지 말 것** — 유저 행에는 분류 `CSelect` 가 `<button>` 이라
되돌리기 대신 드롭다운이 눌린다. **버튼은 텍스트로 찾는다.**

### PostgreSQL 실측 (SQL/RLS 를 바꿨다면 필수)

사용자 클러스터(PostgreSQL 18, 포트 5432)는 **건드리지 않는다.** 스크래치패드에 일회용 클러스터를 띄운다:

```bash
export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"
initdb -D "$PGDATA" -U postgres -A trust -E UTF8
pg_ctl -D "$PGDATA" -o "-p 55432" -l "<scratchpad>/pg.log" start
# auth.uid()/auth.role()/anon/authenticated 를 스텁으로 만든 뒤 schema.sql 적용
pg_ctl -D "$PGDATA" stop -m fast                      # 끝나면 반드시 정리
```

### 뮤테이션 검증 (데이터 손실 방어 코드에는 반드시)

**테스트가 통과하는 것과 테스트가 결함을 잡는 것은 다르다.**
B-3 작업 중 처음 쓴 속성 테스트는 가드를 통째로 제거해도 초록불이었다.
방어 코드를 일부러 부수고 테스트가 잡는지 확인할 것.

**`npm test` 의 "Tests passed" 줄만 보면 안 된다.** 테스트 파일이 **파싱 에러로 통째로 수집되지 않아도**
그 줄은 초록불이다(실제로 `ui.test.jsx` 가 그렇게 6건을 조용히 빼먹었다). **`Test Files` 줄을 함께 확인한다.**

**포커스·이벤트는 jsdom 으로 검증한다**(`*.dom.test.jsx` + `// @vitest-environment jsdom` + `act`).

**타임존도 같은 함정이다.** 개발 기계가 KST 라 로컬 기준 코드와 KST 기준 코드가 같은 답을 낸다.
게다가 **Windows 의 Node 는 `TZ=... npm test` 셸 프리픽스를 무시한다.**
`src/lib/tz.test.js` 처럼 **프로세스 안에서** `process.env.TZ` 를 할당하고 `vi.setSystemTime` 으로 시계를 고정해야 한다.

### Codex 재검수 (CLAUDE.md 프로토콜)

코드 변경은 예외 없이 재검수 → **PASS 받을 때까지 반복**. 이번 세션에서 Codex 가 잡은 것:
카테고리 폴백 시 탭 강조 누락, **마이그레이션이 유저의 옛 편집을 지우는 문제(중대)**, 빈/중복 이름 미검증,
수정 모달의 이름 변경이 별개 아이템을 만드는 문제, 공백만 다른 복사본이 매칭에서 빠지는 문제.

⚠️ **`codex:rescue` 가 "검수 불가"를 뱉으면 코드 문제가 아니다** — Windows 샌드박스(`CreateProcessWithLogonW 1326`).
그리고 **한글 경로 때문에 Codex 의 `git diff` 가 cp949 로 깨진다** →
`git diff origin/dev...HEAD > <scratchpad>/x.diff` 로 **UTF-8 파일에 뽑아 주고 "이 파일을 직접 읽어라"** 라고 지시할 것.

Codex 의 지적이 항상 옳지는 않다 — 근거가 있으면 반박하고 그 근거를 커밋 메시지에 남긴다.

---

## 7. 이어서 시작하려면

```bash
cd "C:/Users/82108/orca/workspaces/MVP작/dev-2"
git checkout -b <feature> origin/dev
npm test && npm run build            # 466건 통과가 기준선
```

1. §5 백로그에서 항목을 고른다(미병합 브랜치는 없다).
2. 작업 → **Claude 자체 검수**(빌드 + 테스트 + 가능하면 dev 서버 런타임) → **Codex 재검수 PASS 까지 반복**.
3. `dev` 병합 → 최종 검증 → **`main` 병합(=프로덕션 배포)은 반드시 사용자 확인 후**.
