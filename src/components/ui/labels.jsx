import { won as wonF, mlN } from "../../lib/util.js";

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
