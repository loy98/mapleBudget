// ===== 후원('개발자에게 커피 한잔') 설정 =====
// 결제 연동은 하지 않는다. 송금 수단(계좌·카카오페이·토스)으로 **보내주는 사람이 직접** 보내는 방식이라
// 서버도, 결제사 심사도, 개인정보 수집도 필요 없다.
//
// 값을 채우지 않으면 그 수단은 화면에 아예 나오지 않는다(빈 계좌번호·죽은 링크를 보여주지 않는다).
// 값을 바꾸려면 이 파일을 고치고 배포한다(시세와 달리 자주 바뀌지 않아 app_config 로 빼지 않았다).
export const DONATE = {
  bank: { name: "", holder: "", account: "" }, // 예: "카카오뱅크", "홍길동", "3333-01-1234567"
  kakaoPayUrl: "", // 카카오페이 송금 QR/링크 (https://qr.kakaopay.com/... )
  tossUrl: "", // 토스 아이디 송금 링크 (https://toss.me/아이디)
};

// 링크는 신뢰 호스트의 https 만 허용한다. 설정이 잘못 들어가도(오타·http·낯선 도메인)
// 사용자를 엉뚱한 곳으로 보내지 않는다 — 돈이 오가는 링크라 아이콘 URL 보다 더 보수적으로 막는다.
const ALLOWED_HOSTS = {
  kakaoPayUrl: ["qr.kakaopay.com", "link.kakaopay.com"],
  tossUrl: ["toss.me"],
};

export function safeDonateUrl(kind, raw) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return "";
  }
  if (u.protocol !== "https:") return "";
  const hosts = ALLOWED_HOSTS[kind] || [];
  return hosts.includes(u.hostname) ? u.href : "";
}

// 화면이 쓰는 형태로 정리. 유효한 수단이 하나도 없으면 `any === false` → 진입점(헤더·푸터 버튼)을 숨긴다.
export function donateOptions(cfg = DONATE) {
  const b = (cfg && cfg.bank) || {};
  // 값이 문자열이 아닐 수 있다고 보고 다룬다(설정 오타·구조 변경). 아래에서 정규화한 값만 쓴다.
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const account = str(b.account);
  const name = str(b.name);
  const holder = str(b.holder);
  const bank = account
    ? {
        name,
        holder,
        account,
        // 복사는 은행·예금주까지 함께 넣어 준다. 계좌번호만 복사하면 어느 은행인지 다시 찾아봐야 한다.
        copyText: [name, account, holder].filter(Boolean).join(" "),
      }
    : null;
  const kakao = safeDonateUrl("kakaoPayUrl", cfg && cfg.kakaoPayUrl);
  const toss = safeDonateUrl("tossUrl", cfg && cfg.tossUrl);
  return { bank, kakao, toss, any: Boolean(bank || kakao || toss) };
}
