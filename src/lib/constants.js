// ===== 도메인 상수 =====
export const TIERS = [
  { name: "브론즈", amt: 150000 },
  { name: "실버", amt: 300000 },
  { name: "골드", amt: 600000 },
  { name: "다이아", amt: 900000 },
  { name: "레드", amt: 1500000 },
  { name: "블랙", amt: 3000000 },
];

export const CHARGE_METHODS = [
  { name: "정가 (할인 없음)", rate: 0, limit: 0 },
  { name: "컬쳐랜드 상품권", rate: 7, limit: 200000 },
  { name: "도서문화상품권", rate: 7, limit: 200000 },
  { name: "넥슨카드 (할인몰)", rate: 5.6, limit: 0 },
  { name: "넥슨 현대카드", rate: 10, limit: 0 },
  { name: "직접 입력", rate: 0, limit: 0 },
];

export const MVP_GRADES = ["무등급 (15만 미만)", "브론즈", "실버", "골드", "다이아", "레드", "블랙"];

export const DEFAULT_ITEMS = [
  { name: "로얄 스타일 쿠폰 10개", cash: 22000, mAllowed: false, icon: "🎀" },
  { name: "로얄 스타일 쿠폰 20개", cash: 44000, mAllowed: false, icon: "🎀" },
  { name: "원더베리", cash: 3900, mAllowed: true, icon: "🫐" },
  { name: "플래티넘 카르마의 가위", cash: 5900, mAllowed: true, icon: "✂️" },
  { name: "프리미엄 헤어 쿠폰", cash: 5500, mAllowed: true, icon: "💇" },
  { name: "프리미엄 성형 쿠폰", cash: 5500, mAllowed: true, icon: "💄" },
  { name: "뷰티 쿠폰", cash: 4900, mAllowed: true, icon: "💅" },
];

export const MILEAGE_ACCRUAL = 0.05;

// MVP 등급은 '최근 13주 누적 넥슨캐시 사용액' 기준. 롤링 창의 길이(주).
// 창 합계는 [i-(N-1) … i] 로 정확히 N개 항이어야 한다.
export const WINDOW_WEEKS = 13;

// 거래 원장의 4개 버킷. 한 곳에서 정의해 병합·정규화·통계가 같은 목록을 쓴다.
export const LEDGER_BUCKETS = ["buys", "sells", "cashes", "spends"];

// 삭제 표식(tombstone) 보존 기간(일).
// 삭제는 '없음'이라서 id 합집합 병합으로는 표현할 수 없다 → 삭제된 id 를 명시적으로 기록해 전파한다.
// 영구 보존하면 원장 blob 이 무한히 커지므로 만료시킨다. 대가: 이 기간보다 오래 오프라인이던 기기가
// 삭제된 항목을 아직 들고 있으면 그 항목이 되살아난다. 1년이면 실사용에서 사실상 발생하지 않는다.
export const TOMBSTONE_TTL_DAYS = 365;

// 삭제 표식 개수 상한. TTL 정리는 신뢰 가능한 서버 시각이 있을 때만 하므로(기기 시계를 믿지 않는다),
// 클라우드 병합이 없는 게스트는 표식이 무한히 쌓인다. 개수 상한은 시계와 무관하게(상대 순서만 사용)
// 증가를 묶는다. 넘치면 오래된 것부터 버린다 — 오래된 표식일수록 아직 그 항목을 든 기기가 있을 확률이 낮다.
export const TOMBSTONE_MAX = 2000;

// ===== 게임 규칙(rules) =====
// 시세가 아니라 넥슨이 정하는 '규칙'이라 사용자가 편집하지 않는다. 따라서 settings(사용자 소유)가 아니라
// 순수 함수의 인자로 흘려보낸다 — 전역 상태를 읽지 않으므로 computeCalc/estGrade 는 순수하게 남는다.
// app_config.config.rules 로 덮어쓸 수 있고(재배포 없이 대응), fetch 실패·malformed 면 아래 기본값.
//   feeMvp  : MVP 브론즈 이상 또는 프리미엄 PC방일 때 경매장 수수료(%)
//   feeBase : 그 외 경매장 수수료(%)
//   mileageAccrual : 넥슨캐시 결제액 대비 마일리지 적립률(0~1)
//   mileageRate    : 아이템 가격 중 마일리지로 결제 가능한 비율(%). 넥슨이 정하는 상한이며
//                    사용자 취향이 아니다. 예전엔 settings 에 있어 사용자가 바꿀 수 있었고,
//                    바꾸는 순간 13주 누적 과금(cum)이 재계산되어 표시 등급까지 흔들렸다.
//   tiers   : MVP 등급별 13주 누적 기준액(오름차순)
export const DEFAULT_RULES = {
  feeMvp: 3,
  feeBase: 5,
  mileageAccrual: MILEAGE_ACCRUAL,
  mileageRate: 30,
  tiers: TIERS,
};

