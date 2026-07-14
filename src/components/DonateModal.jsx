// '개발자에게 커피 한잔' — 후원 안내 모달. 모듈 스코프 컴포넌트(렌더 함수 안에 정의하면 리마운트로 포커스를 잃는다).
//
// 결제를 대신 처리하지 않는다. 송금 수단을 보여줄 뿐이고 실제 송금은 사용자가 자기 앱에서 한다.
// 그래서 이 화면은 어떤 개인정보·결제정보도 받지 않는다.
//
// 금액 버튼은 **금액이 이미 박힌 카카오페이 링크**로 바로 나간다(금액을 URL 로 조립하지 않는다 — donate.js 참고).
import Modal from "./Modal.jsx";
import { DONATE, donateOptions } from "../lib/donate.js";
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

const won = (n) => n.toLocaleString() + "원";

export default function DonateModal({ onClose }) {
  const { bank, kakao } = donateOptions(DONATE);
  const hasKakao = Boolean(kakao.free || kakao.amounts.length);

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
            <div className="dway">
              <div className="dw-t">카카오페이로 보내기</div>
              {/* 외부 사이트로 나간다 → noopener/noreferrer (탭 탈취·리퍼러 유출 차단). */}
              <div className="damts" role="group" aria-label="후원 금액 선택">
                {kakao.amounts.map((a) => (
                  <a key={a.won} className="damt" href={a.url} target="_blank" rel="noopener noreferrer">
                    {won(a.won)}
                  </a>
                ))}
                {kakao.free && (
                  <a className="damt free" href={kakao.free} target="_blank" rel="noopener noreferrer">
                    직접 입력
                  </a>
                )}
              </div>
              <div className="hint">
                카카오페이가 새 창에서 열립니다.
                {kakao.amounts.length > 0 && " 금액 버튼을 누르면 그 금액이 입력된 채로 열려요."}
                {kakao.free && " '직접 입력'은 원하는 금액을 앱에서 넣으시면 됩니다."}
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
