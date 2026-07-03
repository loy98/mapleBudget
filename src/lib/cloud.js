import { supabase, cloudEnabled } from "./supabaseClient.js";

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
  return supabase.auth.signOut();
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
// ledger는 항목 id 기준 합집합 → 거래 손실 없음. calc/my_items는 클라우드가 비어있지 않으면 클라우드 우선.
export function mergeSnapshots(local, cloud) {
  if (!cloud) return local;
  const ledger = mergeLedger(local.ledger, cloud.ledger);
  const my_items = cloud.my_items && cloud.my_items.length ? cloud.my_items : local.my_items;
  const calc = cloud.calc && Object.keys(cloud.calc).length ? cloud.calc : local.calc;
  return { calc, my_items, ledger };
}
function mergeLedger(a = {}, b = {}) {
  const out = {};
  ["buys", "sells", "cashes", "spends"].forEach((k) => {
    const map = new Map();
    (a[k] || []).forEach((x) => { if (x && x.id) map.set(x.id, x); });
    (b[k] || []).forEach((x) => { if (x && x.id) map.set(x.id, x); }); // 같은 id면 클라우드 우선
    out[k] = [...map.values()];
  });
  return out;
}
