// 도움말 모달 — 앱 사용법·용어 안내(정적 콘텐츠, 백엔드 없음).
// 모듈 스코프 컴포넌트(리마운트로 포커스 유실 방지 규칙 준수).
// Esc 닫기·포커스 트랩은 Modal 껍데기가 담당.
import Modal from "./Modal.jsx";
import { IconHelp, IconCalculator, IconBook, IconTarget, IconInfo, IconCloud } from "./ui/icons.jsx";

export default function HelpModal({ onClose }) {
  return (
    <Modal onClose={onClose} label="도움말" cardClass="help">
      <>
        <div className="modal-head">
          <div className="modal-title"><IconHelp />도움말</div>
          <button className="modal-x" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="modal-scroll">
          <p className="modal-body" style={{ marginBottom: 14 }}>
            MVP 등급작(엠작)을 제일 싸게 채우는 방법을 계산하고, 실제로 얼마를 쓰고 얼마를 회수했는지
            기록해 두는 도구입니다. 로그인 없이 그냥 써도 되고, 로그인하면 PC와 폰이 같은 기록을 봅니다.
          </p>

          <div className="help-sec">
            <h4><IconCalculator />계산기 탭</h4>
            <ul>
              <li>왼쪽에 시세와 조건을 넣습니다. 메소 시세, 선물식·메소마켓 비율, 충전 방식, 현재 등급, 보유 마일리지.</li>
              <li><b>현재 누적 실적</b>은 두 가지로 넣을 수 있습니다. <b>직접 입력</b>은 아무 숫자나 넣어 시나리오를 돌려보는 것이고, <b>내 기록 사용</b>은 거래 기록의 13주 누적을 그대로 가져옵니다.</li>
              <li>맨 위 진행률(%)은 <b>누적 실적 ÷ 목표 금액</b>입니다. 실제 진행 상황을 보려면 '내 기록 사용'으로 바꾸세요. 사이드바의 'MVP 등급'은 경매장 수수료 계산에만 씁니다.</li>
              <li>3번에서 캐시템과 경매장 시세를 넣으면 본전가와 회수 금액이 나오고, 4번이 선물식·메소마켓·되팔기 중 제일 싼 걸 골라 줍니다.</li>
              <li>6번은 이번 달 실적을 어떤 조합으로 채우는 게 제일 싼지 짜 줍니다.</li>
            </ul>
          </div>

          <div className="help-sec">
            <h4><IconBook />거래 기록 탭</h4>
            <ul>
              <li>통계, 달력, 입력 세 화면입니다. 구매·판매·현금화·기타 지출을 날짜별로 적으면 주차별과 13주 누적이 자동으로 잡힙니다.</li>
              <li>현금화는 메소(억)와 억당 단가(원)를 넣으면 판매 현금이 알아서 계산됩니다.</li>
              <li>MVP 주는 <b>목요일에 시작해 수요일에 끝납니다.</b> 게임의 주 과금 단위와 같습니다.</li>
              <li>거래는 기록할 때의 수수료·할인율로 저장되니, 나중에 설정을 바꿔도 과거 손익이 흔들리지 않습니다.</li>
            </ul>
          </div>

          <div className="help-sec">
            <h4><IconTarget />예상 &amp; 추천 탭</h4>
            <ul>
              <li>지금 페이스면 언제 목표 등급에 닿는지 보여줍니다.</li>
              <li>13주 창에서 빠져나갈 금액까지 계산해서, 등급을 유지하려면 주당 얼마가 필요한지 알려줍니다.</li>
            </ul>
          </div>

          <div className="help-sec">
            <h4><IconInfo />용어</h4>
            <ul>
              <li><b>선물식</b> — 캐시를 남에게 선물해 주고 메소를 받는 방식. 메포당 받는 메소를 비율로 넣습니다.</li>
              <li><b>메소마켓</b> — 메포를 메소마켓에서 메소로 바꾸는 것.</li>
              <li><b>경매장 되팔기</b> — 캐시템을 사서 경매장에 팔아 메소를 만드는 것. 수수료가 빠집니다.</li>
              <li><b>억당</b> — 메소 1억을 현금 얼마에 파는지(원/억).</li>
              <li><b>마일리지</b> — 캐시가의 최대 30%까지 마일리지로 결제할 수 있습니다. 다만 그만큼은 <b>실적으로 안 잡히고</b>, 랜덤박스류는 아예 못 씁니다.</li>
            </ul>
          </div>

          <div className="help-sec">
            <h4><IconCloud />데이터 &amp; 동기화</h4>
            <ul>
              <li>기본적으로 데이터는 <b>이 브라우저에만</b> 저장됩니다. 서버로 안 갑니다.</li>
              <li>로그인(구글 또는 이메일 링크)하면 계정에 동기화돼서 여러 기기에서 같은 기록을 봅니다.</li>
              <li>기기만 옮기고 싶으면 아래쪽 <b>내보내기 / 가져오기</b>(JSON 파일)를 쓰면 됩니다.</li>
            </ul>
          </div>

          <p className="hint" style={{ marginTop: 4 }}>
            더 자세한 설명은 <a href="/guide">엠작 가이드</a>에 있습니다. 버그나 건의사항은 위쪽 <b>피드백</b> 버튼으로 보내 주세요.
          </p>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </>
    </Modal>
  );
}
