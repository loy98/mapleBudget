import { fmtD, start13, addDays, weekStartThu, estGrade, nowD } from "./util.js";
import { TIERS, WINDOW_WEEKS, LEDGER_BUCKETS } from "./constants.js";

// 이 원장에 거래가 하나라도 있는가. 계산기가 '내 기록' 모드를 권할지 판단하는 데 쓴다
// (기록이 0건이면 그 모드는 0원을 잠가 놓는 것이라 권할 이유가 없다).
export const hasLedgerEntries = (l) =>
  !!l && LEDGER_BUCKETS.some((b) => Array.isArray(l[b]) && l[b].length > 0);

// ===== 거래별 요율 =====
// 과거 거래를 '현재 설정'으로 계산하면, 사용자가 설정을 바꾸는 순간 과거 기록이 조용히 변한다(B-5).
// 그래서 요율은 스칼라가 아니라 **거래 행을 받는 함수**로도 넘길 수 있다:
//   · 마일리지 결제 비율 = 거래일에 유효한 넥슨 규칙 (rulesAt)
//   · 경매장 수수료 / 충전 할인 = 거래 행의 스냅샷(_fee/_effD), 없으면 현재 설정으로 폴백
// 숫자도 그대로 받는다(구 호출부·테스트 호환). 이 헬퍼가 둘을 흡수한다.
// 유한하지 않은 값은 0으로 떨어뜨린다. malformed 스냅샷을 '수수료 0%'로 조용히 바꾸지 않으려면
// **호출측(env)이 먼저** 유효성을 검사해 현재 설정으로 폴백해야 한다(useLedgerDerived 참고).
const rate = (r, row) => {
  const n = +(typeof r === "function" ? r(row) : r);
  return Number.isFinite(n) ? n : 0;
};

// ===== 주간 과금 (MVP 주: 목~수) =====
export function weeklyAch(ledger, ws, mileageR) {
  const e = addDays(ws, 6);
  const ss = fmtD(ws),
    es = fmtD(e);
  let tot = 0;
  ledger.buys.forEach((b) => {
    if (b.date >= ss && b.date <= es) {
      const q = +b.qty || 0,
        p = +b.price || 0,
        mf = b.mil ? rate(mileageR, b) : 0;
      tot += q * p * (1 - mf);
    }
  });
  ledger.spends.forEach((sp) => {
    if (sp.date >= ss && sp.date <= es) tot += +sp.amount || 0;
  });
  return tot;
}

// 최근 13주 누적 과금
export function cumNow(ledger, mileageR) {
  const s = start13();
  let c = 0;
  for (let w = 0; w < WINDOW_WEEKS; w++) c += weeklyAch(ledger, addDays(s, w * 7), mileageR);
  return c;
}

// 현금화 판매현금: 억당(rate) 기반이면 메소×억당, 아니면(구 데이터) 저장된 won 사용
export function cashWonOf(c) {
  if (c.rate != null && c.rate !== "") return (+c.meso || 0) * (+c.rate || 0);
  return +c.won || 0;
}

// 한 주(목~수)의 거래 현황
// buyQty/sellQty = 그 주에 구매·판매한 아이템 '개수'(수량 합, 미입력은 1개로 보지 않고 0)
// sold = 판매 실수령 메소 / cashed = 현금화 메소 / need = 판매−현금화
export function weeklyMeso(ledger, ws, fee) {
  const we = addDays(ws, 6);
  const ss = fmtD(ws), es = fmtD(we);
  let sold = 0, cashed = 0, buyQty = 0, sellQty = 0;
  ledger.buys.forEach((b) => {
    if (b.date >= ss && b.date <= es) buyQty += +b.qty || 0;
  });
  ledger.sells.forEach((sl) => {
    if (sl.date >= ss && sl.date <= es) {
      sellQty += +sl.qty || 0;
      sold += (+sl.qty || 0) * (+sl.meso || 0) * (1 - rate(fee, sl));
    }
  });
  ledger.cashes.forEach((c) => {
    if (c.date >= ss && c.date <= es) cashed += +c.meso || 0;
  });
  return { buyQty, sellQty, sold, cashed, need: sold - cashed };
}

// ===== 품목별 집계 =====
// 품목명이 비어 있는 항목도 버려선 안 된다. weeklyMeso 의 buyQty/sellQty 는 품목 유무와 무관하게
// 수량을 더하므로, 품목별 행의 합이 주차 합계와 어긋나지 않도록 단일 버킷으로 묶는다.
export const NO_ITEM = "(품목 미입력)";
const itemKey = (v) => (v == null ? "" : String(v)).trim() || NO_ITEM;

// 거래량 많은 순 → 동률이면 이름순
const byVolume = (a, b) =>
  b.buyQty + b.sellQty - (a.buyQty + a.sellQty) || a.name.localeCompare(b.name, "ko");

