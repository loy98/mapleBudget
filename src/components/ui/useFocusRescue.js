import { useEffect, useRef } from "react";

// ===== 사라진 요소가 가져간 포커스를 되찾는다 =====
// 사용자가 어떤 컨트롤을 조작했는데 **그 조작 때문에 컨트롤 자체가 화면에서 사라지는** 경우가 있다.
// 예: 달력 상세('7월 9일 내역')에서 거래의 날짜를 7월 17일로 바꾸면, 그 행은 목록에서 빠진다.
// 포커스가 있던 입력이 언마운트되면 포커스는 `<body>` 로 떨어지고, 키보드 사용자는 자기가 어디 있는지
// 잃은 채 Tab 을 처음부터 다시 눌러야 한다.
//
// WAI-ARIA 지침대로, 포커스를 **살아 있는 조상**으로 옮긴다.
// 컨테이너 안에 포커스가 있었던 적이 있을 때만 개입한다 — 아무 관계 없는 리렌더에서 포커스를 훔치면 안 된다.
export function useFocusRescue(ref, deps = []) {
  const hadFocus = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onFocusIn = () => { hadFocus.current = true; };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  }, [ref]);

  // 커밋 뒤에 확인한다. 이 시점에는 사라진 노드가 이미 DOM 에서 빠졌고 activeElement 가 body 다.
  useEffect(() => {
    if (!hadFocus.current) return;
    const el = ref.current;
    if (!el || typeof el.focus !== "function") return;
    const a = typeof document !== "undefined" ? document.activeElement : null;
    if (a && a !== document.body) return; // 포커스가 살아 있는 곳에 있다 → 건드리지 않는다
    hadFocus.current = false;
    el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
