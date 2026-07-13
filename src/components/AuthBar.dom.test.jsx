// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom 의 location.reload 는 "Not implemented" 를 던진다. 로그아웃 성공 경로가 이걸 부르므로 대체한다.
  const loc = { ...window.location, reload: vi.fn() };
  Object.defineProperty(window, "location", { value: loc, writable: true, configurable: true });
});

const signOut = vi.fn();
vi.mock("../lib/cloud.js", () => ({
  cloudEnabled: true,
  signOut: (...a) => signOut(...a),
  signInWithGoogle: vi.fn(),
  signInWithEmail: vi.fn(),
}));

const { default: AuthBar } = await import("./AuthBar.jsx");

const SESSION_A = { user: { id: "user-a", email: "a@example.com" } };
const SESSION_B = { user: { id: "user-b", email: "b@example.com" } };

let container = null;
let root = null;
const render = async (props) => {
  await act(async () => { root.render(<AuthBar syncState="saved" {...props} />); });
};
const click = async (text) => {
  const btn = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  if (!btn) throw new Error(`버튼 없음: ${text} (있는 것: ${[...container.querySelectorAll("button")].map((b) => b.textContent.trim()).join(" / ")})`);
  await act(async () => { btn.click(); });
};
const hasText = (t) => container.textContent.includes(t);

beforeEach(() => {
  vi.clearAllMocks();
  signOut.mockResolvedValue({ error: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// 로그아웃은 이 기기의 계정 데이터를 지운다 → 디바운스 대기 중인 편집은 지우기 전에 올려야 한다.
describe("AuthBar 로그아웃 — 지우기 전에 플러시", () => {
  it("signOut 보다 flushPendingUpload 를 먼저 부른다", async () => {
    const order = [];
    const flushPendingUpload = vi.fn(async () => { order.push("flush"); return { ok: true }; });
    signOut.mockImplementation(async () => { order.push("signOut"); return { error: null }; });

    await render({ session: SESSION_A, flushPendingUpload });
    await click("로그아웃");

    expect(order).toEqual(["flush", "signOut"]);
  });

  it("플러시가 실패하면 바로 로그아웃하지 않고 확인을 받는다 — '취소'면 로그아웃하지 않는다", async () => {
    const flushPendingUpload = vi.fn(async () => ({ ok: false }));
    await render({ session: SESSION_A, flushPendingUpload });
    await click("로그아웃");

    expect(signOut).not.toHaveBeenCalled();
    expect(hasText("아직 저장되지 않은 변경이 있어요")).toBe(true);

    await click("취소 (다시 시도)");
    expect(signOut).not.toHaveBeenCalled();
    expect(hasText("아직 저장되지 않은 변경이 있어요")).toBe(false);
  });

  it("'그래도 로그아웃'을 고르면 로그아웃한다", async () => {
    const flushPendingUpload = vi.fn(async () => ({ ok: false }));
    await render({ session: SESSION_A, flushPendingUpload });
    await click("로그아웃");
    await click("그래도 로그아웃");

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  // Codex 지적: resolver 를 해소하지 않으면 logout() 이 await 에 갇히고, 그 continuation 이 나중에 살아나
  // **다른 계정을** 로그아웃시킨다. 모달이 떠 있는 동안 계정이 바뀌면 대기 중 선택을 취소로 해소해야 한다.
  it("확인 모달이 떠 있는 동안 계정이 바뀌면, 그 로그아웃 요청은 무효가 된다", async () => {
    const flushPendingUpload = vi.fn(async () => ({ ok: false }));
    await render({ session: SESSION_A, flushPendingUpload });
    await click("로그아웃");
    expect(hasText("아직 저장되지 않은 변경이 있어요")).toBe(true);

    // 다른 탭에서 로그아웃 → 다른 계정으로 로그인. 같은 AuthBar 인스턴스가 살아 있다.
    await render({ session: SESSION_B, flushPendingUpload });

    expect(hasText("아직 저장되지 않은 변경이 있어요")).toBe(false); // 모달은 닫혔다
    expect(signOut).not.toHaveBeenCalled();                          // B 를 로그아웃시키지 않았다
  });

  it("확인 모달이 떠 있는 채로 언마운트되면 대기 중 프로미스가 해소된다(누수 없음)", async () => {
    const flushPendingUpload = vi.fn(async () => ({ ok: false }));
    await render({ session: SESSION_A, flushPendingUpload });
    await click("로그아웃");
    expect(hasText("아직 저장되지 않은 변경이 있어요")).toBe(true);

    await act(async () => root.unmount());
    root = createRoot(container); // afterEach 의 unmount 가 던지지 않도록 다시 만든다
    expect(signOut).not.toHaveBeenCalled();
  });

  // 플러시를 기다리는 동안 다른 탭이 로그아웃/재로그인하면, 이 로그아웃 요청은 옛 계정을 대상으로 한 것이므로 무효다.
  it("플러시를 기다리는 동안 계정이 바뀌면 로그아웃하지 않는다", async () => {
    let release;
    const flushPendingUpload = vi.fn(() => new Promise((r) => { release = () => r({ ok: true }); }));
    await render({ session: SESSION_A, flushPendingUpload });

    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "로그아웃");
    await act(async () => { btn.click(); });        // 플러시 시작(아직 안 끝남)
    await render({ session: SESSION_B, flushPendingUpload }); // 그 사이 계정이 B 로 바뀐다
    await act(async () => { release(); });          // 이제 플러시가 끝난다

    expect(signOut).not.toHaveBeenCalled();         // B 를 로그아웃시키면 안 된다
  });

  it("플러시가 던져도 로그아웃이 조용히 진행되지 않는다(확인을 받는다)", async () => {
    const flushPendingUpload = vi.fn(async () => { throw new Error("boom"); });
    await render({ session: SESSION_A, flushPendingUpload });
    await click("로그아웃");

    expect(signOut).not.toHaveBeenCalled();
    expect(hasText("아직 저장되지 않은 변경이 있어요")).toBe(true);
  });
});
