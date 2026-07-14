import { supabase, cloudEnabled } from "./supabaseClient.js";
import { clearAccountData, mergeDeleted, isDeleted, canonicalizeRows, canonicalizeMyItems, isItemDeleted } from "./storage.js";
import { LEDGER_BUCKETS } from "./constants.js";
import { hasSnapshot, uid } from "./util.js";
import { ATTACH_MAX_FILES, attachmentPath } from "./feedback.js";

export { cloudEnabled };

// 문의 첨부 이미지 버킷(비공개). supabase/schema.sql 의 버킷 id 와 같아야 한다.
export const ATTACH_BUCKET = "feedback-attachments";

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

// ===== 피드백 (feedback 테이블) =====
// 게스트/로그인 모두 제출 가능. user_id 는 DB default(auth.uid())가 채우므로 클라이언트가 보내지 않는다.
// 상태(status)·답변(reply)도 보내지 않는다 — DB 트리거가 덮어쓴다(위조 방지).
// 반환: { error } — 성공이면 error=null. 클라우드 비활성이면 error에 사유를 담아 호출부가 안내.
export async function submitFeedback({ message, category, email, attachments } = {}) {
  if (!supabase) return { error: new Error("cloud-disabled") };
  const msg = String(message ?? "").trim();
  if (!msg) return { error: new Error("empty") };
  const row = {
    message: msg.slice(0, 4000),
    category: category ? String(category).slice(0, 40) : null,
    email: email ? String(email).trim().slice(0, 200) : null,
    user_agent: (typeof navigator !== "undefined" ? navigator.userAgent : "").slice(0, 500),
    attachments: Array.isArray(attachments) ? attachments.slice(0, ATTACH_MAX_FILES) : [],
  };
  const { error } = await supabase.from("feedback").insert(row);
  // DB 트리거(feedback_rate_limit)가 던지는 토큰을 안정적인 사유 코드로 바꿔 UI에 넘긴다.
  if (error && String(error.message || "").includes("feedback_rate_limited")) {
    return { error: new Error("rate-limited") };
  }
  if (error && String(error.message || "").includes("feedback_bad_attachment")) {
    return { error: new Error("bad-attachment") };
  }
  return { error };
}

// ===== 문의 첨부 (Storage: feedback-attachments, 비공개) =====
// 로그인 유저만. 경로는 `<uid>/<uuid>.<ext>` — 첫 폴더가 소유자라는 규약 위에 RLS 가 서 있다.
//
// **업로드가 먼저, INSERT 가 나중이다.** 순서를 뒤집으면 첨부 없는 문의 행이 먼저 생기고,
// 업로드가 실패했을 때 그 행을 고칠 방법이 없다(유저에게 UPDATE 권한이 없다).
// 반대로 이 순서에서는 업로드만 성공하고 INSERT 가 실패해도 고아 파일이 남을 뿐,
// 사용자는 "전송 실패"를 보고 다시 보낼 수 있다 — 데이터가 어긋나지 않는다.
export async function uploadFeedbackAttachments(files, userId, onProgress) {
  if (!supabase) return { paths: [], error: new Error("cloud-disabled") };
  if (!userId) return { paths: [], error: new Error("login-required") };
  const paths = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = attachmentPath(userId, f, uid());
    const { error } = await supabase.storage
      .from(ATTACH_BUCKET)
      .upload(path, f, { contentType: f.type, upsert: false });
    if (error) {
      // 이미 올라간 것들은 지운다 — 문의에 매달리지 못한 파일은 쓰레기다(스토리지 요금).
      // 지우기가 실패해도 무시한다: 사용자에게 보여줄 결과는 '전송 실패' 하나뿐이다.
      if (paths.length) await supabase.storage.from(ATTACH_BUCKET).remove(paths).catch(() => {});
      const rateLimited = String(error.message || "").includes("row-level security");
      return { paths: [], error: new Error(rateLimited ? "attach-rejected" : "upload-failed") };
    }
    paths.push(path);
    onProgress?.(i + 1, files.length);
  }
  return { paths, error: null };
}

// 비공개 버킷이라 공개 URL 이 없다. 짧은 수명의 서명 URL 로만 본다.
// 실패한 경로는 null 로 남긴다(한 장이 깨져도 나머지는 보여준다).
export async function signedAttachmentUrls(paths, expiresIn = 600) {
  if (!supabase || !Array.isArray(paths) || !paths.length) return {};
  const { data, error } = await supabase.storage.from(ATTACH_BUCKET).createSignedUrls(paths, expiresIn);
  if (error || !Array.isArray(data)) return {};
  const map = {};
  data.forEach((d) => {
    if (d && d.path && d.signedUrl) map[d.path] = d.signedUrl;
  });
  return map;
}

