import { describe, it, expect } from "vitest";
import { safeDonateUrl, safeAmount, tossUrl, donateOptions, MAX_DONATE_AMOUNT } from "./donate.js";

describe("safeDonateUrl", () => {
  it("신뢰 호스트의 https 만 통과시킨다", () => {
    expect(safeDonateUrl("kakaoPayUrl", "https://qr.kakaopay.com/xyz")).toBe("https://qr.kakaopay.com/xyz");
    expect(safeDonateUrl("kakaoPayUrl", "https://link.kakaopay.com/xyz")).toBe("https://link.kakaopay.com/xyz");
  });

  it("http·낯선 도메인·유사 도메인·javascript: 는 막는다", () => {
    // 돈이 오가는 링크다. 설정 오타 하나로 사용자를 피싱 사이트에 보내지 않게 화이트리스트로만 통과시킨다.
    expect(safeDonateUrl("kakaoPayUrl", "http://qr.kakaopay.com/x")).toBe("");
    expect(safeDonateUrl("kakaoPayUrl", "https://qr.kakaopay.com.evil.com/x")).toBe("");
    expect(safeDonateUrl("kakaoPayUrl", "https://evil.com/x")).toBe("");
    expect(safeDonateUrl("kakaoPayUrl", "javascript:alert(1)")).toBe("");
    expect(safeDonateUrl("kakaoPayUrl", "qr.kakaopay.com/x")).toBe(""); // 스킴 없는 값 = URL 로 파싱 불가
  });

  it("빈 값·문자열이 아닌 값은 빈 문자열", () => {
    expect(safeDonateUrl("kakaoPayUrl", "   ")).toBe("");
    expect(safeDonateUrl("kakaoPayUrl", null)).toBe("");
    expect(safeDonateUrl("kakaoPayUrl", { href: "https://qr.kakaopay.com/x" })).toBe("");
  });
});

describe("safeAmount", () => {
  it("정수 원 단위만, 100원 ~ 한도 안", () => {
    expect(safeAmount(5000)).toBe(5000);
    expect(safeAmount("7000")).toBe(7000);
    expect(safeAmount(MAX_DONATE_AMOUNT)).toBe(MAX_DONATE_AMOUNT);
  });

  it("소수는 잘라서 통과시키지 않는다 — 입력과 다른 금액이 링크에 실리면 안 된다", () => {
    // 5000.7 을 5000 으로 조용히 바꿔 넣으면 사용자가 의도하지 않은 금액이 송금 화면에 뜬다.
    expect(safeAmount(5000.7)).toBe(0);
    expect(safeAmount("5000.7")).toBe(0);
  });

  it("숫자로 강제변환되는 값들을 통과시키지 않는다", () => {
    // `+v` 로 뭉개면 아래가 전부 통과한다.
    expect(safeAmount("1e3")).toBe(0);
    expect(safeAmount(" 5000 ")).toBe(5000); // 공백만 있는 건 정상 입력으로 본다
    expect(safeAmount([5000])).toBe(0);
    expect(safeAmount({ valueOf: () => 5000 })).toBe(0);
    expect(safeAmount(true)).toBe(0);
    expect(safeAmount("0x1388")).toBe(0);
  });

  it("범위 밖·비정상 값은 0 (= 금액 없는 링크)", () => {
    expect(safeAmount(0)).toBe(0);
    expect(safeAmount(99)).toBe(0);
    expect(safeAmount(-5000)).toBe(0);
    expect(safeAmount(MAX_DONATE_AMOUNT + 1)).toBe(0);
    expect(safeAmount("")).toBe(0);
    expect(safeAmount("abc")).toBe(0);
    expect(safeAmount(Infinity)).toBe(0);
    expect(safeAmount(null)).toBe(0);
  });
});

