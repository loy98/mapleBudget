# 도메인 로직 — 계산·통계·MVP 규칙

순수 함수 위주(입력→출력, 사이드이펙트 없음). 계산은 `calc.js`, 거래/통계/달력은 `ledger.js`, 값은 `constants.js`, 포매터/날짜는 `util.js`.

## MVP 도메인 규칙 (전역 불변)
- **MVP 주 = 목요일 시작 ~ 수요일 마감** (주 과금 단위). 통계 '특정 주차'·주차별 집계·13주 누적 모두 `weekStartThu`(util.js) 기준. 월력의 "이번주" 하이라이트는 일요일 시작(`weekStartSun`)이라 문맥에 맞게 구분해서 씀.
- **13주 누적 과금 → 추정 MVP 등급**: `estGrade`(util.js) + `TIERS`(constants) 구간.
- **현금화**: 메소(억) + **억당(원/억, `rate`)** 입력 → 판매 현금 자동 산정(`cashWonOf`). 구 데이터(`won` 직접 입력)는 `rate`로 승계하되 `meso=0`이면 rate를 못 만드니 `won` 폴백(손실 방지) — 이 승계는 `normalizeLedger`(storage.js)에서.
- **숫자 입력 규약**: 값은 문자열 저장, 계산부는 `+x || 0`. (프론트 NumInput과 짝)

## calc.js — `computeCalc(settings, charges, items, rules = DEFAULT_RULES)`
계산기 탭의 모든 파생값을 만드는 **단일 순수 함수**. 반환 객체(`calc`)를 App이 useMemo로 캐시해 전 탭에 전달.
- **기초 방식 비교**: 선물식 vs 메소마켓 — 1만원 실적당 순현금(`gift`/`market`), 더 싼 쪽(`giftBest`).
- **충전 배분**: 여러 충전 방식(`charges`: 이름/할인율/월한도)을 할인 높은 순으로 한도만큼 배분 → 평균 충전 할인(`effD`)·배분 내역(`alloc`).
- **경매장 수수료(자동)**: MVP 등급·PC방 여부로 요율(`feePct`, `f`) 결정.
- **목표까지 총비용**: 목표 등급(`tierAmt`)·현재 누적(`curAchieved`)·분할(`SPLITS`) → 남은 실적(`remain`)·최소 실비용(`bestTotal`)·분할 회차.
- **경매장 되팔기 분석**: `items`(캐시가·판매가억·마일가능) 각 행 → 본전(억)·회수현금·손익·1만원당·회수율(`itemRows`), 최적 아이템(`bestName/bestPer`).
- **통합 최적**: 기초 vs 경매장 중 실제 최저(`optTotal/optPer10k/useItem`).
- **마일리지**: 월 적립(≈5% `MILEAGE_ACCRUAL`, 한도)·소요·보유(`earnPerMonth/milNeed/milAvail`).
- **이번 달 최적 플랜**: 구성별 실적/실비용/마일 소모(`plan.steps/totalCost/milUsed`).
> 경계 방어: 0/음수/빈값/거대값. 표시 포매터(`won/eok/ml`)가 `isFinite`로 NaN/Infinity를 "–" 처리.

## ledger.js — 거래/통계/달력/예상
원장(`{buys, sells, cashes, spends}`, 각 항목 `id`)을 입력으로:
- **`ledgerStats(ledger, match, env)`** — 기간 필터(`match`) 내 집계: 총 과금(실적, buys 실적 + spends), 실지출, 판매 메소(실수령), 현금화 메소, 마일 소모, 손익, 현금화율, 건수. `env`=수수료/충전할인/마일리지율.
  - 주의: `st.ach`에 spends(엠작 외 캐시사용)도 MVP 과금으로 합산되지만 `st.spend`(엠작 구매 실지출)에는 buys만 — 정의 차이는 의도(툴팁로 안내). 손익 정의 재검 시 이 부분 확인.
- **`weeklyAch(ledger, ws, mileageR)`** — 특정 주(목~수) 과금.
- **`cumNow(ledger, mileageR)`** — 최근 13주 누적 과금.
- **`dayInfo(ledger, mileageR)`** — 날짜별 과금/건수(달력 셀용).
- **`mesoWeeks(ledger, fee)`** — 주차별 판매/현금화/현금화필요 메소(13주).
- **`cashWonOf(cash)`** — 현금화 항목의 판매현금(rate·meso, won 폴백).
- **예상/추천**(`computeForecast` 계열) — 주 경계·월 1일 판정에 로컬 시간대(KST, DST 없음) 의존. 근사 로직은 UI에 명시.

## constants.js
- `TIERS`(브론즈~블랙 금액), `MVP_GRADES`, `CHARGE_METHODS`(프리셋 목록, app_config가 덮을 수 있음), `DEFAULT_SETTINGS`(시세성 기본값), `DEFAULT_ITEMS`(자주 쓰는 아이템 기본), `DEFAULT_CHARGES`/`DEFAULT_CALC_ITEMS`, `SPLITS`(분할 방식), `WD_MVP`(목~수)/`WD_SUN`, `MILEAGE_ACCRUAL`(0.05).
- **시세성 기본값(mesoRate/giftRatio/marketRatio·chargeMethods·defaultItems·rules)은 런타임에 `app_config`(DB)가 덮을 수 있음** — [sync-backend.md](sync-backend.md), [data-layer.md](data-layer.md). constants는 폴백.
- `DEFAULT_ITEMS`는 **카탈로그의 폴백**이다(유저 `my_items`에 심지 않는다). `ITEM_CATS`/`itemCat`으로 분류, 화면 조립은 `lib/items.js` `composeItems`.
- `DEFAULT_SETTINGS.curSource` — 계산기의 '현재 누적 실적' 출처(`"manual"` 직접 입력 / `"ledger"` 거래 기록 13주 누적). 기본 `"manual"`(기록 0건인 첫 방문자가 입력칸이 잠긴 채 0원에 갇히지 않도록).

## util.js
- 포매터: `won`(원)·`pct`(%)·`eok`(억)·`ml`(마일)·`manW`(만원) — 전부 `isFinite` 방어.
- 날짜: `fmtD/todayStr/curMonth/addDays/start13/weekStartThu/weekStartSun/mmdd`.
- `uid()`(랜덤 id)·`estGrade`(누적→등급).
