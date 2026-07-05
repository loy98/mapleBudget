import { useState, useEffect, useRef, useCallback } from "react";
import {
  serializeCalcState, parseCalcState, normalizeLedger, normalizeMyItems, localSnapshot,
  isCloudSynced, markCloudSynced, hasStoredCalc, hasStoredItems, withRowKeys,
} from "./storage.js";
import { onAuthChange, fetchUserData, upsertUserData, mergeSnapshots, fetchAppConfig } from "./cloud.js";
import { CHARGE_METHODS } from "./constants.js";

// app_config에서 settings로 반영하는 시세 스칼라 키(기본값 적용·force가 공유 → 새 키 추가 시 한 곳만 수정).
const CONFIG_RATE_KEYS = ["mesoRate", "giftRatio", "marketRatio"];
function configRatePatch(cfg, onlyKeys) {
  const patch = {};
  CONFIG_RATE_KEYS.forEach((k) => {
    if ((!onlyKeys || onlyKeys.includes(k)) && cfg[k] != null) patch[k] = cfg[k];
  });
  return patch;
}
const validItems = (arr) => (Array.isArray(arr) ? arr.filter((x) => x && typeof x.name === "string") : []);

// ============================================================
// useCloudSync — 세션·app_config·클라우드 동기화·업로드를 한 곳에 응집(App.jsx의 SRP 회복).
// 계산기 상태(state/setter)는 App이 소유하고, 이 훅이 클라우드와의 연동만 담당한다.
// 동작은 이전 App.jsx 인라인 로직과 동일하게 보존하고, 업로드 경로만 runUpload() 하나로 통합
// (디바운스·탭숨김 플러시가 같은 do-while dirty-retry를 공유 → 플러시 중 변경 유실 없음).
//
// 유지되는 불변식:
//  - 단일 in-flight 직렬화(upsertingRef) — 동시 업로드/응답 역전 방지.
//  - 각 write 직전 liveUserIdRef===캡처 userId — 계정 전환 시 옛 행에 쓰지 않음.
//  - 최초 로그인 마커(pendingCloudSyncMarkRef)는 첫 업로드 성공 후에만 기록.
//  - 계정 전환 후 새 계정 업로드는 syncNonce 재예약(직렬화 유지한 채).
//  - force 정착 판정은 syncedUserRef(실제 데이터 로드) — cloudReady state의 stale read 회피.
// ============================================================
// setCalcState/setMyItems/setLedger는 React useState 세터(안정 identity)만 받는다 → stale closure 없음.
// 내부에서 setMyItems(withRowKeys(...))로 안정 key를 부여(App의 applyMyItems 래퍼에 의존하지 않음).
export function useCloudSync({ settings, charges, items, myItems, ledger, setCalcState, setMyItems, setLedger }) {
  const [session, setSession] = useState(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncState, setSyncState] = useState("idle"); // idle|syncing|saved|error
  const [syncNonce, setSyncNonce] = useState(0);       // 계정 전환 후 새 계정 업로드 재예약 트리거
  const [chargeOptions, setChargeOptions] = useState(CHARGE_METHODS);
  const [appConfig, setAppConfig] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);

  const freshRef = useRef({ calc: !hasStoredCalc(), items: !hasStoredItems() });
  const configAppliedRef = useRef(false);
  const forceAppliedForRef = useRef(undefined);
  const upsertTimer = useRef(null);
  const upsertingRef = useRef(false);
  const dirtyRef = useRef(false);
  const dataRef = useRef(null);
  const pendingCloudSyncMarkRef = useRef(null);
  const liveUserIdRef = useRef(null);
  const syncedUserRef = useRef(null);
  const dirtyForFlushRef = useRef(false);

  const userId = session?.user?.id ?? null;
  // 최신 스냅샷·현재 userId를 렌더 본문에서 ref에 반영(의도적). async 콜백(디바운스 업로드·가드)만 읽으므로
  // '항상 최신값'이 필요하고, 파생값 재기록이라 StrictMode 이중 렌더에도 idempotent.
  dataRef.current = { calc: serializeCalcState(settings, charges, items), my_items: myItems, ledger };
  liveUserIdRef.current = userId;

  // 세션 구독. 첫 콜백(세션 null이어도) = auth 해석 완료.
  useEffect(() => onAuthChange((s) => { setSession(s); setAuthResolved(true); }), []);

  // app_config 로드. 충전 프리셋은 즉시 반영, 시세/기본아이템은 아래 적용 이펙트가 담당. 실패/오프라인은 constants 폴백.
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

  // 시세/기본아이템 기본값: auth 해석 후 '저장 이력 없는 게스트'에게만 1회 적용.
  useEffect(() => {
    if (!appConfig || !authResolved || configAppliedRef.current) return;
    if (userId) return; // 로그인 유저는 동기화가 상태 관리
    if (!freshRef.current.calc && !freshRef.current.items) return;
    configAppliedRef.current = true;
    if (freshRef.current.calc) {
      const patch = configRatePatch(appConfig);
      if (Object.keys(patch).length) setCalcState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    }
    if (freshRef.current.items) {
      const its = validItems(appConfig.defaultItems);
      if (its.length) setMyItems(withRowKeys(its));
    }
  }, [appConfig, authResolved, userId]);

  // 강제 반영(force): force 배열의 키를 모든 유저에게 덮어씀. 컨텍스트별 '데이터 정착 후' 1회.
  // 정착 신호: 게스트=authResolved, 로그인=syncedUserRef.current===userId(실제 데이터 로드). cloudReady는 재평가 트리거 dep.
  useEffect(() => {
    if (!appConfig) return;
    const settled = userId ? (syncedUserRef.current === userId) : authResolved;
    if (!settled) return;
    const ctxKey = userId || "__guest__";
    if (forceAppliedForRef.current === ctxKey) return;
    forceAppliedForRef.current = ctxKey;
    const force = Array.isArray(appConfig.force) ? appConfig.force : [];
    if (!force.length) return;
    const patch = configRatePatch(appConfig, force);
    if (Object.keys(patch).length) setCalcState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    if (force.includes("defaultItems")) {
      const its = validItems(appConfig.defaultItems);
      if (its.length) setMyItems(withRowKeys(its));
    }
  }, [appConfig, authResolved, userId, cloudReady]);

  // 최초 로그인 동기화: 클라우드 fetch → 로컬 병합 → 상태 반영. userId 키잉으로 로그인 1회만.
  useEffect(() => {
    syncedUserRef.current = null; // 새 컨텍스트 진입 → 이 유저 데이터 로드 완료 전까지 force 미정착(재로그인 stale 방지)
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
        const firstLogin = !isCloudSynced(userId);
        pendingCloudSyncMarkRef.current = firstLogin ? userId : null;
        const local = localSnapshot();
        const { snapshot, conflict } = mergeSnapshots(local, cloud);
        let finalSnap = snapshot;
        if (conflict && firstLogin) {
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
        syncedUserRef.current = userId; // 이 유저 데이터 로드 완료 → force 정착 신호
        setCloudReady(true);
      } catch (e) {
        console.error("[cloud] 초기 동기화 실패", e);
        if (!cancelled) setSyncState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // ===== 업로드 러너(통합): 디바운스·플러시가 공유 =====
  // 단일 in-flight 직렬화 + do-while dirty-retry + 계정 가드 + 마커 + 재예약. captured uid로 동작.
  // refs + 안정 setter(setSyncState/setSyncNonce)만 읽으므로 useCallback([])로 안정화 → 이펙트 deps에 넣어도 재실행 없음.
  const runUpload = useCallback(async (uid) => {
    if (upsertingRef.current) { dirtyRef.current = true; return; } // in-flight면 dirty만 표시(러너가 소비)
    upsertingRef.current = true;
    setSyncState("syncing");
    let aborted = false;
    try {
      do {
        dirtyRef.current = false;
        if (liveUserIdRef.current !== uid) { aborted = true; break; } // 계정 전환 → 옛 행에 쓰지 않고 중단
        await upsertUserData(uid, dataRef.current);
      } while (dirtyRef.current);
      // 실제로 이 uid 업로드가 완료된 경우에만 성공 처리 — 중단(계정 전환)된 업로드를 성공으로 오인하지 않는다.
      if (!aborted) {
        dirtyForFlushRef.current = false; // 업로드 성공 → 미반영 변경 없음
        if (pendingCloudSyncMarkRef.current === uid) {
          if (!isCloudSynced(uid)) markCloudSynced(uid);
          pendingCloudSyncMarkRef.current = null;
        }
        setSyncState("saved");
      }
    } catch (e) {
      console.error("[cloud] 저장 실패", e);
      setSyncState("error");
    } finally {
      upsertingRef.current = false;
      if (liveUserIdRef.current && liveUserIdRef.current !== uid) setSyncNonce((n) => n + 1); // 새 계정 업로드 재예약
    }
  }, []);

  // 데이터 변경 → 디바운스 후 업로드.
  useEffect(() => {
    if (!userId || !cloudReady) return;
    dirtyForFlushRef.current = true; // 대기 중 미반영 변경(탭 숨김 시 즉시 플러시 대상)
    clearTimeout(upsertTimer.current);
    upsertTimer.current = setTimeout(() => { runUpload(userId); }, 800);
    return () => clearTimeout(upsertTimer.current);
  }, [settings, charges, items, myItems, ledger, userId, cloudReady, syncNonce, runUpload]);

  // 마지막 편집 유실 방지: 탭 숨김 시 대기 중 변경을 즉시 업로드(같은 runUpload → dirty-retry 공유).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      if (!userId || !cloudReady || upsertingRef.current || !dirtyForFlushRef.current) return;
      if (liveUserIdRef.current !== userId) return;
      clearTimeout(upsertTimer.current);
      runUpload(userId);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [userId, cloudReady, runUpload]);

  return { session, syncState, chargeOptions };
}
