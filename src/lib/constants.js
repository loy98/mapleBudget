import { tzDateStr } from "./tz.js";

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

// ===== 자주 쓰는 아이템의 카테고리 =====
// 기본 목록이 20종을 넘어가면 칩이 한 줄로 쏟아져 아무것도 찾을 수 없다 → 카테고리로 접는다.
// id 는 데이터(로컬·클라우드·app_config)에 저장되므로 **바꾸지 않는다**. label 만 바꿔도 된다.
// 사용자가 직접 만든 아이템·구 데이터에는 cat 이 없다 → itemCat() 이 "etc" 로 떨어뜨린다.
export const ITEM_CATS = [
  { id: "beauty", label: "헤어·성형" },
  { id: "style", label: "코디·스타일" },
  { id: "karma", label: "카르마" },
  { id: "pet", label: "펫" },
  { id: "etc", label: "기타" },
];
export const ITEM_CAT_IDS = ITEM_CATS.map((c) => c.id);
// DB/구 데이터에서 온 cat 은 신뢰하지 않는다. 아는 값이 아니면 "기타".
export const itemCat = (v) => (ITEM_CAT_IDS.includes(v) ? v : "etc");

// 새 사용자의 '자주 쓰는 아이템' 기본 목록. app_config.defaultItems 가 있으면 그것이 이긴다(이건 폴백).
//
// **여기 숫자가 틀리면 계산기 전체가 조용히 틀린 답을 낸다.** 근거 없는 값을 추측으로 채우지 말 것.
// 넥슨은 상시 판매가를 공개 웹으로 내놓지 않아, 판매 공지에 가격이 적힌 것만 '공식'으로 확인된다.
//
// 2026-07 조사 결과:
//   [공식 고지] 원더베리 5,400 · 마일리지 불가 (sale/428) — 3,900/마일리지 가능으로 잘못돼 있었다
//   [공식 고지] 루나 크리스탈 3,900 (sale/428)
//   [공식 고지] 로얄 헤어 5,500 / 로얄 성형외과 3,500 · 마일리지 30% (CashShop/360)
//   [공식 고지] 프리미엄 헤어 5,500 / 프리미엄 성형 3,500 (sale/398) — 성형이 5,500 으로 잘못돼 있었다
//   [커뮤니티] 플래티넘 카르마의 가위 5,900 — 사용자가 게임 내 캐시샵에서 확인
//   [커뮤니티] 컬러링 프리즘 5,900 · 체인지 로얄 헤어/성형 5,500/3,500 · 로얄 스타일 쿠폰 개당 2,200
//
// 랜덤박스류(원더베리·루나 크리스탈·로얄 스타일)는 마일리지를 쓸 수 없다 → mAllowed: false.
// 이걸 true 로 두면 계산기가 있지도 않은 30% 절감을 반영해 실비용을 과소평가한다.
//
// 뺀 것: 미라클 서큘레이터·확성기·프리미엄 생명의 물·골드 애플 — 가격은 알아냈지만 **경매장에 올라가는지**를
// 확인하지 못했다. 되팔 수 없는 아이템을 되팔기 목록에 넣으면 계산기가 성립하지 않는다.
//
// `name` 은 아이템의 정체성이다(id 가 이름에서 유도되고, 거래 원장의 품목 통계도 이름으로 매칭한다)
// → **함부로 바꾸지 말 것.** 이름을 바꾸면 과거 거래와의 연결이 끊긴다.
// `cat` 은 ITEM_CATS 의 id. 없으면 itemCat() 이 "etc" 로 떨어뜨린다.
export const DEFAULT_ITEMS = [
  // --- 카르마 ---
  { name: "플래티넘 카르마의 가위", cash: 5900, mAllowed: true, icon: "✂️", cat: "karma" },
  // --- 헤어·성형(마일리지 30% 가 먹혀 실질 단가가 낮다) ---
  { name: "프리미엄 헤어 쿠폰", cash: 5500, mAllowed: true, icon: "💇", cat: "beauty" },
  { name: "프리미엄 성형 쿠폰", cash: 3500, mAllowed: true, icon: "💄", cat: "beauty" },
  { name: "로얄 헤어 쿠폰", cash: 5500, mAllowed: true, icon: "💇", cat: "beauty" },
  { name: "로얄 성형외과 쿠폰", cash: 3500, mAllowed: true, icon: "💄", cat: "beauty" },
  { name: "체인지 로얄 헤어 쿠폰", cash: 5500, mAllowed: true, icon: "💇", cat: "beauty" },
  { name: "체인지 로얄 성형외과 쿠폰", cash: 3500, mAllowed: true, icon: "💄", cat: "beauty" },
  { name: "컬러링 프리즘", cash: 5900, mAllowed: true, icon: "🎨", cat: "beauty" },
  // --- 펫(랜덤박스라 마일리지 불가) ---
  { name: "원더베리", cash: 5400, mAllowed: false, icon: "🫐", cat: "pet" },
  { name: "루나 크리스탈", cash: 3900, mAllowed: false, icon: "🌙", cat: "pet" },
  // --- 코디·스타일(랜덤박스라 마일리지 불가) ---
  { name: "로얄 스타일 쿠폰", cash: 2200, mAllowed: false, icon: "🎀", cat: "style" },
  { name: "로얄 스타일 쿠폰 10개", cash: 22000, mAllowed: false, icon: "🎀", cat: "style" },
];

