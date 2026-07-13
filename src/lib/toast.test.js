import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  toast, pushToast, dismissToast, getToasts, onToast, __resetToasts,
  queueToast, flushQueuedToast, TOAST_TTL,
} from "./toast.js";

// 저장소 스텁 (node 환경).
const mkStore = (map) => ({
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => map.set(k, String(v)),
  removeItem: (k) => map.delete(k),
});
const blocked = () => ({
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
});
const store = new Map();      // sessionStorage
const localStore = new Map(); // localStorage
beforeEach(() => {
  __resetToasts();
  store.clear();
  localStore.clear();
  vi.stubGlobal("sessionStorage", mkStore(store));
  vi.stubGlobal("localStorage", mkStore(localStore));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("토스트 스토어", () => {
  it("띄우면 목록에 쌓이고 구독자에게 알린다", () => {
    const seen = [];
    onToast((t) => seen.push(t.length));
    toast.success("저장했습니다");
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]).toMatchObject({ kind: "success", message: "저장했습니다", sticky: false });
    expect(seen).toEqual([1]);
  });

  it("종류별 시간이 지나면 스스로 사라진다", () => {
    toast.success("a");
    vi.advanceTimersByTime(TOAST_TTL.success - 1);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  // 나쁜 소식은 더 오래 남아야 한다 — 성공 메시지와 같은 속도로 사라지면 읽지 못한다.
  it("오류는 성공보다 오래 남는다", () => {
    expect(TOAST_TTL.error).toBeGreaterThan(TOAST_TTL.success);
    toast.error("실패");
    vi.advanceTimersByTime(TOAST_TTL.success);
    expect(getToasts()).toHaveLength(1);
  });

  it("sticky 는 시간이 지나도 사라지지 않는다(사용자가 닫아야 한다)", () => {
    const id = pushToast("warn", "일부 항목이 빠졌습니다", { sticky: true });
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(getToasts()).toHaveLength(1);
    dismissToast(id);
    expect(getToasts()).toHaveLength(0);
  });

  it("빈 메시지는 띄우지 않는다(빈 상자가 뜨는 것보다 낫다)", () => {
    expect(pushToast("info", "")).toBe(null);
    expect(pushToast("info", "   ")).toBe(null);
    expect(pushToast("info", null)).toBe(null);
    expect(getToasts()).toHaveLength(0);
  });

  it("구독자가 던져도 다른 구독자와 호출측이 멈추지 않는다", () => {
    const ok = vi.fn();
    onToast(() => { throw new Error("구독자 폭발"); });
    onToast(ok);
    expect(() => toast.success("a")).not.toThrow();
    expect(ok).toHaveBeenCalled();
  });

  it("이미 사라진 토스트를 다시 닫아도 구독자를 깨우지 않는다", () => {
    const id = toast.success("a");
    const seen = vi.fn();
    onToast(seen);
    dismissToast(id);
    expect(seen).toHaveBeenCalledTimes(1);
    dismissToast(id); // 두 번째
    expect(seen).toHaveBeenCalledTimes(1); // 불필요한 리렌더 없음
  });
});

// 백업 복원은 성공 직후 새로고침한다 → 그냥 띄운 토스트는 사용자가 볼 수 없다.
describe("새로고침을 건너뛰는 토스트", () => {
  it("queueToast 는 지금 띄우지 않고 세션에 넣어 두고 true 를 돌려준다", () => {
    expect(queueToast("success", "복원 완료.")).toBe(true);
    expect(getToasts()).toHaveLength(0);       // 아직 안 뜬다
    expect(store.size).toBe(1);
    expect(localStore.size).toBe(0);           // 세션이 되면 localStorage 는 건드리지 않는다(다른 탭 오염 방지)
  });

  it("flushQueuedToast 가 새로고침 후 꺼내 띄우고, 두 번 뜨지 않는다", () => {
    queueToast("success", "복원 완료.", { detail: ["거래 2건이 형식 오류로 빠졌습니다"], sticky: true });
    flushQueuedToast();
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]).toMatchObject({
      kind: "success", message: "복원 완료.", sticky: true,
      detail: ["거래 2건이 형식 오류로 빠졌습니다"],
    });
    __resetToasts();
    flushQueuedToast();                        // 다음 새로고침
    expect(getToasts()).toHaveLength(0);       // 또 뜨면 안 된다
  });

  it("손상된 세션 값이 있어도 던지지 않는다", () => {
    store.set("mvpPendingToast", "{망가진 JSON");
    expect(() => flushQueuedToast()).not.toThrow();
    expect(getToasts()).toHaveLength(0);
  });

  it("모르는 kind 는 info 로 떨어뜨린다(렌더 크래시 방지)", () => {
    store.set("mvpPendingToast", JSON.stringify({ kind: "확인되지않은종류", message: "안녕" }));
    flushQueuedToast();
    expect(getToasts()[0].kind).toBe("info");
  });

  // 세션 저장소가 막혀도 경고를 잃으면 안 된다. 복원이 성공했다는 건 localStorage 쓰기가 됐다는 뜻이므로
  // 그쪽으로 떨어뜨린다 — 그러지 않으면 새로고침이 '일부 항목이 빠졌다'는 경고를 통째로 지운다(B-6).
  it("세션 저장소가 막히면 localStorage 로 떨어뜨린다", () => {
    vi.stubGlobal("sessionStorage", blocked());
    expect(queueToast("warn", "복원 완료.", { detail: ["2건 빠짐"], sticky: true })).toBe(true);
    expect(localStore.size).toBe(1);

    flushQueuedToast();
    expect(getToasts()[0]).toMatchObject({ message: "복원 완료.", sticky: true, detail: ["2건 빠짐"] });
    expect(localStore.size).toBe(0); // 꺼내면서 지운다 → 다음 새로고침에 또 뜨지 않는다
  });

  // 둘 다 막히면 새로고침 너머로 넘길 방법이 없다 → false 를 돌려주고, 호출측(App)이 새로고침을 포기한다.
  it("저장소를 전혀 못 쓰면 false 를 돌려준다(호출측이 새로고침하면 안 된다는 신호)", () => {
    vi.stubGlobal("sessionStorage", blocked());
    vi.stubGlobal("localStorage", blocked());
    expect(queueToast("success", "복원 완료.")).toBe(false);
    expect(getToasts()).toHaveLength(0);           // 조용히 띄우고 새로고침에 지워지는 일이 없어야 한다
    expect(() => flushQueuedToast()).not.toThrow();
  });

  // 양쪽에 값이 남는 비정상 상태(폴백을 오갔다면 가능)에서 한쪽만 지우면 다음 새로고침에 또 뜬다.
  it("flush 는 양쪽 저장소에서 모두 지운다", () => {
    const payload = JSON.stringify({ kind: "info", message: "옛 알림" });
    store.set("mvpPendingToast", payload);
    localStore.set("mvpPendingToast", payload);

    flushQueuedToast();
    expect(getToasts()).toHaveLength(1);
    expect(store.size).toBe(0);
    expect(localStore.size).toBe(0);

    __resetToasts();
    flushQueuedToast();
    expect(getToasts()).toHaveLength(0); // 다시 뜨지 않는다
  });

});
