import { fmtD, start13, addDays, weekStartThu, estGrade } from "./util.js";
import { TIERS } from "./constants.js";

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
        mf = b.mil ? mileageR : 0;
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
  for (let w = 0; w < 13; w++) c += weeklyAch(ledger, addDays(s, w * 7), mileageR);
  return c;
}

// ===== 기간 통계 =====
export function ledgerStats(ledger, match, { fee, effD, mileageR }) {
  const st = { ach: 0, spend: 0, mil: 0, meso: 0, cashMeso: 0, cashWon: 0, extra: 0, buys: 0, sells: 0, cashes: 0, spends: 0 };
  ledger.buys.forEach((b) => {
    if (match(b.date)) {
      const q = +b.qty || 0,
        p = +b.price || 0,
        mf = b.mil ? mileageR : 0;
      st.ach += q * p * (1 - mf);
      st.mil += q * p * mf;
      st.spend += q * p * (1 - mf) * (1 - effD);
      st.buys++;
    }
  });
  ledger.sells.forEach((sl) => {
    if (match(sl.date)) {
      st.meso += (+sl.qty || 0) * (+sl.meso || 0) * (1 - fee);
      st.sells++;
    }
  });
  ledger.cashes.forEach((c) => {
    if (match(c.date)) {
      st.cashMeso += +c.meso || 0;
      st.cashWon += +c.won || 0;
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
      mf = b.mil ? mileageR : 0;
    add(b.date, q * p * (1 - mf));
  });
  ledger.spends.forEach((s) => add(s.date, +s.amount || 0));
  ledger.sells.forEach((x) => add(x.date, 0));
  ledger.cashes.forEach((x) => add(x.date, 0));
  return map;
}

// ===== 예상 & 추천: 목표 등급 유지 스케줄 =====
export function computeForecast(ledger, mileageR, tierIdx, timing, includeThis, optPer10k) {
  const C = cumNow(ledger, mileageR);
  const T = TIERS[tierIdx].amt;
  const cur = weekStartThu(new Date());
  const weekOf = (o) => addDays(cur, o * 7);
  const achPast = (o) => weeklyAch(ledger, weekOf(o), mileageR);
  const immediate = Math.max(0, T - C);
  const startOff = includeThis ? 0 : 1;
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

  const x = {};
  for (let o = startOff; o <= 13; o++) {
    const ws = weekOf(o);
    let charge = false;
    if (timing === "weekly") charge = true;
    else if (timing === "biweekly") charge = (o - startOff) % 2 === 0;
    else if (timing === "month1") charge = has1st(ws);
    else if (timing === "monthLast") charge = hasLast(ws);
    if (charge) x[o] = perCharge;
  }
  const achAt = (o) => (o < startOff ? achPast(o) : x[o] || 0);

  let total = 0;
  for (let o = startOff; o <= 13; o++) total += x[o] || 0;
  const cost = (total / 10000) * optPer10k;

  const rows = [];
  let reached = null;
  for (let i = startOff; i <= 13; i++) {
    const ws = weekOf(i),
      we = addDays(ws, 6);
    let sum = 0;
    for (let oo = i - 12; oo <= i; oo++) sum += achAt(oo);
    const g = estGrade(sum);
    if (reached === null && sum >= T) reached = i;
    rows.push({ i, ws, we, charge: x[i] > 0 ? x[i] : 0, sum, grade: g });
  }
  return { C, T, immediate, perCharge, total, cost, rows, reached, startOff };
}
