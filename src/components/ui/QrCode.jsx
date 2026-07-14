import { useEffect, useState } from "react";
import QRCode from "qrcode";

// 링크를 QR 로 그린다. 모듈 스코프 컴포넌트(렌더 함수 안에 정의하면 리마운트로 포커스를 잃는다).
//
// 카카오페이 송금 링크(qr.kakaopay.com/...)는 **모바일/QR 스캔 전용**이라 PC 브라우저로 열면 404 가 뜬다.
// → PC 에서는 링크가 아니라 이 QR 을 폰 카메라로 찍게 한다.
//
// 생성은 비동기(canvas)라 실패할 수 있다. 실패를 조용히 삼키면 빈 네모만 남으므로,
// 그때는 링크 원문을 대신 보여준다(주소를 직접 폰에 칠 수 있게).
export function QrCode({ value, size = 168, label = "QR 코드" }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc("");
    setFailed(false);
    if (!value) return undefined;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    // 값이 바뀌면(금액별 링크 선택) 이전 생성 결과가 늦게 도착해 덮어쓰지 않도록 무효화한다.
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (failed || !value) {
    return <div className="qr-fail">{value || "링크가 없습니다."}</div>;
  }
  // 생성 전에는 같은 크기의 자리를 잡아 둔다(뜨는 순간 레이아웃이 튀지 않게).
  return (
    <div className="qr-box" style={{ width: size, height: size }}>
      {src && <img src={src} width={size} height={size} alt={label} />}
    </div>
  );
}
