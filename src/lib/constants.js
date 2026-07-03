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
  mileageRate: 30,
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
