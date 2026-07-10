import { Fragment } from "react";
import { TIERS } from "../../lib/constants.js";
import { won, pct, eok, mlN, mmdd, fmtD, weekStartThu, estGrade } from "../../lib/util.js";
import { YMPicker, WeekPicker, StatGroup, CostLabel, PlLabel, Sparkline } from "../ui.jsx";
import { ItemSubRow, ItemSummary, Qty } from "./ItemTables.jsx";

// 통계 카드 — 기간 선택, 추세 차트, 지표 3종, 품목별 누적 요약, 주차별 거래 현황.
// 파생값은 전부 useLedgerDerived 가 계산해 d 로 넘어온다(이 컴포넌트는 그리기만 한다).
export default function StatsPanel({
  d, calc, tiers = TIERS,
  periodMode, setPeriodMode,
  statMonth, setStatMonth,
  statWeek, setStatWeek,
  setCalCursor, setCalMode,
  chartMode, setChartMode,
  showItemSum, setShowItemSum,
  openWeeks, toggleWeek,
}) {
  const { st, cum, mWeeks, wkTot, uncashed, mWeekItems, measuredRate, rateWon, itemRows, iconOf,
    weekly13, weekly13Labels, weekOptions, periodRange, mvLabel } = d;

  return (
    <div className="card">
      <h2><span className="n">📊</span>통계</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="pseg">
          {[["w13", "최근 13주"], ["all", "전체"], ["month", "특정 월"], ["week", "특정 주차"]].map(([p, l]) => (
            <button key={p} className={"pbtn" + (periodMode === p ? " on" : "")} onClick={() => setPeriodMode(p)}>{l}</button>
          ))}
        </div>
        {periodMode === "month" && (
          <YMPicker value={statMonth} anchorLabel={mvLabel.split("-")[0] + "년 " + +mvLabel.split("-")[1] + "월 ▾"}
            onChange={(v) => { setStatMonth(v); setCalCursor(new Date(+v.split("-")[0], +v.split("-")[1] - 1, 1)); setCalMode("month"); }} />
        )}
        {periodMode === "week" && (
          <WeekPicker value={statWeek} weeks={weekOptions} onChange={setStatWeek} />
        )}
        <span className="hint">{periodRange}</span>
      </div>
      <div className="trendbox">
        <div className="trend-top">
          <div>
            <div className="trend-lbl">주간 과금 추세 · 최근 13주</div>
            <div className="trend-big">{won(cum)}</div>
          </div>
          <div className="trend-tools">
            <div className="trend-grade">누적 추정 <b>{estGrade(cum, tiers)}</b></div>
            <div className="chart-mode">
              <span className="cm-lbl" id="chartModeLbl">그래프 방식</span>
              <div className="chart-toggle" role="group" aria-labelledby="chartModeLbl">
                <button className={chartMode === "line" ? "on" : ""} aria-pressed={chartMode === "line"} onClick={() => setChartMode("line")}>선</button>
                <button className={chartMode === "bars" ? "on" : ""} aria-pressed={chartMode === "bars"} onClick={() => setChartMode("bars")}>막대</button>
              </div>
            </div>
          </div>
        </div>
        <Sparkline
          data={weekly13} labels={weekly13Labels} mode={chartMode} format={won}
          ariaLabel="최근 13주 주간 과금 추세"
        />
      </div>
      <div className="sgrid">
        <StatGroup
          icon="📈" title="과금 & 등급" best
          primary={{ label: "13주 누적 과금", value: won(cum) }}
          badge={<>추정 등급 <b>{estGrade(cum, tiers)}</b></>}
          items={[
            { label: "총 과금 (실적, MVP)", value: won(st.ach) },
            { label: "총 마일리지 소모", value: st.mil > 0 ? <span className="mil">{mlN(st.mil)}</span> : "–" },
          ]}
        />
        <StatGroup
          icon="💸" title="지출 & 손익"
          primary={{ label: "엠작 손익 (현금화−구매)", value: <PlLabel p={st.profit} /> }}
          items={[
            { label: "엠작 구매 실지출", value: <CostLabel n={st.spend} /> },
            { label: "현금화 판매 현금", value: won(st.cashWon) },
          ]}
        />
        <StatGroup
          icon="💰" title="메소 & 현금화"
          primary={{ label: "현금화 필요 메소 (판매−현금화)", value: <>{eok(Math.max(0, uncashed))} <span className="muted u">메소</span></> }}
          items={[
            { label: "판매 메소 (실수령)", value: <>{eok(st.meso)} <span className="muted u">메소</span></> },
            { label: "현금화한 메소", value: <>{eok(st.cashMeso)} <span className="muted u">메소</span></> },
            { label: "현금화율 (현금화/판매)", value: pct(st.ratio * 100) },
          ]}
          hint={uncashed < 0 ? <>현금화가 판매보다 {eok(-uncashed)} 많습니다.</> : undefined}
        />
      </div>
      <div className="note">
        구매 {st.buys}건 · 판매 {st.sells}건 · 현금화 {st.cashes}건 · 기타 캐시사용 {st.spends}건({won(st.extra)}).
        {" "}거래는 <b>기록 당시의 수수료·충전 할인</b>으로 계산합니다.
        {d.hasLegacyRows && (
          <>
            {" "}
            <b>이 기능이 생기기 전에 입력한 거래</b>는 그때의 요율이 남아 있지 않아
            현재 설정(수수료 {pct(calc.feePct)}, 충전 할인 {pct(calc.effD * 100)}) 기준 <b>추정치</b>입니다 —
            계산기 설정을 바꾸면 그 거래들의 숫자가 함께 바뀝니다.
          </>
        )}
      </div>

      <button
        className={"disc" + (showItemSum ? " on" : "")}
        aria-expanded={showItemSum}
        onClick={() => setShowItemSum((v) => !v)}
      >
        <span className="caret" aria-hidden="true">▶</span>품목별 누적 요약
      </button>
      {showItemSum && (
        <ItemSummary rows={itemRows} iconOf={iconOf} rateWon={rateWon} measuredRate={measuredRate} />
      )}

      <div className="subhead" style={{ marginTop: 18 }}>주차별 거래 현황 (최근 13주 · 목~수)</div>
      <div className="calwrap">
        <table>
          <thead>
            <tr>
              <th className="exph"></th>
              <th className="lh">주 (목~수)</th>
              <th className="qh">구매</th><th className="qh sep">판매</th>
              <th>판매 메소</th><th>현금화 메소</th><th>현금화 필요</th>
            </tr>
          </thead>
          <tbody>
            {mWeeks.map((w, wi) => {
              const wk = fmtD(w.ws), isCur = wk === fmtD(weekStartThu(new Date()));
              const empty = !w.sold && !w.cashed; // 메소 열 전용 — 개수 열은 각자 0이면 '–'
              const items = mWeekItems[wi];
              const canOpen = items.length > 0;
              const open = canOpen && !!openWeeks[wk];
              const range = mmdd(w.ws) + "~" + mmdd(w.we);
              return (
                <Fragment key={wk}>
                  <tr className={[isCur && "curwk", open && "opened"].filter(Boolean).join(" ")}>
                    <td className="expc">
                      {canOpen && (
                        <button
                          className={"disc xs" + (open ? " on" : "")}
                          aria-expanded={open}
                          aria-label={range + " 품목별 내역 " + (open ? "접기" : "펼치기")}
                          onClick={() => toggleWeek(wk)}
                        >
                          <span className="caret" aria-hidden="true">▶</span>
                        </button>
                      )}
                    </td>
                    <td className="lh">
                      <button className="linklike" onClick={() => { setPeriodMode("week"); setStatWeek(wk); }}>
                        {range}
                      </button>
                      {isCur && <span className="nowtag" style={{ marginLeft: 6 }}>이번주</span>}
                    </td>
                    <td className="num qty"><Qty n={w.buyQty} /></td>
                    <td className="num qty sep"><Qty n={w.sellQty} /></td>
                    <td className="num">{empty ? "–" : eok(w.sold)}</td>
                    <td className="num">{empty ? "–" : eok(w.cashed)}</td>
                    <td className={"num " + (w.need > 0.0001 ? "bad" : "good")}>{empty ? "–" : eok(w.need)}</td>
                  </tr>
                  {open && items.map((r, ri) => (
                    <ItemSubRow key={wk + "|" + r.name} r={r} icon={iconOf[r.name]} last={ri === items.length - 1} />
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="wktot-row">
              <td className="expc"></td>
              <td className="lh">13주 합계</td>
              <td className="num qty"><Qty n={wkTot.buyQty} /></td>
              <td className="num qty sep"><Qty n={wkTot.sellQty} /></td>
              <td className="num">{eok(wkTot.sold)}</td>
              <td className="num">{eok(wkTot.cashed)}</td>
              <td className={"num " + (wkTot.need > 0.0001 ? "bad" : "good")}>{eok(wkTot.need)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="hint" style={{ marginTop: 4 }}>
        ▶를 누르면 그 주에 어떤 품목을 몇 개 사고 팔았는지 펼쳐집니다(판매한 품목만 '판매 메소·개당 평균가'가 나옵니다).
        주차 날짜를 누르면 위 통계가 그 주 기준으로 바뀝니다. '구매/판매'는 그 주에 입력한 아이템 수량 합이에요
        (산 주와 판 주가 다르면 각각 그 주에 잡힙니다). '현금화 필요'는 판매 실수령 메소에서 현금화한 메소를 뺀 값이에요.
      </div>
    </div>
  );
}
