# 메이플 MVP작 효율 계산기 — 프로젝트 가이드

메이플스토리 MVP 등급작(엠작) 최적 비용 계산기. Vite + React SPA. 한국어 UI.
탭: **계산기 · 거래 기록(통계/달력/입력) · 예상 & 추천**. 코드 구조는 [README.md](README.md) 참고.

> **진행 중인 작업이 있다면 [docs/WORK-STATUS.md](docs/WORK-STATUS.md) 를 먼저 읽는다** — 브랜치 상태, 미병합 작업,
> 다음 할 일, 배포 전 사람이 해야 할 것, 이 프로젝트 특유의 검증 방법(로컬 PostgreSQL 실측·뮤테이션 검증)이 있다.

**분야별 상세 아키텍처는 [docs/architecture/](docs/architecture/README.md) 를 먼저 읽는다** — 프론트엔드·도메인로직·데이터계층·동기화백엔드·인프라운영. 해당 분야 코드를 바꾸기 전 그 문서를 참조/갱신할 것.

---

## 작업 워크플로우 (필수)

- **`main`에서 직접 작업·커밋 금지.** `main` push = Cloudflare 프로덕션 자동 배포이므로 검증 끝난 것만 올린다.
- 흐름: **`dev` 브랜치 유지 → `dev`에서 feature 브랜치 생성 → 작업 → `dev`에 병합 → 최종 검증 → `dev`를 `main`에 병합(=배포)**.
- feature 브랜치가 서로 겹치는 파일을 크게 건드리면 병렬 대신 순차로 `dev`에 합친다.

## 검증 프로토콜 (코드 변경은 예외 없이 2단계)

1. **Claude 자체 검수** — `npm run build` + 로직/엣지케이스 확인. **가능하면 dev 서버(프리뷰)를 띄워 실제 런타임까지 확인**(빌드는 통과해도 런타임에서 깨질 수 있음).
   - 상태 분기는 `localStorage`를 조작해 재현: **새 게스트**(키 삭제), **기존 유저**(커스텀 값 심기), 로그인 경로. 값이 코드 폴백인지 DB에서 온 건지 구분해야 하면 **로컬 constants를 sentinel(예: 1111)로 바꿔** 새 게스트가 DB값을 받는지 확인 후 **원복**.
   - **프로덕션 Supabase에 sentinel/테스트 값을 쓰지 말 것**(모든 유저가 읽는 shared state 오염). 테스트는 로컬 constants sentinel 또는 `fetchAppConfig` 반환값 임시 주입으로 하고 반드시 되돌린다.
2. **Codex 재검수** — `codex:rescue`(또는 `/codex:review`)로 diff 재검수 → 지적사항 반영(이견 시 보수적으로 수정). **PASS 받을 때까지 반복**(수정 후 재검수).
- `.ts/.tsx/.js/.jsx/.py` 등 코드 변경에 적용. 단순 문서·설정 변경은 예외.

## 아키텍처 방향

- **게스트 모드 유지**: 로그인 없이도 `localStorage`로 그대로 사용 가능. 로그인은 "동기화 켜기"(선택).
- **다인용 클라우드 동기화**: **Supabase**. `user_data` 1행(JSONB: calc/my_items/ledger) + **RLS(본인 행만)**. 인증 = **Google 로그인 + 이메일 매직링크**.
- **데이터 계층 공유**: `storage.js`의 순수 함수(`parseCalcState`/`serializeCalcState`/`normalizeLedger`/`normalizeMyItems`)를 localStorage와 클라우드가 함께 사용. 기존 저장 키를 유지해 구버전 데이터 승계.
- **설정 주입**: 공개 설정(`VITE_SUPABASE_URL`, publishable key)은 저장소 `.env`에 커밋(브라우저 노출이 정상, 보안은 RLS가 담당). **시크릿(service key, SMTP/앱 비밀번호 등)은 절대 커밋 금지.**
- **앱 공용 설정(시세성 기본값)**: `app_config` 테이블(1행, JSONB `config`; RLS = 누구나 SELECT / 쓰기정책 없음)에서 `mesoRate`/`giftRatio`/`marketRatio`·`chargeMethods`·`defaultItems`·`rules`를 로드(`fetchAppConfig`). **DB에서 고치면 재배포 없이 반영**, fetch 실패/오프라인은 `constants.js` 폴백. 대시보드(service role)로만 수정.
  - **적용 규칙**: 충전 프리셋·게임 규칙(`rules`)은 전역(모두). 시세 스칼라는 **저장 이력 없는 새 게스트에게만**(freshRef+configAppliedRef), `config.force` 배열에 든 키는 모든 유저에게 강제 덮어씀. 상세는 프로젝트 메모리 `app-config-db`.
  - **아이템은 force 대상이 아니다** — `defaultItems`(카탈로그)는 **유저 데이터로 복사되지 않고** 화면에서 `my_items`와 합쳐 그려진다(`lib/items.js` `composeItems`). 그래서 가격을 고치거나 아이템을 넣고 빼도 **재배포도 force도 없이 전원에게 즉시 반영**되고, 유저가 추가·수정한 것은 사라지지 않는다. 상세는 아래 '아이템 소유권'.

