import { useState, useMemo } from "react";
import { WD_MVP, WD_SUN } from "../lib/constants.js";
import { won, pct, eok, mmdd, fmtD, todayStr, curMonth, addDays, start13, weekStartThu, weekStartSun, uid, manW, estGrade } from "../lib/util.js";
import { weeklyAch, cumNow, ledgerStats, dayInfo, cashWonOf, mesoWeeks } from "../lib/ledger.js";
import { DateInput, YMPicker, WeekPicker, ItemCombo, NumInput, KpiBox, CostLabel, PlLabel, MilUse, Sparkline } from "./ui.jsx";
import { loadCalMode, saveCalMode } from "../lib/storage.js";

const EMPTY_DRAFT = { buys: [], sells: [], cashes: [], spends: [] };

export default function LogTab({ ledger, setLedger, myItems, calc }) {
  const [sub, setSub] = useState("view");
  const [periodMode, setPeriodMode] = useState("w13");
  const [statMonth, setStatMonth] = useState(curMonth());
  const [statWeek, setStatWeek] = useState(() => fmtD(weekStartThu(new Date())));
  const [calMode, setCalModeState] = useState(loadCalMode);
  const [calCursor, setCalCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [entryDate, setEntryDate] = useState(todayStr);

  const env = { fee: calc.f, effD: calc.effD, mileageR: calc.mileageR };
  const setCalMode = (m) => { setCalModeState(m); saveCalMode(m); };

  // ----- 원장 조작 -----
  const patchEntry = (kind, id, patch) =>
    setLedger({ ...ledger, [kind]: ledger[kind].map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const delEntry = (kind, id) => setLedger({ ...ledger, [kind]: ledger[kind].filter((x) => x.id !== id) });
  const addEntryOn = (kind, base) => {
    const d = selectedDate || todayStr();
    setLedger({ ...ledger, [kind]: [...ledger[kind], { id: uid(), date: d, ...base }] });
  };

  // ----- 통계 -----
  const match = useMemo(() => {
    if (periodMode === "all") return () => true;
    if (periodMode === "month") { const m = statMonth || curMonth(); return (dt) => (dt || "").indexOf(m) === 0; }
    if (periodMode === "week") {
      const ws = statWeek;
      const we = fmtD(addDays(new Date(statWeek + "T00:00:00"), 6));
      return (dt) => (dt || "") >= ws && (dt || "") <= we;
    }
    const s = fmtD(start13());
    return (dt) => (dt || "") >= s;
  }, [periodMode, statMonth, statWeek]);
  const st = useMemo(() => ledgerStats(ledger, match, env), [ledger, match, calc]);
  const cum = useMemo(() => cumNow(ledger, calc.mileageR), [ledger, calc.mileageR]);
  const days = useMemo(() => dayInfo(ledger, calc.mileageR), [ledger, calc.mileageR]);
  // today를 deps에 포함해 날짜(주 경계 포함)가 바뀌면 최근 13주/주차 목록이 갱신되게 한다.
  const today = todayStr();
  const mWeeks = useMemo(() => mesoWeeks(ledger, calc.f), [ledger, calc.f, today]);
  const uncashed = st.meso - st.cashMeso;
  // 최근 13주 주간 과금(실적) 시리즈 — 스파크라인용
  const weekly13 = useMemo(
    () => Array.from({ length: 13 }, (_, w) => weeklyAch(ledger, addDays(start13(), w * 7), calc.mileageR)),
    [ledger, calc.mileageR, today]
  );

  // 주차 선택 목록 (MVP 주: 목~수, 최근 26주 최신순)
  const weekOptions = useMemo(() => {
    const base = weekStartThu(new Date());
    const curKey = fmtD(base);
    const arr = [];
    for (let i = 0; i < 26; i++) {
      const ws = addDays(base, -i * 7), we = addDays(ws, 6), key = fmtD(ws);
      arr.push({ key, label: mmdd(ws) + "~" + mmdd(we), cur: key === curKey });
    }
    return arr;
  }, [today]);

  const soldNames = useMemo(() => {
    const names = {};
    ledger.buys.forEach((b) => { if (b.item) names[b.item] = 1; });
    return Object.keys(names);
  }, [ledger.buys]);

  const selWeek = weekOptions.find((w) => w.key === statWeek);
  const periodRange =
    periodMode === "w13" ? mmdd(start13()) + " ~ " + mmdd(new Date()) + " · 최근 13주"
    : periodMode === "month" ? (statMonth || curMonth()) + " 한 달"
    : periodMode === "week" ? (selWeek ? selWeek.label : statWeek) + " · 한 주(목~수)"
    : "전체 기간";

  const mvLabel = (statMonth || curMonth());

  return (
    <div>
      <div className="subtabs">
        <button className={"subtab" + (sub === "view" ? " on" : "")} onClick={() => setSub("view")}>달력 &amp; 통계</button>
        <button className={"subtab" + (sub === "entry" ? " on" : "")} onClick={() => setSub("entry")}>거래 입력</button>
      </div>
      {sub === "view" && (
        <div>
          {/* 통계 */}
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
                <div className="trend-grade">누적 추정 <b>{estGrade(cum)}</b></div>
              </div>
              <Sparkline data={weekly13} />
              <div className="xlab"><span>13주 전</span><span>이번 주</span></div>
            </div>
            <div className="kpi">
              <KpiBox title="13주 누적 과금 → 추정 등급" best hint={<>추정 등급: <b style={{ color: "var(--accent2)" }}>{estGrade(cum)}</b></>}>{won(cum)}</KpiBox>
              <KpiBox title="총 과금(실적, MVP)">{won(st.ach)}</KpiBox>
              <KpiBox title="엠작 구매 실지출"><CostLabel n={st.spend} /></KpiBox>
            </div>
            <div className="kpi">
              <KpiBox title="판매 메소 (실수령)">{eok(st.meso)} <span className="muted u">메소</span></KpiBox>
              <KpiBox title="현금화한 메소">{eok(st.cashMeso)} <span className="muted u">메소</span></KpiBox>
              <KpiBox title="현금화 필요 메소 (판매−현금화)" hint={uncashed < 0 ? <>현금화가 판매보다 {eok(-uncashed)} 많음</> : undefined}>
                {eok(Math.max(0, uncashed))} <span className="muted u">메소</span>
              </KpiBox>
            </div>
            <div className="kpi">
              <KpiBox title="총 마일리지 소모"><MilUse n={st.mil} /></KpiBox>
              <KpiBox title="엠작 손익 (현금화−구매)"><PlLabel p={st.profit} /></KpiBox>
              <KpiBox title="현금화율 (현금화/판매)">{pct(st.ratio * 100)}</KpiBox>
            </div>
            <div className="note">
              구매 {st.buys}건 · 판매 {st.sells}건 · 현금화 {st.cashes}건 · 기타 캐시사용 {st.spends}건({won(st.extra)}).
              실지출은 계산기 평균 충전 할인({pct(calc.effD * 100)}) 반영.
            </div>

            <div className="subhead" style={{ marginTop: 18 }}>주차별 메소 현황 (최근 13주 · 목~수)</div>
            <div className="calwrap">
              <table>
                <thead><tr><th>주 (목~수)</th><th>판매 메소</th><th>현금화 메소</th><th>현금화 필요</th></tr></thead>
                <tbody>
                  {mWeeks.map((w) => {
                    const wk = fmtD(w.ws), isCur = wk === fmtD(weekStartThu(new Date()));
                    const empty = !w.sold && !w.cashed;
                    return (
                      <tr key={wk} className={isCur ? "curwk" : ""}>
                        <td>
                          <button className="linklike" onClick={() => { setPeriodMode("week"); setStatWeek(wk); }}>
                            {mmdd(w.ws)}~{mmdd(w.we)}
                          </button>
                          {isCur && <span className="nowtag" style={{ marginLeft: 6 }}>이번주</span>}
                        </td>
                        <td className="num">{empty ? "–" : eok(w.sold)}</td>
                        <td className="num">{empty ? "–" : eok(w.cashed)}</td>
                        <td className={"num " + (w.need > 0.0001 ? "bad" : "good")}>{empty ? "–" : eok(w.need)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>주차를 누르면 위 통계가 그 주 기준으로 바뀝니다. '현금화 필요'는 판매 실수령 메소에서 현금화한 메소를 뺀 값이에요.</div>
          </div>

          {/* 달력 */}
          <div className="card">
            <h2><span className="n">📅</span>달력</h2>
            <p className="desc">월력(실제 달력)과 MVP 주간(목~수, 누적 창) 두 모드. 과금 있는 날은 금액 칩으로, 오늘은 원형으로 강조됩니다. 날짜를 누르면 그 날 내역을 아래에서 보고 편집할 수 있어요.</p>
            <div className="calbar">
              <div className="calmodes">
                <button className={"calmode" + (calMode === "month" ? " on" : "")} onClick={() => setCalMode("month")}>월력</button>
                <button className={"calmode" + (calMode === "mvp" ? " on" : "")} onClick={() => setCalMode("mvp")}>MVP 주간 (목~수)</button>
              </div>
              {calMode === "month" && (
                <div className="calnav">
                  <button className="navbtn" onClick={() => setCalCursor(new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1))}>‹</button>
                  <span id="calTitle">{calCursor.getFullYear()}년 {calCursor.getMonth() + 1}월</span>
                  <button className="navbtn" onClick={() => setCalCursor(new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1))}>›</button>
                  <button className="btn ghost sm" onClick={() => setCalCursor(new Date())}>오늘</button>
                </div>
              )}
            </div>
            {calMode === "month" ? (
              <MonthCal cursor={calCursor} days={days} selectedDate={selectedDate} onSelect={setSelectedDate} />
            ) : (
              <MvpCal ledger={ledger} days={days} mileageR={calc.mileageR} selectedDate={selectedDate} onSelect={setSelectedDate} />
            )}
            <div className="legend">
              <span><i className="sw" style={{ background: "var(--accent2)" }}></i>오늘</span>
              <span><i className="sw" style={{ background: "var(--accent)" }}></i>과금 있는 날</span>
              <span><i className="sw" style={{ background: "var(--accent-weak)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}></i>선택</span>
              <span style={{ color: "var(--accent2)" }}>■ 이번 주 하이라이트</span>
            </div>
            {selectedDate && (
              <DayDetail
                date={selectedDate} ledger={ledger} env={env}
                myItems={myItems} soldNames={soldNames}
                patchEntry={patchEntry} delEntry={delEntry} addEntryOn={addEntryOn}
              />
            )}
          </div>
        </div>
      )}

      {sub === "entry" && (
        <EntryForm
          draft={draft} setDraft={setDraft} entryDate={entryDate} setEntryDate={setEntryDate}
          myItems={myItems} soldNames={soldNames}
          onCommit={(n, date) => {
            setSelectedDate(date);
            setSub("view");
            alert(date + "에 " + n + "건 저장되었습니다.");
          }}
          ledger={ledger} setLedger={setLedger}
        />
      )}
    </div>
  );
}

// ===== 월력 =====
function MonthCal({ cursor, days, selectedDate, onSelect }) {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const gs = addDays(first, -first.getDay());
  const tdy = todayStr();
  const tws = fmtD(weekStartSun(new Date()));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const cd = addDays(gs, i);
    const k = fmtD(cd), dow = cd.getDay(), info = days[k];
    let cls = "mcell";
    cls += cd.getMonth() !== m ? " other" : " inmonth";
    if (dow === 0) cls += " sun";
    if (dow === 6) cls += " sat";
    if (k === tdy) cls += " today";
    if (k === selectedDate) cls += " sel";
    if (fmtD(weekStartSun(cd)) === tws) cls += " curweek";
    cells.push(
      <div key={k} className={cls} onClick={() => onSelect(k)}>
        <div className="mc-dn">{cd.getDate()}</div>
        {info && (info.ach > 0 ? <div className="evt">₩{manW(info.ach)}</div> : <div className="dotrow"><i></i></div>)}
      </div>
    );
  }
  return (
    <div className="monthcal">
      <div className="mc-head">
        {WD_SUN.map((w, i) => <div key={w} className={i === 0 ? "sun" : i === 6 ? "sat" : ""}>{w}</div>)}
      </div>
      <div className="mc-body">{cells}</div>
    </div>
  );
}

// ===== MVP 주간 (13주, 목~수) =====
function MvpCal({ ledger, days, mileageR, selectedDate, onSelect }) {
  const s = start13();
  const cur = fmtD(weekStartThu(new Date()));
  const tdy = todayStr();
  const rows = [];
  for (let w = 0; w < 13; w++) {
    const ws = addDays(s, w * 7), we = addDays(ws, 6);
    const isCur = fmtD(ws) === cur;
    const wt = weeklyAch(ledger, ws, mileageR);
    const tds = [];
    for (let dd = 0; dd < 7; dd++) {
      const cd = addDays(ws, dd), k = fmtD(cd), info = days[k];
      let cls = "day";
      if (info) cls += " has";
      if (k === tdy) cls += " today";
      if (k === selectedDate) cls += " sel";
      tds.push(
        <td key={k}>
          <div className={cls} onClick={() => onSelect(k)}>
            <span className="dn">{cd.getDate()}</span>
            {info && (info.ach > 0 ? <span className="amt">₩{manW(info.ach)}</span> : <span className="amt">{info.n}건</span>)}
          </div>
        </td>
      );
    }
    rows.push(
      <tr key={w} className={isCur ? "curwk" : ""}>
        <td className="wklabel"><b>{mmdd(ws)}~{mmdd(we)}</b>{isCur && <> <span className="nowtag">이번주</span></>}</td>
        {tds}
        <td className="wktot">{wt > 0 ? won(wt) : "–"}</td>
      </tr>
    );
  }
  return (
    <div className="calwrap">
      <table className="cal">
        <thead>
          <tr><th className="wkh">주 (목~수)</th>{WD_MVP.map((w) => <th key={w}>{w}</th>)}<th className="toth">주 과금</th></tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

// 상세 섹션 래퍼 — DayDetail 밖(모듈 스코프)에 두어 리렌더 시 입력 포커스가 유지되도록 한다.
function Sec({ label, n, children }) {
  return (
    <>
      <div className="ddsec">{label}{n > 0 && <span className="muted" style={{ fontWeight: 400 }}> · {n}건</span>}</div>
      {n > 0 ? children : <div className="ddnone">내역 없음</div>}
    </>
  );
}

// ===== 선택 날짜 상세 (편집) =====
function DayDetail({ date, ledger, env, myItems, soldNames, patchEntry, delEntry, addEntryOn }) {
  const buys = ledger.buys.filter((x) => x.date === date);
  const sells = ledger.sells.filter((x) => x.date === date);
  const cashes = ledger.cashes.filter((x) => x.date === date);
  const spends = ledger.spends.filter((x) => x.date === date);
  const cnt = buys.length + sells.length + cashes.length + spends.length;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="subhead">
        {date} 내역 {cnt ? `(${cnt}건)` : <span className="muted" style={{ fontWeight: 400 }}>· 기록 없음, 아래 버튼으로 추가</span>}
      </div>
      <Sec label="🛒 구매" n={buys.length}>
        <div className="tblx"><table>
          <thead><tr><th>날짜</th><th>아이템</th><th>수량</th><th>개당 캐시가</th><th className="milh">마일</th><th>실적</th><th></th></tr></thead>
          <tbody>
            {buys.map((b) => {
              const ach = (+b.qty || 0) * (+b.price || 0) * (1 - (b.mil ? env.mileageR : 0));
              return (
                <tr key={b.id}>
                  <td><DateInput value={b.date} width={140} onChange={(v) => patchEntry("buys", b.id, { date: v })} /></td>
                  <td><ItemCombo value={b.item || ""} width={120} options={myItems} onChange={(v) => patchEntry("buys", b.id, { item: v })} /></td>
                  <td><NumInput noStepper width={54} value={b.qty != null ? b.qty : 1} onChange={(v) => patchEntry("buys", b.id, { qty: v })} /></td>
                  <td><NumInput noStepper width={88} value={b.price != null ? b.price : ""} onChange={(v) => patchEntry("buys", b.id, { price: v })} /></td>
                  <td className="mil-cell"><input type="checkbox" checked={!!b.mil} onChange={(e) => patchEntry("buys", b.id, { mil: e.target.checked })} /></td>
                  <td className="num">{won(ach)}</td>
                  <td><button className="del" onClick={() => delEntry("buys", b.id)}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Sec>
      <Sec label="💰 판매" n={sells.length}>
        <div className="tblx"><table>
          <thead><tr><th>날짜</th><th>아이템</th><th>수량</th><th>개당 판매가(억)</th><th>실수령 메소</th><th></th></tr></thead>
          <tbody>
            {sells.map((sl) => (
              <tr key={sl.id}>
                <td><DateInput value={sl.date} width={140} onChange={(v) => patchEntry("sells", sl.id, { date: v })} /></td>
                <td><ItemCombo value={sl.item || ""} width={120} options={soldNames} onChange={(v) => patchEntry("sells", sl.id, { item: v })} /></td>
                <td><NumInput noStepper width={54} value={sl.qty != null ? sl.qty : 1} onChange={(v) => patchEntry("sells", sl.id, { qty: v })} /></td>
                <td><NumInput noStepper width={88} step={0.01} value={sl.meso != null ? sl.meso : ""} onChange={(v) => patchEntry("sells", sl.id, { meso: v })} /></td>
                <td className="num">{eok((+sl.qty || 0) * (+sl.meso || 0) * (1 - env.fee))}</td>
                <td><button className="del" onClick={() => delEntry("sells", sl.id)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Sec>
      <Sec label="🏦 현금화" n={cashes.length}>
        <div className="tblx"><table>
          <thead><tr><th>날짜</th><th>메소(억)</th><th>억당(원)</th><th>판매 현금(자동)</th><th></th></tr></thead>
          <tbody>
            {cashes.map((cc) => (
              <tr key={cc.id}>
                <td><DateInput value={cc.date} width={140} onChange={(v) => patchEntry("cashes", cc.id, { date: v })} /></td>
                <td><NumInput noStepper width={88} step={0.01} value={cc.meso != null ? cc.meso : ""} onChange={(v) => patchEntry("cashes", cc.id, { meso: v })} /></td>
                <td><NumInput noStepper width={110} step={1000} value={cc.rate != null ? cc.rate : ""} onChange={(v) => patchEntry("cashes", cc.id, { rate: v })} /></td>
                <td className="num">{cc.meso && cc.rate ? won(cashWonOf(cc)) : "–"}</td>
                <td><button className="del" onClick={() => delEntry("cashes", cc.id)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Sec>
      <Sec label="💳 기타 캐시 사용" n={spends.length}>
        <div className="tblx"><table>
          <thead><tr><th>날짜</th><th>사용액</th><th>메모</th><th></th></tr></thead>
          <tbody>
            {spends.map((sp) => (
              <tr key={sp.id}>
                <td><DateInput value={sp.date} width={140} onChange={(v) => patchEntry("spends", sp.id, { date: v })} /></td>
                <td><NumInput noStepper width={110} step={1000} value={sp.amount != null ? sp.amount : ""} onChange={(v) => patchEntry("spends", sp.id, { amount: v })} /></td>
                <td><input value={sp.memo || ""} style={{ width: 120 }} onChange={(e) => patchEntry("spends", sp.id, { memo: e.target.value })} /></td>
                <td><button className="del" onClick={() => delEntry("spends", sp.id)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Sec>
      <div className="row-actions">
        <button className="btn sm" onClick={() => addEntryOn("buys", { item: "", qty: 1, price: "", mil: false })}>+ 구매</button>
        <button className="btn sm" onClick={() => addEntryOn("sells", { item: "", qty: 1, meso: "" })}>+ 판매</button>
        <button className="btn sm" onClick={() => addEntryOn("cashes", { meso: "", rate: "" })}>+ 현금화</button>
        <button className="btn sm" onClick={() => addEntryOn("spends", { amount: "", memo: "" })}>+ 캐시사용</button>
      </div>
    </div>
  );
}

// ===== 거래 입력 (드래프트) =====
function EntryForm({ draft, setDraft, entryDate, setEntryDate, myItems, soldNames, onCommit, ledger, setLedger }) {
  const upd = (kind, i, patch) =>
    setDraft({ ...draft, [kind]: draft[kind].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const del = (kind, i) => setDraft({ ...draft, [kind]: draft[kind].filter((_, j) => j !== i) });
  const add = (kind, base) => setDraft({ ...draft, [kind]: [...draft[kind], { ...base, _k: uid() }] });

  const commit = () => {
    const date = entryDate || todayStr();
    let n = 0;
    const next = { ...ledger };
    const buys = draft.buys.filter((x) => x.item || x.price);
    const sells = draft.sells.filter((x) => x.item || x.meso);
    const cashes = draft.cashes.filter((x) => x.meso || x.rate);
    const spends = draft.spends.filter((x) => x.amount);
    n = buys.length + sells.length + cashes.length + spends.length;
    if (n === 0) { alert("입력된 항목이 없습니다."); return; }
    next.buys = [...ledger.buys, ...buys.map((x) => ({ id: uid(), date, item: x.item, qty: x.qty, price: x.price, mil: x.mil }))];
    next.sells = [...ledger.sells, ...sells.map((x) => ({ id: uid(), date, item: x.item, qty: x.qty, meso: x.meso }))];
    next.cashes = [...ledger.cashes, ...cashes.map((x) => ({ id: uid(), date, meso: x.meso, rate: x.rate }))];
    next.spends = [...ledger.spends, ...spends.map((x) => ({ id: uid(), date, amount: x.amount, memo: x.memo }))];
    setLedger(next);
    setDraft(EMPTY_DRAFT);
    onCommit(n, date);
  };

  return (
    <div className="card">
      <h2><span className="n">✎</span>새 거래 입력</h2>
      <p className="desc">한 날짜의 거래를 입력하고 저장하면 달력의 해당 날짜에 기록됩니다. 저장 후 수정·삭제는 '달력 &amp; 통계'에서 날짜를 눌러서 하세요.</p>
      <label style={{ maxWidth: 220 }}>날짜</label>
      <DateInput value={entryDate} width={220} onChange={setEntryDate} />

      <div className="draftblock" style={{ marginTop: 12 }}>
        <div className="bt">🛒 구매 (아이템 → 캐시 사용)</div>
        <div className="tblx"><table>
          <thead><tr><th>아이템</th><th>수량</th><th>개당 캐시가(원)</th><th className="milh">마일</th><th></th></tr></thead>
          <tbody>
            {draft.buys.map((x, i) => (
              <tr key={x._k}>
                <td><ItemCombo value={x.item || ""} options={myItems} onChange={(name) => {
                  const mi = myItems.find((m) => m.name === name);
                  upd("buys", i, mi && !x.price ? { item: name, price: +mi.cash } : { item: name });
                }} /></td>
                <td><NumInput noStepper width={54} value={x.qty != null ? x.qty : 1} onChange={(v) => upd("buys", i, { qty: v })} /></td>
                <td><NumInput noStepper width={88} value={x.price != null ? x.price : ""} onChange={(v) => upd("buys", i, { price: v })} /></td>
                <td className="mil-cell"><input type="checkbox" checked={!!x.mil} onChange={(e) => upd("buys", i, { mil: e.target.checked })} /></td>
                <td><button className="del" onClick={() => del("buys", i)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="row-actions"><button className="btn sm" onClick={() => add("buys", { item: "", qty: 1, price: "", mil: false })}>+ 구매 항목</button></div>
      </div>

      <div className="draftblock">
        <div className="bt">💰 판매 (경매장 → 메소)</div>
        <div className="tblx"><table>
          <thead><tr><th>아이템</th><th>수량</th><th>개당 판매가(억)</th><th></th></tr></thead>
          <tbody>
            {draft.sells.map((x, i) => (
              <tr key={x._k}>
                <td><ItemCombo value={x.item || ""} options={soldNames} onChange={(v) => upd("sells", i, { item: v })} /></td>
                <td><NumInput noStepper width={54} value={x.qty != null ? x.qty : 1} onChange={(v) => upd("sells", i, { qty: v })} /></td>
                <td><NumInput noStepper width={88} step={0.01} value={x.meso != null ? x.meso : ""} onChange={(v) => upd("sells", i, { meso: v })} /></td>
                <td><button className="del" onClick={() => del("sells", i)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="row-actions"><button className="btn sm" onClick={() => add("sells", { item: "", qty: 1, meso: "" })}>+ 판매 항목</button></div>
      </div>

      <div className="draftblock">
        <div className="bt">🏦 현금화 (메소 → 현금)</div>
        <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 8 }}>
          현금화한 메소(억)와 억당 판매 비율(원/억)을 입력하면 판매 현금이 자동 계산됩니다.
        </div>
        <div className="tblx"><table>
          <thead><tr><th>메소(억)</th><th>억당(원)</th><th>판매 현금(자동)</th><th></th></tr></thead>
          <tbody>
            {draft.cashes.map((x, i) => (
              <tr key={x._k}>
                <td><NumInput noStepper width={88} step={0.01} value={x.meso != null ? x.meso : ""} onChange={(v) => upd("cashes", i, { meso: v })} /></td>
                <td><NumInput noStepper width={110} step={1000} value={x.rate != null ? x.rate : ""} onChange={(v) => upd("cashes", i, { rate: v })} /></td>
                <td className="num">{x.meso && x.rate ? won(cashWonOf(x)) : "–"}</td>
                <td><button className="del" onClick={() => del("cashes", i)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="row-actions"><button className="btn sm" onClick={() => add("cashes", { meso: "", rate: "" })}>+ 현금화 항목</button></div>
      </div>

      <div className="draftblock">
        <div className="bt">💳 기타 캐시 사용 (엠작 외 · MVP 과금에 포함)</div>
        <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 8 }}>
          충전은 많이 했어도 엠작 외 다른 데 쓴 넥슨캐시. 사용액이 MVP 과금(실적)에 잡히므로 여기에 기입하면 주차별 과금이 정확해집니다.
        </div>
        <div className="tblx"><table>
          <thead><tr><th>사용액(원)</th><th>메모</th><th></th></tr></thead>
          <tbody>
            {draft.spends.map((x, i) => (
              <tr key={x._k}>
                <td><NumInput noStepper width={110} step={1000} value={x.amount != null ? x.amount : ""} onChange={(v) => upd("spends", i, { amount: v })} /></td>
                <td><input value={x.memo || ""} onChange={(e) => upd("spends", i, { memo: e.target.value })} /></td>
                <td><button className="del" onClick={() => del("spends", i)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="row-actions"><button className="btn sm" onClick={() => add("spends", { amount: "", memo: "" })}>+ 캐시 사용</button></div>
      </div>

      <div className="row-actions" style={{ marginTop: 16 }}>
        <button className="btn big" onClick={commit}>이 날짜로 저장</button>
        <button className="btn ghost" onClick={() => setDraft(EMPTY_DRAFT)}>입력 초기화</button>
      </div>
    </div>
  );
}
