import { describe, it, expect } from "vitest";
import { moveIndex, cycleIndex } from "./ui/useRovingFocus.js";

// 커스텀 위젯(달력 셀·주차 목록·연월 격자)이 div onClick 이라 키보드로 조작할 수 없었다.
// 모든 셀에 tabIndex=0 을 주면 달력 하나를 지나는 데 Tab 을 42번 눌러야 한다 → roving tabindex.
describe("moveIndex — 격자 방향키 이동", () => {
  const COLS = 7, N = 42;

  it("좌우는 한 칸, 상하는 한 줄", () => {
    expect(moveIndex("ArrowRight", 0, N, COLS)).toBe(1);
    expect(moveIndex("ArrowLeft", 5, N, COLS)).toBe(4);
    expect(moveIndex("ArrowDown", 0, N, COLS)).toBe(7);
    expect(moveIndex("ArrowUp", 8, N, COLS)).toBe(1);
  });

  // 마지막 날에서 → 를 눌렀을 때 첫 날로 점프하면 사용자는 자기가 어디 있는지 잃는다.
  it("경계에서 멈춘다 (순환하지 않는다)", () => {
    expect(moveIndex("ArrowRight", N - 1, N, COLS)).toBe(null);
    expect(moveIndex("ArrowLeft", 0, N, COLS)).toBe(null);
    expect(moveIndex("ArrowDown", N - 1, N, COLS)).toBe(null);
    expect(moveIndex("ArrowDown", N - 3, N, COLS)).toBe(null); // 아래 줄이 없다
    expect(moveIndex("ArrowUp", 3, N, COLS)).toBe(null);
  });

  it("Home/End 는 처음·끝으로, 이미 거기면 소비하지 않는다", () => {
    expect(moveIndex("Home", 20, N, COLS)).toBe(0);
    expect(moveIndex("End", 20, N, COLS)).toBe(N - 1);
    expect(moveIndex("Home", 0, N, COLS)).toBe(null);
    expect(moveIndex("End", N - 1, N, COLS)).toBe(null);
  });

  // 우리가 쓰지 않는 키는 null 을 돌려 그대로 흘려보낸다(Tab·Esc 가 막히면 안 된다).
  it("모르는 키는 소비하지 않는다", () => {
    ["Tab", "Escape", "Enter", " ", "a", "PageDown"].forEach((k) => {
      expect(moveIndex(k, 5, N, COLS)).toBe(null);
    });
  });

  it("1열 목록(주차 피커)에서는 상하만 움직인다", () => {
    expect(moveIndex("ArrowDown", 0, 26, 1)).toBe(1);
    expect(moveIndex("ArrowUp", 1, 26, 1)).toBe(0);
    expect(moveIndex("ArrowRight", 0, 26, 1)).toBe(1); // 1열에서는 →도 다음 항목
    expect(moveIndex("ArrowUp", 0, 26, 1)).toBe(null);
  });

  it("3열 격자(연월 피커)", () => {
    expect(moveIndex("ArrowDown", 0, 12, 3)).toBe(3);
    expect(moveIndex("ArrowDown", 10, 12, 3)).toBe(null); // 13번째 칸은 없다
    expect(moveIndex("ArrowUp", 11, 12, 3)).toBe(8);
  });

  it("빈 목록·비정상 입력에 던지지 않는다", () => {
    expect(moveIndex("ArrowRight", 0, 0, 7)).toBe(null);
    expect(moveIndex("ArrowRight", 0, NaN, 7)).toBe(null);
    expect(moveIndex("ArrowRight", NaN, 10, 7)).toBe(null);
  });
});

// ItemCombo 는 자유 입력이라 포커스가 입력에 머문다 → 활성 '인덱스'만 움직이고, 목록 끝에서 순환한다.
// Codex: `(i - 1 + count) % count` 는 아무것도 안 고른 상태(i=-1)에서 마지막이 아니라
// 뒤에서 두 번째를 고른다(오프바이원).
describe("cycleIndex — 콤보 활성 옵션 (순환)", () => {
  it("아무것도 안 고른 상태에서 ↓ 는 첫 옵션, ↑ 는 마지막 옵션", () => {
    expect(cycleIndex("ArrowDown", -1, 3)).toBe(0);
    expect(cycleIndex("ArrowUp", -1, 3)).toBe(2); // 옛 식은 1 을 줬다
  });

  it("끝에서 순환한다", () => {
    expect(cycleIndex("ArrowDown", 2, 3)).toBe(0);
    expect(cycleIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("가운데서는 한 칸씩", () => {
    expect(cycleIndex("ArrowDown", 0, 3)).toBe(1);
    expect(cycleIndex("ArrowUp", 2, 3)).toBe(1);
  });

  it("옵션이 하나면 제자리", () => {
    expect(cycleIndex("ArrowDown", 0, 1)).toBe(0);
    expect(cycleIndex("ArrowUp", -1, 1)).toBe(0);
  });

  it("빈 목록·모르는 키는 소비하지 않는다", () => {
    expect(cycleIndex("ArrowDown", -1, 0)).toBe(null);
    expect(cycleIndex("Enter", 0, 3)).toBe(null);
    expect(cycleIndex("Tab", 0, 3)).toBe(null);
  });
});
