// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CSelect } from "./CSelect.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
const mount = (el) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(el));
};
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; });
const key = (el, k, opts = {}) => act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts })));

const options = [{ value: "1", label: "하나" }, { value: "2", label: "둘" }];

describe("CSelect 키보드", () => {
  it("Enter 로 열고 ↓ 로 이동해 Enter 로 고른다", () => {
    const picked = [];
    mount(<CSelect value="1" onChange={(v) => picked.push(v)} options={options} />);
    const btn = container.querySelector(".csel-btn");
    key(btn, "Enter");
    expect(container.querySelector(".csel").className).toContain("open");
    key(btn, "ArrowDown");
    key(btn, "Enter");
    expect(picked).toEqual(["2"]);
  });

  // Codex: 열린 채 Tab 으로 떠나면 목록이 화면에 남았다.
  it("Tab 으로 떠나면 목록이 닫힌다", () => {
    mount(<CSelect value="1" onChange={() => {}} options={options} />);
    const btn = container.querySelector(".csel-btn");
    key(btn, "Enter");
    expect(container.querySelector(".csel").className).toContain("open");
    key(btn, "Tab");
    expect(container.querySelector(".csel").className).not.toContain("open");
  });

  it("Shift+Tab 도 닫는다", () => {
    mount(<CSelect value="1" onChange={() => {}} options={options} />);
    const btn = container.querySelector(".csel-btn");
    key(btn, "Enter");
    key(btn, "Tab", { shiftKey: true });
    expect(container.querySelector(".csel").className).not.toContain("open");
  });
});
