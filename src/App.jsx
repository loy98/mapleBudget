import { useState, useMemo, useEffect, useRef } from "react";
import { computeCalc } from "./lib/calc.js";
import {
  loadCalcState, saveCalcState, loadMyItems, saveMyItems,
  loadLedger, saveLedger, exportAll, importAll,
  parseCalcState, serializeCalcState, normalizeLedger, normalizeMyItems, localSnapshot,
  isCloudSynced, markCloudSynced,
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
  const upsertingRef = useRef(false); // 업로드 진행 중 플래그(중복/역전 저장 방지)
  const dirtyRef = useRef(false);     // 업로드 중 추가 변경 발생 여부
  const dataRef = useRef(null);       // 항상 최신 스냅샷(업로드 payload)
  const pendingCloudSyncMarkRef = useRef(null); // 첫 로그인 시 "첫 업로드 성공 후 마킹 예정" userId 보관
  const liveUserIdRef = useRef(null); // 현재 로그인된 userId(매 렌더 갱신) — 계정 전환 중 교차 업로드 차단용

  // 파생 계산 (기존 render()의 순수 버전)
  const calc = useMemo(() => computeCalc(settings, charges, items), [settings, charges, items]);

  // 로컬 자동 저장 (게스트/로그인 공통 캐시)
  useEffect(() => saveCalcState(settings, charges, items), [settings, charges, items]);
  useEffect(() => saveMyItems(myItems), [myItems]);
  useEffect(() => saveLedger(ledger), [ledger]);

  const setSettings = (patch) => setCalcState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const setCharges = (charges) => setCalcState((s) => ({ ...s, charges }));
  const setItems = (items) => setCalcState((s) => ({ ...s, items }));

  // 세션 객체 대신 userId(원시값)로 이펙트를 키잉 → 토큰 갱신/중복 이벤트로 재실행되지 않음.
  const userId = session?.user?.id ?? null;
  // 최신 스냅샷을 매 렌더 갱신 → 디바운스 업로드가 항상 최신값을 쓴다.
  dataRef.current = { calc: serializeCalcState(settings, charges, items), my_items: myItems, ledger };
  liveUserIdRef.current = userId; // 업로드 직전 캡처된 userId와 대조 → 계정 전환 시 옛 계정 행에 쓰지 않음

  // 세션 구독
  useEffect(() => onAuthChange(setSession), []);

  // 최초 로그인 동기화: 클라우드 fetch → 로컬과 병합 → 상태 반영 (업로드는 아래 upsert 이펙트가 담당).
  // userId를 deps로 두어 로그인 1회만 실행(토큰 갱신·중복 인증 이벤트로 재실행/취소 레이스 없음).
  useEffect(() => {
    if (!userId) {
      pendingCloudSyncMarkRef.current = null;
      setCloudReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setSyncState("syncing");
        const cloud = await fetchUserData(userId);
        if (cancelled) return;
        // 이 기기가 이 계정과 이미 동기화됐으면(=새로고침/세션 복원) 프롬프트 없이 조용히 병합.
        // 최초 로그인일 때만 게스트↔클라우드 설정 선택을 묻는다.
        const firstLogin = !isCloudSynced(userId);
        pendingCloudSyncMarkRef.current = firstLogin ? userId : null;
        const local = localSnapshot();
        const { snapshot, conflict } = mergeSnapshots(local, cloud);
        let finalSnap = snapshot;
        if (conflict && firstLogin) {
          // 이 기기 게스트 데이터와 클라우드 설정이 모두 있음 → 어느 설정을 쓸지 선택(거래는 이미 합쳐짐).
          const useCloud = window.confirm(
            "클라우드에 저장된 설정/자주 쓰는 아이템이 있습니다.\n\n" +
            "확인 = 클라우드 설정 사용 (이 기기 설정은 덮어씀)\n" +
            "취소 = 이 기기 설정을 클라우드에 올림\n\n" +
            "※ 거래 기록은 어느 쪽을 고르든 모두 합쳐집니다."
          );
          if (!useCloud) finalSnap = { ...snapshot, calc: local.calc, my_items: local.my_items };
        }
        if (cancelled) return;
        const c = parseCalcState(finalSnap.calc);
        setCalcState({ settings: c.settings, charges: c.charges, items: c.items });
        setMyItems(normalizeMyItems(finalSnap.my_items));
        setLedger(normalizeLedger(finalSnap.ledger));
        setCloudReady(true); // 이후 데이터 변경분은 클라우드로 업로드
      } catch (e) {
        console.error("[cloud] 초기 동기화 실패", e);
        if (!cancelled) setSyncState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // 데이터 변경 → 디바운스 후 직렬화 upsert. 업로드 중 변경이 오면(dirty) 끝나고 최신값으로 한 번 더 저장.
  // 항상 dataRef.current(최신)를 쓰고 in-flight를 하나로 제한 → 느린 옛 저장이 새 저장을 덮어쓰지 않음.
  useEffect(() => {
    if (!userId || !cloudReady) return;
    clearTimeout(upsertTimer.current);
    upsertTimer.current = setTimeout(async () => {
      if (upsertingRef.current) { dirtyRef.current = true; return; }
      upsertingRef.current = true;
      setSyncState("syncing");
      try {
        do {
          dirtyRef.current = false;
          // 계정이 바뀌었으면(로그아웃/전환) 이 콜백이 캡처한 옛 userId 행에 현재(다른 계정) 데이터를
          // 써 넣지 않도록 중단. dataRef는 라이브라 새 계정 데이터를 담을 수 있어 교차 오염을 막는다.
          if (liveUserIdRef.current !== userId) break;
          await upsertUserData(userId, dataRef.current);
        } while (dirtyRef.current);
        // 최초 로그인이었다면, 업로드가 실제로 성공한 지금 시점에만 동기화 마커를 찍는다.
        // (병합 직후 조기 마킹 시 업로드 실패/새로고침 레이스로 사용자의 "기기 설정 사용" 선택이 무시될 수 있음)
        if (pendingCloudSyncMarkRef.current === userId) {
          if (!isCloudSynced(userId)) markCloudSynced(userId);
          pendingCloudSyncMarkRef.current = null; // 이 계정의 pending만 정리(다른 계정 로그인분을 지우지 않음)
        }
        setSyncState("saved");
      } catch (e) {
        console.error("[cloud] 저장 실패", e);
        setSyncState("error");
      } finally {
        upsertingRef.current = false;
      }
    }, 800);
    return () => clearTimeout(upsertTimer.current);
  }, [settings, charges, items, myItems, ledger, userId, cloudReady]);

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
