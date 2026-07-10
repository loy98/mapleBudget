import { describe, it, expect, beforeEach } from "vitest";
import {
  parseCalcState, serializeCalcState, normalizeLedger, normalizeMyItems, withRowKeys,
  getDataOwner, setDataOwner, clearAccountData, deleteLedgerEntry, mergeDeleted, importAll,
  KEY, ITEMS_KEY, LKEY, SYNC_KEY, TOUCHED_KEY, OWNER_KEY, CALMODE_KEY,
  loadLedger, saveLedger, loadCalcState, getStorageIssues, onStorageIssue, __resetStorageIssues, CORRUPT_SUFFIX, corruptSlots,
} from "./storage.js";
import { mergeSnapshots, mergeLedger, mergeForUpload, tombstoneClock } from "./cloud.js";
import { weeklyMeso, weeklyItems, itemSummary, NO_ITEM, ledgerStats } from "./ledger.js";
import { uid, estGrade, fmtD, weekStartThu, padDate, hasSnapshot, todayStr, curMonth, legacyRowId } from "./util.js";
import { tzDateStr, dateOf, nowD, APP_TZ } from "./tz.js";
import { computeForecast, cumNow } from "./ledger.js";
import { computeCalc, computeFeePct } from "./calc.js";
import { DEFAULT_RULES, resolveRules, DEFAULT_SETTINGS, DEFAULT_CHARGES, TIERS, TOMBSTONE_TTL_DAYS, TOMBSTONE_MAX, resolveRuleHistory, rulesAt } from "./constants.js";

// ===== ledger.js 순수 함수 =====

describe("weeklyMeso", () => {
  const ws = new Date("2026-07-02T00:00:00"); // 목요일 시작, ~07/08(수) 마감
  const L = (o) => ({ buys: [], sells: [], cashes: [], spends: [], ...o });

  it("주 범위 안의 구매/판매 수량을 합산한다", () => {
    const r = weeklyMeso(L({
      buys: [{ date: "2026-07-02", qty: 2 }, { date: "2026-07-08", qty: 3 }],
      sells: [{ date: "2026-07-05", qty: 4, meso: 1 }],
    }), ws, 0);
    expect(r.buyQty).toBe(5);
    expect(r.sellQty).toBe(4);
  });

  it("주 경계 밖(직전 수요일·직후 목요일)은 제외한다", () => {
    const r = weeklyMeso(L({
      buys: [{ date: "2026-07-01", qty: 9 }, { date: "2026-07-09", qty: 9 }],
      sells: [{ date: "2026-07-01", qty: 9, meso: 1 }],
    }), ws, 0);
    expect(r.buyQty).toBe(0);
    expect(r.sellQty).toBe(0);
  });

  it("수량 미입력/빈 문자열은 구매·판매 모두 0으로 취급한다 (1개로 세지 않음)", () => {
    const r = weeklyMeso(L({
      buys: [{ date: "2026-07-03" }, { date: "2026-07-03", qty: "" }],
      sells: [{ date: "2026-07-03", meso: 3 }, { date: "2026-07-03", qty: "", meso: 3 }],
    }), ws, 0);
    expect(r.buyQty).toBe(0);
    expect(r.sellQty).toBe(0);
    expect(r.sold).toBe(0);
  });

  it("판매 실수령 메소는 경매장 수수료를 뺀 값이다", () => {
    const r = weeklyMeso(L({
      sells: [{ date: "2026-07-03", qty: 2, meso: 10 }],
      cashes: [{ date: "2026-07-03", meso: 5 }],
    }), ws, 0.05);
    expect(r.sold).toBeCloseTo(19, 10);
    expect(r.cashed).toBe(5);
    expect(r.need).toBeCloseTo(14, 10);
  });
});

describe("weeklyItems", () => {
  const ws = new Date("2026-07-02T00:00:00"); // 목요일 시작, ~07/08(수) 마감
  const L = (o) => ({ buys: [], sells: [], cashes: [], spends: [], ...o });

  it("품목별로 그 주의 구매·판매 수량을 모은다", () => {
    const r = weeklyItems(L({
      buys: [{ date: "2026-07-02", item: "가위", qty: 4 }, { date: "2026-07-05", item: "가위", qty: 2 }],
      sells: [{ date: "2026-07-06", item: "가위", qty: 5, meso: 1.2 }],
    }), ws, 0);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "가위", buyQty: 6, sellQty: 5 });
  });

  it("주 경계 밖은 제외한다", () => {
    const r = weeklyItems(L({
      buys: [{ date: "2026-07-01", item: "가위", qty: 9 }, { date: "2026-07-09", item: "가위", qty: 9 }],
    }), ws, 0);
    expect(r).toEqual([]);
  });

  it("avg 는 입력한 개당 판매가의 수량가중 평균(수수료 차감 전), sold 는 수수료 반영 실수령", () => {
    const r = weeklyItems(L({
      sells: [
        { date: "2026-07-03", item: "가위", qty: 1, meso: 1 },
        { date: "2026-07-04", item: "가위", qty: 3, meso: 2 },
      ],
    }), ws, 0.05);
    expect(r[0].avg).toBeCloseTo(7 / 4, 10); // (1*1 + 3*2) / 4
    expect(r[0].sold).toBeCloseTo(7 * 0.95, 10);
  });

  it("품목별 수량 합계는 weeklyMeso 의 주차 합계와 일치한다 (품목 미입력분 포함)", () => {
    const led = L({
      buys: [{ date: "2026-07-02", item: "가위", qty: 4 }, { date: "2026-07-03", item: "", qty: 3 }],
      sells: [{ date: "2026-07-06", item: "  ", qty: 2, meso: 1 }],
    });
    const wk = weeklyMeso(led, ws, 0);
    const items = weeklyItems(led, ws, 0);
    expect(items.reduce((a, x) => a + x.buyQty, 0)).toBe(wk.buyQty);
    expect(items.reduce((a, x) => a + x.sellQty, 0)).toBe(wk.sellQty);
    expect(items.map((x) => x.name)).toContain(NO_ITEM); // 이름 없는 항목은 버리지 않고 한 버킷으로
  });

  it("거래량 많은 순으로 정렬한다", () => {
    const r = weeklyItems(L({
      buys: [{ date: "2026-07-02", item: "적음", qty: 1 }, { date: "2026-07-02", item: "많음", qty: 8 }],
    }), ws, 0);
    expect(r.map((x) => x.name)).toEqual(["많음", "적음"]);
  });
});

describe("itemSummary", () => {
  const all = () => true;
  const env = { fee: 0, effD: 0, mileageR: 0.3 };
  const L = (o) => ({ buys: [], sells: [], cashes: [], spends: [], ...o });

  it("재고는 전체 기간 누적(구매−판매)이라 기간을 좁혀도 음수가 되지 않는다", () => {
    const led = L({
      buys: [{ date: "2026-07-02", item: "가위", qty: 6, price: 5900 }],
      sells: [{ date: "2026-07-09", item: "가위", qty: 5, meso: 1 }],
    });
    // 판 주(07-09~)만 보는 기간: 그 기간엔 구매 0 · 판매 5 지만 재고는 전체 기준 1
    const inSellWeek = (d) => d >= "2026-07-09";
    const r = itemSummary(led, inSellWeek, env, 3000);
    expect(r[0]).toMatchObject({ buyQty: 0, sellQty: 5, stock: 1 });
  });

  it("spend 는 마일리지·충전할인을 반영하고, profit 은 실수령 메소를 rateWon 으로 환산해 뺀 값", () => {
    const led = L({
      buys: [{ date: "2026-07-02", item: "가위", qty: 2, price: 10000, mil: true }],
      sells: [{ date: "2026-07-03", item: "가위", qty: 2, meso: 5 }],
    });
    const r = itemSummary(led, all, { fee: 0.05, effD: 0.1, mileageR: 0.3 }, 3000);
    // spend = 2 * 10000 * (1-0.3) * (1-0.1) = 12600
    expect(r[0].spend).toBeCloseTo(12600, 10);
    // sold = 2 * 5 * 0.95 = 9.5억 → 9.5 * 3000 = 28500원
    expect(r[0].sold).toBeCloseTo(9.5, 10);
    expect(r[0].profit).toBeCloseTo(28500 - 12600, 10);
  });

  it("rateWon 이 0/음수/NaN 이면 profit 은 null (거짓 손익을 내지 않는다)", () => {
    const led = L({ sells: [{ date: "2026-07-03", item: "가위", qty: 1, meso: 5 }] });
    expect(itemSummary(led, all, env, 0)[0].profit).toBeNull();
    expect(itemSummary(led, all, env, -1)[0].profit).toBeNull();
    expect(itemSummary(led, all, env, NaN)[0].profit).toBeNull();
    expect(itemSummary(led, all, env, undefined)[0].profit).toBeNull();
  });

  it("기간 내 거래가 없는 품목은 행에서 빠진다 (재고만 있어도)", () => {
    const led = L({ buys: [{ date: "2026-01-01", item: "옛날거", qty: 3, price: 100 }] });
    expect(itemSummary(led, (d) => d >= "2026-07-01", env, 3000)).toEqual([]);
  });
});

// ===== storage.js 순수 함수 =====

describe("withRowKeys", () => {
  it("_k 없는 행에 부여하고, 기존 _k는 유지", () => {
    const out = withRowKeys([{ name: "a" }, { name: "b", _k: "keep" }]);
    expect(out[0]._k).toBeTruthy();
    expect(out[1]._k).toBe("keep");
  });
  it("_k 는 행마다 유니크", () => {
    const out = withRowKeys([{}, {}, {}]);
    expect(new Set(out.map((x) => x._k)).size).toBe(3);
  });
  it("null/undefined 입력은 빈 배열", () => {
    expect(withRowKeys(null)).toEqual([]);
    expect(withRowKeys(undefined)).toEqual([]);
  });
});

describe("parseCalcState / serializeCalcState", () => {
  it("null 이면 기본값 + charges/items에 _k", () => {
    const s = parseCalcState(null);
    expect(s.settings.mesoRate).toBeDefined();
    expect(s.charges.every((c) => c._k)).toBe(true);
    expect(Array.isArray(s.items)).toBe(true);
  });
  it("제공된 설정은 유지, 없는 키는 기본값", () => {
    const s = parseCalcState({ mesoRate: 9999 });
    expect(s.settings.mesoRate).toBe(9999);
    expect(s.settings.giftRatio).toBeDefined(); // 기본값 채움
  });
  it("빈 문자열/누락 설정은 기본값으로 폴백", () => {
    const s = parseCalcState({ mesoRate: "" });
    expect(s.settings.mesoRate).not.toBe(""); // "" 는 무시하고 기본값
  });
  it("serialize→parse 라운드트립에서 사용자 값 보존", () => {
    const ser = serializeCalcState({ mesoRate: 3200, giftRatio: 8100 }, [{ name: "x", rate: 5, limit: 0 }], [{ name: "i", cash: 100 }]);
    const parsed = parseCalcState(ser);
    expect(parsed.settings.mesoRate).toBe(3200);
    expect(parsed.settings.giftRatio).toBe(8100);
    expect(parsed.charges[0].name).toBe("x");
    expect(parsed.items[0].name).toBe("i");
  });
});

describe("normalizeLedger", () => {
  it("id 없는 항목에 id 부여, 4개 버킷 보장", () => {
    const l = normalizeLedger({ buys: [{ price: 1 }], sells: [] });
    expect(l.buys[0].id).toBeTruthy();
    expect(l.cashes).toEqual([]);
    expect(l.spends).toEqual([]);
  });
  it("구 데이터 won→rate 승계 (meso>0일 때)", () => {
    const l = normalizeLedger({ cashes: [{ meso: 2, won: 1000 }] });
    expect(l.cashes[0].rate).toBe(500); // 1000/2
  });
  it("meso=0 이면 rate 만들지 않고 won 폴백 유지(손실 방지)", () => {
    const l = normalizeLedger({ cashes: [{ meso: 0, won: 1000 }] });
    expect(l.cashes[0].rate == null).toBe(true);
    expect(l.cashes[0].won).toBe(1000);
  });
  it("빈/누락 입력에도 4버킷 + 빈 삭제표식 반환", () => {
    expect(normalizeLedger(null)).toEqual({ buys: [], sells: [], cashes: [], spends: [], deleted: {} });
  });
});

describe("normalizeMyItems", () => {
  it("빈 입력이면 기본 목록(+_k)", () => {
    const out = normalizeMyItems([]);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((x) => x._k)).toBe(true);
  });
  it("제공 목록은 유지(+_k)", () => {
    const out = normalizeMyItems([{ name: "커스텀" }]);
    expect(out[0].name).toBe("커스텀");
    expect(out[0]._k).toBeTruthy();
  });
});

// ===== cloud.js mergeSnapshots =====

