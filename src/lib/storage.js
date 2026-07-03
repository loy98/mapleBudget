import { DEFAULT_SETTINGS, DEFAULT_CHARGES, DEFAULT_CALC_ITEMS, DEFAULT_ITEMS } from "./constants.js";
import { uid } from "./util.js";

// 기존 단일 HTML 버전과 동일한 키 → 사용자 데이터 그대로 승계
export const KEY = "mvpCalc_v4";
export const ITEMS_KEY = "mvpItems_v1";
export const LKEY = "mvpLedger_v2";
export const CALMODE_KEY = "mvpCalMode";

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
export function loadCalcState() {
  const d = readJSON(KEY);
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

export function saveCalcState(settings, charges, items) {
  writeJSON(KEY, { ...settings, charge: charges, items });
}

// ===== 자주 쓰는 아이템 =====
export function loadMyItems() {
  const d = readJSON(ITEMS_KEY);
  if (d && d.length) return d;
  return DEFAULT_ITEMS.map((x) => ({ ...x }));
}
export const saveMyItems = (items) => writeJSON(ITEMS_KEY, items);

// ===== 거래 원장 =====
export function loadLedger() {
  const d = readJSON(LKEY) || {};
  const led = { buys: d.buys || [], sells: d.sells || [], cashes: d.cashes || [], spends: d.spends || [] };
  ["buys", "sells", "cashes", "spends"].forEach((k) => led[k].forEach((x) => { if (!x.id) x.id = uid(); }));
  return led;
}
export const saveLedger = (ledger) => writeJSON(LKEY, ledger);

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
