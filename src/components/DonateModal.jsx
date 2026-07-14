// '개발자에게 커피 한잔' — 후원 안내 모달. 모듈 스코프 컴포넌트(렌더 함수 안에 정의하면 리마운트로 포커스를 잃는다).
//
// 결제를 대신 처리하지 않는다. 송금 수단을 보여줄 뿐이고 실제 송금은 사용자가 자기 앱에서 한다.
// 그래서 이 화면은 어떤 개인정보·결제정보도 받지 않는다.
import { useState } from "react";
import Modal from "./Modal.jsx";
import { DONATE, donateOptions, tossUrl, safeAmount } from "../lib/donate.js";
import { NumInput } from "./ui.jsx";
import { IconCoffee } from "./ui/icons.jsx";
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

export default function DonateModal({ onClose }) {
  const { bank, kakao, tossId, amounts } = donateOptions(DONATE);
  // 프리셋 중 하나(원). 0 = '직접 입력' 선택.
  const [preset, setPreset] = useState(amounts[0] || 0);
  const [custom, setCustom] = useState("");
  const amount = preset || safeAmount(custom);
  const toss = tossId ? tossUrl(tossId, amount) : "";
  const won = (n) => n.toLocaleString() + "원";

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

        {toss && (amounts.length > 0) && (
          <div className="dway">
            <div className="dw-t">금액 고르기</div>
            <div className="damts" role="group" aria-label="후원 금액 선택">
              {amounts.map((a) => (
                <button key={a} type="button" className={"damt" + (preset === a ? " on" : "")}
                  aria-pressed={preset === a} onClick={() => setPreset(a)}>
                  {won(a)}
                </button>
              ))}
              <button type="button" className={"damt" + (preset === 0 ? " on" : "")}
                aria-pressed={preset === 0} onClick={() => setPreset(0)}>
                직접 입력
              </button>
            </div>
            {preset === 0 && (
              <div className="dcustom">
                <NumInput noStepper step={1000} placeholder="예: 7000" value={custom} onChange={setCustom}
                  ariaLabel="후원 금액 직접 입력 (원)" />
                <span className="hint">원</span>
              </div>
            )}
            {/* 금액이 안 잡히면(직접 입력이 비었거나 범위를 벗어남) 링크에 금액을 싣지 않고 앱에서 넣게 둔다. */}
            <div className="hint">
              {amount ? `토스로 ${won(amount)}이 미리 입력된 채 열립니다.` : "금액 없이 열립니다 — 토스 앱에서 직접 넣으시면 됩니다."}
            </div>
          </div>
        )}

        <div className="donate-ways">
          {(toss || kakao) && (
            <div className="dway">
              <div className="dw-t">간편 송금</div>
              <div className="dw-links">
                {/* 외부 사이트로 나간다 → noopener/noreferrer (탭 탈취·리퍼러 유출 차단). */}
                {toss && (
                  <a className="btn sm toss" href={toss} target="_blank" rel="noopener noreferrer">
                    토스로 보내기{amount ? ` · ${won(amount)}` : ""}
                  </a>
                )}
                {kakao && (
                  <a className="btn sm kakao" href={kakao} target="_blank" rel="noopener noreferrer">
                    카카오페이로 보내기
                  </a>
                )}
              </div>
              <div className="hint">
                송금 앱이 새 창에서 열립니다.
                {kakao && " 카카오페이는 금액을 앱에서 직접 입력합니다."}
              </div>
            </div>
          )}

          {bank && (
            <div className="dway">
              <div className="dw-t">계좌 이체</div>
              <div className="dw-acc">
                <span className="dw-bank">{[bank.name, bank.holder].filter(Boolean).join(" · ")}</span>
                <span className="dw-num num">{bank.account}</span>
              </div>
              <button className="btn ghost sm" onClick={() => copy(bank.copyText)}>계좌번호 복사</button>
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