// ===== 아이콘 이미지 호스트 allowlist (B-8) =====
// 아이콘 URL 은 클라우드로 동기화되는 **사용자 입력**이다. 임의 호스트를 허용하면
// 트래킹 픽셀·콘텐츠 스푸핑 표면이 된다(스크립트 실행은 아니지만 요청은 나간다).
// 신뢰 호스트만 <img> 로 로드하고, 나머지는 렌더하지 않는다.
// `public/_headers` 의 CSP `img-src` 도 같은 목록으로 좁혀 브라우저가 한 번 더 막는다.
export const ICON_HOSTS = ["maplestory.io"];

// https 만. 정확히 그 호스트이거나 그 호스트의 서브도메인이어야 한다
// (`evil-maplestory.io` 나 `maplestory.io.evil.com` 이 통과하면 안 된다).
export function isAllowedIconUrl(url) {
  if (typeof url !== "string" || !url) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return ICON_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

export const MILEAGE_ACCRUAL = 0.05;

// MVP 등급은 '최근 13주 누적 넥슨캐시 사용액' 기준. 롤링 창의 길이(주).
// 창 합계는 [i-(N-1) … i] 로 정확히 N개 항이어야 한다.
export const WINDOW_WEEKS = 13;

// 거래 원장의 4개 버킷. 한 곳에서 정의해 병합·정규화·통계가 같은 목록을 쓴다.
export const LEDGER_BUCKETS = ["buys", "sells", "cashes", "spends"];

// 구버전(id 없는) 원장 행의 **결정적 id** 를 만들 때 쓰는 필드 (B-7).
// 로드 시점에 랜덤 id 를 주면, 같은 백업을 두 기기에서 열었을 때 같은 거래가 서로 다른 id 를 얻고
// 합집합 병합이 둘 다 보존해 통계가 2배가 된다. 내용에서 id 를 유도하면 두 기기가 같은 답을 낸다.
//
// 요율 스냅샷(_fee/_effD)은 넣지 않는다 — 구 데이터에는 없고, 나중에 붙어도 id 가 흔들리면 안 된다.
// 타입은 아래 표로 정규화한다("3" 과 3 이 다른 id 를 만들지 않게).
export const LEDGER_ID_FIELDS = {
  buys: [["date", "s"], ["item", "s"], ["qty", "n"], ["price", "n"], ["mil", "b"]],
  sells: [["date", "s"], ["item", "s"], ["qty", "n"], ["meso", "n"]],
  cashes: [["date", "s"], ["meso", "n"], ["rate", "n"], ["won", "n"]],
  spends: [["date", "s"], ["amount", "n"], ["memo", "s"]],
};

// ===== 자주 쓰는 아이템의 결정적 id (B-2b) =====
// **id 가 없는 아이템**(구 데이터·기본 목록)에 id 를 유도할 때 쓰는 필드. 아이템의 정체성은 이름이다.
// 이미 id 가 있으면 그대로 둔다 → 이름을 바꿔도 같은 아이템이다(id 는 한 번 정해지면 바뀌지 않는다).
// 그 규칙 덕에 이름 입력 중 React key 가 바뀌어 리마운트되는 일이 없다.
// 대가: 두 기기가 각자 새로 만든 같은 이름의 아이템은 id 가 달라 둘 다 남는다(표시 중복).
export const MY_ITEM_ID_FIELDS = [["name", "s"]];

// 아이템 삭제 표식은 거래 삭제 표식과 **같은 맵**(`ledger.deleted`)에 네임스페이스를 붙여 넣는다.
// 이유: (1) DB 스키마·JSONB 형태를 바꾸지 않는다, (2) 표식을 모르는 구버전 탭도 **모르는 키를 그대로 보존해
// 업로드하므로**, 신버전 기기가 만든 삭제가 구버전 탭을 거쳐도 살아남는다,
// (3) TTL·개수 상한·병합 로직을 그대로 재사용한다.
//
// ⚠️ (2)는 '구버전 탭이 만든 삭제도 전파된다'는 뜻이 **아니다**. 구버전 탭은 표식을 만들지 못하고
// 배열만 줄여 올리므로, 그 삭제는 합집합 병합에서 부활한다. B-2b 이전에도 결과는 같았다
// (그때는 my_items 가 LWW 였고 클라우드의 `[]` 는 '데이터 없음'으로 취급돼 로컬이 이겼다) → 회귀는 아니다.
// 구버전 탭은 서비스워커 자동 갱신으로 곧 사라진다.
//
// 대가: '원장 삭제 로그'에 아이템 삭제가 섞인다. 그래서 접두사로 분명히 구분한다.
export const ITEM_TOMBSTONE_PREFIX = "item:";

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

// 한 벌의 규칙을 기본값 위에 얹는다(발효일은 여기서 다루지 않는다).
function resolveOne(cfg) {
  const r = { ...DEFAULT_RULES };
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return r;
  if (posNum(cfg.feeMvp, 100)) r.feeMvp = cfg.feeMvp;
  if (posNum(cfg.feeBase, 100)) r.feeBase = cfg.feeBase;
  if (posNum(cfg.mileageAccrual, 1)) r.mileageAccrual = cfg.mileageAccrual;
  // 100% 는 buildPlan 의 achM = cash*(1-mileageR) 를 0으로 만들어 NaN/Infinity 를 유발한다 → 배제.
  if (posNum(cfg.mileageRate, 100) && cfg.mileageRate < 100) r.mileageRate = cfg.mileageRate;
  if (Array.isArray(cfg.tiers) && cfg.tiers.length) {
    // 등급 기준액은 0보다 커야 한다(0이면 무등급과 구분되지 않는다).
    const t = cfg.tiers.filter((x) => x && typeof x.name === "string" && posNum(x.amt, 1e12) && x.amt > 0);
    // estGrade 는 오름차순 순회로 '마지막 통과 등급'을 고른다.
    // 인접 등급 금액이 같으면 앞 등급은 어떤 값으로도 도달할 수 없는 죽은 등급이 되므로 엄격한 증가를 요구한다.
    const ascending = t.every((x, i) => i === 0 || t[i - 1].amt < x.amt);
    if (t.length === cfg.tiers.length && ascending) r.tiers = t;
  }
  return r;
}

// ===== 발효일 있는 규칙 이력 =====
// 넥슨이 수수료율·마일리지 비율을 바꾸면 그 시점 이후 거래만 새 규칙으로 계산해야 한다.
// 단일 규칙만 두면 규칙이 바뀌는 순간 **과거 기록까지 소급해서** 값이 변한다(B-5).
//
// app_config.config.rules 는 두 형태를 모두 받는다:
//   · 객체            → 항상 유효한 단일 규칙(하위 호환)
//   · 배열 [{effectiveFrom:"YYYY-MM-DD", ...}]  → 발효일 오름차순 이력
// 날짜 문자열은 fmtD 와 같은 zero-padded 형식이라 사전식 비교가 곧 시간순 비교다.
const EPOCH = "0000-01-01";
const isDateStr = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// 오늘 날짜(KST, zero-padded). util.js 의 todayStr 을 쓰지 않는 이유: util.js 가 constants.js 를 import 해 순환이 된다.
// tz.js 는 의존성이 없어 양쪽이 안전하게 쓴다.
const nowStr = () => tzDateStr();

export function resolveRuleHistory(cfgRules, today = nowStr()) {
  if (!Array.isArray(cfgRules)) return [{ effectiveFrom: EPOCH, ...resolveOne(cfgRules) }];
  const entries = cfgRules
    .filter((e) => e && typeof e === "object" && !Array.isArray(e))
    .map((e) => ({ effectiveFrom: isDateStr(e.effectiveFrom) ? e.effectiveFrom : EPOCH, ...resolveOne(e) }))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
  if (!entries.length) return [{ effectiveFrom: EPOCH, ...DEFAULT_RULES }];
  // 가장 이른 항목을 EPOCH 로 내려 '그 이전 거래'도 규칙을 갖게 한다(빈 구간 방지).
  // 운영자는 이력을 자신이 아는 가장 오래된 규칙부터 쓰므로, 그게 그 이전 시기의 최선의 추정이다.
  //
  // 단, **이미 발효한 규칙일 때만** 내린다. 미래 발효 규칙만 있는 이력(예: [{effectiveFrom:"2030-01-01"}])을
  // 내리면 아직 오지 않은 규칙이 지금·과거에 소급 적용된다 — '발효일 이후부터'가 무의미해진다.
  // 그 경우 EPOCH~발효일 구간은 코드 기본값이 메운다.
  if (entries[0].effectiveFrom <= today) entries[0] = { ...entries[0], effectiveFrom: EPOCH };
  else entries.unshift({ effectiveFrom: EPOCH, ...DEFAULT_RULES });
  return entries;
}

// 그 날짜에 유효한 규칙. history 는 발효일 오름차순.
export function rulesAt(history, date) {
  if (!Array.isArray(history) || !history.length) return DEFAULT_RULES;
  const d = isDateStr(date) ? date : EPOCH;
  let found = history[0];
  for (const e of history) { if (e.effectiveFrom <= d) found = e; else break; }
  return found;
}

// 계산기('지금')가 쓰는 규칙. today 를 생략하면 오늘.
export function resolveRules(cfgRules, today = nowStr()) {
  return rulesAt(resolveRuleHistory(cfgRules, today), today);
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
  // '현재 누적 실적'을 어디서 가져오는가.
  //   "manual" — 사용자가 직접 입력한 curAchieved 를 그대로 쓴다(시나리오만 돌려보는 순수 계산).
  //   "ledger" — 거래 기록 탭의 13주 누적(cumNow)을 쓴다. curAchieved 는 보존만 하고 쓰지 않는다.
  // 기본이 "manual" 인 이유: 기록이 하나도 없는 첫 방문자가 "ledger" 로 시작하면 입력칸이 잠긴 채
  // 0원이 박혀 있어 계산기를 시험해 볼 수가 없다. 기록이 쌓이면 UI 가 전환을 안내한다.
  curSource: "manual",
  months: "0",
};

export const DEFAULT_CHARGES = [{ name: "넥슨 현대카드", rate: 10, limit: 0 }];
export const DEFAULT_CALC_ITEMS = [
  { name: "플래티넘 카르마의 가위", cash: 5900, sell: "", mAllowed: true, mil: false },
];
