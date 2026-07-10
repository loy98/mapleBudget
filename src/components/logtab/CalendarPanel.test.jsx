import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CalendarPanel from "./CalendarPanel.jsx";
import { computeCalc } from "../../lib/calc.js";
import { DEFAULT_SETTINGS, DEFAULT_CHARGES, DEFAULT_CALC_ITEMS, DEFAULT_ITEMS } from "../../lib/constants.js";
import { nowD, fmtD } from "../../lib/util.js";

const ledger = { buys: [], sells: [], cashes: [], spends: [] };
const calc = computeCalc(DEFAULT_SETTINGS, DEFAULT_CHARGES, DEFAULT_CALC_ITEMS);
const d = { days: {}, env: { mileageR: () => 0, fee: () => 0, effD: () => 0 }, soldNames: [] };

const render = (calMode, selectedDate = "") =>
  renderToStaticMarkup(
    <CalendarPanel
      ledger={ledger} calc={calc} myItems={DEFAULT_ITEMS} d={d}
      calMode={calMode} setCalMode={() => {}} calCursor={nowD()} setCalCursor={() => {}}
      selectedDate={selectedDate} setSelectedDate={() => {}}
      patchEntry={() => {}} delEntry={() => {}} addEntryOn={() => {}}
    />
  );

// 달력 셀은 `<div onClick>` 이라 키보드로는 아예 조작할 수 없었다.
// roving tabindex: 격자 전체가 Tab 정지점 하나를 갖고 그 안에서는 방향키로 움직인다.
describe("달력 셀 키보드 접근성 (roving tabindex)", () => {
  it("월력 셀은 버튼 역할과 이름을 갖는다", () => {
    const html = render("month");
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-label="' + fmtD(nowD()) + '"'); // 오늘 셀의 접근 가능한 이름
  });

  it("월력 격자의 Tab 정지점은 정확히 하나다 (42번 Tab 하지 않는다)", () => {
    const html = render("month");
    expect((html.match(/tabindex="0"/g) || []).length).toBe(1);
    expect((html.match(/tabindex="-1"/g) || []).length).toBe(41);
  });

  it("MVP 주간(13주 × 7일)도 Tab 정지점이 하나다", () => {
    const html = render("mvp");
    expect((html.match(/tabindex="0"/g) || []).length).toBe(1);
    expect((html.match(/tabindex="-1"/g) || []).length).toBe(90);
  });

  it("선택된 날이 있으면 그 셀이 Tab 정지점이자 aria-pressed 다", () => {
    const sel = fmtD(nowD());
    const html = render("month", sel);
    expect(html).toContain('aria-pressed="true"');
    expect((html.match(/aria-pressed="true"/g) || []).length).toBe(1);
  });

  it("선택이 없으면 오늘 셀이 Tab 정지점이다", () => {
    const html = render("month");
    const today = fmtD(nowD());
    // 오늘 셀의 태그 안에 tabindex="0" 이 함께 있다.
    const cell = html.slice(html.indexOf('aria-label="' + today + '"') - 200, html.indexOf('aria-label="' + today + '"') + 100);
    expect(cell).toContain('tabindex="0"');
  });
});
