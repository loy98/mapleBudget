// ===== 후원('개발자에게 커피 한잔') 설정 =====
// 결제 연동은 하지 않는다. 송금 수단(계좌·카카오페이·토스)만 보여주고 **보내는 사람이 직접** 자기 앱에서 보낸다.
// 서버도, 결제사 심사도, 개인정보 수집도 필요 없다.
//
// 금액 버튼(프리셋/직접 입력)은 **토스에만** 붙는다. 토스는 `toss.me/{아이디}/{금액}` 으로 금액이 링크에 실린다.
// 카카오페이 링크(qr.kakaopay.com)는 금액을 URL 로 넘기는 공식 형식이 확인되지 않았다 →
// 금액은 카카오페이 앱에서 직접 넣게 두고, 링크에 금액을 억지로 붙이지 않는다(틀린 금액이 실리면 돈 문제가 된다).
//
// 값을 비우면 그 수단은 화면에 나오지 않고, 전부 비면 진입점(헤더·푸터)까지 숨는다.
export const DONATE = {
  bank: { name: "신한", holder: "ㅈㅈㅎ", account: "110-472-965110" },
  tossId: "", // 토스아이디 (토스 앱 → 송금 → 내 토스아이디). "abc" → https://toss.me/abc
  kakaoPayUrl: "", // 카카오페이 송금 링크 (https://qr.kakaopay.com/... )
  amounts: [3000, 5000, 10000], // 금액 프리셋(원)
};

// 링크는 신뢰 호스트의 https 만 허용한다. 설정이 잘못 들어가도(오타·http·낯선 도메인)
// 사용자를 엉뚱한 곳으로 보내지 않는다 — 돈이 오가는 링크라 아이콘 URL 보다 보수적으로 막는다.
const ALLOWED_HOSTS = { kakaoPayUrl: ["qr.kakaopay.com", "link.kakaopay.com"] };

export function safeDonateUrl(kind, raw) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return "";
  }
  if (u.protocol !== "https:") return "";
  return (ALLOWED_HOSTS[kind] || []).includes(u.hostname) ? u.href : "";
}

// 토스아이디는 URL 경로에 그대로 들어간다 → 경로를 깨거나 다른 곳으로 튀지 않는 문자만 허용한다.
// (`../`, `//evil.com`, 공백 등을 인코딩으로 덮지 않고 아예 거부한다 — 애초에 토스아이디에 없는 문자다.)
// `.` 과 `..` 은 문자 자체는 허용 범위지만 경로에서 특별한 뜻(현재/상위 디렉터리)이라 따로 막는다.
const TOSS_ID_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,30}$/;

// 금액은 **정수 원 단위만**. 링크에 실리는 값이라 입력과 조금이라도 다르면 안 된다 —
// `5000.7` 을 5000 으로 조용히 잘라 넣으면 사용자가 의도하지 않은 금액이 송금 화면에 뜬다.
// 이상한 값은 0 → 금액 없는 링크(앱에서 직접 입력)로 폴백한다. 토스 1회 한도는 200만원.
export const MAX_DONATE_AMOUNT = 2000000;
const inRange = (n) => (n >= 100 && n <= MAX_DONATE_AMOUNT ? n : 0);
export function safeAmount(v) {
  if (typeof v === "number") return Number.isInteger(v) ? inRange(v) : 0;
  // 문자열은 숫자만으로 이뤄진 것만 받는다(`+v` 강제변환은 "1e3"·" 5000 "·[5000] 까지 통과시킨다).
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return inRange(Number(v.trim()));
  return 0;
}

// 금액이 유효하지 않으면 **금액 없는 링크**를 준다 → 토스 앱에서 직접 금액을 넣게 된다.
// (금액을 못 붙인다고 송금 자체를 막을 이유는 없다.)
export function tossUrl(tossId, amount) {
  const id = typeof tossId === "string" ? tossId.trim() : "";
  if (!TOSS_ID_RE.test(id)) return "";
  const n = safeAmount(amount);
  return `https://toss.me/${id}${n ? `/${n}` : ""}`;
}

// 화면이 쓰는 형태로 정리. 유효한 수단이 하나도 없으면 any === false → 진입점을 숨긴다.
export function donateOptions(cfg = DONATE) {
  const b = (cfg && cfg.bank) || {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const account = str(b.account);
  const name = str(b.name);
  const holder = str(b.holder);
  const bank = account
    ? {
        name,
        holder,
        account,
        // 복사는 은행·예금주까지 함께. 계좌번호만 복사하면 어느 은행인지 다시 찾아봐야 한다.
        copyText: [name, account, holder].filter(Boolean).join(" "),
      }
    : null;
  const kakao = safeDonateUrl("kakaoPayUrl", cfg && cfg.kakaoPayUrl);
  const tossId = tossUrl(cfg && cfg.tossId, 0) ? str(cfg.tossId) : "";
  // 프리셋은 유효한 금액만, 중복 없이, 오름차순으로.
  const amounts = [...new Set((Array.isArray(cfg && cfg.amounts) ? cfg.amounts : []).map(safeAmount).filter(Boolean))]
    .sort((x, y) => x - y);
  return { bank, kakao, tossId, amounts, any: Boolean(bank || kakao || tossId) };
}
