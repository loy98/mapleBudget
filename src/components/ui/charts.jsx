import { useState, useRef, useLayoutEffect, useId } from "react";

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
          {/* 모든 눈금을 데이터 포인트 중앙에 정렬. 양끝은 살짝 넘칠 수 있어 .spark-x가 여백을 갖는다. */}
          {ticks.map((i) => (
            <span key={i} className={"sx" + (i === hi ? " on" : "")} style={{ left: xAt(i) }}>
              {(labels[i] && labels[i].short) || ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
