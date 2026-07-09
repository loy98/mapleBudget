import { SPLITS, DEFAULT_RULES } from "./constants.js";

// ===== 기본 파라미터 =====
// 메소→원 환산 계수: (원/1억메소) / 1e8
export const mesoS = (mesoRate) => (+mesoRate || 0) / 1e8;

// 경매장 수수료(%): MVP 브론즈+ 또는 프리미엄 PC방이면 우대 수수료, 아니면 기본 수수료.
// 수수료율은 넥슨이 정하는 규칙이므로 rules 로 주입받는다(app_config 로 재배포 없이 변경 가능).
export function computeFeePct(mvpGrade, pcRoom, rules = DEFAULT_RULES) {
  return +mvpGrade >= 1 || pcRoom === "1" ? rules.feeMvp : rules.feeBase;
}

// ===== 충전 배분 =====
// C원을 M개월에 걸쳐 충전할 때, 할인율 높은 방식부터 월한도만큼 배분
export function allocateCharge(C, M, chargeRows) {
  const rows = (chargeRows || []).filter((r) => isFinite(r.rate));
  if (!rows.length) return { realCash: C, discWon: 0, disc: 0, leftover: C, breakdown: [] };
  const sorted = [...rows].sort((a, b) => b.rate - a.rate);
  let left = C,
    discWon = 0;
  const bd = [];
  sorted.forEach((r) => {
    if (left <= 0) return;
    const cap = r.limit > 0 ? r.limit * M : Infinity;
    const use = Math.min(left, cap);
    if (use > 0) {
      discWon += use * (r.rate / 100);
      bd.push({ name: r.name || "방식", use, rate: r.rate });
      left -= use;
    }
  });
  const dRate = C > 0 ? discWon / C : sorted[0].rate / 100;
  return { realCash: C - discWon, discWon, disc: dRate, leftover: Math.max(0, left), breakdown: bd };
}

// 1만원 실적당 순현금 (기초 방식: 비율 rate로 메소 회수)
export const costPer10k = (rate, disc, s) => 10000 * ((1 - disc) - rate * s);

// ===== 이번 달 최적 실행 플랜 =====
export function buildPlan(monthlyAch, availMil, f, s, bestBasic, giftBest, itemList, effD, mileageR) {
  const modes = [];
  modes.push({ label: (giftBest ? "선물식" : "메소마켓") + " 충전", costPerAch: bestBasic / 10000, milPerAch: 0 });
  itemList.forEach((it) => {
    const recovered = it.sell * 1e8 * (1 - f) * s;
    modes.push({
      label: "경매장 되팔기 · " + it.name,
      costPerAch: (it.cash * (1 - effD) - recovered) / it.cash,
      milPerAch: 0,
    });
    if (it.useMil && mileageR > 0) {
      const achM = it.cash * (1 - mileageR);
      const costM = it.cash * (1 - mileageR) * (1 - effD) - recovered;
      const milM = it.cash * mileageR;
      modes.push({ label: "경매장 · " + it.name + " (마일리지)", costPerAch: costM / achM, milPerAch: milM / achM });
    }
  });
  modes.sort((a, b) => a.costPerAch - b.costPerAch);
  let achLeft = monthlyAch,
    milLeft = availMil,
    totalCost = 0,
    milUsed = 0;
  const steps = [];
  for (let i = 0; i < modes.length && achLeft > 1e-6; i++) {
    const m = modes[i];
    let achHere = achLeft;
    if (m.milPerAch > 0) achHere = Math.min(achHere, milLeft / m.milPerAch);
    if (achHere <= 1e-6) continue;
    const costHere = achHere * m.costPerAch,
      milHere = achHere * m.milPerAch;
    totalCost += costHere;
    milUsed += milHere;
    achLeft -= achHere;
    milLeft -= milHere;
    steps.push({ label: m.label, ach: achHere, cost: costHere, mil: milHere });
  }
  return { steps, totalCost, milUsed, achLeft };
}

