import { WD_MVP, WD_SUN } from "../../lib/constants.js";
import { won, eok, mmdd, fmtD, todayStr, addDays, start13, weekStartThu, weekStartSun, manW, nowD } from "../../lib/util.js";
import { weeklyAch, cashWonOf } from "../../lib/ledger.js";
import { DateInput, ItemCombo, NumInput } from "../ui.jsx";

// ===== 월력 =====
function MonthCal({ cursor, days, selectedDate, onSelect }) {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const gs = addDays(first, -first.getDay());
  const tdy = todayStr();
  const tws = fmtD(weekStartSun(nowD()));
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
  const cur = fmtD(weekStartThu(nowD()));
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
              const ach = (+b.qty || 0) * (+b.price || 0) * (1 - (b.mil ? env.mileageR(b) : 0));
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
                <td className="num">{eok((+sl.qty || 0) * (+sl.meso || 0) * (1 - env.fee(sl)))}</td>
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

// 달력 카드 — 월력/MVP주간 전환, 선택 날짜 상세 편집.
export default function CalendarPanel({
  ledger, calc, myItems, d,
  calMode, setCalMode, calCursor, setCalCursor,
  selectedDate, setSelectedDate,
  patchEntry, delEntry, addEntryOn,
}) {
  const { days, env, soldNames } = d;
  return (
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
            <button className="btn ghost sm" onClick={() => setCalCursor(nowD())}>오늘</button>
          </div>
        )}
      </div>
      {calMode === "month" ? (
        <MonthCal cursor={calCursor} days={days} selectedDate={selectedDate} onSelect={setSelectedDate} />
      ) : (
        <MvpCal ledger={ledger} days={days} mileageR={env.mileageR} selectedDate={selectedDate} onSelect={setSelectedDate} />
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
  );
}
