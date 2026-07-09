import { supabase, cloudEnabled } from "./supabaseClient.js";
import { clearAccountData, mergeDeleted, isDeleted } from "./storage.js";
import { LEDGER_BUCKETS } from "./constants.js";

export { cloudEnabled };

// ===== 인증 =====
export function onAuthChange(cb) {
  if (!supabase) { cb(null); return () => {}; }
  supabase.auth.getSession().then(({ data }) => cb(data.session));
  const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return () => sub.subscription.unsubscribe();
}
export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
}
export function signInWithEmail(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
}
// 로그아웃은 '이 기기에서 계정 데이터를 떼어내는' 동작이다.
// 지우기 전에 signOut 성공을 확인한다 — 실패했는데 로컬만 비우면 세션은 살아 있는 채로
// 다음 새로고침에서 빈 로컬이 클라우드와 병합돼 혼란을 준다(구현은 마커만 지워 이 문제가 있었다).
// 데이터는 클라우드에 있으므로 재로그인하면 복원된다. 호출측이 성공 시 페이지를 리로드해 상태를 초기화한다.
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (!error) clearAccountData();
  return { error };
}

// ===== 앱 공용 설정 (app_config 1행, 누구나 읽기) =====
// 시세성 기본값(mesoRate/giftRatio/marketRatio·chargeMethods·defaultItems)을 DB에서 받아온다.
// 실패/오프라인/게스트면 null → 호출부가 constants.js 값으로 폴백.
export async function fetchAppConfig() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("config")
      .eq("id", 1)
      .maybeSingle();
    if (error) { console.warn("[config] 앱 설정 로드 실패", error); return null; }
    return data?.config ?? null;
  } catch (e) {
    console.warn("[config] 앱 설정 로드 예외", e);
    return null;
  }
}

// ===== 피드백 (feedback 테이블, INSERT 전용) =====
// 게스트/로그인 모두 제출 가능. user_id 는 DB default(auth.uid())가 채우므로 클라이언트가 보내지 않는다.
// 반환: { error } — 성공이면 error=null. 클라우드 비활성이면 error에 사유를 담아 호출부가 안내.
export async function submitFeedback({ message, category, email } = {}) {
  if (!supabase) return { error: new Error("cloud-disabled") };
  const msg = String(message ?? "").trim();
  if (!msg) return { error: new Error("empty") };
  const row = {
    message: msg.slice(0, 4000),
    category: category ? String(category).slice(0, 40) : null,
    email: email ? String(email).trim().slice(0, 200) : null,
    user_agent: (typeof navigator !== "undefined" ? navigator.userAgent : "").slice(0, 500),
  };
  const { error } = await supabase.from("feedback").insert(row);
  // DB 트리거(feedback_rate_limit)가 던지는 토큰을 안정적인 사유 코드로 바꿔 UI에 넘긴다.
  if (error && String(error.message || "").includes("feedback_rate_limited")) {
    return { error: new Error("rate-limited") };
  }
  return { error };
}

