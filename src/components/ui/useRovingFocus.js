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

// 격자 안에서 방향키로 포커스를 옮긴다. `activate(i)` 는 Enter/Space 에서 불린다.
// `initial` 은 처음 Tab 으로 들어왔을 때 포커스를 받을 인덱스(예: 오늘·선택된 날).
export function useRovingFocus({ count, cols = 1, initial = 0, activate }) {
  const [active, setActive] = useState(() => Math.max(0, Math.min(count - 1, initial)));
  const refs = useRef([]);
  const pendingFocus = useRef(false);

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

  return { active, setActive, itemProps };
}
