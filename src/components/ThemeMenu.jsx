import { useState, useRef, useEffect } from "react";
import { IconSun, IconMoon, IconMonitor, IconCheck } from "./ui/icons.jsx";

// ===== 테마 선택 (라이트 / 다크 / 시스템) =====
// 예전엔 토글 버튼 하나였다("다크"↔"라이트"). 시스템 설정을 따르는 선택지가 없었고,
// 무엇을 고른 상태인지 한눈에 보이지 않았다. maplescouter 처럼 드롭다운으로 세 가지를 직접 고른다.
// 키보드 조작은 CSelect 규칙을 따른다: Enter/Space/↓ 로 열고, ↑↓ 이동, Enter 선택, Esc 닫기(캡처).
const OPTS = [
  { value: "light", label: "라이트", Icon: IconSun },
  { value: "dark", label: "다크", Icon: IconMoon },
  { value: "system", label: "시스템", Icon: IconMonitor },
];

export default function ThemeMenu({ mode, setMode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef(null);
  const btnRef = useRef(null);

  const selIdx = OPTS.findIndex((o) => o.value === mode);
  const cur = OPTS[selIdx] || OPTS[2];
  const CurIcon = cur.Icon;

  const close = (refocus) => {
    setOpen(false);
    setActive(-1);
    if (refocus) btnRef.current?.focus();
  };
  const pick = (o) => {
    setMode(o.value);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close(false);
    };
    // Esc 는 캡처 단계에서 소비한다(모달 안에서 열려도 모달까지 닫히지 않게 — CSelect 와 같은 규칙).
    const onKeyCapture = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKeyCapture, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKeyCapture, true);
    };
  }, [open]);

  const onBtnKey = (e) => {
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
      setActive((i) => (i + 1) % OPTS.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + OPTS.length) % OPTS.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (active >= 0 && OPTS[active]) pick(OPTS[active]);
    }
  };

  return (
    <span className={"thememenu" + (open ? " open" : "")} ref={ref}>
      <button
        type="button"
        ref={btnRef}
        className="hbtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={"테마: " + cur.label}
        title="테마 전환"
        onClick={() => (open ? close(false) : (setActive(selIdx >= 0 ? selIdx : 0), setOpen(true)))}
        onKeyDown={onBtnKey}
      >
        <CurIcon className="hbtn-ico" />
        <span className="hbtn-lbl">{cur.label}</span>
      </button>
      <div className="thememenu-pop" role="menu" aria-label="테마 선택">
        {open &&
          OPTS.map((o, i) => {
            const OIcon = o.Icon;
            return (
              <button
                type="button"
                key={o.value}
                role="menuitemradio"
                aria-checked={o.value === mode}
                className={"thememenu-opt" + (o.value === mode ? " sel" : "") + (i === active ? " active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                <OIcon className="tm-ico" />
                <span className="tm-lbl">{o.label}</span>
                {o.value === mode && <IconCheck className="tm-check" />}
              </button>
            );
          })}
      </div>
    </span>
  );
}
