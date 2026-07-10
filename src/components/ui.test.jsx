import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { IconView } from "./ui.jsx";

// 아이콘 URL 은 클라우드로 동기화되는 사용자 입력이다.
// 임의 호스트를 <img> 로 로드하면 트래킹 픽셀·콘텐츠 스푸핑 표면이 된다.
describe("IconView — 아이콘 호스트 allowlist", () => {
  it("신뢰 호스트의 https 는 img 로 렌더하고 리퍼러를 보내지 않는다", () => {
    const html = renderToString(<IconView icon="https://maplestory.io/api/icon.png" />);
    expect(html).toContain("<img");
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it("비신뢰 호스트는 아무것도 렌더하지 않는다 (URL 문자열조차 노출하지 않는다)", () => {
    expect(renderToString(<IconView icon="https://evil.com/pixel.gif" />)).toBe("");
    expect(renderToString(<IconView icon="https://evil-maplestory.io/x.png" />)).toBe("");
    expect(renderToString(<IconView icon="http://maplestory.io/a.png" />)).toBe(""); // https 만
  });

  it("스킴 우회를 렌더하지 않는다", () => {
    expect(renderToString(<IconView icon="javascript:alert(1)" />)).toBe("");
    expect(renderToString(<IconView icon="data:image/svg+xml,<svg/>" />)).toBe("");
  });

  it("이모지는 그대로 보여준다", () => {
    expect(renderToString(<IconView icon="🫐" />)).toContain("🫐");
  });

  it("malformed 아이콘(객체·숫자)은 크래시 없이 무시한다", () => {
    expect(renderToString(<IconView icon={{}} />)).toBe("");
    expect(renderToString(<IconView icon={3} />)).toBe("");
    expect(renderToString(<IconView icon="" />)).toBe("");
  });
});
