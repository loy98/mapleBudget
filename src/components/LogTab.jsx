import { useState } from "react";
import { TIERS } from "../lib/constants.js";
import { fmtD, todayStr, curMonth, weekStartThu, uid } from "../lib/util.js";
import { loadCalMode, saveCalMode } from "../lib/storage.js";
import { useLedgerDerived } from "./logtab/useLedgerDerived.js";
import StatsPanel from "./logtab/StatsPanel.jsx";
import CalendarPanel from "./logtab/CalendarPanel.jsx";
import EntryForm, { EMPTY_DRAFT } from "./logtab/EntryForm.jsx";

// 테스트·외부에서 쓰는 표 컴포넌트는 여기서 재수출(분할 전 import 경로 유지).
export { ItemSubRow, ItemSummary } from "./logtab/ItemTables.jsx";

// 거래 기록 탭 — 뷰 상태를 소유하고 세 패널(통계·달력·입력)에 나눠준다.
// 파생값 계산은 useLedgerDerived, 그리기는 각 패널이 맡는다.
export default function LogTab({ ledger, setLedger, myItems, calc, tiers = TIERS }) {
  const [sub, setSub] = useState("view");
  const [periodMode, setPeriodMode] = useState("w13");
  const [chartMode, setChartMode] = useState("line"); // 추세 차트: line | bars
  const [statMonth, setStatMonth] = useState(curMonth());
  const [statWeek, setStatWeek] = useState(() => fmtD(weekStartThu(new Date())));
  const [calMode, setCalModeState] = useState(loadCalMode);
  const [calCursor, setCalCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [entryDate, setEntryDate] = useState(todayStr);
  const [openWeeks, setOpenWeeks] = useState({}); // 주차별 품목 내역 펼침 상태 (키: 주 시작일)
  const [showItemSum, setShowItemSum] = useState(false);

  const toggleWeek = (wk) => setOpenWeeks((o) => ({ ...o, [wk]: !o[wk] }));
  const setCalMode = (m) => { setCalModeState(m); saveCalMode(m); };

  // ----- 원장 조작 -----
  const patchEntry = (kind, id, patch) =>
    setLedger({ ...ledger, [kind]: ledger[kind].map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const delEntry = (kind, id) => setLedger({ ...ledger, [kind]: ledger[kind].filter((x) => x.id !== id) });
  const addEntryOn = (kind, base) => {
    const d = selectedDate || todayStr();
    setLedger({ ...ledger, [kind]: [...ledger[kind], { id: uid(), date: d, ...base }] });
  };

  const d = useLedgerDerived({ ledger, calc, myItems, periodMode, statMonth, statWeek });

  return (
    <div>
      <div className="subtabs">
        <button className={"subtab" + (sub === "view" ? " on" : "")} onClick={() => setSub("view")}>달력 &amp; 통계</button>
        <button className={"subtab" + (sub === "entry" ? " on" : "")} onClick={() => setSub("entry")}>거래 입력</button>
      </div>
      {sub === "view" && (
        <div>
          <StatsPanel
            d={d} calc={calc} tiers={tiers}
            periodMode={periodMode} setPeriodMode={setPeriodMode}
            statMonth={statMonth} setStatMonth={setStatMonth}
            statWeek={statWeek} setStatWeek={setStatWeek}
            setCalCursor={setCalCursor} setCalMode={setCalMode}
            chartMode={chartMode} setChartMode={setChartMode}
            showItemSum={showItemSum} setShowItemSum={setShowItemSum}
            openWeeks={openWeeks} toggleWeek={toggleWeek}
          />
          <CalendarPanel
            ledger={ledger} calc={calc} myItems={myItems} d={d}
            calMode={calMode} setCalMode={setCalMode}
            calCursor={calCursor} setCalCursor={setCalCursor}
            selectedDate={selectedDate} setSelectedDate={setSelectedDate}
            patchEntry={patchEntry} delEntry={delEntry} addEntryOn={addEntryOn}
          />
        </div>
      )}

      {sub === "entry" && (
        <EntryForm
          draft={draft} setDraft={setDraft} entryDate={entryDate} setEntryDate={setEntryDate}
          myItems={myItems} soldNames={d.soldNames}
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
