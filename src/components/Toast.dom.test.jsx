// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import ToastHost from "./ui/Toast.jsx";
import { toast, pushToast, getToasts, __resetToasts, TOAST_TTL } from "../lib/toast.js";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });

let container = null;
let root = null;
beforeEach(async () => {
  __resetToasts();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<ToastHost />); });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("ToastHost", () => {
  // live region 을 그때그때 DOM 에 새로 넣으면 일부 스크린리더가 첫 알림을 읽지 못한다
  // (이미 존재하던 영역의 '변경'만 안정적으로 읽는다) → 비어 있어도 컨테이너는 항상 있어야 한다.
  it("토스트가 없어도 live region 은 DOM 에 있다(첫 알림이 읽히도록)", () => {
    const host = container.querySelector(".toast-host");
    expect(host).not.toBe(null);
    expect(host.getAttribute("aria-live")).toBe("polite");
    expect(host.querySelector(".toast")).toBe(null); // 내용은 비어 있다
  });

  it("토스트를 띄우면 메시지가 화면에 나타난다", async () => {
    await act(async () => { toast.success("2026-07-13에 3건 저장되었습니다."); });
    expect(container.textContent).toContain("2026-07-13에 3건 저장되었습니다.");
    expect(container.querySelector(".toast.success")).not.toBe(null);
  });

  it("종류가 클래스로 구분된다(색으로 심각도를 알린다)", async () => {
    await act(async () => { toast.error("로그아웃 실패: 네트워크"); });
    expect(container.querySelector(".toast.error")).not.toBe(null);
  });

  it("경고 상세(복원에서 빠진 항목)를 함께 보여준다", async () => {
    await act(async () => {
      pushToast("success", "복원 완료.", { detail: ["거래 2건이 형식 오류로 빠졌습니다"], sticky: true });
    });
    expect(container.textContent).toContain("거래 2건이 형식 오류로 빠졌습니다");
    expect(container.querySelectorAll(".toast-detail li")).toHaveLength(1);
  });

  it("닫기 버튼으로 사라진다", async () => {
    await act(async () => { toast.success("저장했습니다"); });
    const x = container.querySelector(".toast-x");
    await act(async () => { x.click(); });
    expect(container.querySelector(".toast")).toBe(null);
    expect(getToasts()).toHaveLength(0);
  });

  it("시간이 지나면 스스로 사라진다", async () => {
    vi.useFakeTimers();
    await act(async () => { toast.success("저장했습니다"); });
    expect(container.querySelector(".toast")).not.toBe(null);
    await act(async () => { vi.advanceTimersByTime(TOAST_TTL.success + 10); });
    expect(container.querySelector(".toast")).toBe(null);
  });

  // aria-live 가 없으면 스크린리더 사용자는 저장이 됐는지 알 수 없다.
  // alert 는 (거슬려도) 강제로 읽혔으므로, 대체하면서 이걸 잃으면 접근성 후퇴다.
  it("스크린리더에 알린다 (role=status, aria-live=polite)", async () => {
    await act(async () => { toast.success("저장했습니다"); });
    const host = container.querySelector(".toast-host");
    expect(host.getAttribute("role")).toBe("status");
    expect(host.getAttribute("aria-live")).toBe("polite");
  });

  it("여러 개가 쌓인다(연속 저장해도 앞의 것이 잘리지 않는다)", async () => {
    await act(async () => { toast.success("1건 저장"); toast.success("2건 저장"); });
    expect(container.querySelectorAll(".toast")).toHaveLength(2);
  });

  // 토스트에는 버튼을 두지 않는다 — 버튼이 필요한 상황은 '편집을 막아야 하는 상황'이고
  // 토스트는 화면을 막지 못한다. 그런 건 닫을 수 없는 모달의 일이다(RestoreReloadModal).
  it("토스트의 조작 요소는 닫기 하나뿐이다", async () => {
    await act(async () => { pushToast("warn", "복원했습니다", { sticky: true }); });
    expect([...container.querySelectorAll("button")].map((b) => b.textContent.trim())).toEqual(["×"]);
  });
});
