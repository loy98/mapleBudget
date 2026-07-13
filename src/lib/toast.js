// 토스트 알림 — 모듈 스코프 pub/sub (storage.js 의 onStorageIssue 와 같은 방식).
//
// 왜 alert() 를 걷어냈나: alert 는 **브라우저를 통째로 블로킹한다.**
// 거래를 저장할 때마다 모달을 손으로 닫아야 했고(연속 입력이 사실상 불가능),
// 스타일도 앱과 따로 놀았다. 토스트는 화면을 막지 않고 스스로 사라진다.
//
// 컴포넌트 트리 밖(비 React 코드)에서도 부를 수 있어야 해서 prop 이 아니라 모듈 스토어로 둔다 —
// 알림을 띄우는 지점이 App·LogTab·EntryForm·AuthBar 로 흩어져 있어 prop drilling 이 커진다.

// 종류별 자동 소멸 시간(ms). 나쁜 소식일수록 오래 남긴다 — 사용자가 읽을 시간이 필요하다.
export const TOAST_TTL = { success: 2600, info: 3400, warn: 6000, error: 8000 };

let seq = 0;
let toasts = [];
let listeners = [];
const timers = new Map();

export function getToasts() {
  return toasts;
}
export function onToast(cb) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((f) => f !== cb); };
}
function emit() {
  const snapshot = toasts;
  // 구독자 하나가 던져도 나머지 구독자와 호출측(저장 로직)이 멈추면 안 된다.
  listeners.forEach((f) => { try { f(snapshot); } catch { /* ignore */ } });
}

// sticky: 자동으로 사라지지 않는다(사용자가 반드시 읽어야 하는 경고 — 예: 복원 중 일부 항목이 빠졌다).
//
// 토스트에 '버튼'은 두지 않는다. 버튼이 필요한 상황(예: 복원 후 새로고침)은 **편집을 막아야 하는 상황**이고,
// 토스트는 화면을 막지 못한다 — 그런 건 닫을 수 없는 모달의 일이다(RestoreReloadModal).
export function pushToast(kind, message, { sticky = false, detail } = {}) {
  const msg = String(message ?? "").trim();
  if (!msg) return null; // 빈 토스트는 띄우지 않는다(빈 상자가 뜨는 것보다 안 뜨는 게 낫다)
  const id = "t" + ++seq;
  const rows = Array.isArray(detail) ? detail.filter((x) => typeof x === "string" && x.trim()) : [];
  toasts = [...toasts, { id, kind, message: msg, detail: rows, sticky }];
  if (!sticky) {
    const ttl = TOAST_TTL[kind] ?? TOAST_TTL.info;
    timers.set(id, setTimeout(() => dismissToast(id), ttl));
  }
  emit();
  return id;
}

export function dismissToast(id) {
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
  const next = toasts.filter((x) => x.id !== id);
  if (next.length === toasts.length) return; // 이미 사라졌다 → 불필요한 리렌더를 만들지 않는다
  toasts = next;
  emit();
}

// 테스트 격리용. 프로덕션 코드에서 부르지 않는다.
export function __resetToasts() {
  timers.forEach(clearTimeout);
  timers.clear();
  toasts = [];
  listeners = [];
  seq = 0;
}

export const toast = {
  success: (m, o) => pushToast("success", m, o),
  info: (m, o) => pushToast("info", m, o),
  warn: (m, o) => pushToast("warn", m, o),
  error: (m, o) => pushToast("error", m, o),
};

// ===== 새로고침을 건너뛰는 토스트 =====
// 백업 복원은 성공 직후 페이지를 새로고침한다(메모리 상태를 버리고 복원본으로 다시 로드해야 하므로).
// 그냥 토스트를 띄우면 새로고침이 곧바로 지워버려 사용자는 아무것도 못 본다 —
// 특히 '일부 항목이 빠졌다'는 경고를 놓치면 데이터가 사라진 걸 한참 뒤에야 안다(B-6 이 막으려던 바로 그것).
// → 세션 저장소에 넘겨 두고, 새로고침 후 첫 마운트에서 꺼내 띄운다.
const PENDING_KEY = "mvpPendingToast";

// 세션 저장소를 먼저 쓴다 — 이 탭에서 일어난 일이므로 다른 탭에서 뜨면 안 된다.
// 막혀 있으면 localStorage 로 떨어진다. 복원이 성공했다는 건 **localStorage 쓰기가 됐다는 뜻**이므로
// (importAll 이 거기에 쓴다) 이 폴백은 사실상 항상 성공한다. 둘 다 막히면 넘길 방법이 없다 → false.
function pendingStores() {
  const out = [];
  try { if (typeof sessionStorage !== "undefined" && sessionStorage) out.push(sessionStorage); } catch { /* 접근 자체가 던질 수 있다 */ }
  try { if (typeof localStorage !== "undefined" && localStorage) out.push(localStorage); } catch { /* ignore */ }
  return out;
}

// 성공하면 true. **false 면 호출측이 새로고침해서는 안 된다** — 새로고침이 알림을 통째로 지우고,
// 사용자는 '일부 항목이 빠졌다'는 경고를 영영 못 본다(B-6 이 막으려던 실패).
export function queueToast(kind, message, { sticky = false, detail } = {}) {
  let payload;
  try { payload = JSON.stringify({ kind, message, sticky, detail }); } catch { return false; }
  for (const s of pendingStores()) {
    try { s.setItem(PENDING_KEY, payload); return true; } catch { /* 다음 저장소로 */ }
  }
  return false;
}

// 새로고침 후 첫 마운트에서 호출. 꺼낸 즉시 **양쪽 저장소에서 모두** 지운다 —
// 한쪽만 지우면 다른 쪽에 남은 값이 다음 새로고침에 또 떠오른다.
export function flushQueuedToast() {
  let raw = null;
  for (const s of pendingStores()) {
    try {
      const v = s.getItem(PENDING_KEY);
      if (v != null && raw == null) raw = v;
      s.removeItem(PENDING_KEY);
    } catch { /* 다음 저장소로 */ }
  }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d.message !== "string") return null;
    const kind = TOAST_TTL[d.kind] ? d.kind : "info"; // 모르는 종류는 info 로(렌더 크래시 방지)
    return pushToast(kind, d.message, { sticky: !!d.sticky, detail: d.detail });
  } catch { return null; }
}