// DB에서 온 rules 는 신뢰하지 않는다. 항목별로 검증해 통과한 것만 기본값 위에 얹는다.
// (하나라도 malformed 면 그 키만 버리고 나머지는 적용 — 전체를 버리면 DB 수정의 의미가 없다)
// -0 도 거부한다(`-0 >= 0` 은 true). 수수료·등급 금액에 음의 0이 들어가면 표시·계산이 이상해진다.
const posNum = (v, max) => typeof v === "number" && isFinite(v) && !Object.is(v, -0) && v >= 0 && v <= max;
export function resolveRules(cfgRules) {
  const r = { ...DEFAULT_RULES };
  if (!cfgRules || typeof cfgRules !== "object" || Array.isArray(cfgRules)) return r;
  if (posNum(cfgRules.feeMvp, 100)) r.feeMvp = cfgRules.feeMvp;
  if (posNum(cfgRules.feeBase, 100)) r.feeBase = cfgRules.feeBase;
  if (posNum(cfgRules.mileageAccrual, 1)) r.mileageAccrual = cfgRules.mileageAccrual;
  // 100% 는 buildPlan 의 achM = cash*(1-mileageR) 를 0으로 만들어 NaN/Infinity 를 유발한다 → 배제.
  if (posNum(cfgRules.mileageRate, 100) && cfgRules.mileageRate < 100) r.mileageRate = cfgRules.mileageRate;
  if (Array.isArray(cfgRules.tiers) && cfgRules.tiers.length) {
    // 등급 기준액은 0보다 커야 한다(0이면 무등급과 구분되지 않는다).
    const t = cfgRules.tiers.filter((x) => x && typeof x.name === "string" && posNum(x.amt, 1e12) && x.amt > 0);
    // estGrade 는 오름차순 순회로 '마지막 통과 등급'을 고른다.
    // 인접 등급 금액이 같으면 앞 등급은 어떤 값으로도 도달할 수 없는 죽은 등급이 되므로 엄격한 증가를 요구한다.
    const ascending = t.every((x, i) => i === 0 || t[i - 1].amt < x.amt);
    if (t.length === cfgRules.tiers.length && ascending) r.tiers = t;
  }
  return r;
}

export const SPLITS = [
  { label: "한 번에", n: 1, span: 1 },
  { label: "2회 분할 (2개월)", n: 2, span: 2 },
  { label: "3회 분할 (3개월)", n: 3, span: 3 },
  { label: "격주 (7회·3개월)", n: 7, span: 3 },
  { label: "매주 (13회·3개월)", n: 13, span: 3 },
];

export const WD_MVP = ["목", "금", "토", "일", "월", "화", "수"];
export const WD_SUN = ["일", "월", "화", "수", "목", "금", "토"];

// 기본 설정값
export const DEFAULT_SETTINGS = {
  mesoRate: 3000,
  giftRatio: 8000,
  marketRatio: 7500,
  mvpGrade: "0",
  pcRoom: "0",
  // mileageRate 는 넥슨 규칙이므로 여기 없다 → DEFAULT_RULES.mileageRate (app_config 로 덮어씀).
  // 구 저장본에 남아 있어도 parseCalcState 가 DEFAULT_SETTINGS 키만 복사하므로 무시된다.
  milAvail: 30000,
  milCap: 50000,
  tierSel: "4",
  tierAmt: 1500000,
  curAchieved: 0,
  months: "0",
};

export const DEFAULT_CHARGES = [{ name: "넥슨 현대카드", rate: 10, limit: 0 }];
export const DEFAULT_CALC_ITEMS = [
  { name: "플래티넘 카르마의 가위", cash: 5900, sell: "", mAllowed: true, mil: false },
];
