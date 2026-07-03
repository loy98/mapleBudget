import { TIERS } from "./constants.js";

// ===== 포맷 =====
export const won = (n) => (isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "–") + "원";
export const pct = (n) => (isFinite(n) ? n.toFixed(1) : "–") + "%";
export const eok = (n) => (isFinite(n) ? n.toFixed(2) : "–") + "억";
export const ml = (n) => (isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "–") + " 마일리지";

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

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function estGrade(total) {
  let g = "무등급";
  TIERS.forEach((t) => {
    if (total >= t.amt) g = t.name;
  });
  return g;
}
