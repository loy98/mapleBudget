import { useEffect, useRef } from "react";

// 접근성을 갖춘 모달 껍데기. 세 모달(도움말·피드백·병합충돌)이 공유한다.
//  - Esc 로 닫기 (onClose 를 주지 않으면 비활성 = 선택을 강제하는 모달)
//  - 포커스 트랩: Tab/Shift+Tab 이 모달 밖으로 새지 않는다
//  - 열릴 때 첫 포커스 대상으로 이동하고, 닫힐 때 직전 요소로 되돌린다
//  - 배경 스크롤 잠금
//
// 모듈 스코프 컴포넌트(렌더 함수 내부 정의 금지 규칙 준수).
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function Modal({ onClose, label, cardClass = "", children }) {
  const cardRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    restoreRef.current = document.activeElement;
    const card = cardRef.current;
    // 첫 포커스는 카드 안의 첫 조작 가능 요소. 없으면 카드 자체(tabIndex=-1).
    const first = card?.querySelector(FOCUSABLE);
    (first || card)?.focus();

    const onKey = (e) => {
      if (e.key === "Escape" && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !card) return;
      const nodes = [...card.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!nodes.length) { e.preventDefault(); return; }
      const firstEl = nodes[0];
      const lastEl = nodes[nodes.length - 1];
      // 경계에서 감싸돈다. 모달 밖(주소창·배경 버튼)으로 포커스가 나가지 않는다.
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    // 버블 단계로 듣는다(캡처 아님). 모달 안에서 열린 드롭다운(CSelect)이 캡처 단계에서
    // Esc 를 먼저 소비하고 stopPropagation 하므로, 드롭다운이 열려 있으면 모달은 닫히지 않는다.
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // 모달을 연 버튼으로 포커스 복귀(스크린리더/키보드 사용자가 맥락을 잃지 않도록).
      const el = restoreRef.current;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div
        ref={cardRef}
        className={"modal-card " + cardClass}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
