import { describe, it, expect } from "vitest";
import { safeDonateUrl, donateOptions } from "./donate.js";

describe("safeDonateUrl", () => {
  it("신뢰 호스트의 https 만 통과시킨다", () => {
    expect(safeDonateUrl("tossUrl", "https://toss.me/abc")).toBe("https://toss.me/abc");
    expect(safeDonateUrl("kakaoPayUrl", "https://qr.kakaopay.com/xyz")).toBe("https://qr.kakaopay.com/xyz");
  });

  it("http·낯선 도메인·유사 도메인·javascript: 는 막는다", () => {
    // 돈이 오가는 링크다. 설정 오타 하나로 사용자를 피싱 사이트에 보내지 않게 화이트리스트로만 통과시킨다.
    expect(safeDonateUrl("tossUrl", "http://toss.me/abc")).toBe("");
    expect(safeDonateUrl("tossUrl", "https://toss.me.evil.com/abc")).toBe("");
    expect(safeDonateUrl("tossUrl", "https://evil.com/abc")).toBe("");
    expect(safeDonateUrl("kakaoPayUrl", "https://toss.me/abc")).toBe(""); // 종류가 다르면 호스트도 다르다
    expect(safeDonateUrl("tossUrl", "javascript:alert(1)")).toBe("");
    expect(safeDonateUrl("tossUrl", "toss.me/abc")).toBe(""); // 스킴 없는 값 = URL 로 파싱 불가
  });

  it("빈 값·문자열이 아닌 값은 빈 문자열", () => {
    expect(safeDonateUrl("tossUrl", "")).toBe("");
    expect(safeDonateUrl("tossUrl", "   ")).toBe("");
    expect(safeDonateUrl("tossUrl", null)).toBe("");
    expect(safeDonateUrl("tossUrl", { href: "https://toss.me/x" })).toBe("");
  });
});

describe("donateOptions", () => {
  it("설정이 비면 any=false (진입점을 숨긴다)", () => {
    const o = donateOptions({ bank: { name: "", holder: "", account: "" }, kakaoPayUrl: "", tossUrl: "" });
    expect(o).toMatchObject({ bank: null, kakao: "", toss: "", any: false });
  });

  it("계좌만 있어도 any=true, 복사 문구에 은행·예금주를 함께 넣는다", () => {
    const o = donateOptions({ bank: { name: "카카오뱅크", holder: "홍길동", account: "3333-01-1234567" } });
    expect(o.any).toBe(true);
    expect(o.bank.copyText).toBe("카카오뱅크 3333-01-1234567 홍길동");
  });

  it("계좌번호가 없으면 은행·예금주가 있어도 계좌 수단은 없다", () => {
    const o = donateOptions({ bank: { name: "카카오뱅크", holder: "홍길동", account: "  " } });
    expect(o.bank).toBe(null);
    expect(o.any).toBe(false);
  });

  it("링크가 유효하지 않으면 그 수단만 빠진다", () => {
    const o = donateOptions({ bank: {}, kakaoPayUrl: "https://evil.com/x", tossUrl: "https://toss.me/me" });
    expect(o.kakao).toBe("");
    expect(o.toss).toBe("https://toss.me/me");
    expect(o.any).toBe(true);
  });

  it("문자열이 아닌 값이 섞여도 터지지 않는다", () => {
    // 설정이 잘못 들어와도(객체·숫자) 화면이 죽으면 안 된다 — 후원 UI 하나 때문에 계산기 전체가 못 뜬다.
    const o = donateOptions({ bank: { name: { ko: "카뱅" }, holder: 42, account: 12345 }, kakaoPayUrl: 7, tossUrl: [] });
    expect(o).toMatchObject({ bank: null, kakao: "", toss: "", any: false });
  });

  it("인자 없이 호출해도(기본 설정) 터지지 않는다", () => {
    expect(() => donateOptions()).not.toThrow();
    expect(() => donateOptions({})).not.toThrow();
  });
});