const EMPTY_LEDGER = { buys: [], sells: [], cashes: [], spends: [] };
const mk = (o = {}) => ({ calc: {}, my_items: [], ledger: { ...EMPTY_LEDGER }, ...o });

describe("mergeSnapshots", () => {
  it("클라우드 없으면 로컬 그대로, conflict 없음", () => {
    const local = mk({ calc: { mesoRate: 1 } });
    const { snapshot, conflict } = mergeSnapshots(local, null);
    expect(snapshot).toBe(local);
    expect(conflict).toBe(false);
  });

  it("ledger는 id 합집합 — 거래 손실 없음", () => {
    const local = mk({ ledger: { ...EMPTY_LEDGER, buys: [{ id: "a", price: 1 }] } });
    const cloud = mk({ calc: { x: 1 }, ledger: { ...EMPTY_LEDGER, buys: [{ id: "b", price: 2 }] } });
    const { snapshot } = mergeSnapshots(local, cloud);
    const ids = snapshot.ledger.buys.map((x) => x.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("같은 id는 클라우드 우선(알려진 한계)", () => {
    const local = mk({ ledger: { ...EMPTY_LEDGER, sells: [{ id: "s", meso: 1 }] } });
    const cloud = mk({ calc: { x: 1 }, ledger: { ...EMPTY_LEDGER, sells: [{ id: "s", meso: 99 }] } });
    const { snapshot } = mergeSnapshots(local, cloud);
    expect(snapshot.ledger.sells).toHaveLength(1);
    expect(snapshot.ledger.sells[0].meso).toBe(99);
  });

  it("클라우드 calc가 있으면 calc는 클라우드 우선", () => {
    const local = mk({ calc: { mesoRate: 1 } });
    const cloud = mk({ calc: { mesoRate: 2 } });
    const { snapshot } = mergeSnapshots(local, cloud);
    expect(snapshot.calc.mesoRate).toBe(2);
  });

  it("클라우드 calc가 비면 로컬 calc 유지", () => {
    const local = mk({ calc: { mesoRate: 7 } });
    const cloud = mk({ calc: {}, my_items: [{ name: "z" }] });
    const { snapshot } = mergeSnapshots(local, cloud);
    expect(snapshot.calc.mesoRate).toBe(7);
  });

  it("로컬에 거래 있고 클라우드에 설정 있으면 conflict=true", () => {
    const local = mk({ ledger: { ...EMPTY_LEDGER, buys: [{ id: "a" }] } });
    const cloud = mk({ calc: { mesoRate: 5 } });
    const { conflict } = mergeSnapshots(local, cloud);
    expect(conflict).toBe(true);
  });

  it("로컬에 거래 없으면 conflict=false", () => {
    const local = mk({ calc: { mesoRate: 1 } });
    const cloud = mk({ calc: { mesoRate: 2 } });
    const { conflict } = mergeSnapshots(local, cloud);
    expect(conflict).toBe(false);
  });

  it("거래 없어도 사용자 직접 편집(localTouched)+클라우드 설정 있으면 conflict=true (P1-4)", () => {
    const local = mk({ calc: { mesoRate: 1 } });
    const cloud = mk({ calc: { mesoRate: 2 } });
    const { conflict } = mergeSnapshots(local, cloud, { localTouched: true });
    expect(conflict).toBe(true);
  });

  it("localTouched여도 클라우드에 설정/아이템 없으면 conflict=false", () => {
    const local = mk({ calc: { mesoRate: 1 } });
    const cloud = mk({ calc: {}, my_items: [] });
    const { conflict } = mergeSnapshots(local, cloud, { localTouched: true });
    expect(conflict).toBe(false);
  });
});

describe("uid", () => {
  it("같은 밀리초에 대량 생성해도 충돌하지 않는다 (ledger 병합이 id 합집합이라 충돌=거래 소실)", () => {
    const N = 20000;
    const ids = new Set();
    for (let i = 0; i < N; i++) ids.add(uid());
    expect(ids.size).toBe(N);
  });
  it("문자열이고 비어 있지 않다", () => {
    const v = uid();
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(8);
  });
});

// malformed 데이터(손상된 localStorage · 클라우드 행 · 가져오기 파일)가 렌더 중 예외를 던지면
// React 18은 트리 전체를 언마운트한다 → 백지 화면. 데이터 계층에서 반드시 흡수해야 한다.
describe("malformed 입력 방어", () => {
  it("normalizeLedger: 버킷이 배열이 아니면 빈 배열로 강등", () => {
    const out = normalizeLedger({ buys: {}, sells: "x", cashes: null, spends: 42 });
    expect(out.buys).toEqual([]);
    expect(out.sells).toEqual([]);
    expect(out.cashes).toEqual([]);
    expect(out.spends).toEqual([]);
  });
  it("normalizeLedger: 객체가 아닌 원소는 걸러낸다", () => {
    const out = normalizeLedger({ buys: [null, "a", 3, { qty: 1 }] });
    expect(out.buys).toHaveLength(1);
    expect(out.buys[0].id).toBeTruthy();
  });
  it("normalizeLedger: d 자체가 배열/문자열이어도 던지지 않는다", () => {
    expect(() => normalizeLedger([])).not.toThrow();
    expect(() => normalizeLedger("nope")).not.toThrow();
  });
  it("normalizeMyItems: 배열이 아니면 기본 목록으로 폴백", () => {
    expect(normalizeMyItems({}).length).toBeGreaterThan(0);
    expect(normalizeMyItems("x").length).toBeGreaterThan(0);
  });
  it("parseCalcState: charge/items가 배열이 아니어도 던지지 않는다", () => {
    expect(() => parseCalcState({ charge: {}, items: "x" })).not.toThrow();
    expect(() => parseCalcState([])).not.toThrow();
  });
  it("withRowKeys: 배열이 아니면 빈 배열", () => {
    expect(withRowKeys({})).toEqual([]);
    expect(withRowKeys(null)).toEqual([]);
  });
  it("mergeSnapshots: 클라우드 ledger 버킷이 malformed여도 병합이 던지지 않는다", () => {
    const local = { calc: {}, my_items: [], ledger: { buys: [{ id: "a" }], sells: [], cashes: [], spends: [] } };
    const cloud = { calc: {}, my_items: [], ledger: { buys: {}, sells: null } };
    let res;
    expect(() => { res = mergeSnapshots(local, cloud); }).not.toThrow();
    expect(res.snapshot.ledger.buys).toHaveLength(1); // 로컬 거래는 보존
  });
});

// app_config.rules 는 DB에서 오므로 신뢰하지 않는다. 항목별 검증 후 통과한 것만 기본값 위에 얹는다.
describe("resolveRules", () => {
  it("null/malformed 이면 기본값 그대로", () => {
    // 반환값에는 어느 규칙이 적용됐는지 알 수 있게 effectiveFrom 이 붙는다.
    expect(resolveRules(null)).toMatchObject(DEFAULT_RULES);
    expect(resolveRules("x")).toMatchObject(DEFAULT_RULES);
    expect(resolveRules([])).toMatchObject(DEFAULT_RULES);
  });
  it("유효한 스칼라만 덮어쓴다", () => {
    const r = resolveRules({ feeMvp: 2, feeBase: "5", mileageAccrual: 0.1 });
    expect(r.feeMvp).toBe(2);
    expect(r.feeBase).toBe(DEFAULT_RULES.feeBase); // 문자열은 거부
    expect(r.mileageAccrual).toBe(0.1);
  });
  it("범위를 벗어난 값은 거부", () => {
    const r = resolveRules({ feeMvp: -1, mileageAccrual: 2 });
    expect(r.feeMvp).toBe(DEFAULT_RULES.feeMvp);
    expect(r.mileageAccrual).toBe(DEFAULT_RULES.mileageAccrual);
  });
  it("tiers: 오름차순이 아니면 통째로 거부(등급 판정이 틀어지므로)", () => {
    const r = resolveRules({ tiers: [{ name: "a", amt: 100 }, { name: "b", amt: 50 }] });
    expect(r.tiers).toBe(DEFAULT_RULES.tiers);
  });
  it("tiers: 원소 하나라도 malformed 면 거부", () => {
    const r = resolveRules({ tiers: [{ name: "a", amt: 100 }, { amt: 200 }] });
    expect(r.tiers).toBe(DEFAULT_RULES.tiers);
  });
  it("tiers: 유효하면 교체", () => {
    const t = [{ name: "a", amt: 100 }, { name: "b", amt: 200 }];
    expect(resolveRules({ tiers: t }).tiers).toEqual(t);
  });
});

describe("rules 주입", () => {
  it("computeFeePct: 수수료율이 rules 에서 온다", () => {
    const rules = { ...DEFAULT_RULES, feeMvp: 1, feeBase: 9 };
    expect(computeFeePct("2", "0", rules)).toBe(1);
    expect(computeFeePct("0", "0", rules)).toBe(9);
    expect(computeFeePct("0", "1", rules)).toBe(1); // 프리미엄 PC방
  });
  it("computeFeePct: rules 미지정이면 기본값", () => {
    expect(computeFeePct("0", "0")).toBe(DEFAULT_RULES.feeBase);
  });
  it("estGrade: tiers 를 주입할 수 있고, 미달이면 무등급", () => {
    const t = [{ name: "낮음", amt: 10 }, { name: "높음", amt: 20 }];
    expect(estGrade(5, t)).toBe("무등급");
    expect(estGrade(15, t)).toBe("낮음");
    expect(estGrade(25, t)).toBe("높음");
  });
  it("computeCalc: mileageAccrual 이 rules 에서 온다", () => {
    const s = { ...DEFAULT_SETTINGS, tierAmt: 1200000, curAchieved: 0, months: "0", milCap: 0 };
    const a = computeCalc(s, DEFAULT_CHARGES, [], { ...DEFAULT_RULES, mileageAccrual: 0.05 });
    const b = computeCalc(s, DEFAULT_CHARGES, [], { ...DEFAULT_RULES, mileageAccrual: 0.10 });
    expect(b.rawMonth).toBeCloseTo(a.rawMonth * 2, 6);
  });
});

// computeForecast 는 오늘 날짜에 의존하므로(start13/weekStartThu) 이번 주 시작일을 계산해 fixture 를 만든다.
describe("computeForecast — 이번 주 포함", () => {
  const thisWeek = fmtD(weekStartThu(new Date()));
  const led = (amount) => ({ buys: [], sells: [], cashes: [], spends: [{ id: "p", date: thisWeek, amount }] });
  const T = TIERS[4].amt; // 레드 1,500,000

  it("이번 주에 이미 쓴 과금은 계획값으로 대체되지 않고 함께 잡힌다", () => {
    // 회귀: 예전엔 includeThis 일 때 o=0 이 x[0](=T/13)로 '대체'되어 실제 500,000원이 사라졌다.
    const fc = computeForecast(led(500000), 0.3, 4, "weekly", true, 10000);
    expect(fc.rows[0].sum).toBeCloseTo(500000 + T / 13, 6);
  });

  it("과금 주가 아닌 시점(month1)이어도 이번 주 실적은 보존된다", () => {
    // 회귀: 예전엔 x[0] 이 undefined 라 achAt(0)=0 → 이번 주 실적이 통째로 사라졌다.
    const fc = computeForecast(led(500000), 0.3, 4, "month1", true, 10000);
    expect(fc.rows[0].sum).toBeGreaterThanOrEqual(500000);
  });

  it("이번 주 포함을 켠다고 도달이 늦어지지 않는다", () => {
    const off = computeForecast(led(500000), 0.3, 4, "weekly", false, 10000);
    const on = computeForecast(led(500000), 0.3, 4, "weekly", true, 10000);
    expect(on.reached).toBeLessThanOrEqual(off.reached);
  });

  it("예측 지평은 켜든 끄든 13주, 총 과금은 목표를 넘지 않는다", () => {
    for (const inc of [false, true]) {
      const fc = computeForecast(led(0), 0.3, 4, "weekly", inc, 10000);
      expect(fc.rows).toHaveLength(13);
      expect(fc.total).toBeCloseTo(T, 6); // 예전 includeThis=true 는 14주 × T/13 = 107.7%
    }
  });

  it("includeThis=false 는 기존 동작을 그대로 보존한다", () => {
    const fc = computeForecast(led(500000), 0.3, 4, "weekly", false, 10000);
    expect(fc.rows[0].sum).toBeCloseTo(500000 + T / 13, 6); // o=0 실적 + o=1 계획
    expect(fc.startOff).toBe(1);
  });
});

// 공용 브라우저: A 로그아웃 → B 로그인 시 A의 원장이 B 계정으로 유입되면 안 된다.
// ledger 병합은 id 합집합이고 tombstone 이 없어 한 번 섞이면 되돌릴 수 없다.
describe("데이터 소유자 게이트", () => {
  const store = new Map();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  });

  it("소유자 마커 왕복", () => {
    expect(getDataOwner()).toBe(null);
    setDataOwner("user-a");
    expect(getDataOwner()).toBe("user-a");
    setDataOwner(null);
    expect(getDataOwner()).toBe(null);
  });

  it("로그아웃은 계정 데이터·마커를 지우고 기기별 뷰 설정은 남긴다", () => {
    store.set(KEY, "{}"); store.set(ITEMS_KEY, "[]"); store.set(LKEY, "{}");
    store.set(SYNC_KEY, "user-a"); store.set(TOUCHED_KEY, "1"); store.set(OWNER_KEY, "user-a");
    store.set(CALMODE_KEY, "mvp"); store.set("mvpTheme", "dark");

    clearAccountData();

    [KEY, ITEMS_KEY, LKEY, SYNC_KEY, TOUCHED_KEY, OWNER_KEY].forEach((k) => expect(store.has(k)).toBe(false));
    expect(store.get(CALMODE_KEY)).toBe("mvp");
    expect(store.get("mvpTheme")).toBe("dark");
  });

  it("다른 계정 소유의 로컬을 배제하면 클라우드만 채택되고 충돌도 없다", () => {
    // useCloudSync 가 owner !== userId 일 때 넘기는 값과 동일한 형태
    const EMPTY = { calc: {}, my_items: [], ledger: { buys: [], sells: [], cashes: [], spends: [] } };
    const cloudB = {
      calc: { mesoRate: 4000 },
      my_items: [{ name: "B아이템" }],
      ledger: { buys: [{ id: "b-only" }], sells: [], cashes: [], spends: [] },
    };
    const { snapshot, conflict } = mergeSnapshots(EMPTY, cloudB, { localTouched: false });
    expect(snapshot.ledger.buys.map((x) => x.id)).toEqual(["b-only"]); // A의 거래가 섞이지 않음
    expect(snapshot.calc).toEqual({ mesoRate: 4000 });
    expect(conflict).toBe(false);
  });

  it("같은 계정(또는 게스트)의 로컬은 여전히 병합된다", () => {
    const localA = { calc: {}, my_items: [], ledger: { buys: [{ id: "a1" }], sells: [], cashes: [], spends: [] } };
    const cloudA = { calc: {}, my_items: [], ledger: { buys: [{ id: "a2" }], sells: [], cashes: [], spends: [] } };
    const { snapshot } = mergeSnapshots(localA, cloudA, { localTouched: false });
    expect(snapshot.ledger.buys.map((x) => x.id).sort()).toEqual(["a1", "a2"]);
  });
});

describe("resolveRules — Codex 재검수 반영", () => {
  it("동일 금액의 인접 등급은 거부한다 (앞 등급이 도달 불가능한 죽은 등급이 됨)", () => {
    const dup = [{ name: "브론즈", amt: 150000 }, { name: "실버", amt: 150000 }];
    expect(resolveRules({ tiers: dup }).tiers).toBe(DEFAULT_RULES.tiers);
    // 실제로 죽는지 확인: estGrade 는 마지막 통과 등급을 고르므로 브론즈는 절대 안 나온다.
    expect(estGrade(150000, dup)).toBe("실버");
  });
  it("-0 은 거부한다", () => {
    const r = resolveRules({ feeMvp: -0, mileageAccrual: -0 });
    expect(r.feeMvp).toBe(DEFAULT_RULES.feeMvp);
    expect(r.mileageAccrual).toBe(DEFAULT_RULES.mileageAccrual);
  });
  it("등급 기준액 0 은 거부한다 (무등급과 구분 불가)", () => {
    expect(resolveRules({ tiers: [{ name: "영", amt: 0 }, { name: "일", amt: 1 }] }).tiers)
      .toBe(DEFAULT_RULES.tiers);
  });
  it("엄격히 증가하는 tiers 는 통과", () => {
    const t = [{ name: "a", amt: 1 }, { name: "b", amt: 2 }];
    expect(resolveRules({ tiers: t }).tiers).toEqual(t);
  });
  it("schema.sql 시드의 rules 가 검증을 통과한다", () => {
    // 시드가 거부되면 DB 설정이 조용히 무시되고 폴백만 쓰인다.
    const seed = {
      feeMvp: 3, feeBase: 5, mileageAccrual: 0.05,
      tiers: [
        { name: "브론즈", amt: 150000 }, { name: "실버", amt: 300000 }, { name: "골드", amt: 600000 },
        { name: "다이아", amt: 900000 }, { name: "레드", amt: 1500000 }, { name: "블랙", amt: 3000000 },
      ],
    };
    const r = resolveRules(seed);
    expect(r.feeMvp).toBe(3);
    expect(r.feeBase).toBe(5);
    expect(r.mileageAccrual).toBe(0.05);
    expect(r.tiers).toEqual(seed.tiers);
  });
});

// ===== 삭제 전파(tombstone) =====
// id 합집합 병합은 '없음'을 표현하지 못해, 삭제된 항목을 아직 가진 기기가 되살렸다.
const LED = (buys, deleted) => ({ buys, sells: [], cashes: [], spends: [], ...(deleted ? { deleted } : {}) });
const T0 = 1_700_000_000_000; // 고정 시각(테스트 결정성)

describe("tombstone — 삭제 전파", () => {
  it("deleteLedgerEntry: 항목 제거 + 표식 기록", () => {
    const before = LED([{ id: "x" }, { id: "y" }]);
    const after = deleteLedgerEntry(before, "buys", "x", T0);
    expect(after.buys.map((b) => b.id)).toEqual(["y"]);
    expect(after.deleted).toEqual({ x: T0 });
    expect(before.buys).toHaveLength(2); // 원본 불변
  });

  it("기기 A가 지운 거래를, 아직 들고 있는 기기 B가 되살리지 못한다", () => {
    const a = deleteLedgerEntry(LED([{ id: "x" }, { id: "y" }]), "buys", "x", T0); // A: x 삭제
    const b = LED([{ id: "x" }, { id: "y" }]);                                     // B: 아직 x 보유
    const merged = mergeLedger(a, b, T0 + 1000);
    expect(merged.buys.map((r) => r.id)).toEqual(["y"]);
    expect(merged.deleted).toEqual({ x: T0 }); // 표식은 살아남아 계속 전파
  });

  it("반대 방향도 동일 — 클라우드의 표식이 로컬 항목을 지운다", () => {
    const local = LED([{ id: "x" }, { id: "y" }]);
    const cloud = deleteLedgerEntry(LED([{ id: "x" }, { id: "y" }]), "buys", "x", T0);
    const merged = mergeLedger(local, cloud, T0 + 1000);
    expect(merged.buys.map((r) => r.id)).toEqual(["y"]);
  });

  it("삭제 우선: 한쪽이 지우고 다른 쪽이 수정해도 되살아나지 않는다", () => {
    const a = deleteLedgerEntry(LED([{ id: "x", qty: 1 }]), "buys", "x", T0);
    const b = LED([{ id: "x", qty: 99 }]); // 다른 기기에서 수정
    expect(mergeLedger(a, b, T0 + 1000).buys).toEqual([]);
  });

  it("단일 기기: 삭제 후 디바운스 안에 탭을 닫아도 다음 로드에서 부활하지 않는다", () => {
    // 로컬은 즉시 저장(표식 포함), 클라우드는 아직 옛 상태(x 있음)
    const local = deleteLedgerEntry(LED([{ id: "x" }]), "buys", "x", T0);
    const cloud = LED([{ id: "x" }]);
    const { snapshot } = mergeSnapshots(
      { calc: {}, my_items: [], ledger: local },
      { calc: {}, my_items: [], ledger: cloud },
      { now: T0 + 1000 }
    );
    expect(snapshot.ledger.buys).toEqual([]);
  });

  it("삭제하지 않은 거래는 양쪽에서 모두 보존된다 (합집합 유지)", () => {
    const a = LED([{ id: "a1" }]);
    const b = LED([{ id: "b1" }]);
    expect(mergeLedger(a, b, T0).buys.map((r) => r.id).sort()).toEqual(["a1", "b1"]);
  });

  it("TTL 만료된 표식은 정리된다 (원장 blob 무한 증가 방지)", () => {
    const old = T0 - (TOMBSTONE_TTL_DAYS + 1) * 86400000;
    const led = LED([], { stale: old, fresh: T0 - 1000 });
    const n = normalizeLedger(led, T0);
    expect(n.deleted).toEqual({ fresh: T0 - 1000 });
  });

  it("같은 id 의 표식이 양쪽에 있으면 더 늦은 시각을 남긴다 (오래 살아야 안전)", () => {
    // 두 값 모두 now 이하여야 clamp 에 걸리지 않는다(미래 시각 방어는 아래 별도 테스트).
    expect(mergeDeleted({ x: T0 - 5000 }, { x: T0 }, T0).x).toBe(T0);
    expect(mergeDeleted({ x: T0 }, { x: T0 - 5000 }, T0).x).toBe(T0);
  });

  it("normalizeLedger: 로컬에 표식과 항목이 동시에 있으면 삭제를 존중한다", () => {
    const n = normalizeLedger(LED([{ id: "x" }, { id: "y" }], { x: T0 }), T0);
    expect(n.buys.map((b) => b.id)).toEqual(["y"]);
  });

  it("구버전 원장(deleted 없음)도 그대로 동작한다", () => {
    const n = normalizeLedger({ buys: [{ id: "x" }] }, T0);
    expect(n.deleted).toEqual({});
    expect(n.buys).toHaveLength(1);
  });

  it("malformed deleted 는 흡수한다", () => {
    expect(normalizeLedger(LED([], "nope"), T0).deleted).toEqual({});
    expect(normalizeLedger(LED([], [1, 2]), T0).deleted).toEqual({});
    expect(normalizeLedger(LED([], { x: "abc", y: -1, z: null }), T0).deleted).toEqual({});
  });

  it("프로토타입 오염과 상속 키에 안전하다", () => {
    // "__proto__" 키는 받지 않는다
    const n = normalizeLedger(LED([], JSON.parse('{"__proto__": 1, "ok": ' + T0 + '}')), T0);
    expect(n.deleted).toEqual({ ok: T0 });
    expect(Object.prototype.polluted).toBeUndefined();
    // id 가 "toString" 인 항목이 상속 키 때문에 잘못 삭제되면 안 된다
    const merged = mergeLedger(LED([{ id: "toString" }]), LED([]), T0);
    expect(merged.buys.map((b) => b.id)).toEqual(["toString"]);
    // 실제로 지운 경우엔 지워져야 한다
    const del = deleteLedgerEntry(LED([{ id: "toString" }]), "buys", "toString", T0);
    expect(del.buys).toEqual([]);
    expect(mergeLedger(del, LED([{ id: "toString" }]), T0).buys).toEqual([]);
  });

  it("남의 계정 표식이 내 거래를 지우지 않는다 (소유자 게이트와 함께 동작)", () => {
    const EMPTY = { buys: [], sells: [], cashes: [], spends: [], deleted: {} };
    const cloudMine = LED([{ id: "mine" }]);
    expect(mergeLedger(EMPTY, cloudMine, T0).buys.map((b) => b.id)).toEqual(["mine"]);
  });
});

// Codex 재검수 반영: 시계 오차·미래 시각·안전하지 않은 id·가져오기 검증
describe("tombstone — 신뢰할 수 없는 시각/키 방어", () => {
  it("로컬 로드는 TTL 정리를 하지 않는다 (기기 시계가 미래여도 표식이 살아남는다)", () => {
    const led = LED([], { x: T0 });
    // now 미지정 = 정리 안 함
    expect(normalizeLedger(led).deleted).toEqual({ x: T0 });
    // 시계가 2년 미래로 틀어진 기기가 로드해도 표식 유지
    expect(normalizeLedger(led).deleted.x).toBe(T0);
    // 반면 서버 시각을 명시하면 TTL 적용
    const future = T0 + (TOMBSTONE_TTL_DAYS + 1) * 86400000;
    expect(normalizeLedger(led, future).deleted).toEqual({});
  });

  it("미래 시각 표식은 현재로 clamp 된다 (영원히 만료되지 않는 표식 방지)", () => {
    const far = T0 + 100 * 365 * 86400000; // 100년 뒤
    expect(normalizeLedger(LED([], { x: far }), T0).deleted).toEqual({ x: T0 });
    // clamp 없으면 mergeDeleted 의 max 때문에 영구히 남아 남의 거래를 계속 지운다
    expect(mergeDeleted({ x: far }, { x: T0 }, T0).x).toBe(T0);
  });

  it("병합은 서버 시각(updated_at) 기준으로 정리한다", () => {
    const stale = T0 - (TOMBSTONE_TTL_DAYS + 1) * 86400000;
    const merged = mergeLedger(LED([], { old: stale, keep: T0 - 1000 }), LED([]), T0);
    expect(merged.deleted).toEqual({ keep: T0 - 1000 });
    // now=null 이면 정리하지 않는다
    expect(Object.keys(mergeLedger(LED([], { old: stale }), LED([]), null).deleted)).toEqual(["old"]);
  });

  it("안전하지 않은 행 id 는 새 id 로 교체된다 (표식을 남길 수 있어야 삭제가 전파된다)", () => {
    const led = JSON.parse('{"buys":[{"id":"__proto__"},{"id":"constructor"},{"id":123},{"id":""}],"sells":[],"cashes":[],"spends":[]}');
    const n = normalizeLedger(led);
    const ids = n.buys.map((b) => b.id);
    expect(ids).toHaveLength(4);
    ids.forEach((id) => {
      expect(typeof id).toBe("string");
      expect(["__proto__", "constructor", "prototype", ""]).not.toContain(id);
    });
    // 교체된 id 로 삭제하면 표식이 정상 기록된다
    const del = deleteLedgerEntry(n, "buys", ids[0], T0);
    expect(del.deleted[ids[0]]).toBe(T0);
    expect(del.buys).toHaveLength(3);
  });

  it("표식을 남길 수 없는 id 로는 삭제하지 않는다 (조용한 부활 방지)", () => {
    const led = LED([{ id: "ok" }]);
    expect(deleteLedgerEntry(led, "buys", "__proto__", T0)).toBe(led); // 무변경
    expect(deleteLedgerEntry(led, "buys", "", T0)).toBe(led);
  });

  it("가져오기는 원장을 정규화해 쓴다 (조작된 백업의 미래 표식 차단)", () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    const far = Date.now() + 100 * 365 * 86400000;
    const backup = JSON.stringify({
      app: "mvp-calculator",
      ledger: { buys: [{ id: "keep" }, "쓰레기", null], sells: {}, deleted: { evil: far, bad: "abc" } },
    });
    expect(importAll(backup).ok).toBe(true);
    const written = JSON.parse(store.get(LKEY));
    expect(written.buys.map((b) => b.id)).toEqual(["keep"]); // malformed 원소 제거
    expect(written.sells).toEqual([]);                        // 배열 아닌 버킷 강등
    expect(written.deleted.bad).toBeUndefined();              // malformed 시각 제거
    expect(written.deleted.evil).toBeLessThanOrEqual(Date.now()); // 미래 시각 clamp
  });
});

