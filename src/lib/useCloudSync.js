import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  serializeCalcState, parseCalcState, normalizeLedger, normalizeMyItems, localSnapshot,
  isCloudSynced, markCloudSynced, hasStoredCalc, hasStoredItems, withRowKeys, isUserTouched,
  getDataOwner, setDataOwner,
} from "./storage.js";
import { onAuthChange, fetchUserData, writeUserData, mergeForUpload, mergeSnapshots, fetchAppConfig, tombstoneClock } from "./cloud.js";
import { CHARGE_METHODS, resolveRuleHistory, rulesAt } from "./constants.js";
import { todayStr } from "./util.js";

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
// 다른 계정 소유의 로컬 데이터를 병합에서 배제할 때 쓰는 '아무것도 없음' 스냅샷.
// deleted 도 비운다 — 남의 계정 tombstone 이 내 계정 거래를 지우면 안 된다.
const EMPTY_SNAPSHOT = { calc: {}, my_items: [], ledger: { buys: [], sells: [], cashes: [], spends: [], deleted: {} } };

// 오늘 날짜("YYYY-MM-DD"). 날짜가 실제로 바뀔 때만 새 문자열을 돌려주므로 리렌더는 하루 한 번뿐이다.
// 규칙 발효일과 13주 창 경계가 모두 오늘 기준이라, 탭을 열어둔 채 자정을 넘겨도 갱신돼야 한다.
// 탭 복귀(visibilitychange/focus)에 더해 분 단위 폴링을 두는 이유: 자정에 탭이 계속 떠 있을 수 있다.
function useToday() {
  const [today, setToday] = useState(todayStr);
  useEffect(() => {
    const tick = () => setToday((prev) => { const now = todayStr(); return now === prev ? prev : now; });
    const onVisible = () => { if (!document.hidden) tick(); };
    const id = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return today;
}

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
// 내부에서 setMyItems(normalizeMyItems(...))로 결정적 id·안정 key를 부여(App의 applyMyItems 래퍼에 의존하지 않음).
// id 없이 넣으면 삭제 표식을 남길 수 없어 아이템 삭제가 조용히 실패한다(B-2b).
export function useCloudSync({ settings, charges, items, myItems, ledger, setCalcState, setMyItems, setLedger }) {
  const [session, setSession] = useState(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncState, setSyncState] = useState("idle"); // idle|syncing|saved|error
  const [syncNonce, setSyncNonce] = useState(0);       // 계정 전환 후 새 계정 업로드 재예약 트리거
  const [chargeOptions, setChargeOptions] = useState(CHARGE_METHODS);
  // 게임 규칙(수수료·마일리지 결제 비율·적립률·등급 기준). settings 와 달리 사용자 소유가 아니라 전역이므로
  // 저장 이력·로그인 여부와 무관하게 '모든 유저'에게 즉시 적용한다(force 대상이 아님).
  // cfgRules 는 app_config 원본(객체 또는 발효일 배열)을 그대로 들고 있고,
  // ruleHistory(발효일 오름차순 이력)와 rules(지금 유효한 규칙)는 today 와 함께 파생한다.
  // 파생으로 두는 이유: 규칙 발효일이 오늘 자정을 넘는데 탭이 열려 있으면, state 로 굳혀 둔 rules 는
  // 영영 옛 규칙을 쓴다(계산기가 잘못된 수수료·마일리지 비율로 계산).
  const [cfgRules, setCfgRules] = useState(null);
  const today = useToday();
  const ruleHistory = useMemo(() => resolveRuleHistory(cfgRules, today), [cfgRules, today]);
  const rules = useMemo(() => rulesAt(ruleHistory, today), [ruleHistory, today]);
  const [appConfig, setAppConfig] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [conflictPrompt, setConflictPrompt] = useState(null); // 최초 로그인 병합 충돌 시 { onChoose } — App이 모달 렌더
  const conflictResolveRef = useRef(null);                    // 대기 중 프로미스 resolver(cleanup에서 정리)

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
  const retryTimer = useRef(null);
  const retryAtRef = useRef(0);   // 연속 업로드 실패 횟수(백오프 단계)
  const runUploadRef = useRef(null);
  // 내가 마지막으로 본 서버 행 버전(updated_at). 조건부 쓰기의 기준. null = 행이 없다고 알고 있음.
  const lastSeenRef = useRef(null);

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
      // 원본을 그대로 담는다. 검증(resolveOne)은 파생 시점의 resolveRuleHistory 가 항목별로 하므로
      // malformed 키는 버리고 기본값이 유지된다(전체 폐기 아님).
      setCfgRules(cfg.rules ?? null);
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
      if (its.length) setMyItems(normalizeMyItems(its));
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
      if (its.length) setMyItems(normalizeMyItems(its));
    }
  }, [appConfig, authResolved, userId, cloudReady]);

  // 최초 로그인 동기화: 클라우드 fetch → 로컬 병합 → 상태 반영. userId 키잉으로 로그인 1회만.
  useEffect(() => {
    syncedUserRef.current = null; // 새 컨텍스트 진입 → 이 유저 데이터 로드 완료 전까지 force 미정착(재로그인 stale 방지)
    // uid → 다른 uid 로 바뀔 때도 반드시 내린다. 그러지 않으면 새 유저 fetch 가 진행 중인데
    // 디바운스 이펙트가 cloudReady=true 로 재무장해 '이전 유저의 dataRef' 를 새 유저 행에 올릴 수 있다
    // (liveUserIdRef 가드는 이미 새 uid 이므로 이 경우를 잡지 못한다).
    setCloudReady(false);
    lastSeenRef.current = null; // 새 컨텍스트 → 이 계정 행의 버전을 아직 모른다(첫 쓰기는 INSERT 시도)
    if (!userId) {
      pendingCloudSyncMarkRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setSyncState("syncing");
        const cloud = await fetchUserData(userId);
        if (cancelled) return;
        // 조건부 쓰기의 기준 버전. 행이 없으면 null → 첫 업로드는 INSERT.
        lastSeenRef.current = cloud?.updated_at ?? null;
        const firstLogin = !isCloudSynced(userId);
        pendingCloudSyncMarkRef.current = firstLogin ? userId : null;
        // 로컬 데이터의 소유자가 다른 계정이면 병합하지 않는다. 공용 브라우저에서 A 로그아웃 → B 로그인 시
        // A의 원장이 id 합집합으로 B 계정에 영구 유입되는 것을 막는다(tombstone이 없어 되돌릴 수 없다).
        // 소유자 없음(=진짜 게스트) 또는 같은 계정일 때만 로컬을 병합 대상으로 삼는다.
        const owner = getDataOwner();
        const localUsable = !owner || owner === userId;
        const local = localUsable ? localSnapshot() : EMPTY_SNAPSHOT;
        // 거래 없이 설정/아이템만 바꾼 게스트도 보호: 사용자 직접 편집 여부를 병합 판정에 전달(P1-4).
        // tombstone 만료 기준은 서버 updated_at, 미래 clamp 상한은 max(서버, 내 시계).
        // 둘을 겸용하면 오래 접속하지 않은 유저의 새 표식이 과거로 되감겨 조기 만료된다.
        const clock = tombstoneClock(cloud);
        const { snapshot, conflict } = mergeSnapshots(local, cloud, {
          localTouched: localUsable && isUserTouched(),
          now: clock.now,
          ceiling: clock.ceiling,
        });
        let finalSnap = snapshot;
        if (conflict && firstLogin) {
          // 네이티브 confirm 대신 App이 렌더하는 테마 모달로 선택을 받는다(테스트 가능·UI 일관성).
          // 이펙트는 사용자가 고를 때까지 프로미스로 대기. cleanup(계정 전환/언마운트) 시 안전하게 정리.
          const useCloud = await new Promise((resolve) => {
            conflictResolveRef.current = resolve;
            setConflictPrompt({
              onChoose: (v) => { conflictResolveRef.current = null; setConflictPrompt(null); resolve(v); },
            });
          });
          if (cancelled) return;
          if (!useCloud) finalSnap = { ...snapshot, calc: local.calc, my_items: local.my_items };
        }
        if (cancelled) return;
        const c = parseCalcState(finalSnap.calc);
        setCalcState({ settings: c.settings, charges: c.charges, items: c.items });
        setMyItems(normalizeMyItems(finalSnap.my_items));
        setLedger(normalizeLedger(finalSnap.ledger));
        // 이제 이 기기의 로컬 데이터는 이 계정 것이다. 이후 다른 계정이 로그인하면 병합 게이트가 막는다.
        setDataOwner(userId);
        syncedUserRef.current = userId; // 이 유저 데이터 로드 완료 → force 정착 신호
        setCloudReady(true);
      } catch (e) {
        console.error("[cloud] 초기 동기화 실패", e);
        if (!cancelled) setSyncState("error");
      }
    })();
    return () => {
      cancelled = true;
      // 충돌 모달이 떠 있는 채로 계정 전환/언마운트되면 대기 프로미스를 해소(기본=클라우드)해 async 누수 방지.
      if (conflictResolveRef.current) {
        const r = conflictResolveRef.current;
        conflictResolveRef.current = null;
        setConflictPrompt(null);
        r(true);
      }
    };
  }, [userId]);

  // ===== 업로드 실패 재시도(지수 백오프) =====
  // 오프라인·일시 장애로 실패한 업로드를 다시 시도한다. 성공하면 retryAtRef 를 0으로 되돌린다.
  // runUpload 를 ref 로 참조해 두 useCallback 의 순환 의존을 피한다(둘 다 deps [] 로 안정).
  const scheduleRetry = useCallback((uid) => {
    const n = Math.min(retryAtRef.current + 1, 5);
    retryAtRef.current = n;
    const delay = Math.min(2000 * 2 ** (n - 1), 60000); // 2s,4s,8s,16s,32s → 이후 60s 고정
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      if (liveUserIdRef.current === uid) runUploadRef.current?.(uid);
    }, delay);
  }, []);

  // ===== 업로드 러너(통합): 디바운스·플러시가 공유 =====
  // 단일 in-flight 직렬화 + do-while dirty-retry + 계정 가드 + 마커 + 재예약. captured uid로 동작.
  // refs + 안정 setter(setSyncState/setSyncNonce/setLedger)만 읽으므로 안정화 → 이펙트 deps에 넣어도 재실행 없음.
  // setLedger 는 React useState 세터라 identity 가 고정이다(훅 계약).
  const runUpload = useCallback(async (uid) => {
    if (upsertingRef.current) { dirtyRef.current = true; return; } // in-flight면 dirty만 표시(러너가 소비)
    upsertingRef.current = true;
    setSyncState("syncing");
    let aborted = false;
    try {
      do {
        dirtyRef.current = false;
        if (liveUserIdRef.current !== uid) { aborted = true; break; } // 계정 전환 → 옛 행에 쓰지 않고 중단
        const payload = dataRef.current;
        // 이 payload 에 담긴 변경은 지금 업로드된다 → 여기서 플러시 부채를 턴다.
        // (루프가 끝난 뒤에 털면, await 중 들어온 편집까지 '플러시됨'으로 오인해 탭 종료 시 유실된다.)
        dirtyForFlushRef.current = false;

        // 조건부 쓰기: 내가 마지막으로 본 버전일 때만 성립. 그 사이 다른 탭/기기가 썼으면 conflict.
        let res = await writeUserData(uid, payload, lastSeenRef.current);
        for (let tries = 0; res.conflict && tries < 5; tries++) {
          if (liveUserIdRef.current !== uid) { aborted = true; break; }
          // 서버 최신본을 읽어 병합한다. 거래는 합집합 + tombstone 차감,
          // 설정/아이템은 이 탭의 값이 이긴다(방금 편집한 것).
          const cloud = await fetchUserData(uid);
          if (liveUserIdRef.current !== uid) { aborted = true; break; }
          lastSeenRef.current = cloud?.updated_at ?? null;
          const merged = mergeForUpload(dataRef.current, cloud);
          // 병합 결과를 반드시 화면(상태)에도 반영한다. 우리는 merged 를 서버에 쓰므로,
          // 로컬 상태가 merged 와 어긋난 채 남으면 다음 업로드가 그 어긋난 값을 올바른 버전으로
          // 덮어써 다른 기기의 거래를 지우고 삭제된 거래를 되살린다.
          // (항목 '개수'만 비교해 건너뛰면 안 된다 — 한 건이 지워지고 한 건이 추가된 경우 개수가 같다.)
          setLedger(normalizeLedger(merged.ledger));
          res = await writeUserData(uid, merged, lastSeenRef.current);
        }
        if (aborted) break;
        if (res.conflict) throw new Error("write-conflict"); // 5회 재시도에도 실패 → 백오프로 넘긴다
        // 쓰기 도중 계정이 바뀌었으면 새 계정의 버전을 옛 행의 값으로 덮지 않는다.
        if (liveUserIdRef.current === uid) lastSeenRef.current = res.updatedAt;
      } while (dirtyRef.current);
      // 실제로 이 uid 업로드가 완료된 경우에만 성공 처리 — 중단(계정 전환)된 업로드를 성공으로 오인하지 않는다.
      if (!aborted) {
        // 성공 → 백오프 초기화 + 예약된 재시도 취소.
        // (취소하지 않으면 이미 clean 한 상태에서 타이머가 울려 불필요한 중복 업로드가 한 번 더 돈다.)
        retryAtRef.current = 0;
        clearTimeout(retryTimer.current);
        if (pendingCloudSyncMarkRef.current === uid) {
          if (!isCloudSynced(uid)) markCloudSynced(uid);
          pendingCloudSyncMarkRef.current = null;
        }
        setSyncState("saved");
      }
    } catch (e) {
      console.error("[cloud] 저장 실패", e);
      // 실패한 변경은 아직 클라우드에 없다 → 플러시 부채를 되살리고 백오프 재시도를 예약한다.
      // (이전에는 error 표시만 하고 끝나서, 사용자가 더 편집하지 않으면 변경이 영영 로컬에만 남았고
      //  다음 새로고침에서 클라우드의 낡은 값이 이겼다.)
      dirtyForFlushRef.current = true;
      dirtyRef.current = true;
      setSyncState("error");
      scheduleRetry(uid);
    } finally {
      upsertingRef.current = false;
      if (liveUserIdRef.current && liveUserIdRef.current !== uid) setSyncNonce((n) => n + 1); // 새 계정 업로드 재예약
    }
  }, [setLedger]);

  runUploadRef.current = runUpload; // 파생값 재기록 → StrictMode 이중 렌더에도 idempotent

  // 데이터 변경 → 디바운스 후 업로드.
  useEffect(() => {
    if (!userId || !cloudReady) return;
    dirtyForFlushRef.current = true; // 대기 중 미반영 변경(탭 숨김 시 즉시 플러시 대상)
    // 업로드가 in-flight 라면 러너의 do-while 이 이 변경을 소비하게 표시한다.
    // (이전에는 재진입 runUpload 호출에서만 세워져, await 중 들어온 편집을 재시도 루프가 보지 못했다.)
    dirtyRef.current = true;
    clearTimeout(upsertTimer.current);
    upsertTimer.current = setTimeout(() => {
      if (!dirtyForFlushRef.current) return; // in-flight 러너가 이미 올렸으면 중복 업로드 생략
      runUpload(userId);
    }, 800);
    return () => clearTimeout(upsertTimer.current);
  }, [settings, charges, items, myItems, ledger, userId, cloudReady, syncNonce, runUpload]);

  // 오프라인에서 실패한 업로드를 온라인 복귀 즉시 재시도. 백오프 타이머는 계정 전환·언마운트 시 정리.
  useEffect(() => {
    if (!userId) return;
    const onOnline = () => {
      if (dirtyForFlushRef.current && liveUserIdRef.current === userId) {
        retryAtRef.current = 0;
        runUpload(userId);
      }
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      clearTimeout(retryTimer.current);
    };
  }, [userId, runUpload]);

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

  return { session, syncState, chargeOptions, conflictPrompt, rules, ruleHistory };
}
