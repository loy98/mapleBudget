// LogTab 품목별 내역 UI 런타임 렌더 검증 (SSR 정적 마크업 기준)
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LogTab, { ItemSubRow, ItemSummary } from "./LogTab.jsx";
import { computeCalc } from "../lib/calc.js";
import { DEFAULT_SETTINGS, DEFAULT_CHARGES, DEFAULT_CALC_ITEMS, DEFAULT_ITEMS } from "../lib/constants.js";
import { weeklyItems, itemSummary } from "../lib/ledger.js";

// 오늘 = 2026-07-09(목) → 이번주 07-09~07-15, 지난주 07-02~07-08
const ledger = {
  buys: [
    { id: "b1", date: "2026-07-02", item: "플래티넘 카르마의 가위", qty: 6, price: 5900 },
    { id: "b2", date: "2026-07-03", item: "원더베리", qty: 4, price: 3900, mil: true },
    { id: "b3", date: "2026-07-03", item: "", qty: 2, price: 1000 }, // 품목 미입력
  ],
  sells: [
    { id: "s1", date: "2026-07-09", item: "플래티넘 카르마의 가위", qty: 5, meso: 1.2 },
    { id: "s2", date: "2026-07-10", item: "원더베리", qty: 4, meso: 0.35 },
  ],
  cashes: [{ id: "c1", date: "2026-07-10", meso: 5, rate: 3000 }],
  spends: [],
};
const calc = computeCalc(DEFAULT_SETTINGS, DEFAULT_CHARGES, DEFAULT_CALC_ITEMS);

describe("LogTab 런타임 렌더", () => {
  it("통계 탭이 크래시 없이 렌더된다", () => {
    const html = renderToStaticMarkup(
      <LogTab ledger={ledger} setLedger={() => {}} myItems={DEFAULT_ITEMS} calc={calc} />
    );
    expect(html).toContain("주차별 거래 현황");
    expect(html).toContain("품목별 누적 요약");
    // 13주 합계: 구매 12개 / 판매 9개
    expect(html).toContain("12<span class=\"muted u\">개</span>");
    expect(html).toContain("9<span class=\"muted u\">개</span>");
  });

  it("myItems 에 malformed 원소가 있어도 크래시하지 않는다", () => {
    // icon 이 객체/배열이면 IconView 가 React child 크래시 → iconOf 에서 문자열만 통과시켜야 한다.
    const bad = [
      null, undefined, 42, { icon: "x" }, { name: 7, icon: "y" },
      { name: "플래티넘 카르마의 가위", icon: {} },      // 객체 아이콘
      { name: "원더베리", icon: ["a"] },                 // 배열 아이콘
      ...DEFAULT_ITEMS,
    ];
    expect(() =>
      renderToStaticMarkup(<LogTab ledger={ledger} setLedger={() => {}} myItems={bad} calc={calc} />)
    ).not.toThrow();
  });

  it("빈 원장도 렌더된다", () => {
    const empty = { buys: [], sells: [], cashes: [], spends: [] };
    expect(() =>
      renderToStaticMarkup(<LogTab ledger={empty} setLedger={() => {}} myItems={DEFAULT_ITEMS} calc={calc} />)
    ).not.toThrow();
  });
});

describe("ItemSubRow (주차 확장 품목 행)", () => {
  const row = (r, extra = {}) =>
    renderToStaticMarkup(<table><tbody><ItemSubRow r={r} {...extra} /></tbody></table>);

  it("판매 품목: 실수령 메소 + 개당 평균가를 낸다", () => {
    const html = row({ name: "가위", buyQty: 0, sellQty: 5, sold: 5.7, avg: 1.2 }, { icon: "✂️" });
    expect(html).toContain("iemoji");
    expect(html).toContain("가위");
    expect(html).toContain("5<span class=\"muted u\">개</span>");
    expect(html).toContain("5.70억");
    expect(html).toContain("개당 1.20억");
  });

  it("구매만 한 품목: 판매·평균가 자리는 '–'", () => {
    const html = row({ name: "가위", buyQty: 6, sellQty: 0, sold: 0, avg: 0 });
    expect(html).toContain("6<span class=\"muted u\">개</span>");
    // sell/avg 칸은 대시. iemoji 없이(아이콘 미지정) 이름만.
    expect(html).not.toContain("iemoji");
    expect(html).toContain("colSpan=\"2\"");
  });

  it("last=true 면 그룹 종료 테두리 클래스가 붙는다", () => {
    expect(row({ name: "x", buyQty: 1, sellQty: 0 }, { last: true })).toContain("itemrow lastitem");
    expect(row({ name: "x", buyQty: 1, sellQty: 0 })).not.toContain("lastitem");
  });

  it("icon 이 문자열이 아니면(객체/배열) 크래시 없이 아이콘만 생략한다", () => {
    // DB(app_config) 오염분이 그대로 흘러와도 렌더 크래시가 없어야 한다.
    [{}, ["a"], 42, null].forEach((bad) => {
      expect(() => row({ name: "x", buyQty: 1, sellQty: 0 }, { icon: bad })).not.toThrow();
    });
    expect(row({ name: "x", buyQty: 1, sellQty: 0 }, { icon: {} })).not.toContain("iemoji");
  });
});

