import { useState, useMemo, useEffect, useRef } from "react";
import { computeCalc } from "./lib/calc.js";
import {
  loadCalcState, saveCalcState, loadMyItems, saveMyItems,
  loadLedger, saveLedger, exportAll, importAll, withRowKeys, markUserTouched,
} from "./lib/storage.js";
import { cloudEnabled } from "./lib/cloud.js";
import { useCloudSync } from "./lib/useCloudSync.js";
import CalcTab from "./components/CalcTab.jsx";
import LogTab from "./components/LogTab.jsx";
import ForecastTab from "./components/ForecastTab.jsx";
import AuthBar from "./components/AuthBar.jsx";

const TABS = [
  { id: "calc", label: "계산기" },
  { id: "log", label: "거래 기록" },
  { id: "fore", label: "예상 & 추천" },
];

// 최초 로그인 병합 충돌 선택 모달(네이티브 confirm 대체 — 앱 테마·테스트 가능). 모듈 스코프(리마운트 방지).
function ConflictModal({ onChoose }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-title">클라우드에 저장된 설정이 있어요</div>
        <p className="modal-body">
          이 기기의 설정/자주 쓰는 아이템과 클라우드에 저장된 것이 서로 달라요. 어느 쪽을 쓸까요?
          <br /><span className="muted">※ 거래 기록은 어느 쪽을 고르든 모두 합쳐집니다.</span>
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={() => onChoose(true)}>클라우드 설정 사용</button>
          <button className="btn ghost" onClick={() => onChoose(false)}>이 기기 설정 사용</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("calc");
  const [{ settings, charges, items }, setCalcState] = useState(loadCalcState);
  const [myItems, setMyItems] = useState(loadMyItems);
  const [ledger, setLedger] = useState(loadLedger);
  const fileRef = useRef(null);

  // 파생 계산 (기존 render()의 순수 버전)
  const calc = useMemo(() => computeCalc(settings, charges, items), [settings, charges, items]);

  // 로컬 자동 저장 (게스트/로그인 공통 캐시)
  useEffect(() => saveCalcState(settings, charges, items), [settings, charges, items]);
  useEffect(() => saveMyItems(myItems), [myItems]);
  useEffect(() => saveLedger(ledger), [ledger]);

  // 사용자 직접 편집용 setter. withRowKeys로 안정 key를 부여하고, markUserTouched로 '사용자가 손댔음'을 기록
  // → 최초 로그인 병합에서 거래 없이 설정/아이템만 바꾼 게스트의 데이터도 보호(P1-4). config/sync 프로그램적
  //   변경은 훅이 setCalcState/setMyItems를 직접 호출하므로 여기 표시가 붙지 않는다.
  const setSettings = (patch) => { markUserTouched(); setCalcState((s) => ({ ...s, settings: { ...s.settings, ...patch } })); };
  const setCharges = (charges) => { markUserTouched(); setCalcState((s) => ({ ...s, charges: withRowKeys(charges) })); };
  const setItems = (items) => { markUserTouched(); setCalcState((s) => ({ ...s, items: withRowKeys(items) })); };
  const applyMyItems = (arr) => { markUserTouched(); setMyItems(withRowKeys(arr)); };

  // 세션·app_config·클라우드 동기화·업로드는 useCloudSync 훅이 담당(App은 계산기 상태·렌더만 소유).
  const { session, syncState, chargeOptions, conflictPrompt } = useCloudSync({
    settings, charges, items, myItems, ledger,
    setCalcState, setMyItems, setLedger,
  });

  const onImportFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const r = importAll(reader.result);
      if (r.ok) {
        alert("복원 완료! 페이지를 새로고침합니다.");
        location.reload();
      } else {
        alert(r.error);
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  return (
    <div className="wrap">
      <header>
        <span className="logo">M</span>
        <h1>메이플 MVP작 효율 계산기</h1>
        <span className="sub">엠작 최적화 · 계산기 + 거래 기록/13주 달력</span>
        <AuthBar session={session} syncState={syncState} />
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "calc" && (
        <CalcTab
          settings={settings} setSettings={setSettings}
          charges={charges} setCharges={setCharges}
          items={items} setItems={setItems}
          myItems={myItems} setMyItems={applyMyItems}
          chargeMethods={chargeOptions}
          calc={calc}
        />
      )}
      {tab === "log" && (
        <LogTab ledger={ledger} setLedger={setLedger} myItems={myItems} calc={calc} />
      )}
      {tab === "fore" && <ForecastTab ledger={ledger} calc={calc} />}

      <footer className="site">
        <div className="backupbar" style={{ justifyContent: "center" }}>
          <button className="btn ghost sm" onClick={exportAll}>데이터 내보내기 (백업)</button>
          <button className="btn ghost sm" onClick={() => fileRef.current.click()}>데이터 가져오기 (복원)</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={onImportFile} />
        </div>
        <p>
          {cloudEnabled
            ? "로그인하면 기기 간 자동 동기화됩니다. 로그인 없이는 이 브라우저(localStorage)에만 저장됩니다."
            : "모든 데이터는 이 브라우저(localStorage)에만 저장됩니다. 기기 변경 시 내보내기/가져오기를 사용하세요."}
        </p>
      </footer>

      {conflictPrompt && <ConflictModal onChoose={conflictPrompt.onChoose} />}
    </div>
  );
}
