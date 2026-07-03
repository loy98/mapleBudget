import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { fmtD, todayStr, addDays } from "../lib/util.js";
import { WD_SUN } from "../lib/constants.js";

// ===== 숫자 입력 (테마 스테퍼) =====
export function NumInput({ value, onChange, step = 1, width, noStepper, placeholder }) {
  const inp = (
    <input
      type="number"
      step={step}
      value={value}
      placeholder={placeholder}
      style={width ? { width } : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  if (noStepper || width) return inp;
  const bump = (dir) => {
    const v = +value || 0;
    onChange(String(v + dir * step));
  };
  return (
    <span className="numwrap">
      {inp}
      <span className="stepbtns">
        <button type="button" className="stbtn up" onClick={() => bump(1)}>▲</button>
        <button type="button" className="stbtn dn" onClick={() => bump(-1)}>▼</button>
      </span>
    </span>
  );
}

// ===== 커스텀 셀렉트 =====
export function CSelect({ value, onChange, options, style }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);
  const sel = options.find((o) => String(o.value) === String(value));
  return (
    <span className={"csel" + (open ? " open" : "")} ref={ref} style={style}>
      <button type="button" className="csel-btn" onClick={() => setOpen(!open)}>
        {sel ? sel.label : ""}
      </button>
      <div className="csel-pop">
        {open &&
          options.map((o) => (
            <div
              key={o.value}
              className={"csel-opt" + (String(o.value) === String(value) ? " sel" : "")}
              onClick={() => {
                onChange(String(o.value));
                setOpen(false);
              }}
            >
              {o.label}
            </div>
          ))}
      </div>
    </span>
  );
}

// ===== 날짜 피커 =====
export function DateInput({ value, onChange, width }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [cursor, setCursor] = useState(() => (value ? new Date(value + "T00:00:00") : new Date()));
  const inpRef = useRef(null);
  const popRef = useRef(null);

  const openPop = () => {
    setCursor(value ? new Date(value + "T00:00:00") : new Date());
    const r = inpRef.current.getBoundingClientRect();
    setPos({ left: window.scrollX + r.left, top: window.scrollY + r.bottom + 6 });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) && e.target !== inpRef.current) setOpen(false);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);

  const y = cursor.getFullYear(),
    m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const gs = addDays(first, -first.getDay());
  const tdy = todayStr();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const cd = addDays(gs, i);
    const k = fmtD(cd);
    let cls = "dpd";
    if (cd.getMonth() !== m) cls += " oth";
    if (cd.getDay() === 0) cls += " sun";
    if (cd.getDay() === 6) cls += " sat";
    if (k === tdy) cls += " tdy";
    if (k === value) cls += " sel";
    cells.push(
      <div key={k} className={cls} onClick={() => { onChange(k); setOpen(false); }}>
        {cd.getDate()}
      </div>
    );
  }
  return (
    <>
      <input ref={inpRef} className="datep" readOnly value={value || ""} style={width ? { width } : undefined} onClick={openPop} />
      {open &&
        createPortal(
          <div ref={popRef} className="dppop" style={{ left: pos.left, top: pos.top }}>
            <div className="dphead">
              <button type="button" className="dpnav" onClick={() => setCursor(new Date(y, m - 1, 1))}>‹</button>
              <span>{y}. {m + 1}</span>
              <button type="button" className="dpnav" onClick={() => setCursor(new Date(y, m + 1, 1))}>›</button>
            </div>
            <div className="dpgrid dphead2">
              {WD_SUN.map((w, i) => (
                <div key={w} className={i === 0 ? "sun" : i === 6 ? "sat" : ""}>{w}</div>
              ))}
            </div>
            <div className="dpgrid">{cells}</div>
          </div>,
          document.body
        )}
    </>
  );
}

// ===== 연·월 피커 =====
export function YMPicker({ value, onChange, anchorLabel }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [year, setYear] = useState(() => +(value || "").split("-")[0] || new Date().getFullYear());
  const btnRef = useRef(null);
  const popRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) && e.target !== btnRef.current) setOpen(false);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);
  const selY = +(value || "").split("-")[0],
    selM = +(value || "").split("-")[1];
  return (
    <>
      <button
        ref={btnRef}
        className="btn ghost sm"
        onClick={() => {
          setYear(selY || new Date().getFullYear());
          const r = btnRef.current.getBoundingClientRect();
          setPos({ left: window.scrollX + r.left, top: window.scrollY + r.bottom + 6 });
          setOpen(!open);
        }}
      >
        {anchorLabel}
      </button>
      {open &&
        createPortal(
          <div ref={popRef} className="ympop" style={{ left: pos.left, top: pos.top }}>
            <div className="ymhead">
              <button type="button" className="dpnav" onClick={() => setYear(year - 1)}>‹</button>
              <span>{year}년</span>
              <button type="button" className="dpnav" onClick={() => setYear(year + 1)}>›</button>
            </div>
            <div className="ymgrid">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => (
                <div
                  key={mo}
                  className={"ymc" + (year === selY && mo === selM ? " sel" : "")}
                  onClick={() => {
                    onChange(year + "-" + ("0" + mo).slice(-2));
                    setOpen(false);
                  }}
                >
                  {mo}월
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

// ===== 라벨/수치 박스 =====
export function KpiBox({ title, best, children, hint }) {
  return (
    <div className={"box" + (best ? " best" : "")}>
      <div className="t">{title}</div>
      <div className="v num">{children}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

// 손익/비용 표기 헬퍼 (JSX)
import { won as wonF, ml as mlF } from "../lib/util.js";
export const CostLabel = ({ n }) =>
  n < 0 ? <span className="good">{wonF(-n)} 이득</span> : <span className="cost">{wonF(n)} 지출</span>;
export const PlLabel = ({ p }) =>
  p >= 0 ? <span className="good">{wonF(p)} 이득</span> : <span className="bad">{wonF(-p)} 손해</span>;
export const MilUse = ({ n }) => (n > 0 ? <span className="mil">{mlF(n)} 소모</span> : <>–</>);
export const IconView = ({ icon }) => {
  if (!icon) return null;
  return /^https?:/.test(icon) ? (
    <img className="iic" src={icon} alt="" onError={(e) => (e.target.style.display = "none")} />
  ) : (
    <span className="iemoji">{icon}</span>
  );
};