// ===== 내 문의 내역 =====
// RLS(feedback_select_own)가 본인 행만 돌려준다. 게스트로 보낸 문의(user_id=null)는 나오지 않는다 —
// 누구 것인지 증명할 방법이 없기 때문이다(로그인 후 문의해야 내역에 남는다는 것을 UI 가 안내한다).
export async function fetchMyFeedback(limit = 50) {
  if (!supabase) return { rows: [], error: new Error("cloud-disabled") };
  const { data, error } = await supabase
    .from("feedback")
    .select("id,created_at,category,message,status,reply,replied_at,attachments")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error };
  // DB 값을 그대로 믿지 않는다(malformed 원소 렌더 크래시 방지 — CLAUDE.md).
  const rows = (data || [])
    .filter((r) => r && typeof r.message === "string")
    .map((r) => ({
      ...r,
      attachments: Array.isArray(r.attachments) ? r.attachments.filter((p) => typeof p === "string") : [],
    }));
  return { rows, error: null };
}

// ===== 계정 삭제(탈퇴) =====
// 서버의 delete_account() RPC 가 지운다: user_data(동기화 데이터) + auth 계정.
// 피드백은 내용을 남기고 작성자·회신 이메일만 지운다(방침: 접수일로부터 1년 보관).
//
// 인자가 없다 — 대상은 언제나 JWT 의 본인이다. 남의 계정을 지정할 방법이 아예 없다.
// 성공하면 이 기기의 로컬 데이터도 지우고(공용 브라우저), 세션을 끊는다.
// signOut 이 실패해도 계정은 이미 서버에서 사라졌으므로 성공으로 본다 — 남은 토큰은 무효다.
export async function deleteAccount() {
  if (!supabase) return { error: new Error("cloud-disabled") };
  const { error } = await supabase.rpc("delete_account");
  if (error) return { error };
  try { await supabase.auth.signOut(); } catch { /* 계정은 이미 없다 */ }
  clearAccountData();
  return { error: null };
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

// ===== 자주 쓰는 아이템 병합 (B-2b) =====
// 예전에는 이 탭의 배열이 통째로 이겼다(last-writer-wins). 그래서 오래된 스냅샷을 든 탭이 업로드하면
// **다른 탭에서 추가한 아이템이 사라졌다.**
//
// 이제 id 합집합 + 삭제 표식 차감이다(원장과 같은 규칙). 표식은 `ledger.deleted` 안에
// `item:<id>` 네임스페이스로 산다 → 구버전 탭도 모르는 키를 보존하므로, 신버전이 만든 삭제는 살아남는다.
// (구버전 탭 **자신의** 삭제는 표식이 없어 합집합에서 부활한다 — 표식 이전과 같은 한계다.)
//
// `winner` 는 **같은 id 일 때** 어느 쪽 내용을 쓸지 정한다:
//  · 업로드 충돌 → 이 탭(사용자가 방금 편집한 값을 잃으면 안 된다)
//  · 최초 로그인 → 클라우드(calc 와 같은 기준)
// 순서는 loser 를 먼저 깔고 winner 로 덮는다 → 양쪽 추가분이 모두 남고, 표시 순서도 안정적이다.
export function mergeMyItems(loser, winner, deleted, ceiling = null) {
  const map = new Map();
  canonicalizeMyItems(loser).forEach((x) => map.set(x.id, x));
  canonicalizeMyItems(winner).forEach((x) => map.set(x.id, x));
  // 표식보다 나중에 추가된 아이템은 살아남는다 — 지웠다가 다시 넣은 것이다(isItemDeleted 참고).
  return [...map.values()].filter((x) => !isItemDeleted(deleted, x, ceiling));
}

// 업로드 충돌 시의 병합 규칙.
// calc = 지금 이 탭의 값이 이긴다(사용자가 방금 편집한 것). 스칼라 묶음이라 last-writer-wins 로 충분하다.
// ledger/my_items = 합집합 + tombstone 차감. 손실도 부활도 없어야 하므로 진짜 병합이 필요하다.
export function mergeForUpload(localSnap, cloud, clientNow = Date.now()) {
  const t = tombstoneClock(cloud, clientNow);
  const ledger = mergeLedger(localSnap.ledger, cloud ? cloud.ledger : {}, t.now, t.ceiling);
  return {
    calc: localSnap.calc,
    // 같은 id 면 이 탭이 이긴다 — 방금 고친 캐시가·아이콘을 서버의 옛 값으로 되돌리지 않는다.
    my_items: mergeMyItems(cloud ? cloud.my_items : [], localSnap.my_items, ledger.deleted, t.ceiling),
    ledger,
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
  // '병합할 아이템 데이터가 있는가'와 '충돌을 물어야 하는가'는 다른 질문이다(B-2b).
  //  · 병합 여부 = 배열의 존재. `[]` 는 '사용자가 목록을 비웠다'는 상태이고 그것도 지켜야 한다.
  //  · 충돌 여부 = 비어 있지 않은 클라우드 아이템. 이제 아이템은 합집합이라 덮어써지지 않으므로,
  //    아이템 때문에 사용자에게 선택을 물을 이유가 없어졌다. 기존 UX 를 그대로 두기 위해 판정만 유지한다.
  const cloudItems = Array.isArray(cloud.my_items);
  const cloudHasItems = cloudItems && cloud.my_items.length > 0;
  const cloudHasCalc = !!(cloud.calc && Object.keys(cloud.calc).length);
  const localHasCalc = !!(local.calc && Object.keys(local.calc).length);

  // localWinsCalc / localWinsItems = 이 기기의 로컬이 그 필드의 **권위**다.
  // 백업 복원 직후, **파일에 실제로 들어 있던 필드에만** 켠다(storage 의 복원 마커).
  // 복원은 "이 백업이 지금부터 내 데이터다"라는 명시적 의도인데, 기본 정책(클라우드 우선)을 그대로 두면
  // 복원한 설정이 새로고침 직후 클라우드 옛값으로 조용히 되돌아간다 —
  // 게다가 충돌 선택 모달은 최초 로그인 때만 뜨므로, 이미 동기화된 사용자는 물어보지도 않고 잃는다.
  //
  // 필드 단위인 이유: 거래만 든 백업을 복원했는데 전역으로 켜면, **복원하지도 않은 옛 로컬 calc** 가
  // 클라우드를 덮는다. 그건 막으려던 것과 같은 종류의 손실이다.
  // 로컬 calc 가 비어 있으면 켜도 무의미하니 클라우드를 쓴다(빈 {} 로 클라우드 설정을 날리지 않는다).
  const lwCalc = !!opts.localWinsCalc;
  const lwItems = !!opts.localWinsItems;
  const calc = lwCalc && localHasCalc ? local.calc : (cloudHasCalc ? cloud.calc : local.calc);
  // 아이템은 합집합 + 표식 차감. 같은 id 면 기본은 클라우드가, 복원 직후엔 로컬이 이긴다.
  const my_items = cloudItems
    ? (lwItems
        ? mergeMyItems(cloud.my_items, local.my_items, ledger.deleted, opts.ceiling)
        : mergeMyItems(local.my_items, cloud.my_items, ledger.deleted, opts.ceiling))
    : local.my_items;

  const ledgerActive = ["buys", "sells", "cashes", "spends"].some(
    (k) => local.ledger && local.ledger[k] && local.ledger[k].length > 0
  );
  // 거래가 있거나(ledgerActive) 사용자가 설정/아이템을 직접 편집했으면(localTouched) 지켜야 할 로컬 데이터가 있음.
  const localActive = ledgerActive || !!opts.localTouched;
  // 충돌 선택은 결국 calc 를 묻는 것이다(아이템은 이제 합집합이라 물을 이유가 없다).
  // calc 의 답이 이미 정해졌으면(복원본이 권위) 묻지 않는다.
  const conflict = !lwCalc && (cloudHasCalc || cloudHasItems) && localActive;
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
    // `next[k] == null` 이 아니라 hasSnapshot 으로 판정한다. malformed 값(문자열·NaN·범위 밖)은
    // '존재'하지만 계산부가 거부하고 현재 설정으로 폴백하므로, 살아 있는 prev 스냅샷을 덮으면 요율이 소실된다.
    if (!hasSnapshot(next[k]) && hasSnapshot(prev[k])) out = { ...out, [k]: prev[k] };
  });
  return out;
}

