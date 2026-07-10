import { useState, useRef, useEffect, useCallback } from "react";

// ===== 팝오버 공통 동작 =====
// `ItemCombo` / `WeekPicker` / `DateInput` / `YMPicker` 가 같은 로직을 각자 복붙하고 있었고,
// 미묘하게 달랐다: 어떤 것은 `mousedown` 을, 어떤 것은 `click` 을 들었다.
//
// 바깥 판정도 셋은 `e.target !== btnRef.current` 로 **참조 비교**를 썼는데, 이건 틀렸다.
// 앵커 버튼 안에 자식 엘리먼트가 있으면(예: `{sel.label} ▾` 의 텍스트를 감싸는 노드) 그것을 눌렀을 때
// `e.target` 이 자식이라 '바깥'으로 판정되어 닫히고, 곧이어 버튼의 onClick 이 토글해 다시 연다.
// `contains` 로 판정해야 한다.
//
// 이벤트는 `pointerdown` 하나로 통일한다: 마우스·터치·펜을 함께 덮고, `click` 보다 먼저 와서
// 앵커의 토글 핸들러와 경합하지 않는다.
//
// Esc 는 **캡처 단계에서 소비**한다(CSelect 와 같은 규칙) — 그러지 않으면 모달 안의 팝오버를 Esc 로 닫을 때
// 모달까지 함께 닫힌다(Modal 은 버블 단계로 듣는다).

// 이 지점이 팝오버 '바깥'인가. 순수 함수라 DOM 없이 테스트할 수 있다.
// 아직 마운트되지 않은 노드는 판정에서 뺀다. 붙잡을 노드가 하나도 없으면 닫지 않는다
// (첫 프레임에 ref 가 비어 있어 즉시 닫히는 것을 막는다).
export function isOutsideClick(target, nodes) {
  const live = (nodes || []).filter((n) => n && typeof n.contains === "function");
  if (!live.length) return false;
  return !live.some((n) => n.contains(target));
}

// 앵커 바로 아래의 문서 좌표. 팝오버는 portal 로 body 에 absolute 로 뜬다.
export function rectBelow(el, gap = 4) {
  if (!el || typeof el.getBoundingClientRect !== "function") return { left: 0, top: 0, width: 0 };
  const r = el.getBoundingClientRect();
  return { left: window.scrollX + r.left, top: window.scrollY + r.bottom + gap, width: r.width };
}

// anchorRef = 토글 버튼/입력을 감싸는 요소(바깥 클릭 판정 기준). popRef = 떠 있는 패널.
export function usePopover() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const anchorRef = useRef(null);
  const popRef = useRef(null);

  // `restoreFocus` = 닫으면서 트리거(앵커)로 포커스를 되돌린다.
  // 팝오버 안의 셀에 포커스가 있는 채로 그 셀이 언마운트되면 포커스는 `<body>` 로 떨어진다 —
  // 키보드 사용자는 자기가 어디 있는지 잃고 Tab 을 처음부터 다시 눌러야 한다.
  // 단, **바깥을 클릭해 닫을 때는 되돌리지 않는다**(사용자가 이미 다른 곳으로 갔다).
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (!restoreFocus) return;
    const el = anchorRef.current;
    if (el && typeof el.focus === "function") el.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (isOutsideClick(e.target, [popRef.current, anchorRef.current])) close(false);
    };
    const onKeyCapture = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation(); // 바깥 모달이 같은 Esc 로 닫히지 않게 여기서 소비
      close(true); // Esc 로 닫으면 트리거로 돌아간다
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyCapture, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyCapture, true);
    };
  }, [open, close]);

  return { open, setOpen, close, pos, setPos, anchorRef, popRef };
}
