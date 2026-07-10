import { useState, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { fmtD, todayStr, addDays, nowD, dateOf } from "../../lib/util.js";
import { WD_SUN } from "../../lib/constants.js";
import { usePopover, rectBelow } from "./usePopover.js";
import { useRovingFocus } from "./useRovingFocus.js";
import { IconView } from "./IconView.jsx";

// 네 피커는 모두 같은 팝오버 동작을 쓴다(usePopover): pointerdown 바깥 클릭 + Esc 닫기.
// 예전에는 각자 복붙한 데다 이벤트 종류(mousedown/click)와 바깥 판정 방식이 달랐다.

// ===== 아이템 콤보 (자유 입력 + 항상 열리는 목록, 테마 통일) =====
export function ItemCombo({ value, onChange, options, width, placeholder }) {
  // anchorRef = 입력 + 토글 버튼을 감싸는 span. 둘 중 무엇을 눌러도 '바깥'이 아니다.
  const { open, setOpen, close, pos, setPos, anchorRef, popRef } = usePopover();
  const inpRef = useRef(null);
  // 자유 입력 콤보라 **포커스는 입력에 머물러야 한다**(옵션으로 옮기면 타이핑이 끊긴다).
  // 그래서 roving tabindex 대신 `aria-activedescendant` 패턴을 쓴다: 활성 옵션을 인덱스로만 추적한다.
  const [active, setActive] = useState(-1);
  const listId = useId();
  const opts = (options || [])
    .map((o) => (typeof o === "string" ? { name: o } : o))
    .filter((o) => o && o.name);

  // 위치는 입력칸 기준으로 잡는다(토글 버튼까지 감싼 wrap 이 아니라).
  const openPop = () => {
    setPos(rectBelow(inpRef.current, 4));
    setOpen(true);
  };
  const pick = (o) => { onChange(o.name); setActive(-1); close(); };

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(0); openPop(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % Math.max(1, opts.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + opts.length) % Math.max(1, opts.length)); }
    else if (e.key === "Enter" && active >= 0 && opts[active]) { e.preventDefault(); pick(opts[active]); }
    // Esc 는 usePopover 가 캡처 단계에서 닫는다.
  };

  const optId = (i) => `${listId}-opt-${i}`;

  return (
    <span className="icombo" ref={anchorRef} style={width ? { width } : undefined}>
      <input
        ref={inpRef}
        className="icombo-inp"
        value={value || ""}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 && opts[active] ? optId(active) : undefined}
        onChange={(e) => { onChange(e.target.value); setActive(-1); }}
        onFocus={openPop}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="icombo-tgl" tabIndex={-1} aria-hidden="true" onClick={() => (open ? close() : openPop())}>▾</button>
      {open && opts.length > 0 &&
        createPortal(
          <div ref={popRef} id={listId} role="listbox" className="icombo-pop" style={{ left: pos.left, top: pos.top, minWidth: pos.width || 160 }}>
            {opts.map((o, i) => (
              <div
                key={o.name}
                id={optId(i)}
                role="option"
                aria-selected={o.name === value}
                className={"icombo-opt" + (o.name === value ? " sel" : "") + (i === active ? " active" : "")}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
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
  const selIdx = Math.max(0, weeks.findIndex((w) => w.key === value));
  const activate = (i) => { if (weeks[i]) { onChange(weeks[i].key); close(); } };
  // 1열 목록 — 위/아래로 이동, Enter/Space 로 선택.
  const roving = useRovingFocus({ count: weeks.length, cols: 1, initial: selIdx, activate });
  return (
    <>
      <button
        ref={anchorRef}
        className="btn ghost sm"
        aria-haspopup="listbox"
        aria-expanded={open}
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
          <div ref={popRef} role="listbox" aria-label="주차 선택" className="wkpop" style={{ left: pos.left, top: pos.top }}>
            {weeks.map((w, i) => (
              <div
                key={w.key}
                role="option"
                aria-selected={w.key === value}
                className={"wkc" + (w.key === value ? " sel" : "")}
                onClick={() => activate(i)}
                {...roving.itemProps(i)}
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
  const keys = Array.from({ length: 42 }, (_, i) => fmtD(addDays(gs, i)));
  // 처음 Tab 으로 들어오면 선택된 날(없으면 오늘, 그것도 없으면 이 달 1일)에 포커스가 간다.
  const initial = Math.max(0, [value, tdy, fmtD(first)].map((k) => keys.indexOf(k)).find((i) => i >= 0) ?? 0);
  const activate = (i) => { onChange(keys[i]); close(); };
  // 7열 격자(.dpgrid) — 좌우로 하루, 상하로 한 주.
  const roving = useRovingFocus({ count: 42, cols: 7, initial, activate });

  const cells = keys.map((k, i) => {
    const cd = addDays(gs, i);
    let cls = "dpd";
    if (cd.getMonth() !== m) cls += " oth";
    if (cd.getDay() === 0) cls += " sun";
    if (cd.getDay() === 6) cls += " sat";
    if (k === tdy) cls += " tdy";
    if (k === value) cls += " sel";
    return (
      <div
        key={k}
        role="button"
        aria-label={k}
        aria-pressed={k === value}
        className={cls}
        onClick={() => activate(i)}
        {...roving.itemProps(i)}
      >
        {cd.getDate()}
      </div>
    );
  });
  return (
    <>
      <input
        ref={anchorRef}
        className="datep"
        readOnly
        value={value || ""}
        style={width ? { width } : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPop}
        onKeyDown={(e) => {
          // readOnly 입력이라 Enter/Space/↓ 로 열 수 있어야 한다(클릭 말고는 여는 길이 없었다).
          if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); openPop(); }
        }}
      />
      {open &&
        createPortal(
          <div ref={popRef} role="dialog" aria-label="날짜 선택" className="dppop" style={{ left: pos.left, top: pos.top }}>
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
            <div className="dpgrid" role="group">{cells}</div>
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
  const pickMonth = (i) => { onChange(year + "-" + ("0" + (i + 1)).slice(-2)); close(); };
  // 3열 격자(.ymgrid) — 좌우로 한 칸, 상하로 세 칸 이동.
  const roving = useRovingFocus({ count: 12, cols: 3, initial: Math.max(0, (selM || 1) - 1), activate: pickMonth });
  return (
    <>
      <button
        ref={anchorRef}
        className="btn ghost sm"
        aria-haspopup="listbox"
        aria-expanded={open}
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
            <div className="ymgrid" role="listbox" aria-label="월 선택">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mo, i) => (
                <div
                  key={mo}
                  role="option"
                  aria-selected={year === selY && mo === selM}
                  className={"ymc" + (year === selY && mo === selM ? " sel" : "")}
                  onClick={() => pickMonth(i)}
                  {...roving.itemProps(i)}
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