describe("tossUrl", () => {
  it("아이디와 금액을 경로에 싣는다", () => {
    expect(tossUrl("maple_dev", 5000)).toBe("https://toss.me/maple_dev/5000");
  });

  it("금액이 유효하지 않으면 금액 없는 링크 — 송금 자체를 막지는 않는다", () => {
    expect(tossUrl("maple_dev", 0)).toBe("https://toss.me/maple_dev");
    expect(tossUrl("maple_dev", "abc")).toBe("https://toss.me/maple_dev");
    expect(tossUrl("maple_dev", 99)).toBe("https://toss.me/maple_dev");
  });

  it("경로를 깨거나 다른 곳으로 튈 수 있는 아이디는 거부한다", () => {
    // 아이디는 URL 경로에 그대로 들어간다 → 인코딩으로 덮지 않고 아예 링크를 만들지 않는다.
    expect(tossUrl("../evil", 5000)).toBe("");
    expect(tossUrl("me/../../evil.com", 5000)).toBe("");
    expect(tossUrl("id?x=1", 5000)).toBe("");
    expect(tossUrl("id with space", 5000)).toBe("");
    // 점 하나·둘은 경로에서 '현재/상위 디렉터리'라 아이디로 쓰이면 링크가 엉뚱한 경로가 된다.
    expect(tossUrl(".", 5000)).toBe("");
    expect(tossUrl("..", 5000)).toBe("");
    expect(tossUrl("a.b", 5000)).toBe("https://toss.me/a.b/5000"); // 점이 섞인 정상 아이디는 통과
    expect(tossUrl("", 5000)).toBe("");
    expect(tossUrl(null, 5000)).toBe("");
    expect(tossUrl("a".repeat(31), 5000)).toBe("");
  });
});

describe("donateOptions", () => {
  it("설정이 비면 any=false (진입점을 숨긴다)", () => {
    const o = donateOptions({ bank: { name: "", holder: "", account: "" }, kakaoPayUrl: "", tossId: "" });
    expect(o).toMatchObject({ bank: null, kakao: "", tossId: "", any: false });
    expect(o.amounts).toEqual([]);
  });

  it("계좌만 있어도 any=true, 복사 문구에 은행·예금주를 함께 넣는다", () => {
    const o = donateOptions({ bank: { name: "신한", holder: "홍길동", account: "110-472-965110" } });
    expect(o.any).toBe(true);
    expect(o.bank.copyText).toBe("신한 110-472-965110 홍길동");
  });

  it("계좌번호가 없으면 은행·예금주가 있어도 계좌 수단은 없다", () => {
    const o = donateOptions({ bank: { name: "신한", holder: "홍길동", account: "  " } });
    expect(o.bank).toBe(null);
    expect(o.any).toBe(false);
  });

  it("수단별로 따로 걸러진다 — 잘못된 것만 빠진다", () => {
    const o = donateOptions({ bank: {}, kakaoPayUrl: "https://evil.com/x", tossId: "maple_dev" });
    expect(o.kakao).toBe("");
    expect(o.tossId).toBe("maple_dev");
    expect(o.any).toBe(true);
  });

  it("금액 프리셋은 유효값만·중복 없이·오름차순", () => {
    const o = donateOptions({ tossId: "x", amounts: [10000, 3000, 3000, -1, 50, "5000", 9e9] });
    expect(o.amounts).toEqual([3000, 5000, 10000]);
  });

  it("문자열이 아닌 값이 섞여도 터지지 않는다", () => {
    // 설정이 잘못 들어와도 화면이 죽으면 안 된다 — 후원 UI 하나 때문에 계산기 전체가 못 뜬다.
    const o = donateOptions({ bank: { name: { ko: "신한" }, holder: 42, account: 12345 }, kakaoPayUrl: 7, tossId: [], amounts: "3000" });
    expect(o).toMatchObject({ bank: null, kakao: "", tossId: "", any: false });
    expect(o.amounts).toEqual([]);
  });

  it("인자 없이 호출해도(기본 설정) 터지지 않는다", () => {
    expect(() => donateOptions()).not.toThrow();
    expect(() => donateOptions({})).not.toThrow();
  });
});