- **아이템 소유권 분리(절대 되돌리지 말 것)**: 기본 아이템(운영자)과 유저가 추가한 아이템이 예전엔 `my_items` 배열 하나에 섞여 있었다. 그래서 운영자가 기본값을 고치려면 그 배열을 통째로 덮어쓰는 수밖에 없었고(`force: ["defaultItems"]`), **그 덮어쓰기가 유저가 추가한 아이템을 삭제 표식도 없이 지웠다(실제 사고).**
  - 카탈로그 = `app_config.defaultItems`(운영자 소유, 읽기 전용). 내 아이템 = `user_data.my_items`(유저 소유만).
  - **동기화 로직은 새로 만들지 않는다.** 숨김·수정본을 전부 `my_items`의 '행'으로 표현해 기존 합집합 병합·tombstone·`at` 순서를 그대로 쓴다: 수정본 = 같은 이름의 행(카탈로그를 가림), 숨김 = `hidden:true` 행, 되돌리기/숨김해제 = 그 행 삭제.
  - `origin:"user"` 표식이 붙은 행은 **마이그레이션이 절대 지우지 않는다**. 이게 없으면 유저 수정본(카탈로그와 같은 이름을 갖는 게 정상)이 다음 로드에서 지워져 수정 기능 자체가 성립하지 않는다.
  - 마이그레이션(`planItemMigration`, 멱등)은 **값이 같은 순수 복사본만** 지운다(`cash`/`mAllowed`/`cat`/`icon` 비교 — `differsFromBase`). 하나라도 다르면 유저가 손댄 것일 수 있으므로 '수정됨'으로 살린다 — **지우는 건 되돌릴 수 없고 배지는 되돌릴 수 있다.**
- **동기화 불변식(깨면 데이터 꼬임 — 절대 유지)**: ① 업로드는 **단일 in-flight 직렬화**(`upsertingRef`; `upsertingRef`를 외부에서 리셋하지 말 것 — 계정 전환 복구는 `syncNonce` 재예약으로). ② 각 upsert write 직전 `liveUserIdRef.current === 캡처 userId` 확인 → **다른 계정 행에 쓰지 않음**. ③ 최초 로그인 프롬프트는 계정별 마커(`mvpCloudSyncedUid`)로 **1회만**(새로고침 X). ④ ledger는 항목 id 기준 **합집합 병합 + tombstone 차감**(추가는 손실 없음, 삭제는 전파됨). ⑤ 로컬 데이터에는 **소유자 마커**(`mvpDataOwnerUid`)가 붙는다 — 소유자가 다른 계정이면 병합하지 않고 클라우드만 채택(공용 브라우저에서 남의 원장이 섞이는 것을 막음). 로그아웃은 계정 데이터를 지운다. ⑥ 업로드는 **조건부 쓰기**(`updated_at` 버전 일치) — 무조건 upsert 금지. 충돌 시 서버 최신본을 읽어 `mergeForUpload` 로 병합 후 재시도(설정은 이 탭 우선, 원장은 합집합+tombstone 차감).
- **삭제는 반드시 `deleteLedgerEntry`로**: 배열에서 항목만 빼면 그 항목을 아직 가진 기기가 다음 접속 때 되살린다(단일 기기도 — 디바운스 전에 탭을 닫으면 동일). `ledger.deleted = { [id]: 삭제시각 }`에 표식을 남겨야 전파된다. 병합은 **삭제 우선**(한쪽이 지우고 다른 쪽이 수정했으면 삭제가 이김). 표식은 `TOMBSTONE_TTL_DAYS`(1년) 후 만료 — 그보다 오래 오프라인이던 기기는 부활시킬 수 있다(수용된 한계).
- 상세는 프로젝트 메모리 `supabase-multiuser-sync` 참고.

## 배포

