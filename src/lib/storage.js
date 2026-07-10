import {
  DEFAULT_SETTINGS, DEFAULT_CHARGES, DEFAULT_CALC_ITEMS, DEFAULT_ITEMS,
  LEDGER_BUCKETS, LEDGER_ID_FIELDS, MY_ITEM_ID_FIELDS, ITEM_TOMBSTONE_PREFIX, TOMBSTONE_TTL_DAYS, TOMBSTONE_MAX,
} from "./constants.js";
import { uid, padDate, todayStr, legacyRowId, rowContentKey, occurrenceCounter } from "./util.js";

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

// ===== 저장소 무결성 =====
// 파싱 실패한 값을 조용히 null 로 바꾸면, 앱은 '빈 상태'로 로드되고 곧바로 자동저장 이펙트가
// **복구 가능했을 원본 위에 빈 값을 덮어쓴다.** 쓰기 중단(쿼터·브라우저 크래시) 한 번이
// 게스트에겐 영구·불가역 데이터 손실이 된다.
//
// 규칙:
//  ① 파싱 실패 시 원본 문자열을 `<key>.corrupt` 에 백업한 뒤에만 null 을 반환한다.
//  ② 백업에 실패했으면(공간 부족) 그 키에는 **쓰지 않는다** — 덮어쓰면 원본이 사라진다.
//  ③ 쓰기 실패(QuotaExceededError 등)를 조용히 삼키지 않고 호출측/사용자에게 알린다.
export const CORRUPT_SUFFIX = ".corrupt";

const corrupted = new Map(); // key -> { backedUp: boolean }
let quotaHit = false;
let listeners = [];

export function getStorageIssues() {
  return {
    corruptKeys: [...corrupted.keys()],
    // 백업조차 못한 키가 있으면 그 키는 쓰기가 막혀 있다(더 위험).
    unbackedKeys: [...corrupted.entries()].filter(([, v]) => !v.backedUp).map(([k]) => k),
    quotaHit,
  };
}
export function onStorageIssue(cb) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((f) => f !== cb); };
}
function emitIssue() {
  const s = getStorageIssues();
  listeners.forEach((f) => { try { f(s); } catch { /* 구독자 오류가 저장을 막지 않게 */ } });
}
// 테스트/가져오기용: 손상 표시를 해제한다(사용자가 명시적으로 덮어쓰기를 택한 경우).
export function clearCorruptFlag(key) {
  if (corrupted.delete(key)) emitIssue();
}
export function __resetStorageIssues() {
  corrupted.clear();
  quotaHit = false;
  listeners = [];
}

const isQuotaError = (e) =>
  !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);

// 백업 슬롯. 한 슬롯만 두고 '이미 있으면 성공'으로 치면, **다른 내용**으로 다시 손상됐을 때
// 지금 살려야 할 원본이 백업되지 않은 채 자동저장에 덮인다.
//
// 지켜야 할 불변식은 하나다: **지금 덮어쓸 원본이 어딘가에 백업돼 있을 것.**
// 그래서 슬롯 2개를 '최초 손상본'과 '가장 최근 손상본'으로 쓴다. 둘 다 차 있고 새 손상본이
// 들어오면 최근 슬롯을 밀어낸다 — 잃는 것은 이미 대체된 옛 손상본이고, 지키는 것은 지금 사라질 원본이다.
// (슬롯이 차면 쓰기를 영구 차단하는 대안은 불변식은 지키지만 앱이 그 키를 저장하지 못하고 얼어붙는다.)
export const corruptSlots = (key) => [key + CORRUPT_SUFFIX, key + CORRUPT_SUFFIX + ".2"];

function backupCorrupt(key, raw) {
  const [first, latest] = corruptSlots(key);
  const holds = (slot) => { try { return localStorage.getItem(slot) === raw; } catch { return false; } };

  // 쓰기를 시도하기 '전에' 두 슬롯을 모두 확인한다. 첫 슬롯 setItem 이 쿼터로 던진다는 이유로
  // 두 번째 슬롯에 이미 안전하게 보관된 원본을 못 보고 '백업 실패'로 판정하면, 쓰기가 불필요하게 막힌다.
  if (holds(first) || holds(latest)) return true;

  try {
    if (localStorage.getItem(first) == null) {
      localStorage.setItem(first, raw);
      return localStorage.getItem(first) === raw;
    }
    localStorage.setItem(latest, raw); // 두 슬롯이 다른 내용으로 차 있다 → 최근 슬롯을 밀어낸다
    return localStorage.getItem(latest) === raw;
  } catch {
    return false; // 저장소에 아예 쓸 수 없다 → 백업 실패. 이 경우에만 쓰기가 막힌다.
  }
}

