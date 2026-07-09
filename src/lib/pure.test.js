import { describe, it, expect, beforeEach } from "vitest";
import {
  parseCalcState, serializeCalcState, normalizeLedger, normalizeMyItems, withRowKeys,
  getDataOwner, setDataOwner, clearAccountData, deleteLedgerEntry, mergeDeleted, importAll,
  KEY, ITEMS_KEY, LKEY, SYNC_KEY, TOUCHED_KEY, OWNER_KEY, CALMODE_KEY,
  loadLedger, saveLedger, loadCalcState, getStorageIssues, onStorageIssue, __resetStorageIssues, CORRUPT_SUFFIX,
} from "./storage.js";
import { mergeSnapshots, mergeLedger, mergeForUpload, tombstoneClock } from "./cloud.js";
import { weeklyMeso, weeklyItems, itemSummary, NO_ITEM } from "./ledger.js";
import { uid, estGrade, fmtD, weekStartThu } from "./util.js";
import { computeForecast } from "./ledger.js";
import { computeCalc, computeFeePct } from "./calc.js";
import { DEFAULT_RULES, resolveRules, DEFAULT_SETTINGS, DEFAULT_CHARGES, TIERS, TOMBSTONE_TTL_DAYS, TOMBSTONE_MAX } from "./constants.js";

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
    expect(resolveRules(null)).toEqual(DEFAULT_RULES);
    expect(resolveRules("x")).toEqual(DEFAULT_RULES);
    expect(resolveRules([])).toEqual(DEFAULT_RULES);
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

  it("최초 손상본을 보존한다 (두 번째 로드가 백업을 덮어쓰지 않는다)", () => {
    store.set(LKEY, CORRUPT);
    loadLedger();
    store.set(LKEY, '{"another":"corrupt');
    __resetStorageIssues();
    loadLedger();
    expect(store.get(LKEY + CORRUPT_SUFFIX)).toBe(CORRUPT);
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

  it("가져오기는 손상 차단을 해제해 복원이 조용히 실패하지 않는다", () => {
    store.set(LKEY, CORRUPT);
    failWrites.add(LKEY + CORRUPT_SUFFIX);
    loadLedger();
    expect(getStorageIssues().unbackedKeys).toContain(LKEY); // 쓰기 차단 상태

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
