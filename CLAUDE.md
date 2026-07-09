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
- **앱 공용 설정(시세성 기본값)**: `app_config` 테이블(1행, JSONB `config`; RLS = 누구나 SELECT / 쓰기정책 없음)에서 `mesoRate`/`giftRatio`/`marketRatio`·`chargeMethods`·`defaultItems`를 로드(`fetchAppConfig`). **DB에서 고치면 재배포 없이 반영**, fetch 실패/오프라인은 `constants.js` 폴백. 대시보드(service role)로만 수정.
  - **적용 규칙**: 충전 프리셋 목록은 전역(모두). 시세/기본아이템은 **저장 이력 없는 새 게스트에게만**(freshRef+configAppliedRef, auth 해석 후 게스트만). `config.force` 배열에 든 키는 **모든 유저에게 강제 덮어씀**(force). 상세는 프로젝트 메모리 `app-config-db`.
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
- **DB 값을 검증 없이 렌더**: `app_config`에서 온 배열/객체(예: `chargeMethods`/`defaultItems`)는 `m && typeof m.name === "string"` 등으로 걸러 쓴다(malformed 원소 렌더 크래시 방지).