// 한 주(목~수)의 품목별 구매/판매 내역
// buyQty/sellQty 의 합은 weeklyMeso 의 buyQty/sellQty 와 정확히 일치한다.
// avg  = 개당 평균 판매가(억) — 거래 입력 화면에 적은 값 그대로(수수료 차감 전)
// sold = 판매 실수령 메소(억) — 수수료 반영
export function weeklyItems(ledger, ws, fee) {
  const we = addDays(ws, 6);
  const ss = fmtD(ws), es = fmtD(we);
  const map = new Map();
  const row = (n) => {
    if (!map.has(n)) map.set(n, { name: n, buyQty: 0, sellQty: 0, gross: 0, sold: 0 });
    return map.get(n);
  };
  ledger.buys.forEach((b) => {
    if (b.date >= ss && b.date <= es) row(itemKey(b.item)).buyQty += +b.qty || 0;
  });
  ledger.sells.forEach((sl) => {
    if (sl.date >= ss && sl.date <= es) {
      const q = +sl.qty || 0, m = +sl.meso || 0, r = row(itemKey(sl.item));
      r.sellQty += q;
      r.gross += q * m;
      r.sold += q * m * (1 - rate(fee, sl));
    }
  });
  return [...map.values()]
    .filter((r) => r.buyQty || r.sellQty)
    .map((r) => ({ ...r, avg: r.sellQty > 0 ? r.gross / r.sellQty : 0 }))
    .sort(byVolume);
}

// 품목별 누적 요약
// buyQty/sellQty/spend/sold/avg = 선택 기간(match) 기준.
// stock(재고) = 전체 원장 누적 구매−판매. 산 주와 판 주가 다를 수 있어 기간으로 자르면 음수가 되므로
//   기간과 무관하게 계산한다. 표시 행은 '기간 내 거래가 있었던 품목'으로만 추린다.
// profit(추정 손익, 원) = 판매 실수령 메소 × rateWon − 구매 실지출.
//   현금화(cashes)는 메소를 뭉텅이로 파는 것이라 품목에 귀속되지 않는다. 그래서 억당 환산율을
//   호출측에서 주입받아 '추정'으로만 낸다. rateWon 이 없으면(≤0) profit 은 null.
export function itemSummary(ledger, match, { fee, effD, mileageR }, rateWon) {
  const r = isFinite(rateWon) && rateWon > 0 ? rateWon : 0;
  const map = new Map();
  const row = (n) => {
    if (!map.has(n)) map.set(n, { name: n, buyQty: 0, sellQty: 0, gross: 0, sold: 0, spend: 0, stock: 0 });
    return map.get(n);
  };
  // 재고는 전체 기간 누적
  ledger.buys.forEach((b) => { row(itemKey(b.item)).stock += +b.qty || 0; });
  ledger.sells.forEach((sl) => { row(itemKey(sl.item)).stock -= +sl.qty || 0; });

  ledger.buys.forEach((b) => {
    if (!match(b.date)) return;
    const q = +b.qty || 0, p = +b.price || 0, mf = b.mil ? rate(mileageR, b) : 0;
    const t = row(itemKey(b.item));
    t.buyQty += q;
    t.spend += q * p * (1 - mf) * (1 - rate(effD, b));
  });
  ledger.sells.forEach((sl) => {
    if (!match(sl.date)) return;
    const q = +sl.qty || 0, m = +sl.meso || 0, t = row(itemKey(sl.item));
    t.sellQty += q;
    t.gross += q * m;
    t.sold += q * m * (1 - rate(fee, sl));
  });
  return [...map.values()]
    .filter((x) => x.buyQty || x.sellQty)
    .map((x) => ({
      ...x,
      avg: x.sellQty > 0 ? x.gross / x.sellQty : 0,
      profit: r > 0 ? x.sold * r - x.spend : null,
    }))
    .sort(byVolume);
}

// 최근 13주 주차별 메소 현황
export function mesoWeeks(ledger, fee) {
  const s = start13();
  const arr = [];
  for (let w = 0; w < WINDOW_WEEKS; w++) {
    const ws = addDays(s, w * 7);
    arr.push({ ws, we: addDays(ws, 6), ...weeklyMeso(ledger, ws, fee) });
  }
  return arr;
}

// ===== 기간 통계 =====
export function ledgerStats(ledger, match, { fee, effD, mileageR }) {
  const st = { ach: 0, spend: 0, mil: 0, meso: 0, cashMeso: 0, cashWon: 0, extra: 0, buys: 0, sells: 0, cashes: 0, spends: 0 };
  ledger.buys.forEach((b) => {
    if (match(b.date)) {
      const q = +b.qty || 0,
        p = +b.price || 0,
        mf = b.mil ? rate(mileageR, b) : 0;
      st.ach += q * p * (1 - mf);
      st.mil += q * p * mf;
      st.spend += q * p * (1 - mf) * (1 - rate(effD, b));
      st.buys++;
    }
  });
  ledger.sells.forEach((sl) => {
    if (match(sl.date)) {
      st.meso += (+sl.qty || 0) * (+sl.meso || 0) * (1 - rate(fee, sl));
      st.sells++;
    }
  });
  ledger.cashes.forEach((c) => {
    if (match(c.date)) {
      st.cashMeso += +c.meso || 0;
      st.cashWon += cashWonOf(c);
      st.cashes++;
    }
  });
  ledger.spends.forEach((sp) => {
    if (match(sp.date)) {
      st.extra += +sp.amount || 0;
      st.ach += +sp.amount || 0;
      st.spends++;
    }
  });
  st.profit = st.cashWon - st.spend;
  st.ratio = st.meso > 0 ? st.cashMeso / st.meso : 0;
  return st;
}

