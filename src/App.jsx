import { useState, useMemo, useEffect, useRef } from "react";
import { computeCalc } from "./lib/calc.js";
import {
  loadCalcState, saveCalcState, loadMyItems, saveMyItems,
  loadLedger, saveLedger, exportAll, importAll,
  parseCalcState, serializeCalcState, normalizeLedger, normalizeMyItems, localSnapshot,
} from "./lib/storage.js";
import { cloudEnabled, onAuthChange, fetchUserData, upsertUserData, mergeSnapshots } from "./lib/cloud.js";
import CalcTab from "./components/CalcTab.jsx";
import LogTab from "./components/LogTab.jsx";
import ForecastTab from "./components/ForecastTab.jsx";
import AuthBar from "./components/AuthBar.jsx";

const TABS = [
  { id: "calc", label: "계산기" },
  { id: "log", label: "거래 기록" },
  { id: "fore", label: "예상 & 추천" },
];

export default function App() {
  const [tab, setTab] = useState("calc");
  const [{ settings, charges, items }, setCalcState] = useState(loadCalcState);
  const [myItems, setMyItems] = useState(loadMyItems);
  const [ledger, setLedger] = useState(loadLedger);
  const fileRef = useRef(null);

  // 클라우드 동기화 상태
  const [session, setSession] = useState(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncState, setSyncState] = useState("idle"); // idle|syncing|saved|error
  const upsertTimer = useRef(null);

  // 파생 계산 (기존 render()의 순수 버전)
  const calc = useMemo(() => computeCalc(settings, charges, items), [settings, charges, items]);

  // 로컬 자동 저장 (게스트/로그인 공통 캐시)
  useEffect(() => saveCalcState(settings, charges, items), [settings, charges, items]);
  useEffect(() => saveMyItems(myItems), [myItems]);
  useEffect(() => saveLedger(ledger), [ledger]);

  const setSettings = (patch) => setCalcState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const setCharges = (charges) => setCalcState((s) => ({ ...s, charges }));
  const setItems = (items) => setCalcState((s) => ({ ...s, items }));

  // 세션 구독
  useEffect(() => onAuthChange(setSession), []);

  // 최초 로그인 동기화: 클라우드 fetch → 로컬과 병합 → 상태 반영 (업로드는 아래 upsert 이펙트가 담당)
  useEffect(() => {
    if (!session) { setCloudReady(false); return; }
    let cancelled = false;
    (async () => {
      try {
        setSyncState("syncing");
        const cloud = await fetchUserData(session.user.id);
        if (cancelled) return;
        const merged = mergeSnapshots(localSnapshot(), cloud);
        const c = parseCalcState(merged.calc);
        setCalcState({ settings: c.settings, charges: c.charges, items: c.items });
        setMyItems(normalizeMyItems(merged.my_items));
        setLedger(normalizeLedger(merged.ledger));
        setCloudReady(true); // 이후 데이터 변경분은 클라우드로 업로드
      } catch (e) {
        console.error("[cloud] 초기 동기화 실패", e);
        setSyncState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  // 데이터 변경 → 디바운스 upsert (로그인 & 초기 동기화 완료 후에만). 최초 1회는 병합본 업로드(=이관).
  useEffect(() => {
    if (!session || !cloudReady) return;
    clearTimeout(upsertTimer.current);
    setSyncState("syncing");
    upsertTimer.current = setTimeout(async () => {
      try {
        await upsertUserData(session.user.id, {
          calc: serializeCalcState(settings, charges, items),
          my_items: myItems,
          ledger,
        });
        setSyncState("saved");
      } catch (e) {
        console.error("[cloud] 저장 실패", e);
        setSyncState("error");
      }
    }, 800);
    return () => clearTimeout(upsertTimer.current);
  }, [settings, charges, items, myItems, ledger, session, cloudReady]);

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
          myItems={myItems} setMyItems={setMyItems}
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
    </div>
  );
}
