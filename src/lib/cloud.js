import { supabase, cloudEnabled } from "./supabaseClient.js";
import { clearCloudSynced } from "./storage.js";

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
export function signOut() {
  clearCloudSynced(); // 재로그인 시 게스트↔클라우드 선택을 다시 판별하도록 마커 제거
  return supabase.auth.signOut();
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
export async function upsertUserData(userId, snap) {
  const { error } = await supabase
    .from("user_data")
    .upsert(
      { user_id: userId, calc: snap.calc, my_items: snap.my_items, ledger: snap.ledger },
      { onConflict: "user_id" }
    );
  if (error) throw error;
}

// ===== 병합 (최초 로그인 시 로컬 ↔ 클라우드) =====
// ledger는 항목 id 기준 합집합 → 거래 손실 없음.
// calc/my_items는 클라우드가 비어있지 않으면 클라우드 우선하되, 이 기기에서 게스트로
// 거래를 기록한 적이 있으면(=localActive) conflict=true로 표시해 App이 사용자에게 선택을 묻는다.
// 반환: { snapshot: {calc,my_items,ledger}, conflict: boolean }
// opts.localTouched: 이 기기에서 사용자가 계산기/아이템을 직접 편집했는지(거래 없이 설정만 바꾼 경우 포착 — P1-4).
export function mergeSnapshots(local, cloud, opts = {}) {
  if (!cloud) return { snapshot: local, conflict: false };
  const ledger = mergeLedger(local.ledger, cloud.ledger);
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
function mergeLedger(a = {}, b = {}) {
  const out = {};
  ["buys", "sells", "cashes", "spends"].forEach((k) => {
    const map = new Map();
    (a[k] || []).forEach((x) => { if (x && x.id) map.set(x.id, x); });
    // 같은 id면 클라우드(b) 우선. 항목별 타임스탬프가 없어 정밀 비교는 불가(알려진 한계).
    // 서로 다른 id는 모두 보존되므로 '거래가 사라지는' 손실은 없음.
    (b[k] || []).forEach((x) => { if (x && x.id) map.set(x.id, x); });
    out[k] = [...map.values()];
  });
  return out;
}
