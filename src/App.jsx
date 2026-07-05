import { useState, useMemo, useEffect, useRef } from "react";
import { computeCalc } from "./lib/calc.js";
import {
  loadCalcState, saveCalcState, loadMyItems, saveMyItems,
  loadLedger, saveLedger, exportAll, importAll,
  parseCalcState, serializeCalcState, normalizeLedger, normalizeMyItems, localSnapshot,
  isCloudSynced, markCloudSynced, hasStoredCalc, hasStoredItems, withRowKeys,
} from "./lib/storage.js";
import { cloudEnabled, onAuthChange, fetchUserData, upsertUserData, mergeSnapshots, fetchAppConfig } from "./lib/cloud.js";
import { CHARGE_METHODS } from "./lib/constants.js";
import CalcTab from "./components/CalcTab.jsx";
import LogTab from "./components/LogTab.jsx";
import ForecastTab from "./components/ForecastTab.jsx";
import AuthBar from "./components/AuthBar.jsx";

const TABS = [
  { id: "calc", label: "계산기" },
  { id: "log", label: "거래 기록" },
  { id: "fore", label: "예상 & 추천" },
];

// app_config에서 settings로 반영하는 시세 스칼라 키(기본값 적용·force가 공유 → 새 키 추가 시 한 곳만 수정).
const CONFIG_RATE_KEYS = ["mesoRate", "giftRatio", "marketRatio"];
function configRatePatch(cfg, onlyKeys) {
  const patch = {};
  CONFIG_RATE_KEYS.forEach((k) => {
    if ((!onlyKeys || onlyKeys.includes(k)) && cfg[k] != null) patch[k] = cfg[k];
  });
  return patch;
}

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
  const [syncNonce, setSyncNonce] = useState(0); // 계정 전환 후 새 계정 업로드 재예약 트리거
  // 충전 방식 프리셋 목록(드롭다운 옵션) — DB app_config에서 받아오면 교체, 기본은 constants.
  const [chargeOptions, setChargeOptions] = useState(CHARGE_METHODS);
  const [appConfig, setAppConfig] = useState(null);   // 로드된 app_config
  const [authResolved, setAuthResolved] = useState(false); // 세션 해석 완료 여부(게스트/로그인 확정)
  // 첫 렌더에서 '저장 이력 없는 새 유저'인지 캡처(자동저장 이펙트가 곧 localStorage를 채우므로 최초 시점에).
  const freshRef = useRef({ calc: !hasStoredCalc(), items: !hasStoredItems() });
  const configAppliedRef = useRef(false); // 시세성 기본값을 이미 1회 적용했는지
  const forceAppliedForRef = useRef(undefined); // force를 마지막으로 적용한 컨텍스트('__guest__' 또는 userId)
  const upsertTimer = useRef(null);
  const upsertingRef = useRef(false); // 업로드 진행 중 플래그(중복/역전 저장 방지)
  const dirtyRef = useRef(false);     // 업로드 중 추가 변경 발생 여부
  const dataRef = useRef(null);       // 항상 최신 스냅샷(업로드 payload)
  const pendingCloudSyncMarkRef = useRef(null); // 첫 로그인 시 "첫 업로드 성공 후 마킹 예정" userId 보관
  const liveUserIdRef = useRef(null); // 현재 로그인된 userId(매 렌더 갱신) — 계정 전환 중 교차 업로드 차단용
  const syncedUserRef = useRef(null); // 클라우드 데이터가 실제 로드 완료된 userId(정착 신호 — cloudReady state의 stale read 회피)

  // 파생 계산 (기존 render()의 순수 버전)
  const calc = useMemo(() => computeCalc(settings, charges, items), [settings, charges, items]);

  // 로컬 자동 저장 (게스트/로그인 공통 캐시)
  useEffect(() => saveCalcState(settings, charges, items), [settings, charges, items]);
  useEffect(() => saveMyItems(myItems), [myItems]);
  useEffect(() => saveLedger(ledger), [ledger]);

  // 리스트 setter는 withRowKeys로 감싸 모든 생성/편집 경로가 안정 key(_k)를 갖게 한다(생성 사이트 개별 수정 불필요).
  const setSettings = (patch) => setCalcState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const setCharges = (charges) => setCalcState((s) => ({ ...s, charges: withRowKeys(charges) }));
  const setItems = (items) => setCalcState((s) => ({ ...s, items: withRowKeys(items) }));
  const applyMyItems = (arr) => setMyItems(withRowKeys(arr));

  // 세션 객체 대신 userId(원시값)로 이펙트를 키잉 → 토큰 갱신/중복 이벤트로 재실행되지 않음.
  const userId = session?.user?.id ?? null;
  // 최신 스냅샷·현재 userId를 렌더 본문에서 ref에 반영(의도적). 이 ref들은 디바운스 업로드(800ms+)·
  // 계정 전환 가드 등 async 콜백만 읽으므로 '항상 최신값'이 필요하다. 렌더 본문 갱신이 이를 보장하며,
  // 파생값을 다시 쓰는 것이라 StrictMode 이중 렌더에도 idempotent(무해). useEffect로 옮기면 커밋~이펙트
  // 사이 지연 창에서 stale ref를 읽을 위험이 생겨(Codex 지적) 오히려 나쁘다.
  dataRef.current = { calc: serializeCalcState(settings, charges, items), my_items: myItems, ledger };
  liveUserIdRef.current = userId;

  // 세션 구독. 첫 콜백(세션 null이어도) = auth 해석 완료 → authResolved.
  useEffect(() => onAuthChange((s) => { setSession(s); setAuthResolved(true); }), []);

  // 앱 공용 설정(app_config) 로드. 충전 프리셋은 즉시 반영(드롭다운 옵션),
  // 시세/기본아이템 기본값은 아래 '적용' 이펙트가 auth 해석 후 담당. 실패/오프라인은 constants 폴백.
  useEffect(() => {
    let cancelled = false;
    fetchAppConfig().then((cfg) => {
      if (cancelled || !cfg) return;
      if (Array.isArray(cfg.chargeMethods)) {
        const valid = cfg.chargeMethods.filter((m) => m && typeof m.name === "string");
        if (valid.length) setChargeOptions(valid);
      }
      setAppConfig(cfg);
    });
    return () => { cancelled = true; };
  }, []);

  // 시세/기본아이템 기본값: auth 해석(authResolved) 후 '저장 이력 없는 게스트(userId 없음)'에게만 1회 적용.
  // 설정 fetch가 auth보다 빨라도 여기서 authResolved를 기다리므로 로그인 유저에 오적용/레이스 없음.
  useEffect(() => {
    if (!appConfig || !authResolved || configAppliedRef.current) return;
    if (userId) return; // 로그인 유저 → 클라우드 동기화가 상태 관리
    if (!freshRef.current.calc && !freshRef.current.items) return;
    configAppliedRef.current = true;
    if (freshRef.current.calc) {
      const patch = configRatePatch(appConfig);
      if (Object.keys(patch).length) setCalcState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    }
    if (freshRef.current.items && Array.isArray(appConfig.defaultItems)) {
      const items = appConfig.defaultItems.filter((x) => x && typeof x.name === "string");
      if (items.length) applyMyItems(items);
    }
  }, [appConfig, authResolved, userId]);

  // 강제 반영(force): appConfig.force 배열에 든 키를 '모든 유저'에게 DB값으로 덮어씀(저장값 무시).
  // 컨텍스트(게스트='__guest__' / 각 로그인 userId)별로 '데이터 정착 후' 1회 적용. 정착 신호는
  // 게스트=authResolved, 로그인=syncedUserRef.current===userId(이 유저의 클라우드 데이터가 실제 로드됨).
  //   ↑ cloudReady state는 userId 전환 렌더에서 이전 값이 stale하게 읽히므로 쓰지 않고, 동기화 성공 시
  //     세팅되는 ref로 판정 → A→B 전환 시 B의 stale 데이터에 조기 적용하지 않음. cloudReady는 재평가 트리거용 dep.
  // 컨텍스트 키로 자기완결 게이팅 → 이펙트 선언 순서 무관, 계정 전환에도 정확히 재적용. 대상: 시세 스칼라 + defaultItems.
  useEffect(() => {
    if (!appConfig) return;
    const settled = userId ? (syncedUserRef.current === userId) : authResolved;
    if (!settled) return;
    const ctxKey = userId || "__guest__";
    if (forceAppliedForRef.current === ctxKey) return; // 이 컨텍스트엔 이미 적용
    forceAppliedForRef.current = ctxKey;
    const force = Array.isArray(appConfig.force) ? appConfig.force : [];
    if (!force.length) return;
    const patch = configRatePatch(appConfig, force); // force에 든 시세 키만
    if (Object.keys(patch).length) setCalcState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    if (force.includes("defaultItems") && Array.isArray(appConfig.defaultItems)) {
      const items = appConfig.defaultItems.filter((x) => x && typeof x.name === "string");
      if (items.length) applyMyItems(items);
    }
  }, [appConfig, authResolved, userId, cloudReady]);

  // 최초 로그인 동기화: 클라우드 fetch → 로컬과 병합 → 상태 반영 (업로드는 아래 upsert 이펙트가 담당).
  // userId를 deps로 두어 로그인 1회만 실행(토큰 갱신·중복 인증 이벤트로 재실행/취소 레이스 없음).
  useEffect(() => {
    syncedUserRef.current = null; // 새 userId 컨텍스트 진입 → 이 유저 데이터 로드 완료 전까지 force '미정착'(재로그인 stale 방지)
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
        syncedUserRef.current = userId; // 이 유저 클라우드 데이터 로드 완료 → force '정착' 신호(state stale read 회피)
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
        // 이 업로드가 도는 동안 계정이 바뀌었다면(로그인 전환), 새 계정 업로드를 재예약.
        // upsertingRef를 외부에서 리셋하지 않아 단일 in-flight 직렬화는 유지되고(동시 업로드/응답 역전 없음),
        // A가 끝난 지금에서야 B 업로드를 새 타이머로 트리거 → B 첫 업로드 유실 방지.
        if (liveUserIdRef.current && liveUserIdRef.current !== userId) {
          setSyncNonce((n) => n + 1);
        }
      }
    }, 800);
    return () => clearTimeout(upsertTimer.current);
  }, [settings, charges, items, myItems, ledger, userId, cloudReady, syncNonce]);

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
    </div>
  );
}
