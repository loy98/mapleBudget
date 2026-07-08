import { useState, useRef, useEffect, useLayoutEffect, useId } from "react";
import { createPortal } from "react-dom";
import { fmtD, todayStr, addDays } from "../lib/util.js";
import { WD_SUN } from "../lib/constants.js";

// ===== 숫자 입력 (테마 스테퍼) =====
// 편집 중에는 자유롭게 지울 수 있고(완전 삭제 가능), 다 지운 채 포커스를 벗어나면 0으로,
// 다 지우고 숫자를 입력하면 그 값으로 확정된다. 값은 문자열로 전달(계산부는 +x||0로 처리).
export function NumInput({ value, onChange, step = 1, width, noStepper, placeholder }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const display = value === "" || value == null ? "" : String(value);
  const shown = focused ? draft : display;

  const emit = (raw) => {
    // 숫자·소수점만 남기고, 소수점이 여러 개면 첫 번째만 유지(둘째 점 이후 병합) →
    // "1.2.3" 같은 입력이 blur에서 NaN→0 으로 소실되는 것 방지.
    const clean = raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    setDraft(clean);
    onChange(clean);
  };
  const onBlur = () => {
    setFocused(false);
    if (draft.trim() === "" || !isFinite(+draft)) onChange(0);
  };

  const inp = (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      style={width ? { width } : undefined}
      onFocus={() => { setDraft(display); setFocused(true); }}
      onBlur={onBlur}
      onChange={(e) => emit(e.target.value)}
    />
  );
  if (noStepper || width) return inp;
  const bump = (dir) => {
    const base = +(focused ? draft : value) || 0;
    const nv = String(base + dir * step);
    setDraft(nv);
    onChange(nv);
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

// ===== 아이템 콤보 (자유 입력 + 항상 열리는 목록, 테마 통일) =====
export function ItemCombo({ value, onChange, options, width, placeholder }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 160 });
  const wrapRef = useRef(null);
  const inpRef = useRef(null);
  const popRef = useRef(null);
  const opts = (options || [])
    .map((o) => (typeof o === "string" ? { name: o } : o))
    .filter((o) => o && o.name);

  const openPop = () => {
    const r = inpRef.current.getBoundingClientRect();
    setPos({ left: window.scrollX + r.left, top: window.scrollY + r.bottom + 4, width: r.width });
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (
        popRef.current && !popRef.current.contains(e.target) &&
        wrapRef.current && !wrapRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <span className="icombo" ref={wrapRef} style={width ? { width } : undefined}>
      <input
        ref={inpRef}
        className="icombo-inp"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={openPop}
      />
      <button type="button" className="icombo-tgl" tabIndex={-1} onClick={() => (open ? setOpen(false) : openPop())}>▾</button>
      {open && opts.length > 0 &&
        createPortal(
          <div ref={popRef} className="icombo-pop" style={{ left: pos.left, top: pos.top, minWidth: pos.width }}>
            {opts.map((o) => (
              <div
                key={o.name}
                className={"icombo-opt" + (o.name === value ? " sel" : "")}
                onMouseDown={(e) => { e.preventDefault(); onChange(o.name); setOpen(false); }}
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
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef(null);
  const popRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) && e.target !== btnRef.current) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const sel = weeks.find((w) => w.key === value);
  return (
    <>
      <button
        ref={btnRef}
        className="btn ghost sm"
        onClick={() => {
          const r = btnRef.current.getBoundingClientRect();
          setPos({ left: window.scrollX + r.left, top: window.scrollY + r.bottom + 6 });
          setOpen(!open);
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
                onClick={() => { onChange(w.key); setOpen(false); }}
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

// ===== 진행률 링 (SVG) — 목표 대비 진행도 시각화 =====
export function ProgressRing({ pct, size = 150, stroke = 14, children }) {
  const p = Math.max(0, Math.min(100, +pct || 0));
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p / 100)}
          style={{ transition: "stroke-dashoffset .8s cubic-bezier(.22,1,.36,1)" }}
        />
      </svg>
      <div className="ring-c">{children}</div>
    </div>
  );
}

// ===== 스파크라인 (SVG) — 라인/막대 모드, 컨테이너 실폭 측정으로 1:1 렌더 =====
// preserveAspectRatio="none" 비균등 스케일이 선 두께 불균일·끝점 타원 왜곡을 유발 → 실폭 측정 viewBox로 1:1 렌더해 해결.
// labels: [{ short, full, cur }] — short는 x축 눈금, full은 툴팁 제목. 길이가 data와 달라도 안전(옵셔널 접근).
// format: 툴팁 값 포매터(예: won). 미지정 시 String.
export function Sparkline({ data = [], labels = [], height = 88, pad = 6, mode = "line", format, ariaLabel = "추세 차트" }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState(-1);
  const gid = "spk" + useId().replace(/:/g, ""); // Hook은 조기 반환 이전에 무조건 호출
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setW(Math.max(1, Math.round(el.clientWidth || 600)));
    update();
    let ro;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(update); ro.observe(el); }
    return () => ro && ro.disconnect();
  }, []);

  const vals = data.map((v) => (Number.isFinite(+v) ? +v : 0));
  const n = vals.length;
  const hp = Math.max(0, Math.min(pad, Math.floor(w / 2))); // 초협소 폭 보정(좌표 viewBox 이탈 방지)
  const innerW = Math.max(1, w - 2 * hp);
  const innerH = Math.max(1, height - 2 * pad - 4);
  const fmt = typeof format === "function" ? format : (v) => String(v);
  const bars = mode === "bars";
  const interactive = n >= 2;
  // 데이터 길이가 줄어 hover 인덱스가 범위를 벗어나면 렌더 시점에 무시(스테일 인덱스 방어)
  const hi = hover >= 0 && hover < n ? hover : -1;

  // 좌표 매핑 — 모드별로 x가 다르므로(막대는 셀 중앙, 라인은 등분점) 헬퍼로 통일
  const step = innerW / Math.max(1, n);
  const gap = Math.min(6, step * 0.35);
  const bw = Math.max(1, step - gap);
  const bmax = n ? Math.max(1, ...vals.map((v) => Math.max(0, v))) : 1; // 음수 유입 시 왜곡 방지
  const max = n ? Math.max(...vals) : 0;
  const min = n ? Math.min(...vals) : 0;
  const span = max - min || 1;
  const xAt = (i) => (bars ? hp + i * step + step / 2 : n > 1 ? hp + (i * innerW) / (n - 1) : hp + innerW / 2);
  const yAt = (i) =>
    bars ? height - pad - (Math.max(0, vals[i]) / bmax) * innerH : height - pad - ((vals[i] - min) / span) * innerH;

  let content = null;
  if (n >= 2) {
    if (bars) {
      content = vals.map((v, i) => {
        const bh = Math.max(0, (Math.max(0, v) / bmax) * innerH);
        const x = hp + i * step + gap / 2;
        const y = height - pad - bh;
        const op = hi >= 0 ? (i === hi ? 1 : 0.28) : i === n - 1 ? 1 : 0.45;
        return (
          <rect key={i} x={x.toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={bh.toFixed(1)}
            rx="2" fill="var(--accent)" opacity={op} />
        );
      });
    } else {
      const pts = vals.map((_, i) => [xAt(i), yAt(i)]);
      const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      const area = `M${pts[0][0].toFixed(1)} ${height} ` + line.replace(/^M/, "L") + ` L${pts[n - 1][0].toFixed(1)} ${height} Z`;
      const last = pts[n - 1];
      content = (
        <>
          <path d={area} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="3.6" fill="var(--accent)" stroke="var(--panel)" strokeWidth="2" />
        </>
      );
    }
  }

  // ----- 호버: 포인터 x → 가장 가까운 구간 인덱스 -----
  const pick = (clientX) => {
    const el = wrapRef.current;
    if (!interactive || !el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const px = (clientX - r.left) * (w / r.width); // CSS 축소(max-width) 시에도 viewBox 좌표로 환산
    const raw = bars ? Math.floor((px - hp) / step) : Math.round((px - hp) / (innerW / (n - 1)));
    setHover(Math.max(0, Math.min(n - 1, raw)));
  };
  const onKey = (e) => {
    if (!interactive) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      // 선택 없는 상태의 첫 입력은 끝점(→면 처음, ←면 마지막)을 집는다
      setHover((h) => (h < 0 ? (d > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, h + d))));
    } else if (e.key === "Escape") setHover(-1);
  };

  // ----- x축 눈금: 폭에 맞춰 솎아내되 첫/마지막은 항상 표시 -----
  const ticks = [];
  if (n >= 2 && labels.length) {
    const stride = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 48))));
    for (let i = 0; i < n; i += stride) ticks.push(i);
    const lastT = ticks[ticks.length - 1];
    if (lastT !== n - 1) {
      if (ticks.length > 1 && n - 1 - lastT < stride * 0.6) ticks.pop(); // 마지막 눈금과 겹치면 직전 것 제거
      ticks.push(n - 1);
    }
  }

  // 툴팁: 기본은 점 위. 점이 차트 상단에 붙어 위로 못 띄우면 아래로 뒤집는다.
  const tipX = hi >= 0 ? Math.min(Math.max(xAt(hi), 58), Math.max(58, w - 58)) : 0;
  const tipFlip = hi >= 0 && yAt(hi) < 46;
  const tipY = hi < 0 ? 0 : tipFlip ? Math.min(height - pad - 4, yAt(hi) + 10) : yAt(hi) - 10;

  return (
    <div
      ref={wrapRef} className="spark-wrap"
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "group" : undefined}
      aria-label={interactive ? ariaLabel + " (좌우 방향키로 구간 이동)" : undefined}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => setHover(-1)}
      onKeyDown={onKey}
      onBlur={() => setHover(-1)}
    >
      <svg className="spark" width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={hp} y1={height - pad} x2={w - hp} y2={height - pad} stroke="var(--line)" strokeWidth="1" />
        {content}
        {hi >= 0 && (
          <g pointerEvents="none">
            <line x1={xAt(hi).toFixed(1)} y1={pad} x2={xAt(hi).toFixed(1)} y2={height - pad}
              stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
            {!bars && (
              <circle cx={xAt(hi).toFixed(1)} cy={yAt(hi).toFixed(1)} r="4.2" fill="var(--accent)" stroke="var(--panel)" strokeWidth="2" />
            )}
          </g>
        )}
      </svg>
      {hi >= 0 && (
        <div className={"spark-tip" + (tipFlip ? " down" : "")} style={{ left: tipX, top: tipY }} role="status" aria-live="polite">
          {labels[hi] && (
            <div className="st-d">{labels[hi].full}{labels[hi].cur ? " · 이번 주" : ""}</div>
          )}
          <div className="st-v num">{fmt(vals[hi])}</div>
        </div>
      )}
      {ticks.length > 0 && (
        <div className="spark-x" aria-hidden="true">
          {ticks.map((i) => (
            <span
              key={i}
              className={"sx" + (i === hi ? " on" : "")}
              style={{ left: xAt(i), transform: i === 0 ? "none" : i === n - 1 ? "translateX(-100%)" : "translateX(-50%)" }}
            >
              {(labels[i] && labels[i].short) || ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== 통계 그룹 카드 — 대표 지표 1 + 보조 지표 목록 =====
export function StatGroup({ icon, title, primary, badge, best, items = [], hint }) {
  return (
    <section className={"sgrp" + (best ? " best" : "")}>
      <div className="sg-head">
        {icon && <span className="sg-ico" aria-hidden="true">{icon}</span>}
        <span>{title}</span>
      </div>
      <div className="sg-lbl">{primary.label}</div>
      <div className="sg-val num">{primary.value}</div>
      {badge && <div className="sg-badge">{badge}</div>}
      {items.length > 0 && (
        <dl className="sg-rows">
          {items.map((it) => (
            <div className="sg-row" key={it.label}>
              <dt>{it.label}</dt>
              <dd className="num">{it.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {hint && <div className="sg-hint">{hint}</div>}
    </section>
  );
}

// 손익/비용 표기 헬퍼 (JSX)
import { won as wonF, mlN } from "../lib/util.js";
// 숫자는 모노(.num), 한글 접미는 본문폰트(.u)로 분리 — 모노 컨테이너 안에서도 접미가 mono로 leak되지 않음
export const CostLabel = ({ n }) =>
  n < 0
    ? <span className="good"><span className="num">{wonF(-n)}</span><span className="u"> 이득</span></span>
    : <span className="cost"><span className="num">{wonF(n)}</span><span className="u"> 지출</span></span>;
export const PlLabel = ({ p }) =>
  p >= 0
    ? <span className="good"><span className="num">{wonF(p)}</span><span className="u"> 이득</span></span>
    : <span className="bad"><span className="num">{wonF(-p)}</span><span className="u"> 손해</span></span>;
export const MilUse = ({ n }) =>
  n > 0 ? <span className="mil"><span className="num">{mlN(n)}</span><span className="u"> 마일리지 소모</span></span> : <>–</>;
export const IconView = ({ icon }) => {
  if (!icon) return null;
  // http(s) URL만 이미지로. referrerPolicy=no-referrer 로 트래킹 리퍼러 유출 차단, lazy 로딩.
  // (data:/javascript: 는 여기서 자동 제외 → 이모지 span 으로 폴백, img 스크립트 벡터 없음.)
  return /^https?:\/\//.test(icon) ? (
    <img
      className="iic"
      src={icon}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(e) => (e.target.style.display = "none")}
    />
  ) : (
    <span className="iemoji">{icon}</span>
  );
};