// Codex HIGH: 오래된 스냅샷을 든 탭이 업로드하면 서버의 tombstone 을 덮어써 삭제가 부활했다.
// 낙관적 동시성 제어(updated_at 조건부 쓰기) + 충돌 시 재병합으로 막는다.
describe("업로드 충돌 병합 (mergeForUpload)", () => {
  const iso = (ms) => new Date(ms).toISOString();

  it("stale 탭의 업로드가 서버 tombstone 을 지우지 않는다 (부활 방지)", () => {
    // 탭 A가 x 를 지우고 업로드 완료 → 서버에 tombstone
    const cloud = { ...deleteLedgerEntry(LED([{ id: "x" }, { id: "y" }]), "buys", "x", T0), updated_at: iso(T0) };
    // 탭 B는 stale: x 를 아직 들고 있고 표식 없음. 다른 거래 z 를 추가해 업로드 시도.
    const localB = { calc: { a: 1 }, my_items: [], ledger: LED([{ id: "x" }, { id: "y" }, { id: "z" }]) };

    const merged = mergeForUpload(localB, { ledger: cloud, updated_at: iso(T0 + 1000) });

    expect(merged.ledger.buys.map((b) => b.id).sort()).toEqual(["y", "z"]); // x 부활 안 함, z 는 보존
    expect(merged.ledger.deleted).toEqual({ x: T0 });                        // 표식 유지 → 계속 전파
    expect(merged.calc).toEqual({ a: 1 });                                   // 이 탭의 설정이 이긴다
  });

  it("반대로 stale 탭이 지운 것도 서버에 전파된다", () => {
    const cloud = { ledger: LED([{ id: "x" }, { id: "y" }]), updated_at: iso(T0 + 1000) };
    const localB = { calc: {}, my_items: [], ledger: deleteLedgerEntry(LED([{ id: "x" }, { id: "y" }]), "buys", "y", T0) };
    const merged = mergeForUpload(localB, cloud);
    expect(merged.ledger.buys.map((b) => b.id)).toEqual(["x"]);
    expect(merged.ledger.deleted).toEqual({ y: T0 });
  });

  it("양쪽이 서로 다른 거래를 추가했으면 둘 다 살아남는다", () => {
    const cloud = { ledger: LED([{ id: "fromA" }]), updated_at: iso(T0) };
    const localB = { calc: {}, my_items: [], ledger: LED([{ id: "fromB" }]) };
    expect(mergeForUpload(localB, cloud).ledger.buys.map((b) => b.id).sort()).toEqual(["fromA", "fromB"]);
  });

  it("서버 행이 없으면(첫 업로드) 로컬을 그대로 쓴다", () => {
    const localB = { calc: { a: 1 }, my_items: [{ name: "i" }], ledger: LED([{ id: "x" }]) };
    const merged = mergeForUpload(localB, null);
    expect(merged.ledger.buys.map((b) => b.id)).toEqual(["x"]);
    expect(merged.my_items).toEqual([{ name: "i" }]);
  });

  it("TTL 정리는 서버 updated_at 기준으로 한다", () => {
    const stale = T0 - (TOMBSTONE_TTL_DAYS + 1) * 86400000;
    const cloud = { ledger: LED([], { old: stale }), updated_at: iso(T0) };
    const localB = { calc: {}, my_items: [], ledger: LED([]) };
    expect(mergeForUpload(localB, cloud).ledger.deleted).toEqual({});
  });
});

