# 아키텍처 문서 — 메이플 MVP작 효율 계산기

이 폴더는 프로젝트를 **분야별로** 상세히 설명하는 에이전트·개발자용 참조 문서다. 코드를 바꾸기 전 해당 분야 문서를 먼저 읽는다. (형식은 토큰·독해·grep·편집 이점 때문에 Markdown으로 유지 — 시각화가 필요하면 그때만 렌더.)

## 목차
- [frontend.md](frontend.md) — UI 컴포넌트·상태 소유·테마/CSS·커스텀 위젯·렌더 규칙
- [domain-logic.md](domain-logic.md) — 계산(calc.js)·통계/주차/현금화(ledger.js)·상수·MVP 도메인 규칙
- [data-layer.md](data-layer.md) — storage.js 순수 함수·localStorage 키·안정 key·touched·calMode·내보내기/가져오기
- [sync-backend.md](sync-backend.md) — useCloudSync 훅·Supabase(user_data/app_config)·RLS·인증·동기화 불변식·충돌 모달·**아이템 소유권(카탈로그/내 아이템)**
- [infra-and-ops.md](infra-and-ops.md) — Cloudflare Pages·커스텀 도메인·.env·CSP·schema.sql·테스트·검증 프로토콜

관련: 상위 규칙은 [/CLAUDE.md](../../CLAUDE.md), 검수 백로그는 [../hardening-backlog.md](../hardening-backlog.md), 코드 개요는 [/README.md](../../README.md).

## 한눈에 보기

**정체**: 메이플스토리 MVP 등급작(엠작) 최적 비용 계산기. **Vite + React 18 SPA**, 한국어 UI, 라우터 없음(탭 state). 게스트(localStorage) 우선 + 선택적 **Supabase** 다인용 클라우드 동기화. **Cloudflare Pages** 배포.

**3개 탭**: 계산기 · 거래 기록(통계/달력/입력) · 예상 & 추천.

**핵심 설계 원칙**
1. **게스트 모드 우선** — 로그인 없이 localStorage로 완전 동작. 로그인은 "동기화 켜기"(선택).
2. **순수 데이터 계층 공유** — `storage.js`의 순수 함수를 localStorage·클라우드가 함께 사용(형태 동일). 구버전 저장 키 유지로 데이터 승계.
3. **상태 소유 분리** — App은 계산기 상태·렌더만, 클라우드 연동은 `useCloudSync` 훅에 응집.
4. **UI 일관성** — 브라우저 기본 위젯 금지, `ui.jsx` 테마 컴포넌트 재사용.
5. **보안은 RLS가 담당** — 공개키는 브라우저 노출 정상, 본인 행만 접근은 Supabase RLS.

## 파일 지도

```
src/
  main.jsx                  # 엔트리(React 마운트, PWA 등록)
  App.jsx                   # 루트: 계산기 상태 소유·탭 렌더·useCloudSync 호출·충돌 모달
  styles.css                # 테마(다크)·전 컴포넌트 스타일·반응형(@media 900/600)
  lib/
    calc.js                 # 순수 계산 computeCalc(엠작 방식·총비용·경매장·마일리지·플랜)
    ledger.js               # 거래 통계·주차(목~수)·현금화·달력 집계·예상
    constants.js            # TIERS/CHARGE_METHODS/MVP_GRADES/DEFAULT_*/SPLITS/요일/적립률
    util.js                 # 포매터(won/pct/eok/ml)·날짜(weekStartThu 등)·uid·estGrade
    storage.js              # 순수 parse/serialize/normalize·localStorage·withRowKeys·touched·calMode·export/import
    cloud.js                # Supabase 인증·user_data·app_config·mergeSnapshots
    useCloudSync.js         # 동기화 훅(세션·config·초기동기화·업로드·충돌모달)
    supabaseClient.js       # Supabase 클라이언트 생성(공개 .env 값)
    pure.test.js            # vitest: 순수 함수 회귀(22건)
  components/
    CalcTab.jsx             # 계산기 탭(시세·조건·방식비교·총비용·경매장·마일리지·플랜)
    LogTab.jsx              # 거래 기록(통계·달력 월력/MVP주간·거래 입력·일자 상세)
    ForecastTab.jsx         # 예상 & 추천
    ui.jsx                  # 테마 위젯(NumInput/CSelect/ItemCombo/DateInput/YMPicker/WeekPicker/KpiBox/라벨)
    AuthBar.jsx             # 로그인/동기화 상태 바
supabase/schema.sql         # user_data + app_config DDL/RLS/시드
public/_headers             # CSP·보안 헤더(Cloudflare Pages)
docs/                       # 이 문서들 + hardening-backlog.md
.env / .node-version        # 공개 Supabase 설정 / Node 22
```

## 데이터 흐름 (요약)
```
사용자 입력 → App 상태(settings/charges/items/myItems/ledger)
           → useMemo computeCalc(순수) → 파생값 calc → 컴포넌트 표시
           → useEffect 자동 저장(localStorage)                (게스트/로그인 공통 캐시)
           → (로그인 시) useCloudSync: 디바운스 upsert → Supabase user_data(RLS 본인 행)
로드/로그인 → useCloudSync: fetchUserData → mergeSnapshots(로컬↔클라우드) → 상태 반영
앱 설정     → useCloudSync: fetchAppConfig(app_config, 공개 읽기) → 시세 기본값/force + 카탈로그(defaultItems, 화면에서 합침)
```
