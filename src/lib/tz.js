// ===== 앱의 시간대 (B-4) =====
// MVP 주(목~수)와 '오늘'은 게임 서버 기준, 즉 한국 시간으로 정해진다.
// 예전에는 `new Date()` 를 그대로 주차 계산에 넣어 **브라우저 로컬 타임존**이 기준이 됐다.
// UTC-8 사용자가 수요일 오후에 열면 KST 로는 이미 목요일(새 주)인데 앱은 지난 주를 보여줬고,
// 그때 입력한 거래는 한 주 어긋난 칸에 쌓였다.
//
// 이 파일은 의존성이 없다(util.js·constants.js 가 함께 import 하므로 순환을 만들면 안 된다).
export const APP_TZ = "Asia/Seoul";

const fmtCache = new Map();
function partsFmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

const pad2 = (n) => ("0" + n).slice(-2);
const localDateStr = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());

// 그 '순간'을 tz 에서 보면 몇 월 며칠인가 → "YYYY-MM-DD".
// 로케일별 출력 형식에 기대지 않으려고 formatToParts 로 조립한다("07/09/2026" 같은 순서 차이 회피).
export function tzDateStr(instant = new Date(), tz = APP_TZ) {
  if (!(instant instanceof Date) || !isFinite(instant.getTime())) return null;
  try {
    const parts = partsFmt(tz).formatToParts(instant);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const y = get("year"), m = get("month"), d = get("day");
    if (!y || !m || !d) throw new Error("incomplete parts");
    return y + "-" + m + "-" + d;
  } catch {
    // Intl 시간대 데이터가 없는 환경 → 로컬 기준(구버전 동작)으로 폴백. 죽지는 않는다.
    return localDateStr(instant);
  }
}

// "YYYY-MM-DD" → 그 **민간 날짜**(civil date)를 가리키는 Date.
// 주차 계산(weekStartThu/addDays/fmtD)은 전부 Y/M/D 만 읽는 민간 날짜 연산이다.
//
// 정오에 고정하는 이유: 브라우저 로컬 타임존이 자정에 DST 전환을 하면(예: America/Santiago)
// 그 날 00:00 은 존재하지 않아 Date 가 앞뒤 날짜로 밀린다. 정오는 어떤 전환에도 같은 날에 남는다.
export function dateOf(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (!m) return new Date(NaN);
  return new Date(+m[1], +m[2] - 1, +m[3], 12);
}

// 날짜 계산이 '지금'을 얻는 **유일한 진입점**. KST 기준 오늘의 민간 날짜.
// 여기 말고 다른 곳에서 `new Date()` 를 주차·달력 계산에 넣지 말 것.
export const nowD = () => dateOf(tzDateStr());