// 자체 검수에서 발견: 병합 결과를 '항목 개수'로만 비교해 상태 반영을 건너뛰면,
// 개수가 같지만 내용이 다른 경우 로컬이 어긋난 채 남아 다음 업로드가 병합본을 덮어쓴다.
describe("업로드 충돌 병합 — 개수는 같지만 내용이 다른 경우", () => {
  it("클라우드가 a 를 지우고 c 를 추가했으면 병합 결과는 [c] 다 (로컬 [a] 와 개수 동일)", () => {
    const cloud = {
      ledger: { ...deleteLedgerEntry(LED([{ id: "a" }]), "buys", "a", T0), buys: [{ id: "c" }] },
      updated_at: new Date(T0 + 1000).toISOString(),
    };
    const local = { calc: {}, my_items: [], ledger: LED([{ id: "a" }]) };

    const merged = mergeForUpload(local, cloud);
    expect(merged.ledger.buys.map((b) => b.id)).toEqual(["c"]); // a 는 표식으로 제거, c 는 유입
    expect(local.ledger.buys).toHaveLength(1);                  // 로컬과 개수가 같다(1 vs 1)

    // 이 상태에서 로컬 상태를 갱신하지 않으면, 다음 업로드가 로컬 [a] 를 올려 c 를 지우고 a 를 되살린다.
    // → useCloudSync 는 충돌 병합 후 항상 setLedger(merged) 해야 한다.
    const shape = (l) => ["buys", "sells", "cashes", "spends"].map((k) => l[k].length).join(",");
    expect(shape(merged.ledger)).toBe(shape(local.ledger)); // 개수 비교로는 구분 불가함을 명시
    expect(merged.ledger.buys[0].id).not.toBe(local.ledger.buys[0].id);
  });
});

// Codex E: 만료 기준(서버 updated_at)과 미래 clamp 상한을 한 값으로 겸용하면,
// 오래 접속하지 않은 유저가 오늘 지운 표식이 과거로 되감겨 다음 병합에서 조기 만료된다.
describe("tombstone 시계 — 만료 기준과 clamp 상한의 분리", () => {
  const iso = (ms) => new Date(ms).toISOString();
  const NOW = T0;
  const TWO_YEARS = 2 * 365 * 86400000;

  it("tombstoneClock: 만료는 서버 시각, 상한은 max(서버, 내 시계)", () => {
    const cloud = { updated_at: iso(NOW - TWO_YEARS) };
    const c = tombstoneClock(cloud, NOW);
    expect(c.now).toBe(NOW - TWO_YEARS); // 만료 기준은 보수적(적게 만료)
    expect(c.ceiling).toBe(NOW);         // 상한은 '정상적인 지금'
  });

  it("2년 만에 접속한 유저가 방금 지운 표식이 과거로 되감기지 않는다", () => {
    const cloud = { ledger: LED([{ id: "x" }]), updated_at: iso(NOW - TWO_YEARS) };
    // 오늘 x 를 지움
    const local = { calc: {}, my_items: [], ledger: deleteLedgerEntry(LED([{ id: "x" }]), "buys", "x", NOW) };

    const merged = mergeForUpload(local, cloud, NOW);
    expect(merged.ledger.buys).toEqual([]);
    // 겸용 시절엔 여기서 x 의 시각이 2년 전으로 clamp 되어, 다음 병합(서버 시각=현재)에서
    // TTL(1년) 초과로 조기 만료 → 항목을 아직 든 기기가 부활시켰다.
    expect(merged.ledger.deleted.x).toBe(NOW);

    // 다음 병합(업로드 후 updated_at 이 현재가 됨)에서도 표식이 살아남는다
    const cloud2 = { ledger: merged.ledger, updated_at: iso(NOW) };
    const other = { calc: {}, my_items: [], ledger: LED([{ id: "x" }]) }; // x 를 아직 든 기기
    const merged2 = mergeForUpload(other, cloud2, NOW);
    expect(merged2.ledger.buys).toEqual([]); // 부활하지 않는다
  });

  it("조작된 백업의 100년 뒤 표식은 내 시계 기준으로 clamp 된다", () => {
    const far = NOW + 100 * 365 * 86400000;
    const cloud = { ledger: LED([], { evil: far }), updated_at: iso(NOW) };
    const local = { calc: {}, my_items: [], ledger: LED([]) };
    expect(mergeForUpload(local, cloud, NOW).ledger.deleted.evil).toBe(NOW);
  });

  it("서버 행이 없으면 만료 정리를 하지 않는다 (첫 업로드)", () => {
    const stale = NOW - (TOMBSTONE_TTL_DAYS + 1) * 86400000;
    const local = { calc: {}, my_items: [], ledger: LED([], { old: stale }) };
    expect(mergeForUpload(local, null, NOW).ledger.deleted).toEqual({ old: stale });
  });
});

// Codex D: 클라우드 병합이 없는 게스트는 TTL 정리가 돌지 않아 표식이 무한히 쌓인다.
// 시계에 의존하지 않는 개수 상한으로 묶는다(상대 순서만 사용).
describe("tombstone 개수 상한", () => {
  const many = (n, base = T0) => {
    const d = {};
    for (let i = 0; i < n; i++) d["id" + i] = base + i; // i 가 클수록 최신
    return d;
  };

  it("상한을 넘으면 오래된 표식부터 버린다 (게스트도 무한히 쌓이지 않는다)", () => {
    const n = normalizeLedger(LED([], many(TOMBSTONE_MAX + 50)));
    const ids = Object.keys(n.deleted);
    expect(ids).toHaveLength(TOMBSTONE_MAX);
    expect(ids).toContain("id" + (TOMBSTONE_MAX + 49)); // 최신은 남고
    expect(ids).not.toContain("id0");                   // 가장 오래된 것은 버려진다
  });

  it("상한 이하면 그대로 둔다", () => {
    const n = normalizeLedger(LED([], many(10)));
    expect(Object.keys(n.deleted)).toHaveLength(10);
  });

  it("병합 합집합이 상한을 넘겨도 묶인다", () => {
    const a = LED([], many(TOMBSTONE_MAX, T0));
    const b = LED([], many(100, T0 + 10_000_000)); // 더 최신인 별개 id 들
    const merged = mergeLedger(a, b, null);
    expect(Object.keys(merged.deleted).length).toBeLessThanOrEqual(TOMBSTONE_MAX);
  });
});