- **Cloudflare Pages** — `main` push 시 자동 배포. 프로덕션 URL: **https://maplemvpcalculator.com** (+`www`), 기존 https://maplebudget-1xp.pages.dev 도 유효.
- Framework=**Vite**, Build=`npm run build`, Output=`dist`, Production branch=`main`, Node=**22**(저장소 `.node-version`).
- 환경변수 대시보드가 불안정하면 위 `.env` 커밋 방식으로 대체(공개 값만).
- **도메인을 바꾸면 로그인 리다이렉트도 반드시 갱신**: Supabase → Auth → URL Configuration의 **Site URL**과 **Redirect URLs**에 새 도메인 추가(안 하면 Google/매직링크 로그인이 새 도메인에서 막힘). 앱 코드는 `window.location.origin`을 써서 코드 변경은 불필요.

## 도메인 / 기능 규칙

- **MVP 주 = 목요일 시작 ~ 수요일 마감**(주 과금 단위). 통계 '특정 주차'·주차별 집계·13주 누적 모두 이 기준(`weekStartThu`).
- **'지금'은 항상 KST**(게임 서버 기준). 주차·달력 계산에서 `new Date()` 를 직접 쓰지 말고 **`nowD()`**(`lib/tz.js`)를 쓴다.
  주차 함수(`weekStartThu`/`addDays`/`fmtD`)는 민간 날짜(Y/M/D) 연산이라 시간대를 모른다 — 해석은 `nowD()`/`todayStr()` 한 곳에서만.
- **현금화**: 메소(억) + **억당(원/억)** 입력 → 판매현금 자동 산정. 구 데이터(`won` 직접 입력)는 `rate`로 승계(`meso=0`이면 손실 방지 위해 `won` 폴백).
- **숫자 입력**: 한 자리 남아도 **완전 삭제 가능** + 비운 채 벗어나면 **0** + 값은 문자열로 저장(계산부는 `+x || 0`로 처리). 모든 숫자 칸은 `ui.jsx`의 **`NumInput`** 사용.
- **아이템 입력**: 브라우저 기본 `datalist` 금지 — 앱 테마 콤보 **`ItemCombo`**(목록 상시 노출, 빠른 교체). 날짜·셀렉트도 커스텀 컴포넌트(`DateInput`/`CSelect`/`WeekPicker`).
- **UI 일관성**: 새 위젯은 브라우저 기본 대신 `ui.jsx`의 테마 컴포넌트를 재사용/추가한다.

## 하지 말 것

- `main`에 직접 커밋. 검증 안 된 코드 배포.
- 시크릿 키(Supabase service key, Gmail 앱 비밀번호 등) 저장소 커밋.
- 코드 변경 후 Codex 재검수 생략.
- 렌더 함수 내부에 컴포넌트 정의(리마운트로 입력 포커스 유실) — 모듈 스코프로 둘 것.
- **프로덕션 Supabase(app_config/user_data)에 sentinel·테스트 값 쓰기** — 모든 유저가 읽는 shared state 오염. 테스트는 로컬에서.
- **동기화 불변식 위반**: `upsertingRef`를 이펙트에서 외부 리셋, upsert 시 `liveUserIdRef` 가드 제거, 마커 없이 매 로드 프롬프트 등.
- **기본 아이템을 `my_items`에 심거나 force로 덮어쓰기** — 정확히 이 구조가 유저 아이템을 삭제 표식 없이 지웠다. 카탈로그는 `app_config`에서 읽어 화면에서 합친다(`composeItems`). `normalizeMyItems`가 `DEFAULT_ITEMS`를 시딩하도록 되돌리지 말 것.
- **`origin:"user"` 가드 없이 마이그레이션이 이름만 보고 아이템 삭제** — 유저 수정본이 조용히 사라진다.
- **불확실할 때 유저 데이터 삭제** — 삭제는 되돌릴 수 없다. 판단이 서지 않으면 표시(배지)해서 유저가 고르게 한다.
- **DB 값을 검증 없이 렌더**: `app_config`에서 온 배열/객체(예: `chargeMethods`/`defaultItems`)는 `m && typeof m.name === "string"` 등으로 걸러 쓴다(malformed 원소 렌더 크래시 방지).
- **카카오페이 QR 이미지를 저장소에 커밋** — 앱이 만든 QR 에는 **받는 사람의 실명과 얼굴 사진**이 박혀 있다(예금주를 초성으로 적어 둔 의도와 모순). 이미지에서 **링크만** 뽑아 `lib/donate.js` 에 넣고 화면에서 흑백 QR 로 다시 그린다. 상세는 [docs/WORK-STATUS.md §7](docs/WORK-STATUS.md).
- **토스아이디(`toss.me`) 되살리기** — **서비스 종료**됐다. 낡은 블로그 글을 근거로 죽은 링크를 배포할 뻔했다. 결제·송금 수단은 블로그가 아니라 **공식 페이지**로 확인한다.
