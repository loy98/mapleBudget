import { isAllowedIconUrl } from "../../lib/constants.js";

// 아이콘은 이모지 또는 신뢰 호스트(https)의 이미지 URL. 아이콘 값은 클라우드로 동기화되는 사용자 입력이라
// 임의 호스트를 <img> 로 로드하면 트래킹 픽셀·콘텐츠 스푸핑 표면이 된다.
export const IconView = ({ icon }) => {
  // 문자열만 렌더. app_config(DB)에서 온 malformed 아이콘(객체/배열/숫자)이 오면
  // {icon} 을 그대로 렌더할 때 "Objects are not valid as a React child" 크래시가 나므로 여기서 차단.
  if (typeof icon !== "string" || !icon) return null;
  // 앞뒤 공백·개행을 먼저 턴다. `" https://evil.com/x"` 처럼 공백 하나만 붙여도
  // 아래 스킴 판정을 빠져나가 URL 문자열이 화면에 그대로 찍힌다.
  const src = icon.trim();
  if (!src) return null;
  // URL 처럼 보이는데 신뢰 호스트가 아니면 **아무것도 렌더하지 않는다**.
  // 그대로 span 에 넣으면 화면에 긴 URL 문자열이 그대로 찍히고, img 로 로드하면 임의 호스트로 요청이 나간다.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !isAllowedIconUrl(src)) return null;
  // 신뢰 호스트의 https 이미지만. referrerPolicy=no-referrer 로 리퍼러 유출 차단, lazy 로딩.
  return isAllowedIconUrl(src) ? (
    <img
      className="iic"
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(e) => (e.target.style.display = "none")}
    />
  ) : (
    <span className="iemoji">{src}</span>
  );
};
