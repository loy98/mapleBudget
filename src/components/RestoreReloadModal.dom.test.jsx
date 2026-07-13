// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import RestoreReloadModal from "./RestoreReloadModal.jsx";

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });

let container = null;
let root = null;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async (props) => { await act(async () => { root.render(<RestoreReloadModal {...props} />); }); };

// 복원본은 이미 저장소에 들어갔는데 화면(React 메모리)은 아직 옛 상태다.
// 이때 편집하면 자동저장이 옛 값으로 복원본을 덮어쓴다 → 새로고침 전까지 편집을 봉쇄해야 한다.
describe("RestoreReloadModal — 복원 후 새로고침 강제", () => {
  it("새로고침 버튼이 유일한 탈출구다 (닫기·취소 버튼이 없다)", async () => {
    await render({ warnings: [], onReload: vi.fn() });
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent.trim());
    expect(labels).toEqual(["새로고침"]);
  });

  it("Esc 로 닫히지 않는다 (onClose 를 주지 않았으므로)", async () => {
    const onReload = vi.fn();
    await render({ warnings: [], onReload });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector(".modal-overlay")).not.toBe(null); // 여전히 떠 있다
    expect(onReload).not.toHaveBeenCalled();
  });

  it("배경(오버레이) 클릭으로도 닫히지 않는다", async () => {
    await render({ warnings: [], onReload: vi.fn() });
    const overlay = container.querySelector(".modal-overlay");
    await act(async () => { overlay.click(); });
    expect(container.querySelector(".modal-overlay")).not.toBe(null);
  });

  // 배경 편집 봉쇄: 오버레이가 화면을 덮고 body 스크롤이 잠긴다(Modal 의 계약).
  it("떠 있는 동안 배경 스크롤이 잠긴다", async () => {
    expect(document.body.style.overflow).not.toBe("hidden");
    await render({ warnings: [], onReload: vi.fn() });
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("aria-modal 대화상자로 알린다(배경은 조작 대상이 아니다)", async () => {
    await render({ warnings: [], onReload: vi.fn() });
    const dlg = container.querySelector('[role="dialog"]');
    expect(dlg.getAttribute("aria-modal")).toBe("true");
  });

  it("새로고침을 누르면 onReload 가 불린다", async () => {
    const onReload = vi.fn();
    await render({ warnings: [], onReload });
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "새로고침").click();
    });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  // 경고를 삼키면 "복원 완료"만 보고 데이터가 빠진 걸 나중에야 안다(B-6).
  it("복원에서 빠진 항목을 함께 보여준다", async () => {
    await render({ warnings: ["거래 2건이 형식 오류로 빠졌습니다", "아이템 1건 제외"], onReload: vi.fn() });
    expect(container.textContent).toContain("거래 2건이 형식 오류로 빠졌습니다");
    expect(container.textContent).toContain("아이템 1건 제외");
  });
});
