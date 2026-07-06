// 도움말 모달 — 앱 사용법·용어 안내(정적 콘텐츠, 백엔드 없음).
// 모듈 스코프 컴포넌트(리마운트로 포커스 유실 방지 규칙 준수).

export default function HelpModal({ onClose }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="도움말" onClick={onClose}>
      <div className="modal-card help" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">❓ 도움말</div>
          <button className="modal-x" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="modal-scroll">
          <p className="modal-body" style={{ marginBottom: 14 }}>
            메이플스토리 <b>MVP 등급작(엠작)</b>을 가장 싸게 채우는 방법을 계산하고, 실제 지출/실적을
            기록해 관리하는 도구예요. 로그인 없이도 쓸 수 있고(브라우저에 저장), 로그인하면 기기 간 자동 동기화됩니다.
          </p>

          <div className="help-sec">
            <h4>🧮 계산기 탭</h4>
            <ul>
              <li><b>충전 방식·비율</b>: 상품권/카드 등 충전 할인과 선물식·메소마켓 비율을 넣으면 순비용률을 계산해요.</li>
              <li><b>목표 등급까지 총비용</b>: 현재 13주 누적 실적에서 목표 등급까지 채우는 최소 실비용을 알려줘요.</li>
              <li><b>경매장 되팔기 분석</b>: 캐시 아이템을 사서 경매장에 되팔 때 본전가·회수 현금·손익·회수율을 비교해요.</li>
              <li><b>통합 최적</b>: 선물식·메소마켓·경매장 되팔기 중 <b>실제로 가장 싼 방법</b>으로 총비용을 냅니다.</li>
              <li><b>마일리지 / 최적 플랜</b>: 마일리지 사용까지 반영한 이번 달 실비용과 충전 배분 플랜을 제안해요.</li>
            </ul>
          </div>

          <div className="help-sec">
            <h4>📒 거래 기록 탭</h4>
            <ul>
              <li><b>통계 · 달력 · 입력</b> 3개 화면으로 구성돼요.</li>
              <li>구매/판매/현금화/지출을 기록하면 주차별·13주 누적으로 자동 집계됩니다.</li>
              <li><b>현금화</b>는 메소(억) + <b>억당(원/억)</b>을 넣으면 판매 현금이 자동 계산돼요.</li>
              <li><b>MVP 주</b>는 <b>목요일 시작 ~ 수요일 마감</b> 기준이에요(주 과금 단위와 동일).</li>
            </ul>
          </div>

          <div className="help-sec">
            <h4>🔮 예상 &amp; 추천 탭</h4>
            <ul>
              <li>지금까지의 실적 추세로 이번 주/이번 달 예상 실적과 등급 유지 여부를 보여줘요.</li>
              <li>목표 등급을 유지하려면 얼마를 더 채워야 하는지 추천해줍니다.</li>
            </ul>
          </div>

          <div className="help-sec">
            <h4>📖 용어</h4>
            <ul>
              <li><b>선물식</b>: 캐시를 선물해 메소로 바꾸는 방식(메소 : 1메포 비율).</li>
              <li><b>메소마켓</b>: 메포를 메소로 환전(메소 / 1메포 비율).</li>
              <li><b>경매장 되팔기</b>: 캐시템을 사서 경매장에 팔아 메소를 확보(수수료 반영).</li>
              <li><b>억당</b>: 메소 1억을 현금 얼마에 파는지(원/억).</li>
              <li><b>마일리지</b>: 넥슨 마일리지로 일부 결제해 실비용을 낮추는 것.</li>
            </ul>
          </div>

          <div className="help-sec">
            <h4>💾 데이터 &amp; 동기화</h4>
            <ul>
              <li>모든 데이터는 기본적으로 <b>이 브라우저</b>에 저장돼요(게스트 모드).</li>
              <li><b>로그인</b>(Google·이메일 링크)하면 여러 기기에서 자동 동기화됩니다.</li>
              <li>기기 이동만 하고 싶으면 하단의 <b>데이터 내보내기/가져오기</b>(JSON)를 쓰세요.</li>
            </ul>
          </div>

          <p className="hint" style={{ marginTop: 4 }}>
            더 궁금하거나 개선 아이디어가 있으면 상단 <b>💬 피드백</b> 버튼으로 알려주세요.
          </p>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
