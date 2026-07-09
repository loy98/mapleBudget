import { useMemo } from "react";
import { mmdd, fmtD, todayStr, curMonth, addDays, start13, weekStartThu } from "../../lib/util.js";
import { weeklyAch, cumNow, ledgerStats, dayInfo, mesoWeeks, weeklyItems, itemSummary } from "../../lib/ledger.js";

// LogTab 의 파생값 전부를 한 곳에 모은다. 원장·계산기 값에서 나오는 순수 파생이라
// 렌더 로직과 섞여 있을 이유가 없고, 섞여 있으면 useMemo 의존성 실수가 눈에 띄지 않는다.
// 반환값은 LogTab 이 각 패널에 나눠 넘긴다.
export function useLedgerDerived({ ledger, calc, myItems, periodMode, statMonth, statWeek }) {
  const env = { fee: calc.f, effD: calc.effD, mileageR: calc.mileageR };

  const match = useMemo(() => {
    if (periodMode === "all") return () => true;
    if (periodMode === "month") { const m = statMonth || curMonth(); return (dt) => (dt || "").indexOf(m) === 0; }
    if (periodMode === "week") {
      const ws = statWeek;
      const we = fmtD(addDays(new Date(statWeek + "T00:00:00"), 6));
      return (dt) => (dt || "") >= ws && (dt || "") <= we;
    }
    const s = fmtD(start13());
    return (dt) => (dt || "") >= s;
  }, [periodMode, statMonth, statWeek]);

  const st = useMemo(() => ledgerStats(ledger, match, env), [ledger, match, calc]);
  const cum = useMemo(() => cumNow(ledger, calc.mileageR), [ledger, calc.mileageR]);
  const days = useMemo(() => dayInfo(ledger, calc.mileageR), [ledger, calc.mileageR]);

  // today를 deps에 포함해 날짜(주 경계 포함)가 바뀌면 최근 13주/주차 목록이 갱신되게 한다.
  const today = todayStr();
  const mWeeks = useMemo(() => mesoWeeks(ledger, calc.f), [ledger, calc.f, today]);

  // 주차별 표 하단 합계 (13주 창 기준)
  const wkTot = useMemo(
    () => mWeeks.reduce(
      (a, w) => ({ buyQty: a.buyQty + w.buyQty, sellQty: a.sellQty + w.sellQty, sold: a.sold + w.sold, cashed: a.cashed + w.cashed, need: a.need + w.need }),
      { buyQty: 0, sellQty: 0, sold: 0, cashed: 0, need: 0 }
    ),
    [mWeeks]
  );
  const uncashed = st.meso - st.cashMeso;

  // 주차별 품목 내역 — 합계는 mWeeks 의 buyQty/sellQty 와 일치한다.
  const mWeekItems = useMemo(() => mWeeks.map((w) => weeklyItems(ledger, w.ws, calc.f)), [mWeeks, ledger, calc.f]);

  // 품목별 손익 환산율(억당 원): 기간 내 실제 현금화가 있으면 실측, 없으면 계산기 시세(mesoRate).
  const measuredRate = st.cashMeso > 0 && st.cashWon > 0;
  const rateWon = measuredRate ? st.cashWon / st.cashMeso : (+calc.s || 0) * 1e8;
  const itemRows = useMemo(() => itemSummary(ledger, match, env, rateWon), [ledger, match, calc, rateWon]);

  // 품목 아이콘 조회 — myItems 는 DB(app_config)에서 올 수 있어 malformed 원소를 걸러낸다.
  // icon 은 반드시 문자열만 통과시킨다(객체/배열이면 IconView 가 React child 크래시).
  const iconOf = useMemo(() => {
    const m = {};
    (myItems || []).forEach((it) => {
      if (it && typeof it.name === "string" && typeof it.icon === "string" && it.icon) m[it.name.trim()] = it.icon;
    });
    return m;
  }, [myItems]);

  // 최근 13주 주간 과금(실적) 시리즈 — 스파크라인용
  const weekly13 = useMemo(
    () => Array.from({ length: 13 }, (_, w) => weeklyAch(ledger, addDays(start13(), w * 7), calc.mileageR)),
    [ledger, calc.mileageR, today]
  );
  // 스파크라인 x축 눈금(주 시작일) + 툴팁 제목(목~수 구간). weekly13와 같은 순서·기준.
  const weekly13Labels = useMemo(
    () =>
      Array.from({ length: 13 }, (_, w) => {
        const ws = addDays(start13(), w * 7);
        return { short: mmdd(ws), full: mmdd(ws) + "~" + mmdd(addDays(ws, 6)), cur: w === 12 };
      }),
    [today]
  );

  // 주차 선택 목록 (MVP 주: 목~수, 최근 26주 최신순)
  const weekOptions = useMemo(() => {
    const base = weekStartThu(new Date());
    const curKey = fmtD(base);
    const arr = [];
    for (let i = 0; i < 26; i++) {
      const ws = addDays(base, -i * 7), we = addDays(ws, 6), key = fmtD(ws);
      arr.push({ key, label: mmdd(ws) + "~" + mmdd(we), cur: key === curKey });
    }
    return arr;
  }, [today]);

  const soldNames = useMemo(() => {
    const names = {};
    ledger.buys.forEach((b) => { if (b.item) names[b.item] = 1; });
    return Object.keys(names);
  }, [ledger.buys]);

  const selWeek = weekOptions.find((w) => w.key === statWeek);
  const periodRange =
    periodMode === "w13" ? mmdd(start13()) + " ~ " + mmdd(new Date()) + " · 최근 13주"
    : periodMode === "month" ? (statMonth || curMonth()) + " 한 달"
    : periodMode === "week" ? (selWeek ? selWeek.label : statWeek) + " · 한 주(목~수)"
    : "전체 기간";

  const mvLabel = statMonth || curMonth();

  return {
    env, match, st, cum, days, mWeeks, wkTot, uncashed, mWeekItems,
    measuredRate, rateWon, itemRows, iconOf,
    weekly13, weekly13Labels, weekOptions, soldNames,
    periodRange, mvLabel,
  };
}