// ===== 계산기 전체 파생값 =====
// settings: DEFAULT_SETTINGS 형태, charges: [{name,rate,limit}], items: [{name,cash,sell,mAllowed,mil}]
export function computeCalc(settings, charges, items, rules = DEFAULT_RULES) {
  const s = mesoS(settings.mesoRate);
  const feePct = computeFeePct(settings.mvpGrade, settings.pcRoom, rules);
  const f = feePct / 100;
  const sp = SPLITS[+settings.months || 0] || SPLITS[0];
  const months = sp.span,
    installments = sp.n;
  const target = +settings.tierAmt || 0,
    cur = +settings.curAchieved || 0;
  const remain = Math.max(0, target - cur);
  const alloc = allocateCharge(remain, months, charges);
  const effD = alloc.disc;
  // 마일리지 결제 비율은 넥슨 규칙(rules)이다. 사용자 설정이 아니다.
  const mileageR = (+rules.mileageRate || 0) / 100;

  const gr = +settings.giftRatio || 0,
    mr = +settings.marketRatio || 0;
  const gift = costPer10k(gr, effD, s),
    market = costPer10k(mr, effD, s);
  const giftBest = gift <= market;
  const bestBasic = Math.min(gift, market),
    bestRatio = giftBest ? gr : mr;
  const netRate = (bestBasic / 10000) * 100;

  const chargeCash = alloc.realCash,
    recovered = remain * bestRatio * s;
  const bestTotal = chargeCash - recovered;

  // 아이템 행별 계산
  let sumAch = 0,
    sumCost = 0,
    bestPer = Infinity,
    bestName = "–",
    milNeed = 0;
  const itemList = [];
  const itemRows = items.map((it) => {
    const cash = +it.cash || 0,
      sellEok = +it.sell || 0;
    const useM = it.mAllowed !== false && !!it.mil;
    const nm = it.name || "(무명)";
    if (cash && sellEok > 0) itemList.push({ name: nm, cash, sell: sellEok, mAllowed: it.mAllowed !== false, useMil: useM });
    if (!cash) return { empty: true };
    const mRate = useM ? mileageR : 0;
    if (useM) milNeed += cash * mRate;
    const cashPortion = cash * (1 - mRate),
      realCost = cashPortion * (1 - effD),
      ach = cashPortion;
    const recoveredItem = sellEok * 1e8 * (1 - f) * s;
    const profit = recoveredItem - realCost;
    const breakEok = realCost / ((1 - f) * s) / 1e8;
    const perCost = ach > 0 ? ((realCost - recoveredItem) / ach) * 10000 : NaN;
    const recRate = realCost > 0 ? (recoveredItem / realCost) * 100 : NaN;
    sumAch += ach;
    sumCost += realCost - recoveredItem;
    return { empty: false, breakEok, recoveredItem, profit, perCost, recRate, name: nm, sellEok };
  });
  itemRows.forEach((r) => {
    if (!r.empty && r.sellEok > 0 && r.perCost < bestPer) {
      bestPer = r.perCost;
      bestName = r.name;
    }
  });
  itemRows.forEach((r) => {
    r.win = !r.empty && r.name === bestName && isFinite(bestPer) && r.perCost === bestPer;
  });

  const useItem = isFinite(bestPer) && bestPer < bestBasic;
  const optPer10k = useItem ? bestPer : bestBasic;
  const optMethodName = useItem ? "경매장 되팔기 · " + bestName : giftBest ? "선물식" : "메소마켓";
  const optTotal = useItem ? (remain * optPer10k) / 10000 : bestTotal;

  // 마일리지
  const milCap = +settings.milCap || 0,
    milAvail = +settings.milAvail || 0;
  const monthlyCharge = remain / months;
  const rawMonth = monthlyCharge * rules.mileageAccrual;
  const capM = milCap > 0 ? milCap : Infinity;
  const earnPerMonth = Math.min(rawMonth, capM);

  // 이번 달 플랜
  const monthlyAch = remain / months;
  const plan = buildPlan(monthlyAch, milAvail, f, s, bestBasic, giftBest, itemList, effD, mileageR);

  return {
    s, f, feePct, months, installments, target, cur, remain, alloc, effD, mileageR,
    gift, market, giftBest, bestBasic, bestRatio, netRate, bestTotal,
    itemRows, sumAch, sumCost, bestPer, bestName, milNeed, itemList,
    useItem, optPer10k, optMethodName, optTotal,
    milCap, milAvail, monthlyCharge, rawMonth, capM, earnPerMonth, earnTotal: earnPerMonth * months,
    monthlyAch, plan,
  };
}
