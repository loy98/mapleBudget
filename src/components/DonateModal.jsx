// '개발자에게 커피 한잔' — 후원 안내 모달. 모듈 스코프 컴포넌트(렌더 함수 안에 정의하면 리마운트로 포커스를 잃는다).
//
// 결제를 대신 처리하지 않는다. 송금 수단을 보여줄 뿐이고 실제 송금은 사용자가 자기 앱에서 한다.
// 그래서 이 화면은 어떤 개인정보·결제정보도 받지 않는다.
//
// **QR 이 중심이다.** 카카오페이 송금 링크(qr.kakaopay.com/...)는 모바일/QR 스캔 전용이라
// PC 브라우저로 열면 404 가 뜬다 → PC 에서는 링크를 누르게 하지 않고 QR 을 폰으로 찍게 한다.
// 링크로 바로 여는 버튼은 **터치 기기에서만** 보여준다.
import { useState, useEffect } from "react";
import Modal from "./Modal.jsx";
import { DONATE, donateOptions } from "../lib/donate.js";
import { QrCode } from "./ui/QrCode.jsx";
import { IconCoffee, IconCopy, IconKakaoBubble } from "./ui/icons.jsx";
import { toast } from "../lib/toast.js";

// 클립보드는 https(또는 localhost)에서만 동작하고 권한이 거부될 수도 있다.
// 실패를 조용히 삼키면 사용자는 '복사됐겠지' 하고 빈 클립보드를 붙여넣는다 → 실패도 알려준다.
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("계좌번호를 복사했어요.");
  } catch {
    toast.error("복사에 실패했어요. 계좌번호를 직접 선택해 복사해 주세요.");
  }
}

const won = (n) => n.toLocaleString() + "원";

// 터치 기기(=카카오페이 앱이 있는 기기)에서만 '앱으로 열기' 버튼을 낸다.
// PC 에서 그 링크를 누르면 404 라, 없는 버튼이 있는 버튼보다 낫다.
function useCanOpenApp() {
  const [can, setCan] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setCan(mq.matches);
    sync();
    // 한 번만 읽으면 입력장치가 바뀌었을 때(태블릿 키보드 도킹/분리 등) 낡은 값이 남는다.
    // 구형 사파리는 addEventListener 가 없어 addListener 를 쓴다.
    if (mq.addEventListener) {
      mq.addEventListener("change", sync);
      return () => mq.removeEventListener("change", sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);
  return can;
}

export default function DonateModal({ onClose }) {
  const { bank, kakao } = donateOptions(DONATE);
  const canOpenApp = useCanOpenApp();
  // 제안 금액 선택. 링크에 금액이 박힌 항목(prefilled)을 고르면 QR 도 그 링크로 바뀐다.
  // 그렇지 않으면 QR 은 자유금액 링크 그대로이고, 금액은 카카오페이에서 직접 넣는다 — 화면이 그렇게 말한다.
  const [pick, setPick] = useState(null);
  const chosen = kakao.amounts.find((a) => a.won === pick) || null;
  const qrTarget = chosen ? chosen.href : kakao.free;
  const hasKakao = Boolean(qrTarget);

  return (
    <Modal onClose={onClose} label="개발자에게 커피 한잔" cardClass="donate">
      <>
        <div className="modal-title"><IconCoffee />개발자에게 커피 한잔</div>
        <p className="modal-body">
          이 계산기는 무료이고 앞으로도 무료입니다. 광고도 없습니다.
          도움이 되셨다면 커피 한잔 값으로 응원해 주세요 — 서버·도메인 유지비와 다음 기능에 씁니다.
          <br />
          <span className="muted">후원해도 추가 기능이 열리거나 데이터가 달라지지 않습니다. 순수한 응원입니다. 🙇</span>
        </p>

        <div className="donate-ways">
          {hasKakao && (
            <div className="dway kakao">
              <div className="dw-t"><IconKakaoBubble className="kico" />카카오페이</div>

              {kakao.amounts.length > 0 && (
                <div className="damts" role="group" aria-label="후원 금액 선택">
                  {kakao.amounts.map((a) => (
                    <button key={a.won} type="button" aria-pressed={pick === a.won}
                      className={"damt" + (pick === a.won ? " on" : "")}
                      onClick={() => setPick(pick === a.won ? null : a.won)}>
                      <span className="da-won">{won(a.won)}</span>
                      {a.note && <span className="da-note">{a.note}</span>}
                    </button>
                  ))}
                  {/* 금액을 고르지 않은 상태(= 자유금액 QR)도 하나의 선택지로 보여 준다.
                      선택을 해제할 방법이 버튼 재클릭뿐이면 그걸 아무도 모른다. */}
                  {kakao.free && (
                    <button type="button" aria-pressed={pick === null}
                      className={"damt free" + (pick === null ? " on" : "")} onClick={() => setPick(null)}>
                      <span className="da-won">직접 입력</span>
                      <span className="da-note">원하는 만큼</span>
                    </button>
                  )}
                </div>
              )}

              <div className="qr-wrap">
                {/* QR 은 고른 금액에 따라 바뀐다. 가운데 카카오 심볼은 장식이고 개인정보가 없다
                    (앱이 준 QR 에는 실명·얼굴이 박혀 있어 그대로 쓰지 않는다 — donate.js 참고). */}
                <QrCode value={qrTarget} label={`카카오페이 송금 QR 코드${chosen ? ` (${won(chosen.won)})` : ""}`}
                  center={<IconKakaoBubble />} />
                <div className="qr-guide">
                  <b>휴대폰 카메라로 QR을 찍어 주세요.</b>
                  <span className="hint">
                    {chosen
                      ? chosen.prefilled
                        ? `${won(chosen.won)}이 입력된 채로 카카오페이가 열립니다.`
                        : `카카오페이가 열리면 ${won(chosen.won)}${chosen.note ? ` (${chosen.note})` : ""}을 입력해 주세요.`
                      : "카카오페이가 열리면 원하는 금액을 입력해 주세요."}
                  </span>
                  {/* PC 에서 이 링크는 404 다 → 터치 기기에서만 노출. 외부 이동이라 noopener/noreferrer. */}
                  {canOpenApp && (
                    <a className="btn sm kakao-btn" href={qrTarget} target="_blank" rel="noopener noreferrer">
                      <IconKakaoBubble className="kico" />카카오페이 앱으로 열기
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {bank && (
            <div className="dway">
              <div className="dw-t">계좌 이체</div>
              <div className="dw-acc">
                <span className="dw-bank">{[bank.name, bank.holder].filter(Boolean).join(" · ")}</span>
                <span className="dw-numrow">
                  <span className="dw-num num">{bank.account}</span>
                  <button className="icobtn" onClick={() => copy(bank.copyText)}
                    aria-label="계좌번호 복사" title="계좌번호 복사">
                    <IconCopy />
                  </button>
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>닫기</button>
        </div>
      </>
    </Modal>
  );
}
