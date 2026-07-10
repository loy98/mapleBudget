// ===== 클라이언트 오류 기록 (B-8) =====
// 프로덕션 오류를 알 방법이 전혀 없었다(`console.error` 는 사용자 브라우저에만 남는다).
//
// 외부 트래킹 서비스를 붙이지 않는다: 새 서드파티 엔드포인트는 CSP 를 열어야 하고, 사용자 동의 없이
// 오류 데이터를 내보내게 된다. 대신 **로컬에 최근 오류를 남기고**, 사용자가 스스로 내보내기(백업 파일)나
// 피드백에 첨부할 수 있게 한다. 전송은 언제나 사용자가 시작한다.
export const ERRORS_KEY = "mvpErrors";
export const MAX_ERRORS = 10;
const MAX_STACK = 600;   // 스택은 길다. 저장소를 잡아먹지 않게 자른다.
const MAX_MSG = 300;

const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

// 오류 하나를 직렬화 가능한 평범한 객체로. Error 가 아닌 값(문자열·객체)도 던져질 수 있다.
export function toRecord(error, where = "", now = Date.now()) {
  const isErr = error && typeof error === "object" && "message" in error;
  return {
    t: now,
    where: clip(String(where || ""), 60),
    msg: clip(isErr ? String(error.message) : String(error), MAX_MSG),
    stack: clip(isErr && typeof error.stack === "string" ? error.stack : "", MAX_STACK),
  };
}

function read() {
  try {
    const raw = localStorage.getItem(ERRORS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x === "object") : [];
  } catch {
    return []; // 손상됐으면 조용히 버린다 — 오류 로그 때문에 앱이 멈추면 안 된다
  }
}

export function getRecentErrors() {
  return read();
}

// 최근 것이 앞에 오도록 쌓고 상한을 지킨다. **절대 던지지 않는다** —
// 오류를 기록하다 오류를 내면 ErrorBoundary 가 다시 돌아 무한 루프가 된다.
export function recordError(error, where = "", now = Date.now()) {
  try {
    const rec = toRecord(error, where, now);
    const next = [rec, ...read()].slice(0, MAX_ERRORS);
    localStorage.setItem(ERRORS_KEY, JSON.stringify(next));
    return rec;
  } catch {
    return null; // 저장소 불가·쿼터 초과 — 기록을 포기한다(앱은 계속 돈다)
  }
}

export function clearErrors() {
  try { localStorage.removeItem(ERRORS_KEY); } catch { /* ignore */ }
}

// 피드백에 붙일 사람이 읽을 수 있는 요약. 사용자가 명시적으로 첨부를 택했을 때만 쓴다.
//
// **저장된 기록을 믿지 않는다.** 손상된 `mvpErrors`(예: `t` 가 문자열)를 그대로 쓰면
// `new Date("bad").toISOString()` 이 RangeError 를 던져 **피드백 전송 자체가 실패한다** —
// 오류를 보고하려다 오류에 막히는 셈이다.
const isoOf = (t) => {
  const n = Number(t);
  return Number.isFinite(n) ? new Date(n).toISOString() : "(시각 불명)";
};
const safeStr = (v) => { try { return typeof v === "string" ? v : String(v ?? ""); } catch { return ""; } };

export function formatErrorsForFeedback(errors = getRecentErrors(), limit = 3) {
  const list = (Array.isArray(errors) ? errors : []).filter((e) => e && typeof e === "object").slice(0, limit);
  if (!list.length) return "";
  const lines = list.map((e) => {
    const first = safeStr(e.stack).split("\n")[1] || "";
    return `- ${isoOf(e.t)} [${safeStr(e.where) || "unknown"}] ${safeStr(e.msg)}${first ? "\n  " + first.trim() : ""}`;
  });
  return "\n\n--- 최근 오류 " + list.length + "건 (사용자 첨부) ---\n" + lines.join("\n");
}

// 전역 오류 훅. ErrorBoundary 가 잡지 못하는 것들(이벤트 핸들러, async, Promise 거절)을 담는다.
export function installGlobalErrorHandlers(target = typeof window !== "undefined" ? window : null) {
  if (!target) return () => {};
  const onError = (e) => { recordError(e?.error || e?.message || "unknown", "window.error"); };
  const onRejection = (e) => { recordError(e?.reason || "unhandledrejection", "unhandledrejection"); };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