function readJSON(key) {
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null; // 저장소 자체를 못 읽는 환경(사파리 프라이빗 등)
  }
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    corrupted.set(key, { backedUp: backupCorrupt(key, raw) });
    emitIssue();
    return null;
  }
}

const isParsable = (raw) => { try { JSON.parse(raw); return true; } catch { return false; } };

// 이 키를 지금 덮어써도 되는지 판정한다. **매번 실제 상태를 다시 확인한다** —
// backedUp:true 는 과거의 기록일 뿐이고, 그 사이 다른 탭이나 브라우저의 저장소 정리로
// 슬롯이 사라졌다면 그 기록은 거짓이다.
// 백업을 재시도하므로, 공간이 생겼다면 막혔던 키가 다시 쓰기 가능해진다.
function ensureWritable(key) {
  if (!corrupted.has(key)) return true;
  let raw;
  try { raw = localStorage.getItem(key); } catch { return false; } // 저장소를 못 읽으면 보장할 수 없다
  if (raw == null) return true;       // 지킬 원본이 없다
  // 이미 덮였거나 복원되어 더 이상 손상본이 아니다 → 다시 백업하면 정상 값이 손상 백업을 밀어낸다.
  if (isParsable(raw)) return true;
  const ok = backupCorrupt(key, raw);
  corrupted.set(key, { backedUp: ok });
  return ok;
}

