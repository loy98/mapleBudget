import { describe, it, expect } from "vitest";
import { safeKakaoUrl, safeAmount, donateOptions, MAX_DONATE_AMOUNT } from "./donate.js";

const URL1 = "https://qr.kakaopay.com/AAA";
const URL2 = "https://qr.kakaopay.com/BBB";

describe("safeKakaoUrl", () => {
  it("카카오페이 호스트의 https 만 통과시킨다", () => {
    expect(safeKakaoUrl(URL1)).toBe(URL1);
    expect(safeKakaoUrl("https://link.kakaopay.com/x")).toBe("https://link.kakaopay.com/x");
  });

  it("http·낯선 도메인·유사 도메인·javascript: 는 막는다", () => {
    // 돈이 오가는 링크다. 설정 오타 하나로 사용자를 피싱 사이트에 보내지 않게 화이트리스트로만 통과시킨다.
    expect(safeKakaoUrl("http://qr.kakaopay.com/x")).toBe("");
    expect(safeKakaoUrl("https://qr.kakaopay.com.evil.com/x")).toBe("");
    expect(safeKakaoUrl("https://evil.com/x")).toBe("");
    expect(safeKakaoUrl("javascript:alert(1)")).toBe("");
    expect(safeKakaoUrl("qr.kakaopay.com/x")).toBe(""); // 스킴 없는 값 = URL 로 파싱 불가
  });

  it("빈 값·문자열이 아닌 값은 빈 문자열", () => {
    expect(safeKakaoUrl("   ")).toBe("");
    expect(safeKakaoUrl(null)).toBe("");
    expect(safeKakaoUrl({ href: URL1 })).toBe("");
  });
});

describe("safeAmount", () => {
  it("정수 원 단위만, 100원 ~ 한도 안", () => {
    expect(safeAmount(5000)).toBe(5000);
    expect(safeAmount("7000")).toBe(7000);
    expect(safeAmount(MAX_DONATE_AMOUNT)).toBe(MAX_DONATE_AMOUNT);
  });

  it("소수는 잘라서 통과시키지 않는다 — 라벨 금액이 링크의 실제 금액과 달라지면 안 된다", () => {
    expect(safeAmount(5000.7)).toBe(0);
    expect(safeAmount("5000.7")).toBe(0);
  });

  it("숫자로 강제변환되는 값들을 통과시키지 않는다", () => {
    // `+v` 로 뭉개면 아래가 전부 통과한다.
    expect(safeAmount("1e3")).toBe(0);
    expect(safeAmount([5000])).toBe(0);
    expect(safeAmount({ valueOf: () => 5000 })).toBe(0);
    expect(safeAmount(true)).toBe(0);
    expect(safeAmount("0x1388")).toBe(0);
    expect(safeAmount(" 5000 ")).toBe(5000); // 앞뒤 공백만 있는 건 정상 입력으로 본다
  });

  it("범위 밖·비정상 값은 0", () => {
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

describe("donateOptions", () => {
  it("설정이 비면 any=false (진입점을 숨긴다)", () => {
    const o = donateOptions({ bank: { name: "", holder: "", account: "" }, kakaoPay: { free: "", amounts: [] } });
    expect(o.bank).toBe(null);
    expect(o.kakao).toEqual({ free: "", amounts: [] });
    expect(o.any).toBe(false);
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

  it("자기 링크가 있으면 prefilled, 없으면 자유금액 링크로 폴백한다", () => {
    // prefilled 를 화면까지 들고 가야 '1,000원' 버튼을 눌렀는데 빈 금액칸이 열리는 걸 미리 알릴 수 있다.
    const o = donateOptions({
      kakaoPay: { free: URL2, amounts: [{ won: 5000, url: URL1, note: "커피 한잔" }, { won: 1000, note: "PC방 한 시간" }] },
    });
    expect(o.kakao.amounts).toEqual([
      { won: 1000, note: "PC방 한 시간", href: URL2, prefilled: false },
      { won: 5000, note: "커피 한잔", href: URL1, prefilled: true },
    ]);
  });

  it("갈 곳이 없는 금액 항목은 버린다 (자기 링크도 없고 자유금액 링크도 없다)", () => {
    // 링크가 깨진 항목을 남기면 버튼이 아무 데도 못 가고, 금액이 이상한 항목을 남기면 라벨이 거짓말을 한다.
    const o = donateOptions({
      kakaoPay: {
        free: "",
        amounts: [
          { won: 5000, url: URL1 },
          { won: 3000, url: "https://evil.com/x" }, // 링크 불량 + free 없음 → 버린다
          { won: 0, url: URL2 }, // 금액 불량 → 버린다
          { won: 10000 }, // 링크 없음 + free 없음 → 버린다
          null,
        ],
      },
    });
    expect(o.kakao.amounts).toEqual([{ won: 5000, note: "", href: URL1, prefilled: true }]);
    expect(o.any).toBe(true);
  });

  it("금액 버튼은 중복 없이 오름차순", () => {
    const o = donateOptions({
      kakaoPay: {
        amounts: [
          { won: 10000, url: URL1 },
          { won: 3000, url: URL2 },
          { won: 3000, url: URL1 }, // 같은 금액 중복 → 첫 번째만
        ],
      },
    });
    expect(o.kakao.amounts.map((a) => a.won)).toEqual([3000, 10000]);
  });

  it("자유 금액 링크만 있어도 any=true", () => {
    const o = donateOptions({ bank: {}, kakaoPay: { free: URL1, amounts: [] } });
    expect(o.kakao.free).toBe(URL1);
    expect(o.any).toBe(true);
  });

  it("문자열이 아닌 값이 섞여도 터지지 않는다", () => {
    // 설정이 잘못 들어와도 화면이 죽으면 안 된다 — 후원 UI 하나 때문에 계산기 전체가 못 뜬다.
    const o = donateOptions({ bank: { name: { ko: "신한" }, holder: 42, account: 12345 }, kakaoPay: { free: 7, amounts: "x" } });
    expect(o.bank).toBe(null);
    expect(o.kakao).toEqual({ free: "", amounts: [] });
    expect(o.any).toBe(false);
  });

  it("인자 없이 호출해도(기본 설정) 터지지 않는다", () => {
    expect(() => donateOptions()).not.toThrow();
    expect(() => donateOptions({})).not.toThrow();
  });
});
