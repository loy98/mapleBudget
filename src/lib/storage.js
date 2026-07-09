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
// 이 브라우저에 저장된 데이터가 '누구 것'인지. 없으면 게스트 소유.
// 병합 게이트: 로컬 데이터의 소유자가 다른 계정이면 절대 병합하지 않는다.
// (없으면 공용 브라우저에서 A가 로그아웃 후 B가 로그인할 때 A의 거래 원장이 B 계정으로 영구 유입된다.
//  ledger 병합은 id 합집합이라 충돌 모달 선택과 무관하게 항상 합쳐지고, tombstone이 없어 되돌릴 수도 없다.)
export const OWNER_KEY = "mvpDataOwnerUid";

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
// 리스트 행에 안정적인 React key(_k)를 부여. index key는 중간 행 삭제 시
// NumInput/ItemCombo 내부 상태(draft/focus)가 다른 행에 얹히므로, 행마다 고정 키가 필요.
export function withRowKeys(arr) {
  // 배열이 아닌 값(클라우드/가져오기 파일의 malformed 데이터)이 오면 map에서 던져 앱이 백지가 된다.
  return (Array.isArray(arr) ? arr : []).map((x) => (x && x._k ? x : { ...x, _k: uid() }));
}
// 원장 4개 버킷은 반드시 배열이어야 한다. 아니면 빈 배열로 강등(데이터 없음 < 앱 크래시).
const asArray = (v) => (Array.isArray(v) ? v : []);
export function parseCalcState(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) {
    return { settings: { ...DEFAULT_SETTINGS }, charges: withRowKeys(DEFAULT_CHARGES), items: withRowKeys(DEFAULT_CALC_ITEMS) };
  }
  const settings = { ...DEFAULT_SETTINGS };
  Object.keys(DEFAULT_SETTINGS).forEach((k) => {
    if (d[k] != null && d[k] !== "") settings[k] = d[k];
  });
  const charges = withRowKeys(Array.isArray(d.charge) && d.charge.length ? d.charge : [{ name: "정가 (할인 없음)", rate: 0, limit: 0 }]);
  const items = withRowKeys(Array.isArray(d.items) && d.items.length ? d.items : []);
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
  return withRowKeys(Array.isArray(d) && d.length ? d : DEFAULT_ITEMS);
}
export function loadMyItems() {
  return normalizeMyItems(readJSON(ITEMS_KEY));
}
export const saveMyItems = (items) => writeJSON(ITEMS_KEY, items);

// ===== 거래 원장 =====
export function normalizeLedger(d) {
  const src = d && typeof d === "object" ? d : {};
  const led = { buys: asArray(src.buys), sells: asArray(src.sells), cashes: asArray(src.cashes), spends: asArray(src.spends) };
  // 원소가 객체가 아니면(문자열·null 등) 뒤따르는 x.id 접근이 던진다 → 여기서 걸러낸다.
  ["buys", "sells", "cashes", "spends"].forEach((k) => {
    led[k] = led[k].filter((x) => x && typeof x === "object");
    led[k].forEach((x) => { if (!x.id) x.id = uid(); });
  });
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

// ===== 데이터 소유자 =====
export function getDataOwner() {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
}
export function setDataOwner(userId) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch { /* ignore */ }
}
// 로그아웃 시 이 기기에서 계정 데이터를 지운다.
// 두 가지 목적: ① 다음 계정으로의 유입 차단 ② 남의 브라우저에 금전 원장을 남기지 않음.
// 데이터는 클라우드에 있으므로 재로그인하면 복원된다. calMode/theme 같은 기기별 뷰 설정은 남긴다.
export function clearAccountData() {
  try {
    [KEY, ITEMS_KEY, LKEY, SYNC_KEY, TOUCHED_KEY, OWNER_KEY].forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ===== 사용자 직접 편집 여부 (P1-4 게스트 설정 손실 방지) =====
// 계산기/아이템을 '사용자가 직접' 편집하면 표시. config 자동적용·클라우드 동기화 같은 프로그램적 변경과 구분해,
// 최초 로그인 병합 시 '이 기기에 지켜야 할 사용자 데이터가 있는지' 판정에 쓴다. (거래 없이 설정만 바꾼 게스트도 포착)
export const TOUCHED_KEY = "mvpUserTouched";
export function markUserTouched() {
  try { localStorage.setItem(TOUCHED_KEY, "1"); } catch { /* ignore */ }
}
export function isUserTouched() {
  try { return localStorage.getItem(TOUCHED_KEY) === "1"; } catch { return false; }
}

// calMode(달력 보기: 월력/MVP주간)는 '기기별 뷰 설정'이라 의도적으로 로컬 전용(클라우드 미동기화).
// user_data 스냅샷(calc/my_items/ledger)에는 포함하지 않는다. 내보내기/가져오기에는 포함(백업 편의).
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