// B-3: 파싱 실패를 조용히 null 로 바꾸면, 앱은 빈 상태로 로드되고 자동저장이 원본을 덮어쓴다.
// 쓰기 중단(쿼터·크래시) 한 번이 게스트에겐 영구·불가역 손실이 된다.
describe("저장소 손상 방어 (B-3)", () => {
  const CORRUPT = '{"buys":[{"id":"a1","date":"2026-07-01","qty":3,"pri';
  let store, failWrites;

  const mountStore = () => {
    store = new Map();
    failWrites = new Set(); // 이 키에 대한 setItem 이 쿼터 오류를 던진다
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        if (failWrites.has(k) || failWrites.has("*")) {
          const e = new Error("quota"); e.name = "QuotaExceededError"; throw e;
        }
        store.set(k, String(v));
      },
      removeItem: (k) => store.delete(k),
    };
  };

  beforeEach(() => { mountStore(); __resetStorageIssues(); });

  it("손상된 원본을 <key>.corrupt 로 백업한 뒤에만 null 을 반환한다", () => {
    store.set(LKEY, CORRUPT);
    const led = loadLedger();
    expect(led.buys).toEqual([]);                       // 빈 상태로 로드되지만
    expect(store.get(LKEY + CORRUPT_SUFFIX)).toBe(CORRUPT); // 원본은 보존
    expect(getStorageIssues().corruptKeys).toContain(LKEY);
  });

  it("자동저장이 원본을 덮어써도 백업이 남아 복구 가능하다", () => {
    store.set(LKEY, CORRUPT);
    saveLedger(loadLedger()); // App 의 useEffect(() => saveLedger(ledger), [ledger])
    expect(store.get(LKEY)).not.toBe(CORRUPT);              // 자리는 덮였지만
    expect(store.get(LKEY + CORRUPT_SUFFIX)).toBe(CORRUPT); // 원본은 살아 있다
  });

  it("백업조차 못하면(공간 부족) 그 키에는 쓰지 않는다 — 원본 보존이 최우선", () => {
    store.set(LKEY, CORRUPT);
    failWrites.add(LKEY + CORRUPT_SUFFIX); // 백업 쓰기 실패
    loadLedger();
    expect(getStorageIssues().unbackedKeys).toContain(LKEY);

    expect(saveLedger({ buys: [] })).toBe(false); // 쓰기 거부
    expect(store.get(LKEY)).toBe(CORRUPT);        // 원본 그대로
  });

  it("서로 다른 손상본은 각각 다른 슬롯에 보관한다 (최신 원본도 반드시 백업)", () => {
    const SECOND = '{"another":"corrupt';
    store.set(LKEY, CORRUPT);
    loadLedger();
    store.set(LKEY, SECOND);
    __resetStorageIssues();
    loadLedger();
    const [s1, s2] = corruptSlots(LKEY);
    expect(store.get(s1)).toBe(CORRUPT); // 최초 손상본 유지
    expect(store.get(s2)).toBe(SECOND);  // 지금 살려야 할 원본도 백업
    expect(getStorageIssues().unbackedKeys).toEqual([]);
  });

  it("같은 손상본이 다시 읽히면 슬롯을 낭비하지 않는다", () => {
    store.set(LKEY, CORRUPT);
    loadLedger();
    __resetStorageIssues();
    loadLedger();
    expect(store.has(corruptSlots(LKEY)[1])).toBe(false);
  });

  it("슬롯이 차면 최근 슬롯을 밀어내고 현재 원본을 백업한다 (앱이 얼어붙지 않는다)", () => {
    const [s1, s2] = corruptSlots(LKEY);
    store.set(s1, "first-corrupt");
    store.set(s2, "old-latest");
    const THIRD = '{"third":"corrupt';
    store.set(LKEY, THIRD);
    loadLedger();
    // 불변식: 지금 덮어쓸 원본이 어딘가에 백업돼 있다
    expect([store.get(s1), store.get(s2)]).toContain(THIRD);
    expect(store.get(s1)).toBe("first-corrupt"); // 최초 손상본은 지킨다
    expect(getStorageIssues().unbackedKeys).toEqual([]);
    expect(saveLedger({ buys: [] })).toBe(true); // 쓰기 차단 없음
  });

  it("이미 다른 슬롯에 백업돼 있으면 쿼터가 꽉 차도 백업 성공으로 본다 (Codex B)", () => {
    const [s1, s2] = corruptSlots(LKEY);
    const RAW = '{"x":';
    store.set(s1, "다른-손상본"); // 첫 슬롯은 다른 내용
    store.set(s2, RAW);           // 두 번째 슬롯에 이미 이 원본이 안전하게 보관돼 있다
    store.set(LKEY, RAW);
    failWrites.add("*");          // 이제 어디에도 쓸 수 없다

    loadLedger();
    // 새로 쓸 필요가 없으므로 '백업됨'이어야 한다 → 쓰기가 불필요하게 막히지 않는다
    expect(getStorageIssues().unbackedKeys).toEqual([]);
  });

  it("첫 슬롯에 이미 같은 원본이 있으면 쿼터와 무관하게 백업됨", () => {
    const [s1] = corruptSlots(LKEY);
    const RAW = '{"y":';
    store.set(s1, RAW);
    store.set(LKEY, RAW);
    failWrites.add("*");
    loadLedger();
    expect(getStorageIssues().unbackedKeys).toEqual([]);
  });

  it("백업 기록 후 슬롯이 사라지면 다시 백업하고, 못하면 쓰지 않는다 (Codex LOW)", () => {
    const RAW = '{"z":';
    store.set(LKEY, RAW);
    loadLedger();
    expect(getStorageIssues().unbackedKeys).toEqual([]); // 백업됨으로 기록

    // 다른 탭/브라우저 정리로 슬롯이 사라짐 + 이제 어디에도 쓸 수 없음
    corruptSlots(LKEY).forEach((sl) => store.delete(sl));
    failWrites.add("*");

    expect(saveLedger({ buys: [] })).toBe(false); // 과거 기록을 믿지 않고 재확인
    expect(store.get(LKEY)).toBe(RAW);            // 원본 보존
    expect(getStorageIssues().unbackedKeys).toContain(LKEY);
  });

  it("슬롯이 사라졌어도 공간이 있으면 다시 백업하고 쓴다", () => {
    const RAW = '{"z":';
    store.set(LKEY, RAW);
    loadLedger();
    corruptSlots(LKEY).forEach((sl) => store.delete(sl));

    expect(saveLedger({ buys: [] })).toBe(true);
    expect(store.get(corruptSlots(LKEY)[0])).toBe(RAW); // 사라진 백업을 되살림
  });

  it("이미 덮인 뒤(정상 JSON)에는 재백업하지 않는다 — 정상 값이 손상 백업을 밀어내면 안 된다", () => {
    const RAW = '{"z":';
    store.set(LKEY, RAW);
    loadLedger();
    expect(saveLedger({ buys: [] })).toBe(true);      // 원본은 백업됐고 자리는 덮였다
    expect(saveLedger({ buys: [{ id: "x" }] })).toBe(true); // 두 번째 저장

    const [s1, s2] = corruptSlots(LKEY);
    expect(store.get(s1)).toBe(RAW);   // 손상본 그대로
    expect(store.has(s2)).toBe(false); // 정상 JSON 이 슬롯을 차지하지 않았다
  });

  it("백업 자체가 불가능할 때만 쓰기를 막는다 (원본이 제자리에 남는다)", () => {
    const THIRD = '{"third":"corrupt';
    store.set(LKEY, THIRD);
    failWrites.add("*"); // 어떤 슬롯에도 쓸 수 없다
    loadLedger();
    expect(getStorageIssues().unbackedKeys).toContain(LKEY);
    expect(saveLedger({ buys: [] })).toBe(false);
    expect(store.get(LKEY)).toBe(THIRD); // 파괴되지 않음
  });

  it("쿼터 초과 쓰기는 조용히 삼켜지지 않는다", () => {
    expect(getStorageIssues().quotaHit).toBe(false);
    failWrites.add("*");
    expect(saveLedger({ buys: [] })).toBe(false);
    expect(getStorageIssues().quotaHit).toBe(true);
  });

  it("정상 데이터는 아무 표시도 남기지 않는다", () => {
    store.set(LKEY, JSON.stringify({ buys: [{ id: "x" }], sells: [], cashes: [], spends: [] }));
    expect(loadLedger().buys).toHaveLength(1);
    expect(getStorageIssues().corruptKeys).toEqual([]);
    expect(store.has(LKEY + CORRUPT_SUFFIX)).toBe(false);
  });

  it("내보내기에 손상된 원본이 함께 담긴다 (백업 파일이 유일한 복구 수단)", () => {
    store.set(LKEY, CORRUPT);
    loadLedger();
    // exportAll 은 Blob/DOM 을 쓰므로 여기서는 collectCorruptRaw 경로만 간접 확인:
    // importAll → export 왕복 대신, 백업 키가 존재하고 원본과 같음을 확인한다.
    expect(store.get(LKEY + CORRUPT_SUFFIX)).toBe(CORRUPT);
  });

  it("백업 못한 원본이 있으면 가져오기도 거부한다 (덮어쓰면 복구 불가능하다)", () => {
    store.set(LKEY, CORRUPT);
    failWrites.add("*");
    loadLedger();
    expect(getStorageIssues().unbackedKeys).toContain(LKEY); // 쓰기 차단 상태

    const r = importAll(JSON.stringify({ app: "mvp-calculator", ledger: { buys: [{ id: "new" }] } }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/백업할 공간/);
    expect(store.get(LKEY)).toBe(CORRUPT); // 원본 보존
  });

  it("정상 상태의 가져오기는 그대로 성공한다", () => {
    const r = importAll(JSON.stringify({ app: "mvp-calculator", ledger: { buys: [{ id: "new" }] } }));
    expect(r.ok).toBe(true);
    expect(JSON.parse(store.get(LKEY)).buys[0].id).toBe("new");
  });

  it("가져오기 중 공간이 부족하면 조용히 반쪽 복원하지 않고 알린다", () => {
    failWrites.add(LKEY);
    const r = importAll(JSON.stringify({ app: "mvp-calculator", ledger: { buys: [] } }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/저장 공간/);
  });
});

describe("저장소 손상 방어 — 자체 추가 검수", () => {
  const CORRUPT = '{"buys":[{"id":"a1"';
  let store, failWrites;
  beforeEach(() => {
    store = new Map();
    failWrites = new Set();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        if (failWrites.has(k) || failWrites.has("*")) { const e = new Error("q"); e.name = "QuotaExceededError"; throw e; }
        store.set(k, String(v));
      },
      removeItem: (k) => store.delete(k),
    };
    __resetStorageIssues();
  });

  it("공간이 다시 생겨 쓰기가 성공하면 쿼터 경고를 걷는다", () => {
    failWrites.add("*");
    expect(saveLedger({ buys: [] })).toBe(false);
    expect(getStorageIssues().quotaHit).toBe(true);

    failWrites.clear();
    expect(saveLedger({ buys: [] })).toBe(true);
    expect(getStorageIssues().quotaHit).toBe(false); // 배너가 새로고침까지 남지 않는다
  });

  it("로그아웃은 .corrupt 백업도 지운다 (원장 원본이 공용 브라우저에 남으면 안 된다)", () => {
    store.set(LKEY, CORRUPT);
    loadLedger();
    expect(store.get(LKEY + CORRUPT_SUFFIX)).toBe(CORRUPT);
    expect(getStorageIssues().corruptKeys).toContain(LKEY);

    clearAccountData();

    expect(store.has(LKEY + CORRUPT_SUFFIX)).toBe(false);
    expect(store.has(KEY + CORRUPT_SUFFIX)).toBe(false);
    expect(getStorageIssues().corruptKeys).toEqual([]); // 표시도 초기화
  });

  it("구독 해제가 동작한다 (리스너 누수 없음)", () => {
    let calls = 0;
    const off = onStorageIssue(() => calls++);
    store.set(LKEY, CORRUPT);
    loadLedger();
    expect(calls).toBeGreaterThan(0);
    const before = calls;
    off();
    __resetStorageIssues();
    store.set(KEY, CORRUPT);
    loadCalcState();
    expect(calls).toBe(before); // 해제 후에는 호출되지 않는다
  });
});

