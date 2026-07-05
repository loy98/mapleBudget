import { DEFAULT_SETTINGS, DEFAULT_CHARGES, DEFAULT_CALC_ITEMS, DEFAULT_ITEMS } from "./constants.js";
import { uid } from "./util.js";

// 기존 단일 HTML 버전과 동일한 키 → 사용자 데이터 그대로 승계
export const KEY = "mvpCalc_v4";
export const ITEMS_KEY = "mvpItems_v1";
export const LKEY = "mvpLedger_v2";
export const CALMODE_KEY = "mvpCalMode";
// 이 기기가 어떤 계정(userId)과 이미 동기화됐는지 표시.
// 있으면 = 새로고침(세션 복원) → 병합 충돌을 조용히 클라우드 우선 처리.
// 없거나 다른 uid = 이 기기에서 그 계정 첫 로그인 → 게스트/클라우드 설정 선택을 1회 물음.
export const SYNC_KEY = "mvpCloudSyncedUid";

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function writeJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch { /* 저장 불가 환경 무시 */ }
}

// ===== 계산기 설정 + 충전 방식 + 계산기 아이템 =====
// 직렬화/파싱은 순수 함수로 분리해 localStorage와 Supabase가 같은 형태를 공유한다.
export function serializeCalcState(settings, charges, items) {
  return { ...settings, charge: charges, items };
}
export function parseCalcState(d) {
  if (!d) {
    return { settings: { ...DEFAULT_SETTINGS }, charges: DEFAULT_CHARGES.map((c) => ({ ...c })), items: DEFAULT_CALC_ITEMS.map((i) => ({ ...i })) };
  }
  const settings = { ...DEFAULT_SETTINGS };
  Object.keys(DEFAULT_SETTINGS).forEach((k) => {
    if (d[k] != null && d[k] !== "") settings[k] = d[k];
  });
  const charges = d.charge && d.charge.length ? d.charge : [{ name: "정가 (할인 없음)", rate: 0, limit: 0 }];
  const items = d.items && d.items.length ? d.items : [];
  return { settings, charges, items };
}
export function loadCalcState() {
  return parseCalcState(readJSON(KEY));
}
// 이 브라우저에 계산기/아이템 저장 이력이 있는지(=기존 유저인지) 판별.
// 첫 렌더에서 캡처해 두고, DB 시세성 기본값을 "새 유저에게만" 적용하는 데 쓴다.
// (자동 저장 이펙트가 곧 localStorage를 채우므로 반드시 최초 시점에 읽어야 함)
export function hasStoredCalc() {
  try { return localStorage.getItem(KEY) != null; } catch { return false; }
}
export function hasStoredItems() {
  try { return localStorage.getItem(ITEMS_KEY) != null; } catch { return false; }
}
export function saveCalcState(settings, charges, items) {
  writeJSON(KEY, serializeCalcState(settings, charges, items));
}

// ===== 자주 쓰는 아이템 =====
export function normalizeMyItems(d) {
  if (d && d.length) return d;
  return DEFAULT_ITEMS.map((x) => ({ ...x }));
}
export function loadMyItems() {
  return normalizeMyItems(readJSON(ITEMS_KEY));
}
export const saveMyItems = (items) => writeJSON(ITEMS_KEY, items);

// ===== 거래 원장 =====
export function normalizeLedger(d) {
  const src = d || {};
  const led = { buys: src.buys || [], sells: src.sells || [], cashes: src.cashes || [], spends: src.spends || [] };
  ["buys", "sells", "cashes", "spends"].forEach((k) => led[k].forEach((x) => { if (!x.id) x.id = uid(); }));
  // 현금화: 구 데이터(판매현금 won 직접 입력) → 억당(rate) 기반으로 승계.
  // meso가 0/빈값이면 rate를 만들 수 없으므로 그대로 두고(won 폴백 유지) 데이터 손실을 막는다.
  led.cashes.forEach((c) => {
    if ((c.rate == null || c.rate === "") && c.won != null && +c.meso > 0) {
      c.rate = +c.won / +c.meso;
    }
  });
  return led;
}
export function loadLedger() {
  return normalizeLedger(readJSON(LKEY));
}
export const saveLedger = (ledger) => writeJSON(LKEY, ledger);

// ===== 클라우드 동기화용 스냅샷 (Supabase user_data 컬럼 형태와 동일) =====
export function localSnapshot() {
  return {
    calc: readJSON(KEY) || {},
    my_items: readJSON(ITEMS_KEY) || [],
    ledger: readJSON(LKEY) || { buys: [], sells: [], cashes: [], spends: [] },
  };
}
export function writeLocalSnapshot({ calc, my_items, ledger }) {
  if (calc) writeJSON(KEY, calc);
  if (my_items) writeJSON(ITEMS_KEY, my_items);
  if (ledger) writeJSON(LKEY, ledger);
}

// ===== 클라우드 동기화 마커 (계정별 최초 로그인 판별) =====
export function isCloudSynced(userId) {
  try {
    return !!userId && localStorage.getItem(SYNC_KEY) === userId;
  } catch {
    return false;
  }
}
export function markCloudSynced(userId) {
  try {
    if (userId) localStorage.setItem(SYNC_KEY, userId);
  } catch { /* 저장 불가 환경 무시 */ }
}
export function clearCloudSynced() {
  try {
    localStorage.removeItem(SYNC_KEY);
  } catch { /* ignore */ }
}

export function loadCalMode() {
  try {
    return localStorage.getItem(CALMODE_KEY) || "month";
  } catch {
    return "month";
  }
}
export function saveCalMode(m) {
  try {
    localStorage.setItem(CALMODE_KEY, m);
  } catch { /* ignore */ }
}

// ===== 내보내기 / 가져오기 =====
export function exportAll() {
  const data = {
    app: "mvp-calculator",
    version: 1,
    exportedAt: new Date().toISOString(),
    calc: readJSON(KEY),
    myItems: readJSON(ITEMS_KEY),
    ledger: readJSON(LKEY),
    calMode: loadCalMode(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mvp-calculator-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// 성공 시 true 반환. 적용 후 페이지 리로드 권장(모든 상태 재초기화).
export function importAll(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON 파일을 읽을 수 없습니다." };
  }
  if (!data || data.app !== "mvp-calculator") {
    return { ok: false, error: "이 앱의 백업 파일이 아닙니다." };
  }
  if (data.calc) writeJSON(KEY, data.calc);
  if (data.myItems) writeJSON(ITEMS_KEY, data.myItems);
  if (data.ledger) writeJSON(LKEY, data.ledger);
  if (data.calMode) saveCalMode(data.calMode);
  return { ok: true };
}
