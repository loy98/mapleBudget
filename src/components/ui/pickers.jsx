import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { fmtD, todayStr, addDays, nowD, dateOf } from "../../lib/util.js";
import { WD_SUN } from "../../lib/constants.js";
import { usePopover, rectBelow } from "./usePopover.js";
import { IconView } from "./IconView.jsx";

// 네 피커는 모두 같은 팝오버 동작을 쓴다(usePopover): pointerdown 바깥 클릭 + Esc 닫기.
// 예전에는 각자 복붙한 데다 이벤트 종류(mousedown/click)와 바깥 판정 방식이 달랐다.

// ===== 아이템 콤보 (자유 입력 + 항상 열리는 목록, 테마 통일) =====
export function ItemCombo({ value, onChange, options, width, placeholder }) {
  // anchorRef = 입력 + 토글 버튼을 감싸는 span. 둘 중 무엇을 눌러도 '바깥'이 아니다.
  const { open, setOpen, close, pos, setPos, anchorRef, popRef } = usePopover();
  const inpRef = useRef(null);
  const opts = (options || [])
    .map((o) => (typeof o === "string" ? { name: o } : o))
    .filter((o) => o && o.name);

  // 위치는 입력칸 기준으로 잡는다(토글 버튼까지 감싼 wrap 이 아니라).
  const openPop = () => {
    setPos(rectBelow(inpRef.current, 4));
    setOpen(true);
  };

  return (
    <span className="icombo" ref={anchorRef} style={width ? { width } : undefined}>
      <input
        ref={inpRef}
        className="icombo-inp"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={openPop}
      />
      <button type="button" className="icombo-tgl" tabIndex={-1} onClick={() => (open ? close() : openPop())}>▾</button>
      {open && opts.length > 0 &&
        createPortal(
          <div ref={popRef} className="icombo-pop" style={{ left: pos.left, top: pos.top, minWidth: pos.width || 160 }}>
            {opts.map((o) => (
              <div
                key={o.name}
                className={"icombo-opt" + (o.name === value ? " sel" : "")}
                onMouseDown={(e) => { e.preventDefault(); onChange(o.name); close(); }}
              >
                {o.icon ? <IconView icon={o.icon} /> : null}
                <span>{o.name}</span>
              </div>
            ))}
          </div>,
          document.body
        )}
    </span>
  );
}

// ===== 주차 피커 (MVP 주: 목~수) =====
export function WeekPicker({ value, onChange, weeks }) {
  const { open, setOpen, close, pos, setPos, anchorRef, popRef } = usePopover();
  const sel = weeks.find((w) => w.key === value);
  return (
    <>
      <button
        ref={anchorRef}
        className="btn ghost sm"
        onClick={() => {
          if (open) return close();
          setPos(rectBelow(anchorRef.current, 6));
          setOpen(true);
        }}
      >
        {sel ? sel.label : "주 선택"} ▾
      </button>
      {open &&
        createPortal(
          <div ref={popRef} className="wkpop" style={{ left: pos.left, top: pos.top }}>
            {weeks.map((w) => (
              <div
                key={w.key}
                className={"wkc" + (w.key === value ? " sel" : "")}
                onClick={() => { onChange(w.key); close(); }}
              >
                {w.label}{w.cur ? <span className="nowtag" style={{ marginLeft: 6 }}>이번주</span> : null}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

// ===== 날짜 피커 =====
export function DateInput({ value, onChange, width }) {
  const { open, setOpen, close, pos, setPos, anchorRef, popRef } = usePopover();
  const [cursor, setCursor] = useState(() => (value ? dateOf(value) : nowD()));

  const openPop = () => {
    setCursor(value ? dateOf(value) : nowD());
    setPos(rectBelow(anchorRef.current, 6));
    setOpen(true);
  };

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
      <div key={k} className={cls} onClick={() => { onChange(k); close(); }}>
        {cd.getDate()}
      </div>
    );
  }
  return (
    <>
      <input ref={anchorRef} className="datep" readOnly value={value || ""} style={width ? { width } : undefined} onClick={openPop} />
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
  const { open, setOpen, close, pos, setPos, anchorRef, popRef } = usePopover();
  const selY = +(value || "").split("-")[0],
    selM = +(value || "").split("-")[1];
  const [year, setYear] = useState(() => +(value || "").split("-")[0] || nowD().getFullYear());
  return (
    <>
      <button
        ref={anchorRef}
        className="btn ghost sm"
        onClick={() => {
          if (open) return close();
          setYear(selY || nowD().getFullYear());
          setPos(rectBelow(anchorRef.current, 6));
          setOpen(true);
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
                    close();
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
