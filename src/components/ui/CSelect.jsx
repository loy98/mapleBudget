import { useState, useRef, useEffect } from "react";

// ===== 커스텀 셀렉트 =====
// 키보드로 완전히 조작 가능해야 한다: Enter/Space/↓ 로 열고, ↑↓ 로 이동, Enter 로 선택, Esc 로 닫기.
// 열려 있을 때 Esc 는 '드롭다운만' 닫는다 → document 캡처 단계에서 먼저 소비하고 전파를 멈춘다.
// (그러지 않으면 모달 안에서 Esc 한 번에 모달까지 닫힌다. Modal 은 버블 단계로 듣는다.)
export function CSelect({ value, onChange, options, style, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // 키보드 하이라이트 인덱스
  const ref = useRef(null);
  const btnRef = useRef(null);

  const selIdx = options.findIndex((o) => String(o.value) === String(value));
  const sel = selIdx >= 0 ? options[selIdx] : null;

  const close = (refocus) => {
    setOpen(false);
    setActive(-1);
    if (refocus) btnRef.current?.focus();
  };
  const pick = (o) => {
    onChange(String(o.value));
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close(false);
    };
    const onKeyCapture = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation(); // 바깥 모달이 같은 Esc 로 닫히지 않게 여기서 소비
      close(true);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyCapture, true);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyCapture, true);
    };
  }, [open]);

  const onBtnKey = (e) => {
    // 열린 채 Tab 으로 떠나면 목록이 화면에 남는다. 포커스가 옮겨가므로 되돌리지 않고 닫기만 한다.
    if (open && e.key === "Tab") { close(false); return; }
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setActive(selIdx >= 0 ? selIdx : 0);
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (active >= 0 && options[active]) pick(options[active]);
    }
    // Esc 는 위의 캡처 핸들러가 처리한다.
  };

  return (
    <span className={"csel" + (open ? " open" : "")} ref={ref} style={style}>
      <button
        type="button"
        ref={btnRef}
        className="csel-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close(false) : (setActive(selIdx >= 0 ? selIdx : 0), setOpen(true)))}
        onKeyDown={onBtnKey}
      >
        {sel ? sel.label : ""}
      </button>
      <div className="csel-pop" role="listbox" aria-label={ariaLabel}>
        {open &&
          options.map((o, i) => (
            <div
              key={o.value}
              role="option"
              aria-selected={String(o.value) === String(value)}
              className={
                "csel-opt" +
                (String(o.value) === String(value) ? " sel" : "") +
                (i === active ? " active" : "")
              }
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              {o.label}
            </div>
          ))}
      </div>
    </span>
  );
}