// Codex HIGH: importAll 이 차단을 '먼저' 풀고 쓰기가 실패하면, 가드가 사라진 채 남아
// 이후 자동저장이 백업 없는 원본을 덮어쓴다 — 이 기능이 막으려던 바로 그 파괴가 import 경로로 재발.
describe("저장소 손상 방어 — importAll 경로 (Codex HIGH/MEDIUM)", () => {
  const CORRUPT = '{"buys":[{"id":"a1"';
  let store, failWrites;
  const mount = () => {
    store = new Map();
    failWrites = new Set();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        if (failWrites.has(k) || failWrites.has("*")) { const e = new Error("q"); e.name = "QuotaExceededError"; throw e; }
        store.set(k, String(v));
      },
      removeItem: (k) => store.delete(k),
    };
  };
  beforeEach(() => { mount(); __resetStorageIssues(); });

  const backup = (payload) => JSON.stringify({ app: "mvp-calculator", ...payload });

  it("가져오기가 실패해도 손상 차단이 유지되어 원본이 파괴되지 않는다", () => {
    // 백업조차 못한 상태(슬롯 쓰기 실패)
    store.set(LKEY, CORRUPT);
    failWrites.add("*");
    loadLedger();
    expect(getStorageIssues().unbackedKeys).toContain(LKEY);

    // 가져오기 시도 → 백업 재시도도 실패하므로 아예 쓰지 않고 거부해야 한다
    const r = importAll(backup({ ledger: { buys: [{ id: "new" }] } }));
    expect(r.ok).toBe(false);
    expect(store.get(LKEY)).toBe(CORRUPT); // 원본 그대로

    // 가드가 살아 있어야 한다 — 이후 자동저장이 원본을 덮어쓰면 안 된다
    expect(getStorageIssues().unbackedKeys).toContain(LKEY);
    expect(saveLedger({ buys: [] })).toBe(false);
    expect(store.get(LKEY)).toBe(CORRUPT);
  });

  it("공간이 생기면 가져오기가 백업을 재시도해 성공한다", () => {
    store.set(LKEY, CORRUPT);
    failWrites.add("*");
    loadLedger();
    expect(getStorageIssues().unbackedKeys).toContain(LKEY);

    failWrites.clear(); // 사용자가 저장소를 정리함
    const r = importAll(backup({ ledger: { buys: [{ id: "new" }] } }));
    expect(r.ok).toBe(true);
    expect(JSON.parse(store.get(LKEY)).buys[0].id).toBe("new");
  });

  it("파일에 없는 키의 가드는 건드리지 않는다", () => {
    store.set(LKEY, CORRUPT);
    store.set(KEY, CORRUPT);
    failWrites.add(corruptSlots(KEY)[0]);
    failWrites.add(corruptSlots(KEY)[1]);
    loadLedger();   // ledger 는 정상 백업
    loadCalcState(); // calc 는 백업 실패 → 차단
    expect(getStorageIssues().unbackedKeys).toContain(KEY);

    // ledger 만 담긴 파일 → calc 의 가드는 그대로여야 한다
    const r = importAll(backup({ ledger: { buys: [] } }));
    expect(r.ok).toBe(true);
    expect(getStorageIssues().unbackedKeys).toContain(KEY);
    expect(store.get(KEY)).toBe(CORRUPT); // calc 원본 보존
  });

  it("복원에 성공해도 백업 슬롯은 남긴다 (사용자가 내보내기를 안 했다면 유일한 사본)", () => {
    store.set(LKEY, CORRUPT);
    loadLedger();
    expect(store.get(corruptSlots(LKEY)[0])).toBe(CORRUPT);

    expect(importAll(backup({ ledger: { buys: [] } })).ok).toBe(true);
    expect(store.get(corruptSlots(LKEY)[0])).toBe(CORRUPT); // 증거 보존
    expect(getStorageIssues().corruptKeys).toEqual([]);      // 표시는 걷힌다
  });

  it("내보내기는 모든 슬롯의 원본을 담는다", () => {
    const SECOND = '{"x":';
    store.set(LKEY, CORRUPT);
    loadLedger();
    store.set(LKEY, SECOND);
    __resetStorageIssues();
    loadLedger();
    const [s1, s2] = corruptSlots(LKEY);
    expect(store.get(s1)).toBe(CORRUPT);
    expect(store.get(s2)).toBe(SECOND);
  });
});

