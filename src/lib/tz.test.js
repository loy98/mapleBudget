import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// ===== B-4: 주 경계는 브라우저 로컬 타임존이 아니라 KST 기준이어야 한다 =====
//
// 이 파일은 **로컬 타임존을 KST 밖으로 강제한 뒤** 검증한다. 개발 기계가 KST 라서,
// 로컬 기준 코드와 KST 기준 코드가 같은 답을 내 결함이 보이지 않기 때문이다
// (WORK-STATUS 의 '테스트가 통과하는 것과 결함을 잡는 것은 다르다').
//
// 주의: Windows 의 Node 는 `TZ=... npm test` 같은 **셸 프리픽스를 무시한다**(실측 확인).
// 반드시 프로세스 안에서 `process.env.TZ` 에 할당해야 반영된다.
// vitest 는 파일마다 워커를 격리하므로(isolate 기본값) 다른 테스트 파일에 새지 않는다.
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "America/Los_Angeles";

const { fmtD, weekStartThu, todayStr, curMonth, start13, nowD, dateOf, tzDateStr } = await import("./util.js");

// 2026-07-08T16:00:00Z — 이 순간, KST 는 07-09(목: 새 MVP 주 시작) / LA 는 07-08(수: 지난 주).
const INSTANT = new Date("2026-07-08T16:00:00Z");

describe("B-4 · 로컬 타임존이 KST 가 아닐 때", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(INSTANT);
  });
  afterAll(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("전제 확인: 로컬은 KST 가 아니고, 로컬 날짜는 KST 하루 전이다", () => {
    expect(new Date().getTimezoneOffset()).not.toBe(-540); // -540 = KST
    expect(fmtD(new Date())).toBe("2026-07-08");           // 로컬(LA) 기준 수요일
    expect(tzDateStr(INSTANT, "Asia/Seoul")).toBe("2026-07-09");
  });

  it("todayStr 은 KST 오늘이다 (로컬 오늘이 아니다)", () => {
    expect(todayStr()).toBe("2026-07-09");
  });

  it("nowD 는 KST 오늘의 민간 날짜를 가리킨다", () => {
    expect(fmtD(nowD())).toBe("2026-07-09");
  });

  it("이번 MVP 주는 KST 기준 새 주다 — 로컬 기준이면 한 주 전을 가리킨다", () => {
    expect(fmtD(weekStartThu(nowD()))).toBe("2026-07-09");   // 목요일 당일 = 그 주의 시작
    expect(fmtD(weekStartThu(new Date()))).toBe("2026-07-02"); // 로컬 기준이었을 때의 오답
  });

  it("13주 창의 시작도 KST 기준으로 잡힌다", () => {
    expect(fmtD(start13())).toBe("2026-04-16");
    // 로컬 기준이면 2026-04-09 — 창이 통째로 한 주 어긋나 주차별 집계가 밀린다.
  });

  it("달이 바뀌는 경계에서도 KST 를 따른다", () => {
    vi.setSystemTime(new Date("2026-06-30T16:00:00Z")); // KST 07-01 / LA 06-30
    expect(todayStr()).toBe("2026-07-01");
    expect(curMonth()).toBe("2026-07");
    expect(fmtD(new Date())).toBe("2026-06-30"); // 로컬은 아직 6월
    vi.setSystemTime(INSTANT);
  });

  it("dateOf 는 로컬 타임존과 무관하게 그 민간 날짜를 돌려준다", () => {
    expect(fmtD(dateOf("2026-07-09"))).toBe("2026-07-09");
    expect(dateOf("2026-07-09").getHours()).toBe(12); // 정오 고정 → DST 전환일에도 안 밀린다
  });
});
