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
// focus() 는 onFocus → setState 를 부를 수 있다(ItemCombo). act 로 감싸지 않으면 React 가 경고한다.
const focus = (el) => act(() => el.focus());

// Codex(MEDIUM): 키보드로 팝오버를 열면 포커스가 트리거에 남아 방향키가 격자에 닿지 않았다.
// 격자 전체가 도달 불가 — a11y 작업 자체가 동작하지 않는 상태였다.
describe("팝오버를 키보드로 열면 격자로 포커스가 간다", () => {
  it("DateInput: ↓ 로 열면 날짜 셀이 포커스를 받는다", () => {
    mount(<DateInput value="2026-07-09" onChange={() => {}} />);
    const inp = container.querySelector(".datep");
    focus(inp);
    key(inp, "ArrowDown");
    const focused = document.activeElement;
    expect(focused.className).toContain("dpd");
    expect(focused.getAttribute("aria-label")).toBe("2026-07-09"); // 선택된 날짜에 앉는다
  });

  it("DateInput: 열린 뒤 방향키로 이동하고 Enter 로 고른다", () => {
    const picked = [];
    mount(<DateInput value="2026-07-09" onChange={(v) => picked.push(v)} />);
    const inp = container.querySelector(".datep");
    focus(inp);
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
    focus(inp);
    key(inp, "ArrowDown");
    const cells = [...document.querySelectorAll(".dpd")];
    expect(cells.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    expect(cells.filter((c) => c.tabIndex === 0)[0]).toBe(document.activeElement);
  });
});

// Codex(LOW): 아무것도 안 고른 상태에서 ↑ 는 마지막 옵션이어야 하는데 뒤에서 두 번째를 골랐다.
describe("ItemCombo 키보드 (포커스는 입력에 머문다)", () => {
  const opts = [{ name: "가" }, { name: "나" }, { name: "다" }];

  // 입력에 포커스하면 onFocus 로 목록이 열린다. 이때 active 는 아직 -1(아무것도 안 고름)이다.
  // 그 상태의 ↑ 는 **마지막 옵션**이어야 한다. 옛 식 `(i-1+count)%count` 는 i=-1 에서 뒤에서 두 번째를 골랐다.
  it("열린 직후(-1) ↑ 는 마지막 옵션을 고른다", () => {
    const picked = [];
    mount(<ItemCombo value="" onChange={(v) => picked.push(v)} options={opts} />);
    const inp = container.querySelector(".icombo-inp");
    focus(inp); // onFocus → 목록 열림, active = -1
    expect(document.querySelector(".icombo-pop")).toBeTruthy();
    key(inp, "ArrowUp");
    key(inp, "Enter");
    expect(picked).toEqual(["다"]); // 옛 식이었다면 "나"
  });

  it("열린 직후(-1) ↓ 는 첫 옵션을 고른다", () => {
    const picked = [];
    mount(<ItemCombo value="" onChange={(v) => picked.push(v)} options={opts} />);
    const inp = container.querySelector(".icombo-inp");
    focus(inp);
    key(inp, "ArrowDown");
    key(inp, "Enter");
    expect(picked).toEqual(["가"]);
  });

  it("포커스는 입력에 머문다 (타이핑이 끊기면 안 된다)", () => {
    mount(<ItemCombo value="" onChange={() => {}} options={opts} />);
    const inp = container.querySelector(".icombo-inp");
    focus(inp);
    key(inp, "ArrowDown");
    key(inp, "ArrowDown");
    expect(document.activeElement).toBe(inp);
  });

  it("활성 옵션을 aria-activedescendant 로 가리킨다", () => {
    mount(<ItemCombo value="" onChange={() => {}} options={opts} />);
    const inp = container.querySelector(".icombo-inp");
    focus(inp);
    key(inp, "ArrowDown");
    const id = inp.getAttribute("aria-activedescendant");
    expect(id).toBeTruthy();
    expect(document.getElementById(id).textContent).toContain("가");
  });

  it("옵션이 없으면 방향키가 던지지 않는다", () => {
    mount(<ItemCombo value="" onChange={() => {}} options={[]} />);
    const inp = container.querySelector(".icombo-inp");
    focus(inp);
    expect(() => { key(inp, "ArrowDown"); key(inp, "ArrowUp"); key(inp, "Enter"); }).not.toThrow();
  });
});

// Codex(MEDIUM): 선택하면 포커스된 셀이 언마운트되어 포커스가 <body> 로 떨어진다.
// 키보드 사용자는 자기가 어디 있는지 잃고 Tab 을 처음부터 다시 눌러야 한다.
describe("팝오버를 닫으면 트리거로 포커스가 돌아온다", () => {
  it("DateInput: Enter 로 날짜를 고르면 입력으로 돌아온다", () => {
    mount(<DateInput value="2026-07-09" onChange={() => {}} />);
    const inp = container.querySelector(".datep");
    focus(inp);
    key(inp, "ArrowDown");
    key(document.activeElement, "Enter");
    expect(document.activeElement).toBe(inp);
  });

  it("DateInput: Esc 로 닫아도 입력으로 돌아온다", () => {
    mount(<DateInput value="2026-07-09" onChange={() => {}} />);
    const inp = container.querySelector(".datep");
    focus(inp);
    key(inp, "ArrowDown");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(inp);
  });

  it("WeekPicker: 선택하면 버튼으로 돌아온다", () => {
    const weeks = [{ key: "a", label: "A" }, { key: "b", label: "B" }];
    mount(<WeekPicker value="b" onChange={() => {}} weeks={weeks} />);
    const btn = container.querySelector("button");
    click(btn);
    key(document.activeElement, "Enter");
    expect(document.activeElement).toBe(btn);
  });

  it("YMPicker: 선택하면 버튼으로 돌아온다", () => {
    mount(<YMPicker value="2026-03" onChange={() => {}} anchorLabel="2026-03" />);
    const btn = container.querySelector("button");
    click(btn);
    key(document.activeElement, "Enter");
    expect(document.activeElement).toBe(btn);
  });
});

// Codex: 팝오버 안에서 Tab 을 누르면 포커스가 문서 끝(포털)으로 새고 팝오버는 열린 채 남았다.
describe("팝오버 안에서 Tab 은 닫고 트리거로 돌아간다", () => {
  it("DateInput: 날짜 셀에서 Tab", () => {
    mount(<DateInput value="2026-07-09" onChange={() => {}} />);
    const inp = container.querySelector(".datep");
    focus(inp);
    key(inp, "ArrowDown");
    expect(document.querySelector(".dppop")).toBeTruthy();
    key(document.activeElement, "Tab");
    expect(document.querySelector(".dppop")).toBeNull(); // 닫혔다
    expect(document.activeElement).toBe(inp);            // 트리거로 돌아왔다
  });

  it("WeekPicker: 목록에서 Tab", () => {
    const weeks = [{ key: "a", label: "A" }, { key: "b", label: "B" }];
    mount(<WeekPicker value="b" onChange={() => {}} weeks={weeks} />);
    const btn = container.querySelector("button");
    click(btn);
    key(document.activeElement, "Tab");
    expect(document.querySelector(".wkpop")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

// aria-hidden 은 포커스 가능한 요소에 쓰면 안 된다(접근성 트리에서만 사라진 유령 컨트롤).
describe("ItemCombo 토글 버튼의 접근성", () => {
  it("aria-hidden 이 아니고 이름을 갖는다", () => {
    mount(<ItemCombo value="" onChange={() => {}} options={[{ name: "가" }]} />);
    const tgl = container.querySelector(".icombo-tgl");
    expect(tgl.getAttribute("aria-hidden")).toBeNull();
    expect(tgl.getAttribute("aria-label")).toBeTruthy();
    expect(tgl.tabIndex).toBe(-1); // Tab 순서에서는 빠진다(입력이 combobox 라 경로가 있다)
  });
});
