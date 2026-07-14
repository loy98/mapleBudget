# 프론트엔드 — UI·상태·테마·위젯

## 상태 소유 (single source)
- **App.jsx**가 계산기 상태를 소유: `{settings, charges, items}`(한 useState 객체), `myItems`, `ledger`, `tab`.
  - 초기값은 `loadCalcState/loadMyItems/loadLedger`(localStorage). 변경 시 `useEffect`로 자동 저장.
  - 파생값 `calc = useMemo(computeCalc(settings,charges,items))` — 순수 계산, 모든 탭이 prop으로 받음.
- **useCloudSync 훅**이 세션·동기화 상태(`session/syncState/chargeOptions/conflictPrompt`)를 소유하고 App에 반환. 계산기 상태는 App→훅으로 주입(setter 포함). → 컴포넌트는 클라우드를 모른다.
- **LogTab**만 로컬 UI state를 자체 소유(달력 커서·선택 날짜·서브탭·달력 모드 등 뷰 상태). `calMode`는 기기별 로컬(동기화 안 함).

## 사용자 setter (App.jsx)
`setSettings/setCharges/setItems`(→ `setCalcState`), `applyMyItems`(→ `setMyItems`). 공통 규칙:
- **`withRowKeys`로 감싸** 리스트 행마다 안정 key `_k` 부여(중간 행 삭제 시 입력 상태 뒤섞임 방지).
- **`markUserTouched()`** 호출 → "사용자가 직접 편집함" 표시(최초 로그인 병합 보호, [sync-backend.md](sync-backend.md) P1-4). config/sync 프로그램적 변경은 훅이 `setCalcState/setMyItems`를 직접 호출하므로 이 표시가 안 붙는다.

## 컴포넌트
- **CalcTab** — 시세&조건 사이드바(메소시세·선물식/메소마켓 비율·충전 방식·경매장 수수료·마일리지) + 본문 6섹션(방식 비교·총비용·경매장 되팔기·통합 최적·마일리지·최적 플랜). 충전 프리셋 목록은 `chargeMethods` prop(= app_config 또는 constants).
- **LogTab** — 서브탭 "달력&통계"/"거래 입력". 통계(13주 누적·과금·현금화·주차별), 달력(월력 `MonthCal` / MVP 주간 `MvpCal`), 일자 상세 편집(`DayDetail`), 드래프트 입력 폼(`EntryForm`). 하위 컴포넌트는 **모듈 스코프**로 정의.
- **ForecastTab** — 예상 & 추천.
- **AuthBar** — 비로그인: 로그인 팝업(Google/이메일 링크). 로그인: 동기화 상태(`☁ 동기화됨/중/오류`)·이메일·로그아웃. `cloudEnabled` false면 렌더 안 함.
- **ui.jsx** — 테마 위젯 라이브러리(아래).

## 커스텀 위젯 (ui.jsx) — 브라우저 기본 금지, 반드시 재사용
- **`NumInput`** (모든 숫자 칸) — 편집 중 자유롭게 지움(완전 삭제 가능), 비운 채 벗어나면 0, 값은 **문자열로 저장**(계산부는 `+x||0`). 다중 소수점(`1.2.3`)은 emit에서 병합해 0 소실 방지. `width`/`noStepper` 옵션. 스테퍼 버튼.
- **`CSelect`** — 테마 셀렉트(브라우저 기본 대체).
- **`ItemCombo`** — 자유 입력 + 항상 열리는 목록(자주 쓰는 아이템 빠른 교체). `datalist` 금지. `createPortal`로 팝업.
- **`DateInput`/`YMPicker`/`WeekPicker`** — 커스텀 날짜/연월/주차 피커(모두 portal 팝업).
- **`KpiBox`, `CostLabel`, `PlLabel`, `MilUse`, `IconView`** — 수치/라벨 헬퍼. `IconView`는 이모지 또는 http(s) 이미지 URL(트래킹 리퍼러 차단 위해 `referrerPolicy="no-referrer"`, `loading="lazy"`).

## 렌더·React 규칙 (지키지 않으면 버그)
- **컴포넌트는 모듈 스코프에 정의** — 렌더 함수 내부 정의 금지(리마운트로 입력 포커스 유실). `Sec/MonthCal/MvpCal/DayDetail/EntryForm/ConflictModal` 모두 모듈 스코프.
- **리스트 key는 `_k`(또는 항목 id)** — index key 금지. 저장/생성은 `withRowKeys`가, 원장 항목은 `id`가 담당.
- **DB에서 온 배열/객체는 렌더 전 검증** — `chargeMethods`는 `m && typeof m.name === "string"`으로 필터, `defaultItems`(카탈로그)는 `validCatalog`(빈 이름·중복 이름 제거, 모르는 `cat`은 "기타")로 거른다. 이름은 React key이자 `my_items`와의 매칭 키라 빈 이름/중복이 통과하면 key 충돌과 엉뚱한 숨김/수정이 생긴다.
- **자주 쓰는 아이템(3번 카드)** — 카탈로그+내 아이템을 `composeItems`로 합쳐 그린다. 기본 행은 읽기 전용("기본" 배지 + 수정/숨기기), 내 행은 편집 가능("내 아이템"/"수정됨" 배지 + 삭제/되돌리기). 기본값 수정은 `ItemEditModal`(모듈 스코프)로 '내 아이템 복사' 동의를 받고, **이름은 잠근다**(이름이 매칭 키라 바꾸면 원본을 못 가리고 별개 아이템이 생긴다).

## 테마·CSS (styles.css)
- CSS 변수 팔레트(`--bg/--panel/--line/--txt/--accent/...`), 다크 테마.
- **반응형**: `.grid>*{min-width:0}`(넓은 표 때문에 페이지가 뷰포트 넘치는 것 방지 — `.tblx` 내부만 가로 스크롤), `@media(max-width:900px)`(2열→1열), `@media(max-width:600px)`(폰: 폰트·패딩 축소, KPI 1열, 로그인 팝업 폭 제한). 새 위젯도 이 패턴을 따른다.
- 충돌 선택 모달: `.modal-overlay/.modal-card/...`.
