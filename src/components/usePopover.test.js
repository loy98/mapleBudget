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
});