export function mergeLedger(a = {}, b = {}, now = null, ceiling = now) {
  const out = {};
  // 양쪽 행을 먼저 **정규 형태**로 만든다(날짜 zero-pad → 파생값 → id 부여).
  //  · 클라우드 행은 정규화를 거치지 않고 여기로 들어온다. 예전에는 id 없는 행이 `if (x && x.id)` 에
  //    걸려 **조용히 사라졌다** — 구버전 클라이언트가 올린 pre-id 원장이 병합 한 번에 소실된다.
  //  · id 는 내용에서 유도되므로(B-7), 양쪽을 같은 규칙으로 정규화해야 같은 거래가 같은 id 를 얻어
  //    합집합에서 하나로 합쳐진다. 그러지 않으면 중복된다.
  // canonicalizeRows 는 멱등이라 이미 정규화된 로컬 원장에 다시 적용해도 결과가 같다.
  const deleted = mergeDeleted(a && a.deleted, b && b.deleted, now, ceiling);
  LEDGER_BUCKETS.forEach((k) => {
    const map = new Map();
    // 클라우드 행이 malformed(버킷이 배열 아님)여도 병합이 던지지 않아야 한다 — 던지면 로그인 자체가 실패한다.
    canonicalizeRows(k, a && a[k]).forEach((x) => { map.set(x.id, x); });
    // 같은 id면 클라우드(b) 우선. 항목별 타임스탬프가 없어 정밀 비교는 불가(알려진 한계).
    // 서로 다른 id는 모두 보존되므로 '거래가 사라지는' 손실은 없음.
    canonicalizeRows(k, b && b[k]).forEach((x) => {
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
