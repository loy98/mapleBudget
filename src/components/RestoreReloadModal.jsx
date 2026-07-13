import Modal from "./Modal.jsx";

// 백업 복원은 끝났지만 **새로고침을 아직 못 한** 상태를 위한 모달.
//
// 왜 토스트가 아니라 모달인가: 복원본은 이미 저장소에 들어갔는데 화면(React 메모리)은 아직 옛 상태다.
// 이때 사용자가 무엇이든 편집하면 자동저장 이펙트가 **옛 값으로 방금 복원한 데이터를 덮어쓴다.**
// 토스트는 화면을 막지 않으므로 그 편집을 막지 못한다 → 닫을 수 없는 모달로 편집 자체를 봉쇄한다.
//
// onClose 를 주지 않는다 = Esc·배경 클릭으로 닫히지 않는다(ConflictModal 과 같은 이유).
// 나갈 길은 새로고침 하나뿐이고, 그것이 정확히 우리가 원하는 것이다.
//
// 이 경로는 알림을 새로고침 너머로 넘길 저장소가 하나도 없을 때만 도달한다(정상적으로는 자동 새로고침).
// 모듈 스코프 컴포넌트(렌더 함수 내부 정의 금지 규칙 준수).
export default function RestoreReloadModal({ warnings = [], onReload }) {
  return (
    <Modal label="복원 완료 — 새로고침 필요">
      <>
        <div className="modal-title">복원했습니다. 새로고침이 필요해요</div>
        <p className="modal-body">
          백업을 이 브라우저에 복원했습니다. 다만 화면은 아직 이전 내용을 보여주고 있어요.
          <br /><b>새로고침해야 복원한 내용이 반영됩니다.</b>
          {warnings.length > 0 && (
            <>
              <br /><br /><span className="muted">복원 중 아래 항목은 형식이 맞지 않아 제외했습니다.</span>
            </>
          )}
        </p>
        {warnings.length > 0 && (
          <ul className="modal-body" style={{ marginTop: 0 }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onReload}>새로고침</button>
        </div>
      </>
    </Modal>
  );
}
