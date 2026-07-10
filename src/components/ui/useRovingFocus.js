import { useRef, useState, useCallback, useEffect } from "react";

// ===== 격자/목록의 키보드 조작 (roving tabindex) =====
// 커스텀 위젯(달력 셀·주차 목록·연월 격자)이 `<div onClick>` 이라 키보드로는 아예 조작할 수 없었다.
//
// 모든 셀에 `tabIndex=0` 을 주는 것은 접근성 '통과'는 되지만 실사용에서 최악이다 —
// 달력 하나를 지나려면 Tab 을 42번 눌러야 한다. 표준 패턴은 **roving tabindex**:
// 격자 전체가 Tab 정지점 하나를 갖고, 그 안에서는 방향키로 이동한다.

// 키 → 다음 인덱스. 순수 함수라 DOM 없이 테스트한다. 이동이 없으면 null(그 키를 소비하지 않음).
//
// 경계에서 멈춘다(순환하지 않는다). 달력에서 마지막 날에 → 를 눌렀을 때 첫 날로 점프하면
// 사용자는 자기가 어디에 있는지 잃는다.
export function moveIndex(key, i, count, cols = 1) {
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(i)) return null;
  switch (key) {
    case "ArrowRight": return i + 1 < count ? i + 1 : null;
    case "ArrowLeft": return i - 1 >= 0 ? i - 1 : null;
    case "ArrowDown": return i + cols < count ? i + cols : null;
    case "ArrowUp": return i - cols >= 0 ? i - cols : null;
    case "Home": return i === 0 ? null : 0;
    case "End": return i === count - 1 ? null : count - 1;
    default: return null;
  }
}

// 자유 입력 콤보(ItemCombo)용. 포커스는 입력에 머물고 '활성 옵션'만 옮기므로 **순환**한다.
// 아직 아무것도 고르지 않은 상태(-1)에서 ↑ 는 마지막 옵션으로 가야 한다.
// `(i - 1 + count) % count` 는 i=-1 일 때 뒤에서 두 번째를 고른다(오프바이원).
export function cycleIndex(key, i, count) {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (key === "ArrowDown") return i + 1 >= count ? 0 : i + 1;
  if (key === "ArrowUp") return i <= 0 ? count - 1 : i - 1;
  return null;
}

// 격자 안에서 방향키로 포커스를 옮긴다. `activate(i)` 는 Enter/Space 에서 불린다.
// `initial` 은 처음 Tab 으로 들어왔을 때 포커스를 받을 인덱스(예: 오늘·선택된 날).
export function useRovingFocus({ count, cols = 1, initial = 0, activate }) {
  const [active, setActive] = useState(() => Math.max(0, Math.min(count - 1, initial)));
  const refs = useRef([]);
  const pendingFocus = useRef(false);
  // 콜백 안에서 최신 active 를 읽기 위한 거울. state 를 의존성에 넣지 않아도 된다.
  const activeRef = useRef(active);
  activeRef.current = active;

  // 인덱스가 범위를 벗어나면(목록이 줄어듦) 되돌린다.
  useEffect(() => {
    if (active > count - 1) setActive(Math.max(0, count - 1));
  }, [count, active]);

  // 방향키로 옮긴 뒤에만 focus() 를 부른다. 렌더마다 부르면 사용자의 포커스를 훔친다.
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const el = refs.current[active];
    if (el && typeof el.focus === "function") el.focus();
  }, [active]);

  // 팝오버가 **키보드로** 열렸을 때 격자로 포커스를 옮긴다.
  // 이게 없으면 포커스가 트리거(버튼·입력)에 남아, 방향키가 격자에 닿지 않는다 — 격자 전체가 도달 불가.
  // 격자가 항상 떠 있는 곳(달력 탭)에서는 부르지 않는다. 부르면 탭 전환마다 포커스를 훔친다.
  // 인덱스를 주면 거기로 옮긴 뒤 포커스한다(팝오버를 다시 열 때 선택된 항목으로 돌아가게).
  // refs 는 커밋 시점에 이미 채워져 있으므로 state 갱신을 기다리지 않고 바로 focus 할 수 있다.
  const focusActive = useCallback((i) => {
    const want = Number.isFinite(i) ? Math.max(0, Math.min(count - 1, i)) : activeRef.current;
    if (want !== activeRef.current) setActive(want);
    const el = refs.current[want];
    if (el && typeof el.focus === "function") el.focus();
  }, [count]);

  const onKeyDown = useCallback((e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activate) activate(active);
      return;
    }
    const next = moveIndex(e.key, active, count, cols);
    if (next == null) return; // 우리가 쓰는 키가 아니면 그대로 흘려보낸다(Tab·Esc 등)
    e.preventDefault();
    pendingFocus.current = true;
    setActive(next);
  }, [active, count, cols, activate]);

  // 각 셀에 뿌릴 props. Tab 정지점은 active 하나뿐이다.
  const itemProps = useCallback((i) => ({
    ref: (el) => { refs.current[i] = el; },
    tabIndex: i === active ? 0 : -1,
    onKeyDown,
    onFocus: () => setActive(i), // 마우스로 다른 셀을 눌러 포커스가 옮겨간 경우 동기화
  }), [active, onKeyDown]);

  return { active, setActive, itemProps, focusActive };
}
