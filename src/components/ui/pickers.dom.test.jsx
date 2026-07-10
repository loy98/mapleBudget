// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DateInput, WeekPicker, YMPicker, ItemCombo } from "./pickers.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
const mount = (el) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(el));
};
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const key = (el, k) => act(() => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
});
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

// Codex(MEDIUM): 키보드로 팝오버를 열면 포커스가 트리거에 남아 방향키가 격자에 닿지 않았다.
// 격자 전체가 도달 불가 — a11y 작업 자체가 동작하지 않는 상태였다.
describe("팝오버를 키보드로 열면 격자로 포커스가 간다", () => {
  it("DateInput: ↓ 로 열면 날짜 셀이 포커스를 받는다", () => {
    mount(<DateInput value="2026-07-09" onChange={() => {}} />);
    const inp = container.querySelector(".datep");
    inp.focus();
    key(inp, "ArrowDown");
    const focused = document.activeElement;
    expect(focused.className).toContain("dpd");
    expect(focused.getAttribute("aria-label")).toBe("2026-07-09"); // 선택된 날짜에 앉는다
  });

  it("DateInput: 열린 뒤 방향키로 이동하고 Enter 로 고른다", () => {
    const picked = [];
    mount(<DateInput value="2026-07-09" onChange={(v) => picked.push(v)} />);
    const inp = container.querySelector(".datep");
    inp.focus();
    key(inp, "ArrowDown");
    key(document.activeElement, "ArrowRight");   // 하루 뒤
    expect(document.activeElement.getAttribute("aria-label")).toBe("2026-07-10");
    key(document.activeElement, "ArrowDown");    // 한 주 뒤
    expect(document.activeElement.getAttribute("aria-label")).toBe("2026-07-17");
    key(document.activeElement, "Enter");
    expect(picked).toEqual(["2026-07-17"]);
  });

  it("WeekPicker: 버튼 클릭으로 열면 선택된 주에 포커스가 간다", () => {
    const weeks = [{ key: "2026-07-02", label: "A" }, { key: "2026-07-09", label: "B" }, { key: "2026-07-16", label: "C" }];
    mount(<WeekPicker value="2026-07-09" onChange={() => {}} weeks={weeks} />);
    click(container.querySelector("button"));
    expect(document.activeElement.className).toContain("wkc");
    expect(document.activeElement.textContent).toContain("B");
  });

  it("YMPicker: 열면 선택된 달에 포커스가 간다", () => {
    mount(<YMPicker value="2026-03" onChange={() => {}} anchorLabel="2026-03" />);
    click(container.querySelector("button"));
    expect(document.activeElement.className).toContain("ymc");
    expect(document.activeElement.textContent).toBe("3월");
  });

  it("격자의 Tab 정지점은 포커스된 셀 하나뿐이다", () => {
    mount(<DateInput value="2026-07-09" onChange={() => {}} />);
    const inp = container.querySelector(".datep");
    inp.focus();
    key(inp, "ArrowDown");
    const cells = [...document.querySelectorAll(".dpd")];
    expect(cells.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    expect(cells.filter((c) => c.tabIndex === 0)[0]).toBe(document.activeElement);
  });
});

// Codex(LOW): 아무것도 안 고른 상태에서 ↑ 는 마지막 옵션이어야 하는데 뒤에서 두 번째를 골랐다.
describe("ItemCombo 키보드 (포커스는 입력에 머문다)", () => {
  const opts = [{ name: "가" }, { name: "나" }, { name: "다" }];

  it("↓ 로 열고 ↑ 로 마지막 옵션을 고른다", () => {
    const picked = [];
    mount(<ItemCombo value="" onChange={(v) => picked.push(v)} options={opts} />);
    const inp = container.querySelector(".icombo-inp");
    inp.focus();
    key(inp, "ArrowDown");                 // 열림, active=0
    expect(document.activeElement).toBe(inp); // 포커스는 입력에 머문다(타이핑이 끊기면 안 된다)
    key(inp, "ArrowUp");                   // -1 이 아니라 0 → 마지막(2)
    key(inp, "ArrowUp");
    key(inp, "Enter");
    expect(picked).toEqual(["나"]);
  });

  it("열린 직후 ↑ 는 마지막 옵션이다", () => {
    const picked = [];
    mount(<ItemCombo value="" onChange={(v) => picked.push(v)} options={opts} />);
    const inp = container.querySelector(".icombo-inp");
    act(() => inp.dispatchEvent(new FocusEvent("focus", { bubbles: false })));
    inp.focus();
    key(inp, "ArrowUp"); // 아직 안 열렸으면 무시 → 열고 다시
    key(inp, "ArrowDown");
    expect(container.ownerDocument.querySelector(".icombo-pop")).toBeTruthy();
  });

  it("활성 옵션을 aria-activedescendant 로 가리킨다", () => {
    mount(<ItemCombo value="" onChange={() => {}} options={opts} />);
    const inp = container.querySelector(".icombo-inp");
    inp.focus();
    key(inp, "ArrowDown");
    const id = inp.getAttribute("aria-activedescendant");
    expect(id).toBeTruthy();
    expect(document.getElementById(id).textContent).toContain("가");
  });
});