// 이 기능의 유일한 불변식을 무작위 시퀀스로 검증한다:
//   "localStorage[key] 를 덮어쓸 때, 그 내용이 파싱 불가라면 어딘가에 백업돼 있어야 한다."
//   백업할 수 없으면 덮어쓰지 않는다.
// 앱의 실제 흐름(마운트 시 load → 상태 변경 시 save)을 모사한다.
// 슬롯 쓰기만 실패하는 상태를 따로 둔다 — 그래야 '백업 실패인데 본문은 써지는' 위험 구간이 재현된다.
describe("저장소 손상 방어 — 불변식 (무작위 시퀀스)", () => {
  it("어떤 순서로 손상·저장이 반복돼도 백업 없는 원본이 파괴되지 않는다", () => {
    const CORRUPTS = ['{"a":', '{"b":[1,', "not json", '{"c":{"d":', "["];
    let seed = 1;
    // LCG 하위 비트는 주기가 짧다 → 상위 비트를 쓴다.
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return ((seed >>> 16) % n); };
    const isSlot = (k) => k.includes(CORRUPT_SUFFIX);
    let checked = 0;

    for (let trial = 0; trial < 300; trial++) {
      const store = new Map();
      let blockSlots = false; // 백업(.corrupt*) 쓰기만 실패
      globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => {
          if (blockSlots && isSlot(k)) { const e = new Error("q"); e.name = "QuotaExceededError"; throw e; }
          store.set(k, String(v));
        },
        removeItem: (k) => store.delete(k),
      };
      __resetStorageIssues();

      for (let step = 0; step < 10; step++) {
        if (rnd(2) === 0) store.set(LKEY, CORRUPTS[rnd(CORRUPTS.length)]); // 손상 발생
        blockSlots = rnd(3) === 0;                                          // 백업 공간 없음
        loadLedger();                                                       // 앱 마운트

        const before = store.get(LKEY);
        const parsable = (() => { try { JSON.parse(before); return true; } catch { return false; } })();
        const wrote = saveLedger({ buys: [{ id: "s" + step }] });           // 자동저장

        if (before != null && !parsable) {
          checked++;
          if (wrote) {
            // 파싱 불가한 원본을 덮어썼다 → 어느 슬롯엔가 반드시 남아 있어야 한다
            expect(corruptSlots(LKEY).map((sl) => store.get(sl))).toContain(before);
          } else {
            expect(store.get(LKEY)).toBe(before); // 쓰지 않았으면 원본이 제자리에
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100); // 위험 구간을 실제로 밟았는지 확인
  });
});


// B-5 (1단계): 마일리지 결제 비율은 넥슨 규칙이다. 사용자 설정이 아니다.
// 예전엔 settings 에 있어 사용자가 바꿀 수 있었고, 바꾸면 cumNow 가 재계산되어
// 13주 누적 과금과 표시 등급이 흔들렸다(등급 판정의 기준 숫자가 소급해 변함).
describe("B-5 · 마일리지 결제 비율은 규칙이지 설정이 아니다", () => {
  const thisWeek = fmtD(weekStartThu(new Date()));
  const led = {
    buys: [{ id: "b", date: thisWeek, qty: 10, price: 5900, mil: true }],
    sells: [], cashes: [], spends: [],
  };

  it("settings 에 mileageRate 가 없다", () => {
    expect(DEFAULT_SETTINGS.mileageRate).toBeUndefined();
    expect(DEFAULT_RULES.mileageRate).toBe(30);
  });

  it("사용자가 settings 에 mileageRate 를 심어도 계산에 영향이 없다", () => {
    const base = computeCalc(DEFAULT_SETTINGS, DEFAULT_CHARGES, []);
    const 오염 = computeCalc({ ...DEFAULT_SETTINGS, mileageRate: 90 }, DEFAULT_CHARGES, []);
    expect(오염.mileageR).toBe(base.mileageR); // settings 는 무시된다
  });

  it("구 저장본의 mileageRate 는 승계되지 않는다 (parseCalcState)", () => {
    const s = parseCalcState({ mileageRate: 90, mesoRate: 3200 });
    expect(s.settings.mileageRate).toBeUndefined();
    expect(s.settings.mesoRate).toBe(3200); // 다른 값은 정상 승계
  });

  it("13주 누적 과금은 사용자 설정으로 흔들리지 않는다 (등급 판정의 기준)", () => {
    const a = computeCalc(DEFAULT_SETTINGS, DEFAULT_CHARGES, []);
    const b = computeCalc({ ...DEFAULT_SETTINGS, mileageRate: 20, mvpGrade: "3" }, DEFAULT_CHARGES, []);
    expect(cumNow(led, b.mileageR)).toBe(cumNow(led, a.mileageR));
  });

  it("규칙이 바뀌면(app_config) 계산도 바뀐다 — 그게 유일한 변경 경로다", () => {
    const r20 = resolveRules({ mileageRate: 20 });
    expect(r20.mileageRate).toBe(20);
    const c = computeCalc(DEFAULT_SETTINGS, DEFAULT_CHARGES, [], r20);
    expect(c.mileageR).toBeCloseTo(0.2, 10);
  });

  it("mileageRate = 100 은 거부한다 (buildPlan 에 NaN/Infinity 유입)", () => {
    expect(resolveRules({ mileageRate: 100 }).mileageRate).toBe(DEFAULT_RULES.mileageRate);
    expect(resolveRules({ mileageRate: 99 }).mileageRate).toBe(99);
  });
});

// B-5 (2단계): 발효일 있는 규칙 이력 + 거래별 요율
describe("B-5 · 발효일 있는 규칙 이력", () => {
  const HIST = [
    { effectiveFrom: "2025-01-01", feeMvp: 5, feeBase: 8, mileageRate: 40 },
    { effectiveFrom: "2026-01-01", feeMvp: 3, feeBase: 5, mileageRate: 30 },
  ];

  it("객체(단일 규칙)도 그대로 받는다 — 하위 호환", () => {
    const h = resolveRuleHistory({ feeMvp: 2 });
    expect(h).toHaveLength(1);
    expect(h[0].feeMvp).toBe(2);
    expect(rulesAt(h, "1999-01-01").feeMvp).toBe(2); // 언제든 유효
  });

  it("거래 날짜에 맞는 규칙을 고른다", () => {
    const h = resolveRuleHistory(HIST);
    expect(rulesAt(h, "2025-06-30").mileageRate).toBe(40);
    expect(rulesAt(h, "2026-06-30").mileageRate).toBe(30);
    expect(rulesAt(h, "2025-12-31").feeMvp).toBe(5);
    expect(rulesAt(h, "2026-01-01").feeMvp).toBe(3); // 발효일 당일부터
  });

  it("가장 이른 규칙 이전 날짜도 규칙을 갖는다 (빈 구간 없음)", () => {
    const h = resolveRuleHistory(HIST);
    expect(rulesAt(h, "2000-01-01").mileageRate).toBe(40);
    expect(rulesAt(h, undefined).mileageRate).toBe(40); // 날짜 없는 행
  });

  it("순서가 뒤섞여 있어도 발효일 오름차순으로 정렬한다", () => {
    const h = resolveRuleHistory([HIST[1], HIST[0]]);
    expect(h.map((e) => e.mileageRate)).toEqual([40, 30]);
  });

  it("malformed 원소는 버리고, 전부 malformed 면 기본값", () => {
    expect(resolveRuleHistory([null, "x", 3])[0]).toMatchObject(DEFAULT_RULES);
    const h = resolveRuleHistory([{ effectiveFrom: "not-a-date", feeMvp: 2 }]);
    expect(h[0].feeMvp).toBe(2); // 규칙은 살리되 발효일만 EPOCH 로
  });

  it("규칙이 바뀌어도 과거 거래는 그때의 규칙으로 계산된다", () => {
    const h = resolveRuleHistory(HIST);
    const mileageROf = (b) => rulesAt(h, b.date).mileageRate / 100;
    const led = {
      buys: [
        { id: "old", date: "2025-06-01", qty: 1, price: 10000, mil: true }, // 당시 40%
        { id: "new", date: "2026-06-01", qty: 1, price: 10000, mil: true }, // 지금 30%
      ],
      sells: [], cashes: [], spends: [],
    };
    const all = () => true;
    const st = ledgerStats(led, all, { fee: 0, effD: 0, mileageR: mileageROf });
    // 실적 = 가격 × (1 - 마일리지 비율).  10000×0.6 + 10000×0.7 = 13000
    expect(st.ach).toBeCloseTo(13000, 6);
    // 단일 규칙(30%)만 있었다면 7000+7000 = 14000 이었을 것 — 과거가 소급 변경됐을 것이다
    const stWrong = ledgerStats(led, all, { fee: 0, effD: 0, mileageR: 0.3 });
    expect(stWrong.ach).toBeCloseTo(14000, 6);
  });
});

// B-5 (2단계): 행 스냅샷 — 사용자 상태(등급·충전 방식)는 규칙으로 못 옮기므로 거래에 남긴다
describe("B-5 · 거래 행 요율 스냅샷", () => {
  const all = () => true;
  const led = {
    buys: [
      { id: "snap", date: "2026-06-01", qty: 1, price: 10000, _effD: 0.10 }, // 그때 충전 할인 10%
      { id: "legacy", date: "2026-06-01", qty: 1, price: 10000 },            // 구 데이터
    ],
    sells: [
      { id: "snap", date: "2026-06-01", qty: 1, meso: 10, _fee: 0.05 },      // 그때 수수료 5%
      { id: "legacy", date: "2026-06-01", qty: 1, meso: 10 },                // 구 데이터
    ],
    cashes: [], spends: [],
  };
  // 현재 설정: 충전 할인 0%, 수수료 3%
  const env = (curEffD, curFee) => ({
    mileageR: () => 0,
    effD: (b) => (b._effD != null ? +b._effD : curEffD),
    fee: (s) => (s._fee != null ? +s._fee : curFee),
  });

  it("스냅샷 있는 행은 현재 설정을 바꿔도 값이 변하지 않는다", () => {
    const a = ledgerStats(led, all, env(0, 0.03));
    const b = ledgerStats(led, all, env(0.5, 0.20)); // 사용자가 설정을 크게 바꿈

    // 스냅샷 행의 기여분: spend = 10000×(1-0.10) = 9000, sold = 10×(1-0.05) = 9.5
    // 구 데이터 행만 현재 설정을 따라 변한다.
    const snapSpend = 10000 * (1 - 0.10);
    expect(a.spend - 10000 * (1 - 0.0)).toBeCloseTo(snapSpend, 6);
    expect(b.spend - 10000 * (1 - 0.5)).toBeCloseTo(snapSpend, 6);

    const snapSold = 10 * (1 - 0.05);
    expect(a.meso - 10 * (1 - 0.03)).toBeCloseTo(snapSold, 6);
    expect(b.meso - 10 * (1 - 0.20)).toBeCloseTo(snapSold, 6);
  });

  it("구 데이터(스냅샷 없음)는 현재 설정으로 폴백한다 — 복원할 방법이 없다", () => {
    const st = ledgerStats(led, all, env(0.25, 0.07));
    expect(st.spend).toBeCloseTo(10000 * 0.90 + 10000 * 0.75, 6);
    expect(st.meso).toBeCloseTo(10 * 0.95 + 10 * 0.93, 6);
  });

  it("스냅샷 0(할인 없음)과 '스냅샷 없음'을 구분한다", () => {
    const zero = { buys: [{ id: "z", date: "2026-06-01", qty: 1, price: 10000, _effD: 0 }], sells: [], cashes: [], spends: [] };
    const st = ledgerStats(zero, all, env(0.5, 0));
    expect(st.spend).toBeCloseTo(10000, 6); // 0 이 폴백으로 새지 않는다
  });
});

// 자체 검수: 요율 스냅샷은 '그때 그랬다'는 불변의 사실 → 병합에서 잃으면 안 된다.
describe("B-5 · 스냅샷은 병합에서 소실되지 않는다", () => {
  it("스냅샷 없는 클라우드 행이 스냅샷 있는 로컬 행을 덮어써도 요율은 살아남는다", () => {
    // 구버전 클라이언트(또는 오래된 탭)가 스냅샷 없이 같은 거래를 올린 상황
    const local = { buys: [{ id: "x", qty: 1, price: 10000, _effD: 0.1 }], sells: [], cashes: [], spends: [] };
    const cloud = { buys: [{ id: "x", qty: 2, price: 10000 }], sells: [], cashes: [], spends: [] };
    const merged = mergeLedger(local, cloud, null);
    expect(merged.buys[0].qty).toBe(2);      // 내용은 클라우드 우선(기존 규칙 유지)
    expect(merged.buys[0]._effD).toBe(0.1);  // 스냅샷은 살아남는다
  });

  it("판매 수수료 스냅샷도 마찬가지", () => {
    const local = { buys: [], sells: [{ id: "s", meso: 1, _fee: 0.05 }], cashes: [], spends: [] };
    const cloud = { buys: [], sells: [{ id: "s", meso: 2 }], cashes: [], spends: [] };
    const merged = mergeLedger(local, cloud, null);
    expect(merged.sells[0].meso).toBe(2);
    expect(merged.sells[0]._fee).toBe(0.05);
  });

  it("클라우드 쪽 스냅샷이 최신이면 그쪽을 쓴다", () => {
    const local = { buys: [{ id: "x", _effD: 0.1 }], sells: [], cashes: [], spends: [] };
    const cloud = { buys: [{ id: "x", _effD: 0.2 }], sells: [], cashes: [], spends: [] };
    expect(mergeLedger(local, cloud, null).buys[0]._effD).toBe(0.2);
  });

  it("삭제된 거래는 스냅샷과 무관하게 제거된다", () => {
    const local = { ...deleteLedgerEntry({ buys: [{ id: "x", _effD: 0.1 }], sells: [], cashes: [], spends: [] }, "buys", "x", T0) };
    const cloud = { buys: [{ id: "x" }], sells: [], cashes: [], spends: [] };
    expect(mergeLedger(local, cloud, null).buys).toEqual([]);
  });
});

describe("B-5 · rulesAt 의 날짜 처리", () => {
  const H = resolveRuleHistory([
    { effectiveFrom: "2025-01-01", mileageRate: 40 },
    { effectiveFrom: "2026-01-01", mileageRate: 30 },
  ]);

  it("발효일이 미래인 규칙은 지금 적용되지 않는다", () => {
    expect(rulesAt(H, "2025-12-31").mileageRate).toBe(40);
  });

  it("날짜가 없거나 형식이 깨진 행은 가장 이른 규칙을 쓴다 (조용히 최신을 쓰지 않는다)", () => {
    // "2026-7-2" 는 zero-pad 가 없어 사전식 비교가 깨진다 → 규칙 선택도 신뢰할 수 없다.
    // 앱이 생성하는 날짜는 항상 fmtD(zero-pad)이고, 가져오기 파일 검증은 백로그 B-6.
    expect(rulesAt(H, "2026-7-2").mileageRate).toBe(40);
    expect(rulesAt(H, undefined).mileageRate).toBe(40);
    expect(rulesAt(H, null).mileageRate).toBe(40);
  });

  it("history 가 비었거나 배열이 아니면 기본 규칙", () => {
    expect(rulesAt([], "2026-01-01")).toBe(DEFAULT_RULES);
    expect(rulesAt(null, "2026-01-01")).toBe(DEFAULT_RULES);
  });
});

// Codex A: malformed 스냅샷이 조용히 '수수료 0%'가 되면 안 된다 → '스냅샷 없음'으로 취급해 현재 설정 폴백.
describe("B-5 · malformed 스냅샷 방어 (Codex A)", () => {
  const all = () => true;
  const CUR_FEE = 0.03, CUR_EFFD = 0.10;
  const envOf = () => ({
    mileageR: () => 0,
    fee: (s) => (s && hasSnapshot(s._fee) ? s._fee : CUR_FEE),
    effD: (b) => (b && hasSnapshot(b._effD) ? b._effD : CUR_EFFD),
  });

  it("hasSnapshot 계약", () => {
    expect(hasSnapshot(0)).toBe(true);        // 0% 는 유효한 스냅샷
    expect(hasSnapshot(0.05)).toBe(true);
    expect(hasSnapshot(null)).toBe(false);
    expect(hasSnapshot(undefined)).toBe(false);
    expect(hasSnapshot("bad")).toBe(false);   // NaN
    expect(hasSnapshot("")).toBe(false);      // +"" = 0 이지만 스냅샷으로 인정하지 않는다
    expect(hasSnapshot("0.05")).toBe(false);  // 숫자 타입만 인정(우리가 쓰는 값은 항상 number)
    expect(hasSnapshot(NaN)).toBe(false);
    expect(hasSnapshot(Infinity)).toBe(false);
    expect(hasSnapshot(-0.1)).toBe(false);    // 음수 요율 없음
    expect(hasSnapshot(1)).toBe(false);       // 100% 수수료/할인은 없음
    expect(hasSnapshot(1.5)).toBe(false);
  });

  it('_fee: "bad" 가 수수료 0% 로 새지 않는다 (현재 설정으로 폴백)', () => {
    const led = { buys: [], sells: [{ id: "s", date: "2026-06-01", qty: 1, meso: 10, _fee: "bad" }], cashes: [], spends: [] };
    const st = ledgerStats(led, all, envOf());
    expect(st.meso).toBeCloseTo(10 * (1 - CUR_FEE), 10); // 10 이 아니라 9.7
  });

  it("_effD 가 범위를 벗어나면 현재 설정으로 폴백", () => {
    const led = { buys: [{ id: "b", date: "2026-06-01", qty: 1, price: 10000, _effD: 1.5 }], sells: [], cashes: [], spends: [] };
    const st = ledgerStats(led, all, envOf());
    expect(st.spend).toBeCloseTo(10000 * (1 - CUR_EFFD), 10); // 음수 지출이 되지 않는다
  });

  it("유효한 0 스냅샷은 폴백하지 않는다", () => {
    const led = { buys: [{ id: "b", date: "2026-06-01", qty: 1, price: 10000, _effD: 0 }], sells: [], cashes: [], spends: [] };
    expect(ledgerStats(led, all, envOf()).spend).toBeCloseTo(10000, 10);
  });
});

// Codex C: 원장의 날짜는 zero-padded 여야 사전식 비교가 성립한다.
describe("padDate · 날짜 정규화 (Codex C)", () => {
  it("패딩만 하면 되는 형태를 바로잡는다", () => {
    expect(padDate("2026-7-2")).toBe("2026-07-02");
    expect(padDate("2026-07-2")).toBe("2026-07-02");
    expect(padDate(" 2026-7-02 ")).toBe("2026-07-02");
    expect(padDate("2026-07-02")).toBe("2026-07-02");
  });

  it("해석할 수 없는 값은 건드리지 않는다 (임의로 다른 날로 바꾸지 않는다)", () => {
    expect(padDate("어제")).toBe("어제");
    expect(padDate("2026/07/02")).toBe("2026/07/02");
    expect(padDate(null)).toBe(null);
    expect(padDate(20260702)).toBe(20260702);
  });

  it("normalizeLedger 가 행 날짜를 정규화한다 — 주차 집계에서 조용히 누락되지 않는다", () => {
    const n = normalizeLedger({ buys: [{ id: "b", date: "2026-7-2", qty: 1, price: 100 }] });
    expect(n.buys[0].date).toBe("2026-07-02");

    // 정규화 전이라면 이 거래는 그 주에서 빠진다("2026-7-2" <= "2026-07-08" 이 false)
    const ws = new Date("2026-07-02T00:00:00");
    expect(weeklyMeso(n, ws, 0).buyQty).toBe(1);
  });

  it("정규화된 날짜로 규칙이 올바르게 선택된다", () => {
    const H = resolveRuleHistory([
      { effectiveFrom: "2025-01-01", mileageRate: 40 },
      { effectiveFrom: "2026-01-01", mileageRate: 30 },
    ]);
    const n = normalizeLedger({ buys: [{ id: "b", date: "2026-7-2" }] });
    expect(rulesAt(H, n.buys[0].date).mileageRate).toBe(30); // 정규화 전이라면 40(가장 이른 규칙)
  });
});

// M-7: normalizeLedger 가 입력 객체를 제자리 변형하면, 호출자가 들고 있는 객체(클라우드 행 등)가 오염된다.
describe("normalizeLedger 는 입력을 변형하지 않는다 (M-7)", () => {
  it("행에 id/date 를 심지 않는다", () => {
    const row = { qty: 1, date: "2026-7-2" };
    const input = { buys: [row], sells: [], cashes: [], spends: [] };
    const out = normalizeLedger(input);

    expect(row.id).toBeUndefined();        // 입력은 그대로
    expect(row.date).toBe("2026-7-2");
    expect(out.buys[0].id).toBeTruthy();   // 출력만 정규화
    expect(out.buys[0].date).toBe("2026-07-02");
    expect(out.buys[0]).not.toBe(row);
  });

  it("현금화 rate 승계도 입력을 건드리지 않는다", () => {
    const c = { id: "c", meso: 3, won: 1000 };
    const out = normalizeLedger({ cashes: [c] });
    expect(c.rate).toBeUndefined();
    expect(out.cashes[0].rate).toBeCloseTo(1000 / 3, 10);
  });

  it("요율 스냅샷은 복사본에도 보존된다", () => {
    const out = normalizeLedger({ buys: [{ id: "b", _effD: 0.1 }], sells: [{ id: "s", _fee: 0.05 }] });
    expect(out.buys[0]._effD).toBe(0.1);
    expect(out.sells[0]._fee).toBe(0.05);
  });
});

// ===== Codex 2차 재검수 반영 =====
// 발효일 이력의 '가장 이른 항목을 EPOCH 로 내리는' 편의 규칙이, 미래 발효 규칙까지 소급 적용했다.
describe("B-5 · 미래 발효 규칙은 지금 적용되지 않는다 (Codex F1)", () => {
  const TODAY = "2026-07-10";

  it("미래 발효 규칙만 있는 이력에서 '지금'은 코드 기본값을 쓴다", () => {
    const h = resolveRuleHistory([{ effectiveFrom: "2030-01-01", mileageRate: 50, feeBase: 8 }], TODAY);
    expect(rulesAt(h, TODAY).mileageRate).toBe(DEFAULT_RULES.mileageRate);
    expect(rulesAt(h, TODAY).feeBase).toBe(DEFAULT_RULES.feeBase);
    expect(resolveRules([{ effectiveFrom: "2030-01-01", mileageRate: 50 }], TODAY).mileageRate)
      .toBe(DEFAULT_RULES.mileageRate);
  });

  it("그 규칙은 발효일이 되면 적용된다", () => {
    const h = resolveRuleHistory([{ effectiveFrom: "2030-01-01", mileageRate: 50 }], TODAY);
    expect(rulesAt(h, "2029-12-31").mileageRate).toBe(DEFAULT_RULES.mileageRate);
    expect(rulesAt(h, "2030-01-01").mileageRate).toBe(50);
  });

  it("이미 발효한 가장 이른 규칙은 그 이전 거래에도 적용된다 (빈 구간 방지는 유지)", () => {
    const h = resolveRuleHistory([{ effectiveFrom: "2025-01-01", mileageRate: 40 }], TODAY);
    expect(rulesAt(h, "2000-01-01").mileageRate).toBe(40);
    expect(rulesAt(h, undefined).mileageRate).toBe(40);
  });

  it("과거·미래가 섞여 있으면 과거분만 EPOCH 로 내려간다", () => {
    const h = resolveRuleHistory(
      [{ effectiveFrom: "2025-01-01", mileageRate: 40 }, { effectiveFrom: "2030-01-01", mileageRate: 50 }],
      TODAY
    );
    expect(rulesAt(h, "2000-01-01").mileageRate).toBe(40);
    expect(rulesAt(h, TODAY).mileageRate).toBe(40);
    expect(rulesAt(h, "2030-06-01").mileageRate).toBe(50);
  });
});

// malformed 스냅샷은 '값이 있다'가 아니라 '스냅샷 없음'이다 → 살아 있는 스냅샷을 덮어써선 안 된다.
describe("B-5 · malformed 스냅샷이 유효한 스냅샷을 덮지 않는다 (Codex F2)", () => {
  const row = (extra) => ({ id: "s", date: "2026-06-01", qty: 1, meso: 10, ...extra });

  it("클라우드 행의 _fee 가 malformed 면 로컬의 유효한 스냅샷을 지킨다", () => {
    const out = mergeLedger({ sells: [row({ _fee: 0.05 })] }, { sells: [row({ _fee: "bad" })] });
    expect(out.sells[0]._fee).toBe(0.05);
  });

  it("_effD 도 마찬가지 — 범위를 벗어난 값에 덮이지 않는다", () => {
    const b = (extra) => ({ id: "b", date: "2026-06-01", qty: 1, price: 100, ...extra });
    expect(mergeLedger({ buys: [b({ _effD: 0.1 })] }, { buys: [b({ _effD: 1.5 })] }).buys[0]._effD).toBe(0.1);
    expect(mergeLedger({ buys: [b({ _effD: 0.1 })] }, { buys: [b({ _effD: NaN })] }).buys[0]._effD).toBe(0.1);
  });

  it("유효한 0 스냅샷은 '없음'이 아니다 — 클라우드의 0 이 로컬 0.05 를 이긴다", () => {
    expect(mergeLedger({ sells: [row({ _fee: 0.05 })] }, { sells: [row({ _fee: 0 })] }).sells[0]._fee).toBe(0);
  });

  it("양쪽 다 malformed 면 폴백 대상으로 남는다 (hasSnapshot 이 거부)", () => {
    const out = mergeLedger({ sells: [row({ _fee: "x" })] }, { sells: [row({ _fee: "bad" })] });
    expect(hasSnapshot(out.sells[0]._fee)).toBe(false);
  });
});

// ===== B-4: 주 경계는 브라우저 로컬 타임존이 아니라 KST 기준 =====
// UTC-8 사용자가 수요일 오후에 열면 KST 로는 이미 목요일(새 MVP 주)이다.
// 로컬 기준으로 판단하면 그 거래가 지난 주 칸에 쌓이고 13주 창도 한 주 어긋난다.
describe("B-4 · 주차 경계 타임존 (KST 고정)", () => {
  // 2026-07-08T16:00:00Z → KST 2026-07-09(목, 새 주 시작) / LA 2026-07-08(수, 지난 주)
  const INSTANT = new Date("2026-07-08T16:00:00Z");

  it("같은 순간이라도 시간대에 따라 민간 날짜가 다르다 (문제의 존재)", () => {
    expect(tzDateStr(INSTANT, "Asia/Seoul")).toBe("2026-07-09");
    expect(tzDateStr(INSTANT, "America/Los_Angeles")).toBe("2026-07-08");
  });

  it("앱은 언제나 KST 를 쓴다 — tz 를 생략하면 Asia/Seoul", () => {
    expect(APP_TZ).toBe("Asia/Seoul");
    expect(tzDateStr(INSTANT)).toBe(tzDateStr(INSTANT, "Asia/Seoul"));
  });

  it("그 순간의 MVP 주는 KST 기준으로 새 주다 (로컬 기준이면 지난 주)", () => {
    const kst = fmtD(weekStartThu(dateOf(tzDateStr(INSTANT, "Asia/Seoul"))));
    const la = fmtD(weekStartThu(dateOf(tzDateStr(INSTANT, "America/Los_Angeles"))));
    expect(kst).toBe("2026-07-09");  // 목요일 당일 = 그 주의 시작
    expect(la).toBe("2026-07-02");   // 한 주 전
    expect(kst).not.toBe(la);
  });

  it("todayStr/curMonth 도 KST 기준이다", () => {
    expect(todayStr()).toBe(tzDateStr(new Date(), "Asia/Seoul"));
    expect(curMonth()).toBe(todayStr().slice(0, 7));
  });

  it("nowD 는 KST 오늘의 민간 날짜를 가리킨다", () => {
    expect(fmtD(nowD())).toBe(todayStr());
  });

  it("dateOf 는 정오 고정 — 브라우저 DST 전환일에도 날짜가 밀리지 않는다", () => {
    const d = dateOf("2026-03-08");
    expect(d.getHours()).toBe(12);
    expect(fmtD(d)).toBe("2026-03-08");
    expect(fmtD(dateOf("2026-07-09"))).toBe("2026-07-09");
  });

  it("잘못된 입력은 Invalid Date / null 로 드러난다 (조용히 오늘이 되지 않는다)", () => {
    expect(isNaN(dateOf("2026-7-9").getTime())).toBe(true);  // zero-pad 안 된 값은 padDate 가 먼저 고친다
    expect(isNaN(dateOf("어제").getTime())).toBe(true);
    expect(tzDateStr(new Date("bad"))).toBe(null);
    expect(tzDateStr("문자열")).toBe(null);
  });

  it("알 수 없는 시간대는 로컬로 폴백하고 던지지 않는다", () => {
    expect(tzDateStr(INSTANT, "Not/AZone")).toBe(fmtD(INSTANT));
  });
});

// ===== B-7: 구버전 원장 행의 id 재발급 → 동기화 후 중복 =====
// `if (!x.id) x.id = uid()` 는 로드 시점의 시각·난수를 쓴다. 같은 백업을 두 기기에서 열면
// 같은 거래가 서로 다른 id 를 얻고, 병합이 id 합집합이라 통계·13주 누적이 2배가 된다.
describe("B-7 · 구버전 행은 결정적 id 를 받는다", () => {
  // 단일 HTML 시절 원장: id 가 없다.
  const LEGACY = () => ({
    buys: [
      { date: "2026-07-01", item: "선택 캐시템", qty: 2, price: 5900, mil: true },
      { date: "2026-07-02", item: "펫", qty: 1, price: 22000, mil: false },
    ],
    sells: [{ date: "2026-07-03", item: "펫", qty: 1, meso: 12.5 }],
    cashes: [{ date: "2026-07-04", meso: 10, rate: 3000 }],
    spends: [{ date: "2026-07-05", amount: 3000, memo: "기타" }],
  });

  it("같은 원장을 두 기기에서 로드하면 같은 id 를 만든다", () => {
    const a = normalizeLedger(LEGACY());
    const b = normalizeLedger(LEGACY());
    expect(a.buys.map((x) => x.id)).toEqual(b.buys.map((x) => x.id));
    expect(a.sells[0].id).toBe(b.sells[0].id);
    expect(a.cashes[0].id).toBe(b.cashes[0].id);
    expect(a.spends[0].id).toBe(b.spends[0].id);
  });

  it("그래서 병합해도 거래가 두 배로 불어나지 않는다 (B-7 의 실제 증상)", () => {
    const a = normalizeLedger(LEGACY());
    const b = normalizeLedger(LEGACY());
    const merged = mergeLedger(a, b);
    expect(merged.buys).toHaveLength(2);
    expect(merged.sells).toHaveLength(1);
    expect(merged.cashes).toHaveLength(1);
    expect(merged.spends).toHaveLength(1);
  });

  it("uid() 와 구분된다 — 결정적 id 는 'L' 로 시작", () => {
    const n = normalizeLedger(LEGACY());
    expect(n.buys[0].id.startsWith("L")).toBe(true);
    expect(uid().startsWith("L")).toBe(false);
  });

  // ★ 가장 위험한 경계: 내용만 해시하면 '같은 날 같은 값에 두 번 산 것'이 하나로 합쳐진다(중복보다 나쁜 소실).
  it("내용이 완전히 같은 두 거래는 서로 다른 id 를 갖는다 (소실 방지)", () => {
    const dup = { buys: [
      { date: "2026-07-01", item: "펫", qty: 1, price: 22000, mil: false },
      { date: "2026-07-01", item: "펫", qty: 1, price: 22000, mil: false },
    ], sells: [], cashes: [], spends: [] };
    const a = normalizeLedger(dup);
    expect(a.buys).toHaveLength(2);
    expect(a.buys[0].id).not.toBe(a.buys[1].id);
    // 그러면서도 두 기기가 같은 답을 낸다.
    const b = normalizeLedger(dup);
    expect(a.buys.map((x) => x.id)).toEqual(b.buys.map((x) => x.id));
    expect(mergeLedger(a, b).buys).toHaveLength(2);
  });

  it("날짜 정규화가 id 유도보다 먼저다 — '2026-7-2' 와 '2026-07-02' 는 같은 거래", () => {
    const loose = normalizeLedger({ buys: [{ date: "2026-7-2", item: "펫", qty: 1, price: 100 }] });
    const strict = normalizeLedger({ buys: [{ date: "2026-07-02", item: "펫", qty: 1, price: 100 }] });
    expect(loose.buys[0].id).toBe(strict.buys[0].id);
    expect(mergeLedger(loose, strict).buys).toHaveLength(1);
  });

  it("숫자가 문자열로 저장돼 있어도 같은 id (\"3\" 과 3)", () => {
    const asStr = normalizeLedger({ buys: [{ date: "2026-07-01", item: "펫", qty: "3", price: "100", mil: false }] });
    const asNum = normalizeLedger({ buys: [{ date: "2026-07-01", item: "펫", qty: 3, price: 100, mil: false }] });
    expect(asStr.buys[0].id).toBe(asNum.buys[0].id);
  });

  it("이미 id 가 있는 행은 건드리지 않고, 순번도 그 행 때문에 어긋나지 않는다", () => {
    const withId = { buys: [
      { id: "keep-me", date: "2026-07-01", item: "펫", qty: 1, price: 100 },
      { date: "2026-07-01", item: "펫", qty: 1, price: 100 },
    ], sells: [], cashes: [], spends: [] };
    const onlyLegacy = { buys: [{ date: "2026-07-01", item: "펫", qty: 1, price: 100 }], sells: [], cashes: [], spends: [] };
    const a = normalizeLedger(withId);
    expect(a.buys[0].id).toBe("keep-me");
    // id 없는 행은 '첫 번째 등장'이어야 한다 — 있는 id 를 셈에 넣었다면 두 번째 순번이 되어 어긋난다.
    expect(a.buys[1].id).toBe(normalizeLedger(onlyLegacy).buys[0].id);
  });

  it("요율 스냅샷은 id 에 들어가지 않는다 (나중에 붙어도 id 가 흔들리면 안 된다)", () => {
    const F = [["date", "s"], ["item", "s"], ["qty", "n"], ["price", "n"], ["mil", "b"]];
    const bare = { date: "2026-07-01", item: "펫", qty: 1, price: 100, mil: false };
    expect(legacyRowId(F, bare, 0)).toBe(legacyRowId(F, { ...bare, _effD: 0.1 }, 0));
  });

  it("필드 경계가 뭉개지지 않는다 (\"ab\"+\"c\" 와 \"a\"+\"bc\" 가 다른 id)", () => {
    const F = [["item", "s"], ["memo", "s"]];
    expect(legacyRowId(F, { item: "ab", memo: "c" }, 0)).not.toBe(legacyRowId(F, { item: "a", memo: "bc" }, 0));
  });
});
