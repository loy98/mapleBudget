import { describe, it, expect, beforeEach } from "vitest";
import { recordError, getRecentErrors, clearErrors, toRecord, formatErrorsForFeedback, MAX_ERRORS, ERRORS_KEY } from "./errorLog.js";
import { isAllowedIconUrl, ICON_HOSTS } from "./constants.js";

const mountStore = () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
};

// 프로덕션 오류를 알 방법이 없었다. 외부 트래킹 대신 로컬에 남기고 사용자가 스스로 첨부한다.
describe("errorLog — 로컬 오류 기록", () => {
  beforeEach(mountStore);

  it("Error 를 직렬화 가능한 기록으로 바꾼다", () => {
    const r = toRecord(new Error("터졌다"), "render", 1000);
    expect(r).toMatchObject({ t: 1000, where: "render", msg: "터졌다" });
    expect(typeof r.stack).toBe("string");
    expect(JSON.parse(JSON.stringify(r))).toEqual(r); // 직렬화 왕복
  });

  it("Error 가 아닌 값도 담는다 (문자열·객체가 던져질 수 있다)", () => {
    expect(toRecord("문자열 오류", "x", 1).msg).toBe("문자열 오류");
    expect(toRecord(null, "x", 1).msg).toBe("null");
    expect(toRecord({ a: 1 }, "x", 1).msg).toBe("[object Object]");
  });

  it("최근 것이 앞에 오고 상한을 지킨다", () => {
    for (let i = 0; i < MAX_ERRORS + 5; i++) recordError(new Error("e" + i), "w", i);
    const got = getRecentErrors();
    expect(got).toHaveLength(MAX_ERRORS);
    expect(got[0].msg).toBe("e" + (MAX_ERRORS + 4)); // 가장 최근
  });

  it("긴 메시지·스택을 잘라 저장소를 잡아먹지 않는다", () => {
    const e = new Error("가".repeat(5000));
    e.stack = "s".repeat(5000);
    const r = recordError(e, "w", 1);
    expect(r.msg.length).toBeLessThanOrEqual(300);
    expect(r.stack.length).toBeLessThanOrEqual(600);
  });

  // 오류를 기록하다 오류를 내면 ErrorBoundary 가 다시 돌아 무한 루프가 된다.
  it("저장소가 죽어 있어도 던지지 않는다", () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error("no"); },
      setItem: () => { throw new Error("no"); },
      removeItem: () => { throw new Error("no"); },
    };
    expect(() => recordError(new Error("x"), "w")).not.toThrow();
    expect(recordError(new Error("x"), "w")).toBe(null);
    expect(getRecentErrors()).toEqual([]);
    expect(() => clearErrors()).not.toThrow();
  });

  it("손상된 기록은 조용히 버린다", () => {
    const store = mountStore();
    store.set(ERRORS_KEY, "{{쓰레기");
    expect(getRecentErrors()).toEqual([]);
    store.set(ERRORS_KEY, '"배열이 아님"');
    expect(getRecentErrors()).toEqual([]);
  });

  it("첨부 요약은 비어 있으면 빈 문자열 (본문을 오염시키지 않는다)", () => {
    expect(formatErrorsForFeedback([])).toBe("");
    const out = formatErrorsForFeedback([toRecord(new Error("펑"), "render", 0)]);
    expect(out).toContain("펑");
    expect(out).toContain("최근 오류 1건");
  });

  // Codex: 손상된 기록을 그대로 쓰면 new Date("bad").toISOString() 이 RangeError 를 던져
  // **피드백 전송 자체가 실패한다** — 오류를 보고하려다 오류에 막힌다.
  it("손상된 기록이 있어도 첨부 요약이 던지지 않는다", () => {
    const bad = [
      { t: "bad", msg: "x" },
      { t: NaN, msg: null, where: 3, stack: 7 },
      null,
      "문자열",
    ];
    expect(() => formatErrorsForFeedback(bad)).not.toThrow();
    const out = formatErrorsForFeedback(bad);
    expect(out).toContain("(시각 불명)");
    expect(out).toContain("최근 오류");
  });

  it("errors 가 배열이 아니어도 던지지 않는다", () => {
    expect(formatErrorsForFeedback(null)).toBe("");
    expect(formatErrorsForFeedback("쓰레기")).toBe("");
  });
});

// 아이콘 URL 은 클라우드로 동기화되는 사용자 입력이다. 임의 호스트를 허용하면 트래킹 픽셀 표면이 된다.
describe("isAllowedIconUrl — 아이콘 호스트 allowlist", () => {
  it("신뢰 호스트의 https 만 허용한다", () => {
    expect(isAllowedIconUrl("https://maplestory.io/api/icon.png")).toBe(true);
    expect(isAllowedIconUrl("https://cdn.maplestory.io/x.png")).toBe(true);
    expect(isAllowedIconUrl("http://maplestory.io/x.png")).toBe(false); // https 만
  });

  it("비슷해 보이는 호스트를 통과시키지 않는다", () => {
    expect(isAllowedIconUrl("https://evil-maplestory.io/x.png")).toBe(false);
    expect(isAllowedIconUrl("https://maplestory.io.evil.com/x.png")).toBe(false);
    expect(isAllowedIconUrl("https://evil.com/?x=maplestory.io")).toBe(false);
    expect(isAllowedIconUrl("https://evil.com/#maplestory.io")).toBe(false);
    expect(isAllowedIconUrl("https://user@maplestory.io.evil.com/x")).toBe(false);
  });

  it("스킴 우회를 막는다", () => {
    expect(isAllowedIconUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedIconUrl("data:image/svg+xml,<svg/>")).toBe(false);
    expect(isAllowedIconUrl("//maplestory.io/x.png")).toBe(false); // 프로토콜 상대 URL
  });

  it("URL 이 아닌 값(이모지)·빈 값은 이미지가 아니다", () => {
    expect(isAllowedIconUrl("🫐")).toBe(false);
    expect(isAllowedIconUrl("")).toBe(false);
    expect(isAllowedIconUrl(null)).toBe(false);
    expect(isAllowedIconUrl(123)).toBe(false);
  });

  it("allowlist 는 비어 있지 않다", () => {
    expect(ICON_HOSTS.length).toBeGreaterThan(0);
  });
});