// ===== 데이터 (user_data 1행) =====
export async function fetchUserData(userId) {
  const { data, error } = await supabase
    .from("user_data")
    .select("calc,my_items,ledger,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data; // 없으면 null
}
// ===== 낙관적 동시성 제어 =====
// 이전에는 무조건 upsert(행 전체 덮어쓰기)였다. 그래서 오래된 스냅샷을 든 탭이 나중에 쓰면
// 다른 탭이 올린 거래와 삭제 표식(tombstone)을 통째로 지웠다 — 삭제 전파의 존재 이유가 무너진다.
//
// 서버가 트리거로 채우는 updated_at 을 '버전'으로 삼는다. 내가 마지막으로 본 버전일 때만 쓰기가 성립하고,
// 그 사이 누가 썼다면 0행이 갱신되어 conflict 로 돌아온다(로컬 PostgreSQL 로 실측 확인).
// 호출측은 다시 읽어 병합한 뒤 재시도한다.
//
// 반환: { updatedAt } 성공 | { conflict: true } 버전 불일치(또는 첫 삽입 경쟁)
export async function writeUserData(userId, snap, expectedUpdatedAt) {
  const row = { calc: snap.calc, my_items: snap.my_items, ledger: snap.ledger };

  // 아직 행이 없다고 알고 있는 경우 → INSERT. 다른 기기가 먼저 만들었으면 23505 로 conflict.
  if (!expectedUpdatedAt) {
    const { data, error } = await supabase
      .from("user_data")
      .insert({ user_id: userId, ...row })
      .select("updated_at")
      .maybeSingle();
    if (!error) return { updatedAt: data?.updated_at ?? null };
    if (error.code === "23505") return { conflict: true };
    throw error;
  }

  const { data, error } = await supabase
    .from("user_data")
    .update(row)
    .eq("user_id", userId)
    .eq("updated_at", expectedUpdatedAt)
    .select("updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { conflict: true }; // 0행 = 그 사이 다른 기기가 씀(또는 행이 사라짐)
  return { updatedAt: data.updated_at };
}

// 업로드 충돌 시의 병합 규칙.
// calc/my_items = 지금 이 탭의 값이 이긴다(사용자가 방금 편집한 것). 설정은 last-writer-wins 로 충분하다.
// ledger = 합집합 + tombstone 차감. 거래는 손실도 부활도 없어야 하므로 여기서만 진짜 병합이 필요하다.
export function mergeForUpload(localSnap, cloud, clientNow = Date.now()) {
  const t = tombstoneClock(cloud, clientNow);
  return {
    calc: localSnap.calc,
    my_items: localSnap.my_items,
    ledger: mergeLedger(localSnap.ledger, cloud ? cloud.ledger : {}, t.now, t.ceiling),
  };
}

// tombstone 시각 파라미터를 한 곳에서 만든다(만료 기준과 clamp 상한을 혼동하지 않도록).
//  now     = 서버 updated_at (없으면 null → 만료 정리 안 함)
//  ceiling = max(서버 시각, 내 시계) — 방금 만든 로컬 표식이 과거로 되감기지 않게.
export function tombstoneClock(cloud, clientNow = Date.now()) {
  const serverNow = cloud ? Date.parse(cloud.updated_at) : NaN;
  const now = isFinite(serverNow) ? serverNow : null;
  const ceiling = Math.max(isFinite(serverNow) ? serverNow : -Infinity, clientNow);
  return { now, ceiling: isFinite(ceiling) ? ceiling : null };
}

// ===== 병합 (최초 로그인 시 로컬 ↔ 클라우드) =====
// ledger는 항목 id 기준 합집합 → 거래 손실 없음.
// calc/my_items는 클라우드가 비어있지 않으면 클라우드 우선하되, 이 기기에서 게스트로
// 거래를 기록한 적이 있으면(=localActive) conflict=true로 표시해 App이 사용자에게 선택을 묻는다.
// 반환: { snapshot: {calc,my_items,ledger}, conflict: boolean }
// opts.localTouched: 이 기기에서 사용자가 계산기/아이템을 직접 편집했는지(거래 없이 설정만 바꾼 경우 포착 — P1-4).
export function mergeSnapshots(local, cloud, opts = {}) {
  if (!cloud) return { snapshot: local, conflict: false };
  const ledger = mergeLedger(local.ledger, cloud.ledger, opts.now, opts.ceiling);
  const cloudHasItems = !!(cloud.my_items && cloud.my_items.length);
  const cloudHasCalc = !!(cloud.calc && Object.keys(cloud.calc).length);
  const my_items = cloudHasItems ? cloud.my_items : local.my_items;
  const calc = cloudHasCalc ? cloud.calc : local.calc;
  const ledgerActive = ["buys", "sells", "cashes", "spends"].some(
    (k) => local.ledger && local.ledger[k] && local.ledger[k].length > 0
  );
  // 거래가 있거나(ledgerActive) 사용자가 설정/아이템을 직접 편집했으면(localTouched) 지켜야 할 로컬 데이터가 있음.
  const localActive = ledgerActive || !!opts.localTouched;
  const conflict = (cloudHasCalc || cloudHasItems) && localActive;
  return { snapshot: { calc, my_items, ledger }, conflict };
}
// id 합집합 + tombstone 차감.
// 합집합만으로는 '삭제'를 표현할 수 없어, 삭제된 항목을 아직 가진 기기가 접속하면 부활시켰다.
// (단일 기기에서도: 삭제 후 디바운스 안에 탭을 닫으면 로컬엔 없고 클라우드엔 있는 상태가 된다.)
// 이제 양쪽 tombstone 을 먼저 합치고, 그 id 는 어느 쪽 버킷에 있든 결과에서 제거한다.
// now     : TTL 만료 기준(서버 updated_at). null 이면 만료 정리를 하지 않는다.
// ceiling : 미래 시각 clamp 상한('정상적인 지금'). 기본은 now 지만 호출측이 max(서버, 로컬)을 넘긴다.
// 거래 생성 시점의 요율. 한 번 정해지면 바뀌지 않는 사실이므로, 병합에서 절대 잃지 않는다.
const SNAPSHOT_KEYS = ["_fee", "_effD"];
function keepSnapshots(prev, next) {
  let out = next;
  SNAPSHOT_KEYS.forEach((k) => {
    if (next[k] == null && prev[k] != null) out = { ...out, [k]: prev[k] };
  });
  return out;
}

export function mergeLedger(a = {}, b = {}, now = null, ceiling = now) {
  const out = {};
  // 클라우드 행이 malformed(버킷이 배열 아님)여도 병합이 던지지 않아야 한다 — 던지면 로그인 자체가 실패한다.
  const arr = (v) => (Array.isArray(v) ? v : []);
  const deleted = mergeDeleted(a && a.deleted, b && b.deleted, now, ceiling);
  LEDGER_BUCKETS.forEach((k) => {
    const map = new Map();
    arr(a[k]).forEach((x) => { if (x && x.id) map.set(x.id, x); });
    // 같은 id면 클라우드(b) 우선. 항목별 타임스탬프가 없어 정밀 비교는 불가(알려진 한계).
    // 서로 다른 id는 모두 보존되므로 '거래가 사라지는' 손실은 없음.
    arr(b[k]).forEach((x) => {
      if (!x || !x.id) return;
      // 예외: 요율 스냅샷(_fee/_effD)은 '그때 그랬다'는 불변의 사실이다. 한쪽에만 있으면 살린다.
      // (스냅샷 없이 만든 구버전 클라이언트의 행이 스냅샷 있는 행을 덮어써 요율이 소실되는 것을 막는다.)
      const prev = map.get(x.id);
      map.set(x.id, prev ? keepSnapshots(prev, x) : x);
    });
    // 삭제 우선: 한쪽이 지우고 다른 쪽이 수정했어도 되살리지 않는다.
    out[k] = [...map.values()].filter((x) => !isDeleted(deleted, x.id));
  });
  out.deleted = deleted;
  return out;
}
