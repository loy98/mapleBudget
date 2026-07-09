import { describe, it, expect } from "vitest";
import {
  parseCalcState, serializeCalcState, normalizeLedger, normalizeMyItems, withRowKeys,
} from "./storage.js";
import { mergeSnapshots } from "./cloud.js";
import { weeklyMeso, weeklyItems, itemSummary, NO_ITEM } from "./ledger.js";
import { uid, estGrade } from "./util.js";
import { computeCalc, computeFeePct } from "./calc.js";
import { DEFAULT_RULES, resolveRules, DEFAULT_SETTINGS, DEFAULT_CHARGES } from "./constants.js";

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
  it("빈/누락 입력에도 4버킷 반환", () => {
    expect(normalizeLedger(null)).toEqual({ buys: [], sells: [], cashes: [], spends: [] });
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