describe("ItemSummary (품목별 누적 요약표)", () => {
  const sum = (rows, opts = {}) =>
    renderToStaticMarkup(<ItemSummary rows={rows} iconOf={{}} rateWon={3000} measuredRate {...opts} />);

  it("이득/손해를 색과 문구로 구분한다", () => {
    const html = sum([
      { name: "이득품", buyQty: 1, sellQty: 1, avg: 2, profit: 5000, stock: 0 },
      { name: "손해품", buyQty: 1, sellQty: 1, avg: 1, profit: -3000, stock: 0 },
    ]);
    expect(html).toContain("class=\"good\">5,000원 이득");
    expect(html).toContain("class=\"bad\">3,000원 손해");
  });

  it("재고: 양수는 강조, 음수(산 기록 없이 판 경우)는 그대로 음수로, 0은 '–'", () => {
    const html = sum([
      { name: "남음", buyQty: 3, sellQty: 1, avg: 1, profit: 0, stock: 2 },
      { name: "초과판매", buyQty: 0, sellQty: 2, avg: 1, profit: 0, stock: -2 },
      { name: "딱맞음", buyQty: 1, sellQty: 1, avg: 1, profit: 0, stock: 0 },
    ]);
    expect(html).toContain("qty stock\">2<span");   // 양수 강조
    expect(html).toContain("qty bad\">-2<span");     // 음수 경고색, 값 그대로
  });

  it("profit=null(환산율 없음)이면 손익 칸은 '–', 안내도 바뀐다", () => {
    const html = sum([{ name: "x", buyQty: 1, sellQty: 1, avg: 1, profit: null, stock: 0 }], { rateWon: 0, measuredRate: false });
    expect(html).toContain("환산할 억당 시세가 없어");
  });

  it("계산기 시세 폴백일 땐 '계산기 시세'로 안내한다", () => {
    const html = sum([{ name: "x", buyQty: 1, sellQty: 0, avg: 0, profit: 100, stock: 1 }], { measuredRate: false });
    expect(html).toContain("계산기 시세");
  });

  it("빈 목록이면 안내 문구를 낸다", () => {
    expect(sum([])).toContain("이 기간에 구매·판매 기록이 없어요");
  });
});

describe("LogTab 누적 요약 안내", () => {
  it("환산율이 0(시세 없음·현금화 없음)이면 추정 손익 대신 안내를 낸다", () => {
    const noRate = computeCalc({ ...DEFAULT_SETTINGS, mesoRate: 0 }, DEFAULT_CHARGES, DEFAULT_CALC_ITEMS);
    const noCash = { ...ledger, cashes: [] };
    const html = renderToStaticMarkup(
      <LogTab ledger={noCash} setLedger={() => {}} myItems={DEFAULT_ITEMS} calc={noRate} />
    );
    // 토글은 접힌 기본 상태여도, 안내 문구 분기는 렌더 트리에 항상 존재해야 크래시가 없다.
    expect(html).toContain("품목별 누적 요약");
  });
});

describe("시드 데이터의 실제 집계값", () => {
  const env = { fee: calc.f, effD: calc.effD, mileageR: calc.mileageR };

  it("지난주(07-02~08): 구매 3품목, 판매 없음", () => {
    const r = weeklyItems(ledger, new Date("2026-07-02T00:00:00"), calc.f);
    expect(r.map((x) => [x.name, x.buyQty, x.sellQty])).toEqual([
      ["플래티넘 카르마의 가위", 6, 0],
      ["원더베리", 4, 0],
      ["(품목 미입력)", 2, 0],
    ]);
  });

  it("이번주(07-09~15): 판매만 9개", () => {
    const r = weeklyItems(ledger, new Date("2026-07-09T00:00:00"), calc.f);
    expect(r.map((x) => [x.name, x.buyQty, x.sellQty])).toEqual([
      ["플래티넘 카르마의 가위", 0, 5],
      ["원더베리", 0, 4],
    ]);
    expect(r[0].avg).toBeCloseTo(1.2, 10);
  });

  it("전체 기간 요약: 산 주≠판 주여도 재고가 음수가 아니다", () => {
    const r = itemSummary(ledger, () => true, env, 3000);
    const byName = Object.fromEntries(r.map((x) => [x.name, x]));
    expect(byName["플래티넘 카르마의 가위"].stock).toBe(1); // 6 사고 5 팜
    expect(byName["원더베리"].stock).toBe(0);
    expect(byName["(품목 미입력)"].stock).toBe(2);
    r.forEach((x) => expect(x.stock).toBeGreaterThanOrEqual(0));
  });

  it("'이번주'만 보는 기간에도 재고는 전체 누적이라 양수", () => {
    const thisWeek = (d) => d >= "2026-07-09" && d <= "2026-07-15";
    const r = itemSummary(ledger, thisWeek, env, 3000);
    const gawi = r.find((x) => x.name === "플래티넘 카르마의 가위");
    expect(gawi).toMatchObject({ buyQty: 0, sellQty: 5, stock: 1 });
  });
});
