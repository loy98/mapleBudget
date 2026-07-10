import { TIERS } from "./constants.js";
import { tzDateStr, dateOf, nowD } from "./tz.js";

export { APP_TZ, tzDateStr, dateOf, nowD } from "./tz.js";

// ===== 포맷 =====
// 반올림·자릿수 절삭이 -0 을 만들면 화면에 "-0원", "-0.00억" 이 뜬다. 사용자에겐 오작동으로 보인다.
// (`Math.round(-0.4)` 는 -0 이고 `(-0.001).toFixed(2)` 는 "-0.00" 이다.)
const noNegZero = (n) => (Object.is(n, -0) ? 0 : n);
// "-0.00" 처럼 모든 자리가 0인데 부호만 남은 문자열을 바로잡는다.
const stripNegZero = (s) => (/^-0(\.0+)?$/.test(s) ? s.slice(1) : s);

export const won = (n) => (isFinite(n) ? noNegZero(Math.round(n)).toLocaleString("ko-KR") : "–") + "원";
export const pct = (n) => (isFinite(n) ? stripNegZero(n.toFixed(1)) : "–") + "%";
export const eok = (n) => (isFinite(n) ? stripNegZero(n.toFixed(2)) : "–") + "억";
export const ml = (n) => (isFinite(n) ? noNegZero(Math.round(n)).toLocaleString("ko-KR") : "–") + " 마일리지";
// 숫자만(단위 없음) — 모노(.num) 안에서 쓰고 "마일리지" 단위는 .u 로 따로 붙일 때 사용
export const mlN = (n) => (isFinite(n) ? noNegZero(Math.round(n)).toLocaleString("ko-KR") : "–");

// 큰 금액을 "1.2억"/"3만" 으로 줄여 쓴다. 0·빈값은 빈 문자열(표에서 자리만 차지하지 않게).
// 다른 포맷 함수와 달리 isFinite 가드가 없어 `manW(Infinity)` 가 "Infinity억" 을 냈다.
export function manW(n) {
  if (!isFinite(n) || !n) return "";
  const a = Math.abs(n);
  if (a >= 1e8) return stripNegZero((n / 1e8).toFixed(1)) + "억";
  if (a >= 10000) return noNegZero(Math.round(n / 10000)) + "만";
  return noNegZero(Math.round(n)) + "";
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
// '오늘'은 언제나 KST 기준이다(MVP 주 경계가 게임 서버 시간으로 정해지므로).
// fmtD 는 넘겨받은 민간 날짜의 Y/M/D 를 읽을 뿐이라 시간대를 모른다 → 여기서 tz 를 해석한다.
export const todayStr = () => tzDateStr();

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

// 거래 행에 남긴 요율 스냅샷(sells._fee, buys._effD)으로 인정할 값인가.
// 수수료·충전 할인은 0 이상 1 미만의 비율이고, 우리가 기록하는 값은 항상 number 다(JSONB 왕복에서도 number).
// 문자열("", "0.05")은 신뢰하지 않는다 — `+""` 가 0 이라 '수수료 0%' 로 조용히 샌다.
// null/undefined(구 데이터)뿐 아니라 malformed 값도 '없음'으로 보고 현재 설정으로 폴백한다.
export const hasSnapshot = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1;

export const curMonth = () => todayStr().slice(0, 7);

// ===== 구버전 원장 행의 결정적 id (B-7) =====
// `uid()` 는 로드 시점의 시각·난수를 쓴다. 구 데이터(id 없는 행)에 그걸 붙이면 같은 백업을 연 두 기기가
// 같은 거래에 다른 id 를 만들고, 원장 병합이 id 합집합이라 **거래가 두 배로 불어난다**(B-7).
// 그래서 행의 내용에서 id 를 유도한다 — 두 기기가 같은 입력에서 같은 답을 낸다.
//
// ⚠️ 내용만으로는 부족하다. "같은 날 같은 아이템을 같은 값에 두 번 산 것"은 **서로 다른 두 거래**인데
// 내용 해시가 같으면 하나로 합쳐진다(중복보다 나쁜 소실). 그래서 같은 내용의 **몇 번째 등장인지**를 함께 넣는다.
// 같은 원장을 가진 두 기기는 같은 다중집합을 같은 순서로 가지므로 순번도 같다.
const fnv1a = (str, seed) => {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

// "3" 과 3, true 와 1 이 다른 id 를 만들지 않게 타입별로 정규화한다.
const normField = (v, kind) => {
  if (kind === "n") return v == null || v === "" || !Number.isFinite(+v) ? "" : String(+v);
  if (kind === "b") return v ? "1" : "0";
  return v == null ? "" : String(v).trim();
};

// 필드 구분자는 값에 등장할 수 없는 제어문자다("a|b" 와 "a" + "|b" 가 같은 키가 되는 것을 막는다).
const SEP = "\u0001";
export const rowContentKey = (fields, row) => fields.map(([name, kind]) => normField(row[name], kind)).join(SEP);

// 내용 + 등장 순번(0-based) → 결정적 id. `uid()` 결과("<시각36>-<난수>")와 겹치지 않게 "L" 로 시작한다.
// 32비트 해시 두 개(다른 seed)를 이어 붙여 사실상 64비트 — 원장 규모에서 충돌은 무시할 수 있다.
export const legacyRowId = (fields, row, occurrence) => {
  const s = rowContentKey(fields, row) + SEP + occurrence;
  return "L" + fnv1a(s, 0x811c9dc5).toString(36) + fnv1a(s, 0x7f4a7c15).toString(36);
};

// 같은 내용이 몇 번째로 등장했는지 세어 준다. 버킷 하나당 하나 만든다.
export function occurrenceCounter() {
  const seen = new Map();
  return (key) => {
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    return n;
  };
}
export const mmdd = (dt) => ("0" + (dt.getMonth() + 1)).slice(-2) + "/" + ("0" + dt.getDate()).slice(-2);

// MVP 주 = 목요일 시작 ~ 수요일 마감.
// 아래 함수들은 **민간 날짜 연산**이다(Y/M/D 만 읽고 쓴다). 시간대 해석은 이미 끝난 뒤여야 한다 —
// '지금'이 필요하면 `new Date()` 가 아니라 `nowD()`(KST 기준 오늘)를 넘길 것.
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
  const w = weekStartThu(nowD());
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
