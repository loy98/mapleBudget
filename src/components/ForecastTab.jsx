import { useState } from "react";
import { TIERS } from "../lib/constants.js";
import { won, mmdd, estGrade } from "../lib/util.js";
import { cumNow, computeForecast } from "../lib/ledger.js";
import { CSelect, CostLabel } from "./ui.jsx";

const tierOptions = TIERS.map((t, i) => ({ value: i, label: `${t.name} (${(t.amt / 10000).toLocaleString()}만원)` }));
const timingOptions = [
  { value: "weekly", label: "매주" },
  { value: "biweekly", label: "격주" },
  { value: "month1", label: "매월 1일" },
  { value: "monthLast", label: "매월 말주" },
];
const timingTxt = { weekly: "매주", biweekly: "격주", month1: "매월 1일", monthLast: "매월 말주" };

export default function ForecastTab({ ledger, calc }) {
  const [tier, setTier] = useState("4");
  const [timing, setTiming] = useState("weekly");
  const [includeThis, setIncludeThis] = useState(false);

  const C = cumNow(ledger, calc.mileageR);
  const fc = computeForecast(ledger, calc.mileageR, +tier, timing, includeThis, calc.optPer10k);
  const tn = TIERS[+tier].name;

  // 등급 사다리: 현재 누적(C)이 도달한 레벨 (0=무등급, 1=브론즈, …)
  const ladder = [{ name: "무등급", amt: 0 }, ...TIERS];
  const curLevel = TIERS.reduce((acc, t, i) => (C >= t.amt ? i + 1 : acc), 0);

  return (
    <div>
      <div className="card">
        <h2><span className="n">📈</span>등급별 필요 과금</h2>
        <p className="desc">
          MVP는 최근 13주 누적 넥슨캐시 사용액 기준. 각 등급의 누적 기준과 유지에 필요한 주당 과금입니다.
          현재 누적: <b>{won(C)} · 추정 {estGrade(C)}</b>
        </p>
        <div className="ladder">
          {ladder.map((t, i) => {
            const cls = i < curLevel ? "done" : i === curLevel ? "here" : "todo";
            return (
              <div key={t.name} className={"tier " + cls}>
                <span className="mk" />
                <span className="tn">{t.name}{cls === "here" && <span className="now">현재</span>}</span>
                <span className="t-amt">{t.amt > 0 ? won(t.amt) : "–"}</span>
              </div>
            );
          })}
        </div>
        <div className="subhead">등급별 상세 기준</div>
        <table>
          <thead><tr><th>등급</th><th>13주 누적 기준</th><th>주당 필요(유지)</th><th>현재 창 대비 부족</th></tr></thead>
          <tbody>
            {TIERS.map((t) => {
              const need = Math.max(0, t.amt - C);
              return (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td className="num">{won(t.amt)}</td>
                  <td className="num">{won(t.amt / 13)}</td>
                  <td className={"num " + (need > 0 ? "bad" : "good")}>{need > 0 ? won(need) : <span className="u">충족</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2><span className="n">🎯</span>추천 과금 방안</h2>
        <p className="desc">
          목표 등급을 고르면 다음 주부터 13주간 롤링 창(13주)을 목표 이상으로 유지하는 <b>최소 비용 과금 스케줄</b>을 계산합니다.
          창이 부족한 주에만 과금을 배정해 낭비를 없앱니다. 실비용은 계산기의 최적 방식 단가를 적용합니다.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label>목표 등급</label><CSelect value={tier} onChange={setTier} options={tierOptions} style={{ width: 180 }} /></div>
          <div><label>과금 시점</label><CSelect value={timing} onChange={setTiming} options={timingOptions} style={{ width: 170 }} /></div>
          <div>
            <label style={{ marginBottom: 9 }}>&nbsp;</label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--txt)", fontSize: 13 }}>
              <input type="checkbox" checked={includeThis} onChange={(e) => setIncludeThis(e.target.checked)} /> 이번 주 포함
            </label>
          </div>
        </div>
        <div className="note" style={{ border: "none", marginTop: 12 }}>
          {fc.immediate > 0
            ? <>지금 바로 <b>{tn}</b> 도달하려면 이번 주 부족분 <b>{won(fc.immediate)}</b> 추가.<br /></>
            : <>현재 이미 <b>{tn}</b> 이상 충족.<br /></>}
          <b>{timingTxt[timing]} {won(fc.perCharge)}</b> 과금 시{" "}
          {fc.reached !== null ? <><b>{fc.reached === 0 ? "이번 주" : fc.reached + "주 후"}</b> 도달·유지</> : "13주 내 미도달"}.
          총 과금 <b>{won(fc.total)}</b>, 실비용 <CostLabel n={fc.cost} /> (최적: {calc.optMethodName || "–"}). ※ 근사.
        </div>
        <table>
          <thead><tr><th>주차 (예정)</th><th>추천 과금</th><th>창 합계(예상)</th><th>예상 등급</th></tr></thead>
          <tbody>
            {fc.rows.map((r) => (
              <tr key={r.i}>
                <td>{r.i === 0 ? "이번주" : r.i + "주후"} ({mmdd(r.ws)}~{mmdd(r.we)})</td>
                <td className="num">{r.charge > 0 ? won(r.charge) : "–"}</td>
                <td className="num">{won(r.sum)}</td>
                <td>{r.grade}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note">
          주당 과금 실비용 = 과금액 × (계산기 최적 1만원당 단가 ÷ 10,000). 되팔기가 매우 이득이면 실비용이 낮거나 음수로 나올 수 있어요(현실 제약은 근사).
        </div>
      </div>
    </div>
  );
}
