import { describe, it, expect } from "vitest";
import { isOutsideClick, rectBelow } from "./ui/usePopover.js";

// 가짜 DOM 노드: contains 만 흉내낸다.
const node = (children = []) => {
  const self = { children };
  self.contains = (t) => t === self || children.some((c) => c && c.contains && c.contains(t));
  return self;
};

// 예전 코드는 `e.target !== btnRef.current` 로 참조 비교를 했다.
// 앵커 버튼 안에 자식 엘리먼트가 있으면 그것을 눌렀을 때 '바깥'으로 판정되어 팝오버가 닫히고,
// 곧이어 버튼의 onClick 이 토글해 다시 열린다.
describe("isOutsideClick — 팝오버 바깥 판정", () => {
  it("앵커의 자식을 눌러도 바깥이 아니다 (참조 비교의 버그)", () => {
    const child = node();
    const anchor = node([child]);
    const pop = node();
    expect(isOutsideClick(child, [pop, anchor])).toBe(false);
    expect(child === anchor).toBe(false); // 참조 비교였다면 '바깥'으로 오판했을 값
  });

  it("팝오버 내부를 눌러도 바깥이 아니다", () => {
    const opt = node();
    const pop = node([opt]);
    expect(isOutsideClick(opt, [pop, node()])).toBe(false);
  });

  it("정말 바깥이면 true", () => {
    const outside = node();
    expect(isOutsideClick(outside, [node(), node()])).toBe(true);
  });

  it("아직 마운트되지 않은 노드는 판정에서 뺀다", () => {
    const anchor = node();
    expect(isOutsideClick(anchor, [null, anchor])).toBe(false);
    expect(isOutsideClick(node(), [null, anchor])).toBe(true);
  });

  // 붙잡을 노드가 하나도 없는데 '바깥'이라고 하면 첫 프레임에 즉시 닫힌다.
  it("살아 있는 노드가 하나도 없으면 닫지 않는다", () => {
    expect(isOutsideClick(node(), [null, undefined])).toBe(false);
    expect(isOutsideClick(node(), [])).toBe(false);
    expect(isOutsideClick(node(), null)).toBe(false);
  });

  it("contains 가 없는 값(문자열 등)은 무시한다", () => {
    expect(isOutsideClick(node(), ["쓰레기", 3])).toBe(false);
  });
});

describe("rectBelow — 앵커 아래 문서 좌표", () => {
  it("스크롤을 더해 문서 좌표를 낸다", () => {
    globalThis.window = { scrollX: 10, scrollY: 100 };
    const el = { getBoundingClientRect: () => ({ left: 5, bottom: 20, width: 80 }) };
    expect(rectBelow(el, 6)).toEqual({ left: 15, top: 126, width: 80 });
  });

  it("노드가 없으면 안전한 기본값 (크래시하지 않는다)", () => {
    expect(rectBelow(null)).toEqual({ left: 0, top: 0, width: 0 });
    expect(rectBelow({})).toEqual({ left: 0, top: 0, width: 0 });
  });

  it("offsetWidth 가 없으면 zoom=1 로 보고 기존과 동일하게 동작한다", () => {
    globalThis.window = { scrollX: 10, scrollY: 100 };
    // offsetWidth 미제공(구식 mock) → 보정 없이 기존 좌표
    const el = { getBoundingClientRect: () => ({ left: 5, bottom: 20, width: 80 }) };
    expect(rectBelow(el, 6)).toEqual({ left: 15, top: 126, width: 80 });
  });

  it("소수 픽셀 폭(등배)에서는 보정하지 않는다 — offsetWidth 정수 반올림 잡음 무시", () => {
    globalThis.window = { scrollX: 0, scrollY: 1000 };
    // 등배지만 rect.width 는 소수, offsetWidth 는 정수 → 배율 ≈ 1.001 (잡음). 보정하면 top 이 밀린다.
    const el = { offsetWidth: 333, getBoundingClientRect: () => ({ left: 20, bottom: 40, width: 333.33 }) };
    expect(rectBelow(el, 6)).toEqual({ left: 20, top: 1046, width: 333.33 });
  });

  it("CSS zoom(브라우저 확대) 이면 배율로 나눠 보정한다", () => {
    globalThis.window = { scrollX: 0, scrollY: 0 };
    // 1.4배 확대: rect 는 확대된 값(width 140), offsetWidth 는 레이아웃 폭(100)
    const el = { offsetWidth: 100, getBoundingClientRect: () => ({ left: 280, bottom: 420, width: 140 }) };
    const out = rectBelow(el, 4);
    expect(out.left).toBeCloseTo(200, 3); // 280 / 1.4
    expect(out.top).toBeCloseTo(302.857, 2); // (420 + 4) / 1.4
    expect(out.width).toBeCloseTo(100, 3); // 140 / 1.4
  });
});