function writeJSON(key, val) {
  // 손상된 키에 쓸 때는 '지금 이 순간' 원본이 백업돼 있는지 다시 확인한다.
  // backedUp:true 는 과거 시점의 기록일 뿐이다 — 그 뒤 다른 탭이나 브라우저의 저장소 정리로
  // 슬롯이 사라졌다면 그 기록은 거짓이 되고, 우리는 백업 없는 원본을 덮어쓰게 된다.
  // (정상 키는 corrupted 에 없으므로 이 경로를 타지 않는다 — 일반 저장 성능에 영향 없음.)
  if (corrupted.has(key) && !ensureWritable(key)) { emitIssue(); return false; }
  try {
    localStorage.setItem(key, JSON.stringify(val));
    // 쓰기가 다시 성공했다 = 공간이 생겼다. 경고를 걷는다(그러지 않으면 배너가 새로고침까지 남는다).
    if (quotaHit) { quotaHit = false; emitIssue(); }
    return true;
  } catch (e) {
    if (isQuotaError(e) && !quotaHit) { quotaHit = true; emitIssue(); }
    return false; // 조용히 삼키지 않는다 — 호출측이 알 수 있다
  }
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
// 배열은 객체가 아니다. `typeof [] === "object"` 라 순진하게 걸러내면 배열 행이 통과해
// `{"0":1,"1":2,"id":"..."}` 같은 쓰레기 행으로 저장된다.
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
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
// save* 는 성공 여부(boolean)를 반환한다. 호출측이 useEffect 축약형으로 쓰면 그 값이
// cleanup 으로 해석되므로 반드시 블록 본문으로 감쌀 것(App.jsx 참고).
export function saveCalcState(settings, charges, items) {
  return writeJSON(KEY, serializeCalcState(settings, charges, items));
}

// ===== 자주 쓰는 아이템 =====
// 아이템에도 **결정적 id** 를 준다(B-2b). 랜덤 id 면 두 기기가 같은 아이템을 다른 것으로 보고
// 병합에서 중복시킨다. id 는 이름에서 유도한다 — 이름이 아이템의 정체성이다.
// 같은 이름이 여럿이면 등장 순번으로 가른다(원장과 같은 규칙).
// `_k` 는 React key 다. id 와 같은 값으로 두면 병합 후에도 같은 행이 리마운트되지 않는다.
export function canonicalizeMyItems(rows) {
  const nth = occurrenceCounter();
  return asArray(rows)
    .filter(isPlainObject)
    .map((x) => {
      const row = { ...x };
      if (!safeRowId(row.id)) row.id = legacyRowId(MY_ITEM_ID_FIELDS, row, nth(rowContentKey(MY_ITEM_ID_FIELDS, row)));
      // `at` = 이 아이템이 목록에 들어온 시각. 삭제 표식과 시각을 비교해 '다시 추가'를 표현한다(아래 참고).
      // 숫자가 아니면 없는 것으로 본다 — 그러면 어떤 표식이든 이긴다(삭제가 유지된다).
      if (!Number.isFinite(+row.at)) delete row.at;
      row._k = row.id;
      return row;
    });
}

// 이 아이템이 삭제 표식에 의해 지워진 상태인가.
//
// id 를 이름에서 유도하기 때문에, 표식이 있으면 **같은 이름을 다시 추가해도 곧바로 다시 지워진다.**
// 그래서 시각을 비교한다: 표식보다 나중에 추가된 아이템은 살아남는다("지웠다가 다시 넣었다").
// `at` 이 없는 구 데이터는 표식보다 이전으로 취급한다 — 삭제가 유지되는 쪽이 안전하다.
export function isItemDeleted(deleted, item) {
  if (!deleted || !item) return false;
  const key = itemTombstoneKey(item.id);
  if (!hasOwn(deleted, key)) return false;
  const ts = +deleted[key];
  const at = +item.at;
  return !(Number.isFinite(at) && Number.isFinite(ts) && at > ts);
}

// `[]` 는 '사용자가 목록을 비웠다'는 뜻이고, `null`/배열 아님은 '저장된 데이터가 없다'는 뜻이다.
// 예전에는 둘을 구분하지 못해(`d.length` 검사) 아이템을 전부 지워도 다음 로드에서 기본 목록이 되살아났다.
export function normalizeMyItems(d) {
  return canonicalizeMyItems(Array.isArray(d) ? d : DEFAULT_ITEMS);
}
export function loadMyItems() {
  return normalizeMyItems(readJSON(ITEMS_KEY));
}
export const saveMyItems = (items) => writeJSON(ITEMS_KEY, items);

// 아이템 id → 삭제 표식 키. 거래 id 와 섞이지 않게 네임스페이스를 붙인다.
export const itemTombstoneKey = (id) => ITEM_TOMBSTONE_PREFIX + id;
export const isItemTombstone = (key) => typeof key === "string" && key.startsWith(ITEM_TOMBSTONE_PREFIX);

// 아이템 삭제 = 목록에서 제거 + 표식 기록. 배열에서 빼기만 하면 그 아이템을 아직 가진 기기가 되살린다.
// 표식은 `ledger.deleted` 에 함께 산다(구버전 탭도 모르는 키를 보존해 전파한다 — 자가 치유).
export function deleteMyItem(myItems, ledger, id, now = Date.now()) {
  if (!safeRowId(id)) return { myItems, ledger }; // 표식을 남길 수 없는 id → 삭제도 하지 않는다
  const rows = asArray(myItems);
  const target = rows.find((x) => x && x.id === id);
  const deleted = { ...normalizeDeleted(ledger && ledger.deleted, null) };
  // 표식은 그 아이템의 `at` 보다 반드시 나중이어야 한다. 시계가 틀어져 at 이 미래면
  // `at > ts` 가 되어 삭제가 먹히지 않는다(지워도 그대로 남는 아이템).
  const at = target && Number.isFinite(+target.at) ? +target.at : -Infinity;
  deleted[itemTombstoneKey(id)] = Math.max(now, at + 1);
  return {
    myItems: rows.filter((x) => x && x.id !== id),
    ledger: { ...ledger, deleted },
  };
}

// '기본 목록 복원' — 지금 목록을 기본값으로 바꾼다.
// 지운 기본 아이템의 표식이 클라우드에 남아 있으면(표식은 합집합이라 로컬에서 지워도 되살아난다)
// 복원해도 병합에서 다시 빠진다. 그래서 복원 시각을 `at` 으로 찍어 표식을 이기게 한다.
export function restoreDefaultMyItems(now = Date.now()) {
  return canonicalizeMyItems(DEFAULT_ITEMS.map((x) => ({ ...x, at: now })));
}

// ===== 거래 원장 · 삭제 표식(tombstone) =====
// 삭제는 '항목이 없다'는 사실이라, id 합집합 병합으로는 표현할 수 없다.
// 그래서 삭제된 id 를 시각과 함께 ledger.deleted 에 남겨 다른 기기로 전파한다.
//
// 규칙:
//  · 병합 시 tombstone 에 든 id 는 어느 쪽 버킷에 있든 제거한다(삭제 우선).
//    → 한쪽이 지우고 다른 쪽이 수정했다면 '삭제'가 이긴다. 되살아나는 것보다 낫다.
//  · tombstone 은 TTL 후 만료(원장이 무한히 커지지 않도록).
//  · 키는 JSON 에서 오므로 프로토타입 오염과 "toString" 같은 상속 키에 안전해야 한다
//    → 항상 hasOwn 으로 확인하고, 위험 키는 애초에 받지 않는다.
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// now = null 이면 형태 검증만 하고 TTL 정리·미래 clamp 를 하지 않는다.
// **로컬 로드에서는 정리하지 않는다.** 기기 시계가 미래로 틀어져 있으면 cutoff 가 함께 밀려
// 정상 tombstone 이 조기 만료로 사라지고, 그 기기가 stale 원장을 올리면 삭제된 항목이 부활한다.
// 정리는 클라우드 병합 때만, 서버가 채운 updated_at(신뢰 가능한 시각) 기준으로 한다.
// 두 시각은 성격이 다르므로 분리한다. 하나로 겸용하면 아래 버그가 난다.
//
//  now(만료 기준)   — 이 시각보다 TTL 이상 오래된 표식을 버린다. **보수적이어야 한다**(적게 만료).
//                     클라이언트 시계를 믿지 않고 서버가 채운 updated_at 을 쓴다.
//  ceiling(상한)    — 이보다 미래인 표식은 여기로 끌어내린다. **'정상적인 지금'이어야 한다.**
//                     max(서버 시각, 내 시계). 조작된 백업의 100년 뒤 표식이 영원히 남는 것을 막는다.
//
// 겸용하면: 오래 접속하지 않은 유저(updated_at 이 2년 전)가 오늘 지운 표식이 2년 전으로 되감기고,
// 업로드 후 updated_at 이 현재가 되면 다음 병합에서 TTL 초과로 조기 만료 → 다른 기기가 부활시킨다.
//
// now = null 이면 만료 정리를 하지 않는다(로컬 로드. 기기 시계가 틀어져도 표식이 사라지지 않게).
export function normalizeDeleted(d, now = null, ceiling = now) {
  const out = {};
  if (!d || typeof d !== "object" || Array.isArray(d)) return out;
  const prune = typeof now === "number" && isFinite(now);
  const clamp = typeof ceiling === "number" && isFinite(ceiling);
  const cutoff = prune ? now - TOMBSTONE_TTL_DAYS * 86400000 : -Infinity;
  Object.keys(d).forEach((id) => {
    if (!id || UNSAFE_KEYS.has(id) || !hasOwn(d, id)) return;
    let t = Number(d[id]);
    if (!isFinite(t) || t <= 0) return; // malformed
    if (clamp && t > ceiling) t = ceiling;
    if (t < cutoff) return; // TTL 만료
    out[id] = t;
  });
  return compactDeleted(out);
}

// 개수 상한. TTL 정리는 서버 시각이 있을 때만 하므로 게스트에게는 적용되지 않는다 →
// 시계와 무관하게(상대 순서만 사용) 증가를 묶는다. 넘치면 오래된 표식부터 버린다.
function compactDeleted(d) {
  const ids = Object.keys(d);
  if (ids.length <= TOMBSTONE_MAX) return d;
  ids.sort((a, b) => d[b] - d[a]); // 최신 우선
  const out = {};
  for (let i = 0; i < TOMBSTONE_MAX; i++) out[ids[i]] = d[ids[i]];
  return out;
}

// 두 tombstone 집합의 합집합. 같은 id 면 더 '늦은' 삭제 시각을 남긴다 —
// tombstone 은 오래 살아야 안전하다(일찍 만료되면 그 항목을 아직 든 기기가 되살린다).
export function mergeDeleted(a, b, now = null, ceiling = now) {
  const out = normalizeDeleted(a, now, ceiling);
  const bb = normalizeDeleted(b, now, ceiling);
  Object.keys(bb).forEach((id) => {
    out[id] = hasOwn(out, id) ? Math.max(out[id], bb[id]) : bb[id];
  });
  return compactDeleted(out); // 합집합이 상한을 넘길 수 있다
}

export const isDeleted = (deleted, id) => !!id && hasOwn(deleted, id);

// id 는 tombstone 의 키가 되므로 문자열이어야 하고, 상속 키여선 안 된다.
// id 가 "__proto__" 인 행은 삭제해도 표식이 기록되지 않아(UNSAFE_KEYS 차단) 다른 기기에서 부활한다.
// 삭제 표식 맵의 키로 안전하게 쓸 수 있는 id 인가.
// `item:` 으로 시작하는 id 는 거부한다 — 아이템 삭제 표식의 네임스페이스와 충돌하면
// 아이템 하나를 지웠을 때 같은 이름의 거래 행이 함께 사라진다(가공된 백업으로 유도 가능).
const safeRowId = (id) =>
  typeof id === "string" && !!id && !UNSAFE_KEYS.has(id) && !id.startsWith(ITEM_TOMBSTONE_PREFIX);

// 현금화: 구 데이터(판매현금 won 직접 입력) → 억당(rate) 기반으로 승계.
// meso가 0/빈값이면 rate를 만들 수 없으므로 그대로 두고(won 폴백 유지) 데이터 손실을 막는다.
// **id 유도보다 먼저** 돌려야 한다 — rate 가 id 필드라, 한 기기는 won 만 갖고 다른 기기는 rate 도 가진
// 같은 거래가 서로 다른 id 를 얻어 병합에서 2건이 된다(Codex 지적).
function deriveCashRate(c) {
  if ((c.rate == null || c.rate === "") && c.won != null && +c.meso > 0) c.rate = +c.won / +c.meso;
}

// 한 버킷의 행들을 **정규 형태**로 만든다: 날짜 zero-pad → 파생값 유도 → id 부여.
// 이 순서가 곧 계약이다. id 는 행의 내용에서 유도되므로, 내용을 정규화하기 전에 id 를 만들면
// 같은 거래가 기기마다 다른 id 를 얻는다.
//
// id 없는 행에는 **결정적** id 를 준다(B-7). 랜덤 id 를 주면 같은 백업을 연 두 기기가 같은 거래에
// 다른 id 를 만들고, 병합이 id 합집합이라 거래가 두 배로 불어난다.
// 순번은 'id 없는 행'끼리만 센다 — 이미 id 가 있는 행은 두 기기에서 같은 id 를 가지므로 셈에서 빠져야
// 나머지 행의 순번이 어긋나지 않는다.
//
// 입력 행을 제자리 변형하지 않는다(M-7). 호출자가 넘긴 객체(클라우드 응답 등)를 오염시키면 안 된다.
// 이미 정규화된 입력에 다시 적용해도 결과가 같다(멱등) — mergeLedger 가 양쪽에 무조건 적용하기 때문.
export function canonicalizeRows(bucket, rows) {
  const fields = LEDGER_ID_FIELDS[bucket];
  const nth = occurrenceCounter();
  return asArray(rows)
    // 원소가 객체가 아니면(문자열·null·배열 등) 뒤따르는 x.id 접근이 던지거나 쓰레기 행이 된다 → 걸러낸다.
    .filter(isPlainObject)
    .map((x) => {
      const row = { ...x };
      if (row.date != null) row.date = padDate(row.date);
      if (bucket === "cashes") deriveCashRate(row);
      if (!safeRowId(row.id)) row.id = fields ? legacyRowId(fields, row, nth(rowContentKey(fields, row))) : uid();
      return row;
    });
}

export function normalizeLedger(d, now = null, ceiling = now) {
  const src = d && typeof d === "object" && !Array.isArray(d) ? d : {};
  const led = { deleted: normalizeDeleted(src.deleted, now, ceiling) };
  LEDGER_BUCKETS.forEach((k) => {
    // 로컬에 tombstone 이 있는데 항목도 남아 있으면(가져오기·구데이터) 삭제를 존중한다.
    led[k] = canonicalizeRows(k, src[k]).filter((x) => !isDeleted(led.deleted, x.id));
  });
  return led;
}

// 항목 삭제 = 버킷에서 제거 + tombstone 기록. 삭제 경로는 반드시 이 함수를 거쳐야 전파된다.
export function deleteLedgerEntry(ledger, kind, id, now = Date.now()) {
  if (!safeRowId(id)) return ledger; // 표식을 남길 수 없는 id → 삭제도 하지 않는다(조용한 부활 방지)
  const deleted = { ...normalizeDeleted(ledger.deleted, null) }; // 삭제 시점에 TTL 정리하지 않는다
  deleted[id] = now;
  return {
    ...ledger,
    [kind]: asArray(ledger[kind]).filter((x) => x.id !== id),
    deleted,
  };
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
    ledger: readJSON(LKEY) || emptyLedger(),
  };
}
export const emptyLedger = () => ({ buys: [], sells: [], cashes: [], spends: [], deleted: {} });
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
    const keys = [KEY, ITEMS_KEY, LKEY, SYNC_KEY, TOUCHED_KEY, OWNER_KEY];
    keys.forEach((k) => localStorage.removeItem(k));
    // 손상 백업(.corrupt)에는 원장 원본이 그대로 들어 있다 → 공용 브라우저에 남기지 않는다.
    // 소유자 마커로 막으려던 바로 그 유출 경로다.
    [KEY, ITEMS_KEY, LKEY].forEach((k) => corruptSlots(k).forEach((s) => localStorage.removeItem(s)));
    corrupted.clear();
    emitIssue();
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

