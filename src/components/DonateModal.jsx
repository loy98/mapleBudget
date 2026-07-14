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
  // 금액이 미리 입력되는 버튼과 그렇지 않은 버튼이 **섞일 수 있다**(금액별 링크를 일부만 발급한 경우).
  // 안내를 하나로 뭉뚱그리면 그 상태에서 반드시 거짓말이 된다 → 세 경우를 갈라서 말한다.
  const nPre = kakao.amounts.filter((a) => a.prefilled).length;
  const allPrefilled = kakao.amounts.length > 0 && nPre === kakao.amounts.length;
  const mixed = nPre > 0 && nPre < kakao.amounts.length;
  // 금액 버튼이 전부 자유금액 링크로 간다면 '직접 입력' 버튼은 그 버튼들과 목적지가 똑같다 → 감춘다.
  // (금액별 링크가 설정되는 순간 목적지가 갈리므로 자동으로 다시 나타난다.)
  const showFree = Boolean(kakao.free) && (kakao.amounts.length === 0 || nPre > 0);

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
                  <a key={a.won} className="damt" href={a.href} target="_blank" rel="noopener noreferrer"
                    // 섞인 상태에서는 이 버튼이 어느 쪽인지 버튼 자신이 말해야 한다(공용 안내문으로는 구분이 안 된다).
                    aria-label={`${won(a.won)}${a.note ? ` · ${a.note}` : ""}${a.prefilled ? "" : " — 금액은 카카오페이에서 직접 입력"}`}>
                    <span className="da-won">{won(a.won)}</span>
                    <span className="da-note">
                      {a.note}
                      {mixed && !a.prefilled && <span className="da-manual">앱에서 입력</span>}
                    </span>
                  </a>
                ))}
                {showFree && (
                  <a className="damt free" href={kakao.free} target="_blank" rel="noopener noreferrer">
                    <span className="da-won">직접 입력</span>
                    <span className="da-note">원하는 만큼</span>
                  </a>
                )}
              </div>
              {/* 금액이 미리 입력되는지 아닌지를 숨기지 않는다 — '1,000원'을 눌렀는데 빈 금액칸이 열리면
                  라벨이 거짓말을 한 꼴이 된다. 어느 쪽인지 먼저 말해 준다. */}
              <div className="hint">
                카카오페이가 새 창에서 열립니다.{" "}
                {allPrefilled && "금액 버튼을 누르면 그 금액이 입력된 채로 열려요."}
                {mixed && "'앱에서 입력'이 붙은 금액은 카카오페이에서 직접 넣어 주세요. 나머지는 금액이 입력된 채로 열립니다."}
                {!allPrefilled && !mixed && "금액은 카카오페이에서 직접 입력해 주세요."}
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
