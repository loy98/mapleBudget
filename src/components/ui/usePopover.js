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
// ⚠ CSS zoom(브라우저 확대/축소 — 최신 Chrome 의 페이지 줌이 이렇게 동작)에서는
//   getBoundingClientRect 는 '확대된' 좌표를 주지만 position:absolute 는 '확대 전' 좌표로 해석한다.
//   그대로 두면 팝오버가 엉뚱한 곳(오른쪽 아래로 밀려)에 뜬다 → zoom 배율로 나눠 보정한다.
//   zoom = 확대된 폭(rect.width) / 레이아웃 폭(offsetWidth). 확대 안 했으면 1 이라 기존과 동일.
export function rectBelow(el, gap = 4) {
  if (!el || typeof el.getBoundingClientRect !== "function") return { left: 0, top: 0, width: 0 };
  const r = el.getBoundingClientRect();
  // zoom 배율 추정: 확대폭(rect.width) / 레이아웃폭(offsetWidth).
  // offsetWidth 는 정수로 반올림되므로 소수 픽셀 폭에선 1 근처의 '잡음' 배율이 나온다
  // (예: 333.33/333≈1.001). 실제 브라우저 줌은 100% 에서 최소 10% 이상 벌어지므로,
  // 1 에 아주 가까우면 보정하지 않는다 → 등배(zoom=1)에서 미세한 위치 틀어짐 방지.
  let zoom = el.offsetWidth ? r.width / el.offsetWidth : 1;
  if (!(zoom > 0) || Math.abs(zoom - 1) < 0.02) zoom = 1;
  return {
    left: (window.scrollX + r.left) / zoom,
    top: (window.scrollY + r.bottom + gap) / zoom,
    width: r.width / zoom,
  };
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
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // 바깥 모달이 같은 Esc 로 닫히지 않게 여기서 소비
        close(true); // Esc 로 닫으면 트리거로 돌아간다
        return;
      }
      // 팝오버는 portal 로 <body> 끝에 붙는다. 그 안에서 Tab 을 누르면 포커스가 문서의 엉뚱한 끝으로
      // 새어 나가고 팝오버는 열린 채 남는다. 포커스 트랩 대신 **닫고 트리거로 돌아간다** —
      // 사용자는 Tab 을 한 번 더 눌러 자연스럽게 다음 요소로 간다.
      if (e.key === "Tab" && popRef.current && popRef.current.contains(e.target)) {
        e.preventDefault();
        close(true);
      }
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