// 손상되어 파싱하지 못한 원본을 그대로 담는다. 백업 파일이 유일한 복구 수단이므로
// 읽지 못한 데이터도 함께 나가야 한다(나중에 손으로 고칠 수 있다).
function collectCorruptRaw() {
  const out = {};
  [KEY, ITEMS_KEY, LKEY].forEach((k) => {
    corruptSlots(k).forEach((slot) => {
      try {
        const raw = localStorage.getItem(slot);
        if (raw != null) out[slot] = raw;
      } catch { /* ignore */ }
    });
  });
  return Object.keys(out).length ? out : undefined;
}

// ===== 내보내기 / 가져오기 =====
export function exportAll() {
  const data = {
    app: "mvp-calculator",
    version: BACKUP_VERSION,
    // 순간(instant)은 UTC ISO 로 남긴다. 아래 파일명의 날짜와 달리 이건 시각이지 민간 날짜가 아니다.
    exportedAt: new Date().toISOString(),
    corruptRaw: collectCorruptRaw(),
    calc: readJSON(KEY),
    myItems: readJSON(ITEMS_KEY),
    ledger: readJSON(LKEY),
    calMode: loadCalMode(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  // 파일명의 날짜는 사용자가 읽는 '오늘'이다 → KST 기준(UTC 를 쓰면 아침 9시 이전 내보내기가 어제 날짜로 찍힌다).
  a.download = "mvp-calculator-backup-" + todayStr() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// 성공 시 true 반환. 적용 후 페이지 리로드 권장(모든 상태 재초기화).
// ===== 백업 파일 검증 (B-6) =====
// 예전에는 `data.app` 문자열 하나만 보고 파일 내용을 그대로 localStorage 에 썼다.
// 형태가 깨진 값은 크래시하진 않았지만(데이터 계층 가드) 다음 로드에서 조용히 기본값으로 떨어졌다 —
// 사용자는 "복원 완료"를 보고 데이터가 사라진 것을 나중에야 안다.
//
// 두 종류를 구분한다:
//  · **거절(error)** — 파일이 이 앱의 것이 아니거나 형태가 근본적으로 틀렸다. 아무것도 쓰지 않는다.
//  · **경고(warnings)** — 복원은 하되 조용히 넘어가면 안 되는 사실(버려진 행, 집계에서 빠질 날짜).
const BACKUP_VERSION = 1;
const CAL_MODES = ["month", "mvp"];
// 주차 집계·규칙 선택이 전부 사전식 문자열 비교다 → 이 형태가 아니면 어느 주에도 잡히지 않는다.
// 형태만 보면 "2026-99-99" 나 "2026-02-30" 같은 **달력에 없는 날짜**를 통과시킨다. 그런 행은
// 어떤 주에도 잡히지 않으면서 경고도 못 받는다 → 실제 날짜인지 왕복 검사한다.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const isValidDate = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  // Date 를 쓰지 않는다: `new Date(99, 0, 1)` 은 0099년이 아니라 1999년이고, 로컬 타임존/DST 도 끼어든다.
  // 민간 날짜는 산술로 검사하는 것이 옳다(B-4 와 같은 원칙).
  const max = m === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[m - 1];
  return d >= 1 && d <= max;
};

export function validateBackup(data) {
  if (!isPlainObject(data) || data.app !== "mvp-calculator") {
    return { ok: false, error: "이 앱의 백업 파일이 아닙니다." };
  }
  // version 키가 아예 없는 파일은 초기 내보내기(v1)로 본다. 하지만 `"version": null` 처럼 값이 있는데
  // 정수가 아니면 거절한다 — 형태를 모르는 파일이다. 미래 버전도 거절한다:
  // 모르는 형태를 '최선을 다해' 쓰면 조용히 데이터를 잃는다.
  const version = data.version === undefined ? 1 : data.version;
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, error: "백업 파일의 버전 정보가 올바르지 않습니다." };
  }
  if (version > BACKUP_VERSION) {
    return { ok: false, error: `더 최신 버전(v${version})의 백업 파일입니다. 앱을 새로고침한 뒤 다시 시도해 주세요.` };
  }
  if (data.calc == null && data.myItems == null && data.ledger == null) {
    return { ok: false, error: "복원할 데이터가 없는 파일입니다." };
  }
  if (data.calc != null && !isPlainObject(data.calc)) {
    return { ok: false, error: "백업 파일의 계산기 설정 형태가 올바르지 않습니다." };
  }
  if (data.myItems != null && !Array.isArray(data.myItems)) {
    return { ok: false, error: "백업 파일의 아이템 목록 형태가 올바르지 않습니다." };
  }
  if (data.ledger != null) {
    if (!isPlainObject(data.ledger)) {
      return { ok: false, error: "백업 파일의 거래 기록 형태가 올바르지 않습니다." };
    }
    // 버킷이 배열이 아니면 조용히 []로 강등하지 않고 거절한다 — 거래 전체가 소리 없이 사라진다.
    const bad = LEDGER_BUCKETS.filter((k) => data.ledger[k] != null && !Array.isArray(data.ledger[k]));
    if (bad.length) {
      return { ok: false, error: `백업 파일의 거래 기록이 손상되었습니다(${bad.join(", ")}).` };
    }
    if (data.ledger.deleted != null && !isPlainObject(data.ledger.deleted)) {
      return { ok: false, error: "백업 파일의 삭제 기록 형태가 올바르지 않습니다." };
    }
  }

  // 여기부터는 복원을 진행하되 사용자에게 알린다.
  const warnings = [];
  if (data.ledger) {
    let dropped = 0, badDates = 0;
    LEDGER_BUCKETS.forEach((k) => {
      (data.ledger[k] || []).forEach((row) => {
        if (!isPlainObject(row)) { dropped++; return; }
        if (!isValidDate(padDate(row.date))) badDates++;
      });
    });
    if (dropped) warnings.push(`거래 ${dropped}건은 형태가 깨져 있어 제외했습니다.`);
    if (badDates) warnings.push(`거래 ${badDates}건의 날짜를 읽을 수 없어 주차·월별 집계에서 빠집니다.`);
  }
  if (data.myItems) {
    const bad = data.myItems.filter((x) => !isPlainObject(x) || typeof x.name !== "string").length;
    if (bad) warnings.push(`아이템 ${bad}개는 형태가 깨져 있어 제외했습니다.`);
  }
  if (data.calMode != null && !CAL_MODES.includes(data.calMode)) {
    warnings.push("달력 보기 설정을 읽을 수 없어 기본값을 씁니다.");
  }
  return { ok: true, warnings };
}