// ===== 달력용 일별 요약 =====
export function dayInfo(ledger, mileageR) {
  const map = {};
  const add = (dt, a) => {
    if (!dt) return;
    if (!map[dt]) map[dt] = { n: 0, ach: 0 };
    map[dt].n++;
    map[dt].ach += a || 0;
  };
  ledger.buys.forEach((b) => {
    const q = +b.qty || 0,
      p = +b.price || 0,
      mf = b.mil ? rate(mileageR, b) : 0;
    add(b.date, q * p * (1 - mf));
  });
  ledger.spends.forEach((s) => add(s.date, +s.amount || 0));
  ledger.sells.forEach((x) => add(x.date, 0));
  ledger.cashes.forEach((x) => add(x.date, 0));
  return map;
}

// ===== 예상 & 추천: 목표 등급 유지 스케줄 =====
export function computeForecast(ledger, mileageR, tierIdx, timing, includeThis, optPer10k, tiers = TIERS) {
  const C = cumNow(ledger, mileageR);
  // tierIdx 는 셀렉트 값이라 tiers 길이가 DB에서 바뀌면 범위를 벗어날 수 있다 → 마지막 등급으로 클램프.
  const tier = tiers[tierIdx] || tiers[tiers.length - 1];
  const T = tier.amt;
  const cur = weekStartThu(nowD());
  const weekOf = (o) => addDays(cur, o * 7);
  const achPast = (o) => weeklyAch(ledger, weekOf(o), mileageR);
  const immediate = Math.max(0, T - C);
  const startOff = includeThis ? 0 : 1;
  // divisor = '13주 롤링 창에 최소 몇 번 과금이 들어가는가'(격주 최악 6회, 월 1회 최소 3회).
  // SPLITS 의 '격주=7회'와 다른 이유이며 창 유지에 필요한 회당 금액으로는 이쪽이 맞다.
  const divisor = timing === "weekly" ? 13 : timing === "biweekly" ? 6 : 3;
  const perCharge = T / divisor;

  const has1st = (ws) => {
    let d = new Date(ws);
    for (let k = 0; k < 7; k++) {
      if (d.getDate() === 1) return true;
      d = addDays(d, 1);
    }
    return false;
  };
  const hasLast = (ws) => {
    let d = new Date(ws);
    for (let k = 0; k < 7; k++) {
      if (addDays(d, 1).getDate() === 1) return true;
      d = addDays(d, 1);
    }
    return false;
  };

  // 예측 지평은 startOff 부터 13주. 이전에는 `o <= 13` 이라 includeThis(startOff=0)일 때
  // 14주에 과금이 배정되어 총액이 목표의 107.7%(14×T/13)가 됐다.
  const lastOff = startOff + WINDOW_WEEKS - 1;

  const x = {};
  for (let o = startOff; o <= lastOff; o++) {
    const ws = weekOf(o);
    let charge = false;
    if (timing === "weekly") charge = true;
    else if (timing === "biweekly") charge = (o - startOff) % 2 === 0;
    else if (timing === "month1") charge = has1st(ws);
    else if (timing === "monthLast") charge = hasLast(ws);
    if (charge) x[o] = perCharge;
  }
  // 지나간 주와 이번 주(o<=0)의 과금은 '이미 일어난 사실'이므로 언제나 원장에서 읽는다.
  // 계획값 x[o] 는 그 위에 더한다. 이전에는 includeThis 일 때 o=0 이 계획값으로 '대체'되어
  // 이번 주에 이미 쓴 돈이 롤링 창에서 통째로 사라졌다(체크박스를 켤수록 도달이 늦어지는 역설).
  const achAt = (o) => (o <= 0 ? achPast(o) : 0) + (o >= startOff ? x[o] || 0 : 0);

  let total = 0;
  for (let o = startOff; o <= lastOff; o++) total += x[o] || 0;
  const cost = (total / 10000) * optPer10k;

  const rows = [];
  let reached = null;
  for (let i = startOff; i <= lastOff; i++) {
    const ws = weekOf(i),
      we = addDays(ws, 6);
    let sum = 0;
    for (let oo = i - (WINDOW_WEEKS - 1); oo <= i; oo++) sum += achAt(oo);
    const g = estGrade(sum, tiers);
    if (reached === null && sum >= T) reached = i;
    rows.push({ i, ws, we, charge: x[i] > 0 ? x[i] : 0, sum, grade: g });
  }
  return { C, T, immediate, perCharge, total, cost, rows, reached, startOff };
}
