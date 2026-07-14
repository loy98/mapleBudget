// ===== 후원('개발자에게 커피 한잔') 설정 =====
// 결제 연동은 하지 않는다. 송금 수단(계좌·카카오페이)만 보여주고 **보내는 사람이 직접** 자기 앱에서 보낸다.
// 서버도, 결제사 심사도, 개인정보 수집도 필요 없다.
//
// 금액은 **URL 로 조립하지 않는다.** 카카오페이 송금 링크(qr.kakaopay.com/XXXX)의 뒷부분은
// "유저와 금액 등을 식별하려고 생성된 값"이고 그 생성 방식·파라미터는 공개돼 있지 않다(카카오페이 개발자센터 공식 답변).
// → 금액 버튼을 만들려면 **카카오페이 앱에서 금액별로 링크를 따로 발급**받아 amounts 에 넣는다.
//   금액을 비우고 만든 링크(free)는 보내는 사람이 앱에서 금액을 직접 넣는다.
//
// (토스아이디 `toss.me/{아이디}/{금액}` 은 금액을 링크에 실을 수 있었지만 **서비스가 종료**됐다. 되살리지 말 것.)
//
// 값을 비우면 그 수단은 화면에 나오지 않고, 전부 비면 진입점(헤더·푸터)까지 숨는다.
export const DONATE = {
  bank: { name: "신한", holder: "ㅈㅈㅎ", account: "110-472-965110" },
  // 카카오페이 앱에서 만든 QR 5장(자유금액 + 금액 4종)에서 뽑아낸 링크다.
  //
  // **QR 이미지 자체를 사이트에 올리지 않는다.** 앱이 만든 QR 에는 받는 사람의 **실명과 프로필 사진**이
  // 박혀 있다(예금주를 초성으로 적어 둔 의도와 정면으로 어긋난다). 링크만 가져와 화면에서 깨끗한 QR 로 다시 그린다.
  // 카카오 앱 안에서 실명이 보이는 것은 어쩔 수 없지만, 그것과 사이트에 얼굴을 박아 두는 것은 다르다.
  kakaoPay: {
    // 금액을 지정하지 않은 기본 코드. 보내는 사람이 카카오페이에서 금액을 직접 넣는다.
    free: "https://qr.kakaopay.com/281006011000052154347281",
    // 금액이 박힌 링크(= 위 코드 + 금액). 이걸 스캔하면 그 금액이 입력된 채로 열린다.
    amounts: [
      { won: 1000, note: "PC방 한 시간", url: "https://qr.kakaopay.com/2810060110000521543472811f406491" },
      { won: 3000, note: "커피 한잔", url: "https://qr.kakaopay.com/2810060110000521543472815dc09091" },
      { won: 10000, note: "밥 한 끼", url: "https://qr.kakaopay.com/281006011000052154347281138807307" },
      { won: 20000, note: "치킨 한 마리", url: "https://qr.kakaopay.com/281006011000052154347281271009689" },
    ],
  },
};

// 링크는 신뢰 호스트의 https 만 허용한다. 설정이 잘못 들어가도(오타·http·낯선 도메인)
// 사용자를 엉뚱한 곳으로 보내지 않는다 — 돈이 오가는 링크라 아이콘 URL 보다 보수적으로 막는다.
const KAKAO_HOSTS = ["qr.kakaopay.com", "link.kakaopay.com"];

export function safeKakaoUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return "";
  }
  if (u.protocol !== "https:") return "";
  return KAKAO_HOSTS.includes(u.hostname) ? u.href : "";
}

// 금액은 버튼 **라벨**로만 쓰인다(링크에는 이미 금액이 박혀 있다). 그래도 표시가 틀리면 안 되므로
// 정수 원 단위만 받는다 — `+v` 강제변환은 "1e3"·[5000] 같은 값까지 통과시킨다.
export const MAX_DONATE_AMOUNT = 2000000;
const inRange = (n) => (n >= 100 && n <= MAX_DONATE_AMOUNT ? n : 0);
export function safeAmount(v) {
  if (typeof v === "number") return Number.isInteger(v) ? inRange(v) : 0;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return inRange(Number(v.trim()));
  return 0;
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

  const kp = (cfg && cfg.kakaoPay) || {};
  const free = safeKakaoUrl(kp.free);
  // 금액 항목은 자기 링크(url)가 있으면 그 금액이 미리 입력된 채로 열리고(prefilled),
  // 없으면 자유금액 링크(free)로 보낸다 — 그때는 **금액이 미리 입력되지 않는다**.
  // 이 구분을 화면까지 들고 가야 한다. 안 그러면 '1,000원' 버튼을 눌렀는데 빈 금액칸이 열려
  // 라벨이 거짓말을 한 꼴이 된다(금액이 안 채워지는 것 자체보다 그게 더 나쁘다).
  // 금액이 이상하거나 갈 곳이 아예 없는 항목은 버린다.
  const seen = new Set();
  const amounts = (Array.isArray(kp.amounts) ? kp.amounts : [])
    .map((a) => {
      const url = safeKakaoUrl(a && a.url);
      return {
        won: safeAmount(a && a.won),
        note: str(a && a.note),
        href: url || free,
        prefilled: Boolean(url),
      };
    })
    .filter((a) => {
      if (!a.won || !a.href || seen.has(a.won)) return false;
      seen.add(a.won);
      return true;
    })
    .sort((x, y) => x.won - y.won);

  return { bank, kakao: { free, amounts }, any: Boolean(bank || free || amounts.length) };
}
