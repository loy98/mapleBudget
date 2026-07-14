// 계정 삭제(탈퇴) 확인 모달.
//
// 되돌릴 수 없는 삭제다 → 두 겹으로 막는다: ① 무엇이 지워지는지 명시 ② "삭제"를 직접 입력.
// 그리고 지우기 전에 **백업 내보내기**를 눈앞에 둔다 — 클라우드 데이터가 사라져도
// 그 파일만 있으면 게스트 모드로 그대로 이어 쓸 수 있다.
//
// 모듈 스코프 컴포넌트(렌더 함수 내부 정의 금지 규칙 준수).
import { useState } from "react";
import { deleteAccount } from "../lib/cloud.js";
import { exportAll } from "../lib/storage.js";
import Modal from "./Modal.jsx";

const CONFIRM_WORD = "삭제";

export default function AccountDeleteModal({ email, onClose }) {
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    if (busy || word.trim() !== CONFIRM_WORD) return;
    setBusy(true);
    setErr("");
    const { error } = await deleteAccount();
    if (error) {
      setBusy(false);
      setErr(
        error.message === "cloud-disabled"
          ? "지금은 계정 삭제를 사용할 수 없어요. 잠시 후 다시 시도해 주세요."
          : "계정 삭제에 실패했어요. 잠시 후 다시 시도하거나, 계속 실패하면 피드백으로 알려주세요."
      );
      return;
    }
    // 계정과 이 기기의 계정 데이터가 모두 사라졌다 → 메모리에 남은 React 상태가 자동저장으로
    // 되살아나지 않도록 새로고침한다(로그아웃과 같은 이유).
    location.reload();
  };

  return (
    <Modal onClose={busy ? undefined : onClose} label="계정 삭제">
      <>
        <div className="modal-title">계정을 삭제할까요?</div>
        <p className="modal-body">
          <b>{email}</b> 계정과 클라우드에 저장된 <b>계산기 설정 · 내 아이템 · 거래 기록</b>이 지워집니다.
          <br />
          <b>되돌릴 수 없습니다.</b> 다른 기기에 남아 있던 사본도 다음 접속 때 사라집니다.
        </p>
        <ul className="del-list">
          <li>보내주신 문의는 <b>내용만 남고</b> 작성자·회신 이메일은 지워집니다(익명화).</li>
          <li>이 브라우저에 저장된 데이터도 함께 지워집니다.</li>
          <li>계정 없이(게스트로) 계산기를 계속 쓰실 수 있어요.</li>
        </ul>

        <div className="del-backup">
          <button className="btn ghost sm" onClick={exportAll} disabled={busy}>
            먼저 데이터 내보내기 (백업)
          </button>
          <span className="hint">지우기 전에 받아두면 나중에 그대로 복원할 수 있어요.</span>
        </div>

        <div className="fb-field">
          <label>확인을 위해 <b>{CONFIRM_WORD}</b> 를 입력해 주세요</label>
          <input
            className="fb-input"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder={CONFIRM_WORD}
            disabled={busy}
            autoComplete="off"
          />
        </div>

        {err && <div className="fb-err">{err}</div>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>취소</button>
          <button className="btn danger" onClick={run} disabled={busy || word.trim() !== CONFIRM_WORD}>
            {busy ? "삭제 중…" : "계정 삭제"}
          </button>
        </div>
      </>
    </Modal>
  );
}