export function importAll(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON 파일을 읽을 수 없습니다." };
  }
  const v = validateBackup(data);
  if (!v.ok) return v;

  // 이 파일이 실제로 덮어쓸 키만 대상으로 한다(없는 키의 가드를 풀면 안 된다).
  const targets = [];
  if (data.calc) targets.push(KEY);
  if (data.myItems) targets.push(ITEMS_KEY);
  if (data.ledger) targets.push(LKEY);

  // 차단은 '쓰기 성공 뒤에' 푼다. 먼저 풀고 쓰기가 실패하면 가드가 사라진 채 남아,
  // 이후 자동저장이 백업 없는 원본을 덮어쓴다 — 이 기능이 막으려던 바로 그 파괴다.
  // 대신 여기서 백업을 재시도해, 백업할 수 있으면 쓰기를 허용한다.
  const blocked = targets.filter((k) => !ensureWritable(k));
  if (blocked.length) {
    return { ok: false, error: "손상된 원본을 백업하지 못해 복원하지 않았습니다. 브라우저 저장소를 정리한 뒤 다시 시도해 주세요." };
  }

  // 파일 내용을 그대로 쓰지 않고 **정규 형태로 바꿔서** 쓴다.
  // 그대로 쓰면 형태가 어긋난 값이 저장소에 남고, 다음 로드에서 조용히 기본값으로 떨어진다.
  const writes = [];
  if (data.calc) {
    const { settings, charges, items } = parseCalcState(data.calc);
    writes.push([KEY, serializeCalcState(settings, charges, items)]);
  }
  // malformed 원소는 걸러 낸다(위에서 개수를 경고로 알렸다). IconView 가 문자열 아닌 icon 에 크래시한다.
  if (data.myItems) writes.push([ITEMS_KEY, data.myItems.filter((x) => isPlainObject(x) && typeof x.name === "string")]);
  // 원장은 검증·정규화해서 쓴다. 파일의 tombstone 은 그대로 클라우드로 전파되어 거래를 지우므로
  // (그게 삭제 전파의 정상 동작이다) 최소한 malformed·미래 시각·만료 표식은 걸러내야 한다.
  // now 를 넘겨 미래 시각을 clamp: 조작된 백업이 '영원히 만료되지 않는' 표식으로 남의 거래를 계속 지우는 것을 막는다.
  // 가져오기는 서버와 무관하므로 만료 기준·clamp 상한이 모두 '지금'이다.
  if (data.ledger) { const t = Date.now(); writes.push([LKEY, normalizeLedger(data.ledger, t, t)]); }

  // 복원은 **전부 아니면 전무**여야 한다. 순서대로 쓰다가 뒤쪽에서 쿼터로 실패하면,
  // 앞쪽 키는 이미 새 값으로 덮인 채 "복원하지 못했습니다"를 돌려주게 된다 —
  // 사용자는 아무 일도 없었다고 믿지만 계산기 설정은 바뀌어 있다.
  // 그래서 쓰기 전에 원본 문자열을 잡아 두고, 하나라도 실패하면 되돌린다.
  //
  // 캡처 실패(getItem 예외)를 `null`(원래 없던 키)과 같은 값으로 뭉개면 안 된다 —
  // 롤백이 그 키를 **지워버린다**. 읽지 못한 원본은 되돌릴 수 없으므로, 그 경우엔 아무것도 쓰지 않는다.
  const prior = new Map();
  for (const [k] of writes) {
    try { prior.set(k, localStorage.getItem(k)); }
    catch { return { ok: false, error: "브라우저 저장소를 읽을 수 없어 복원하지 못했습니다." }; }
  }
  const restore = (k) => {
    const raw = prior.get(k); // null = 복원 전에 그 키가 없었다(캡처 실패와 구분됨)
    try {
      if (raw == null) localStorage.removeItem(k);
      else localStorage.setItem(k, raw);
      return true;
    } catch { return false; }
  };

  const done = [];
  for (const [k, val] of writes) {
    if (writeJSON(k, val)) { done.push(k); continue; }
    // 이 경우 손상 표시는 그대로 둔다 — 원본은 여전히 백업본에만 있다.
    // `.every(restore)` 는 첫 실패에서 단락되어 나머지 키를 되돌리지 않는다.
    // 하나를 못 되돌린다고 나머지까지 새 값으로 남길 이유가 없다 → 전부 시도한 뒤 판정한다.
    const rolledBack = done.map(restore).every(Boolean);
    return {
      ok: false,
      error: rolledBack
        ? "저장 공간이 부족해 복원하지 못했습니다. 브라우저 저장소를 비운 뒤 다시 시도해 주세요."
        : "저장 공간이 부족해 복원에 실패했고, 일부 데이터를 되돌리지 못했습니다. 브라우저 저장소를 비운 뒤 백업 파일로 다시 복원해 주세요.",
    };
  }
  // JSON 키를 모두 쓴 뒤에만 부수적인 설정을 건드린다(실패 시 되돌릴 것이 없도록).
  // 아는 값만 쓴다. 임의 문자열을 넣으면 달력이 어느 모드도 아닌 상태로 렌더된다.
  if (CAL_MODES.includes(data.calMode)) saveCalMode(data.calMode);
  // 전부 성공했다 = 사용자가 이 키들을 의도적으로 복원했다 → 손상 표시를 걷는다.
  // 백업 슬롯(.corrupt)은 **남긴다**. 슬롯이 차도 최근 슬롯을 밀어내므로 다음 손상 백업을 막지 않고,
  // 사용자가 내보내기를 하지 않았다면 이게 복원 이전 원본의 유일한 사본이다. 지우는 쪽이 더 파괴적이다.
  // (로그아웃·저장소 정리 시에는 clearAccountData 가 함께 지운다 — 공용 브라우저 프라이버시.)
  targets.forEach(clearCorruptFlag);
  return { ok: true, warnings: v.warnings };
}
