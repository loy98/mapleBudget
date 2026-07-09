import { TIERS } from "./constants.js";

// ===== 포맷 =====
export const won = (n) => (isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "–") + "원";
export const pct = (n) => (isFinite(n) ? n.toFixed(1) : "–") + "%";
export const eok = (n) => (isFinite(n) ? n.toFixed(2) : "–") + "억";
export const ml = (n) => (isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "–") + " 마일리지";
// 숫자만(단위 없음) — 모노(.num) 안에서 쓰고 "마일리지" 단위는 .u 로 따로 붙일 때 사용
export const mlN = (n) => (isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "–");

export function manW(n) {
  const a = Math.abs(n);
  if (!n) return "";
  if (a >= 1e8) return (n / 1e8).toFixed(1) + "억";
  if (a >= 10000) return Math.round(n / 10000) + "만";
  return Math.round(n) + "";
}

// ===== 날짜 =====
export function fmtD(dt) {
  return (
    dt.getFullYear() +
    "-" +
    ("0" + (dt.getMonth() + 1)).slice(-2) +
    "-" +
    ("0" + dt.getDate()).slice(-2)
  );
}
export const todayStr = () => fmtD(new Date());

// 원장의 날짜는 zero-padded "YYYY-MM-DD" 여야 한다 — 주차 필터·규칙 선택이 모두 사전식 문자열 비교이기 때문.
// "2026-7-2" 같은 값은 `"2026-7-2" >= "2026-07-02"` 가 true, `<= "2026-07-08"` 이 false 라
// **모든 주에서 조용히 누락**된다. 앱이 만드는 날짜는 항상 fmtD 지만 가져오기·클라우드 행은 임의 문자열일 수 있다.
// 패딩만 하면 되는 형태는 고쳐주고, 그 외에는 원본을 그대로 둔다(임의로 해석해 다른 날로 바꾸지 않는다).
export function padDate(v) {
  if (typeof v !== "string") return v;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (!m) return v;
  return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
}
export function curMonth() {
  const d = new Date();
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
}
export const mmdd = (dt) => ("0" + (dt.getMonth() + 1)).slice(-2) + "/" + ("0" + dt.getDate()).slice(-2);

// MVP 주 = 목요일 시작 ~ 수요일 마감
export function weekStartThu(dt) {
  const w = new Date(dt);
  w.setHours(0, 0, 0, 0);
  const diff = (w.getDay() - 4 + 7) % 7;
  w.setDate(w.getDate() - diff);
  return w;
}
export function weekStartSun(dt) {
  const w = new Date(dt);
  w.setHours(0, 0, 0, 0);
  w.setDate(w.getDate() - w.getDay());
  return w;
}
export function start13() {
  const w = weekStartThu(new Date());
  const s = new Date(w);
  s.setDate(w.getDate() - 12 * 7);
  return s;
}
export function addDays(dt, n) {
  const d = new Date(dt);
  d.setDate(d.getDate() + n);
  return d;
}

// 거래 항목 id. ledger 병합이 id 기준 합집합이라 충돌하면 거래 1건이 조용히 사라진다.
// 기기 A·B가 오프라인에서 같은 밀리초에 항목을 만들면 난수 부분만이 유일성을 보장하므로
// 엔트로피를 넉넉히 준다(구 4자 base36 ≈ 1.7M → 충돌 가능). 기존 id는 그대로 유효.
export function uid() {
  const t = Date.now().toString(36);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const a = new Uint32Array(2);
    c.getRandomValues(a);
    return t + "-" + a[0].toString(36) + a[1].toString(36);
  }
  return t + "-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// tiers 는 오름차순 전제(resolveRules 가 보장). 마지막으로 통과한 등급이 결과.
export function estGrade(total, tiers = TIERS) {
  let g = "무등급";
  tiers.forEach((t) => {
    if (total >= t.amt) g = t.name;
  });
  return g;
}
