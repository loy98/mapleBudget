// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useFocusRescue } from "./useFocusRescue.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
const mount = (el) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(el));
};
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ""; });

// 사용자가 조작한 컨트롤이 그 조작 때문에 사라지면 포커스는 <body> 로 떨어진다.
// (달력 상세에서 거래의 날짜를 바꾸면 그 행이 목록에서 빠진다.)
function Harness({ onReady }) {
  const [rows, setRows] = useState(["a", "b"]);
  const ref = useRef(null);
  useFocusRescue(ref, [rows.length]);
  onReady({ setRows });
  return (
    <div ref={ref} tabIndex={-1} data-testid="wrap">
      {rows.map((r) => <input key={r} id={r} defaultValue={r} />)}
    </div>
  );
}

describe("useFocusRescue — 사라진 요소의 포커스를 되찾는다", () => {
  it("포커스된 입력이 언마운트되면 컨테이너가 포커스를 받는다", () => {
    let api;
    mount(<Harness onReady={(x) => { api = x; }} />);
    const a = document.getElementById("a");
    act(() => a.focus());
    expect(document.activeElement).toBe(a);

    act(() => api.setRows(["b"])); // 'a' 행이 사라진다
    expect(document.getElementById("a")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[data-testid="wrap"]'));
  });

  it("포커스가 컨테이너 안에 없었으면 훔치지 않는다", () => {
    let api;
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    mount(<Harness onReady={(x) => { api = x; }} />);
    act(() => outside.focus());

    act(() => api.setRows(["b"]));
    expect(document.activeElement).toBe(outside); // 그대로
    outside.remove();
  });

  // hadFocus 가드가 없으면, 아무 데도 포커스가 없는(activeElement === body) 상태의 평범한 리렌더에서
  // 컨테이너가 포커스를 낚아채 페이지가 제멋대로 스크롤된다.
  it("한 번도 포커스가 없었으면 아무 일도 하지 않는다 (body 인 채로 리렌더)", () => {
    let api;
    mount(<Harness onReady={(x) => { api = x; }} />);
    expect(document.activeElement).toBe(document.body);
    act(() => api.setRows(["b"]));
    expect(document.activeElement).toBe(document.body); // 훔치지 않았다
  });

  it("포커스가 살아 있는 다른 요소로 갔으면 개입하지 않는다", () => {
    let api;
    mount(<Harness onReady={(x) => { api = x; }} />);
    const a = document.getElementById("a");
    const b = document.getElementById("b");
    act(() => a.focus());
    act(() => b.focus());       // 사용자가 스스로 옮김
    act(() => api.setRows(["b"]));
    expect(document.activeElement).toBe(b);
  });
});
