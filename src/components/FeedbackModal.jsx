// 피드백 모달 — Supabase feedback 테이블에 INSERT. 게스트/로그인 모두 제출 가능.
// 모듈 스코프 컴포넌트(리마운트로 입력 포커스 유실 방지 규칙 준수).
import { useState } from "react";
import { submitFeedback, cloudEnabled } from "../lib/cloud.js";
import { getRecentErrors, formatErrorsForFeedback } from "../lib/errorLog.js";
import { CSelect } from "./ui.jsx";
import Modal from "./Modal.jsx";

const CATEGORIES = [
  { value: "suggestion", label: "💡 건의 · 개선" },
  { value: "bug", label: "🐞 버그 신고" },
  { value: "question", label: "❔ 질문" },
  { value: "etc", label: "✏️ 기타" },
];
const MAX = 4000;

export default function FeedbackModal({ onClose, session }) {
  const [category, setCategory] = useState("suggestion");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(session?.user?.email || "");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  // 최근 오류가 있으면 첨부 여부를 묻는다. 오류는 로컬에만 쌓이고, **사용자가 켰을 때만** 전송된다.
  const [recentErrors] = useState(getRecentErrors);
  const [attachErrors, setAttachErrors] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const canSend = message.trim().length > 0 && status !== "sending";

  const send = async () => {
    if (!canSend) return;
    setStatus("sending");
    setErrMsg("");
    // 첨부는 본문 뒤에 붙인다(서버가 message 를 4000자로 자르므로 사용자 글이 먼저 온다).
    const body = attachErrors ? message + formatErrorsForFeedback(recentErrors) : message;
    const { error } = await submitFeedback({ message: body, category, email });
    if (error) {
      setStatus("error");
      setErrMsg(
        error.message === "cloud-disabled"
          ? "지금은 피드백 전송을 사용할 수 없어요. 잠시 후 다시 시도해 주세요."
          : error.message === "rate-limited"
          ? "짧은 시간에 너무 많이 보내셨어요. 10분 뒤에 다시 시도해 주세요."
          : "전송에 실패했어요. 잠시 후 다시 시도해 주세요."
      );
      return;
    }
    setStatus("sent");
  };

  return (
    <Modal onClose={onClose} label="피드백 보내기" cardClass="feedback">
      <>
        <div className="modal-head">
          <div className="modal-title">💬 피드백 보내기</div>
          <button className="modal-x" onClick={onClose} aria-label="닫기">×</button>
        </div>

        {status === "sent" ? (
          <>
            <p className="modal-body">
              소중한 의견 감사합니다! 🙌<br />보내주신 내용은 잘 전달됐어요.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>닫기</button>
            </div>
          </>
        ) : (
          <>
            <div className="fb-field">
              <label>종류</label>
              <CSelect value={category} onChange={setCategory} options={CATEGORIES} />
            </div>

            <div className="fb-field">
              <label>내용<span className="req">*</span></label>
              <textarea
                className="fb-text"
                placeholder="개선 아이디어, 버그, 궁금한 점 등을 자유롭게 적어주세요."
                value={message}
                maxLength={MAX}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
              />
              <div className="fb-count">{message.length} / {MAX}</div>
            </div>

            <div className="fb-field">
              <label>회신 이메일 <span className="muted">(선택)</span></label>
              <input
                className="fb-input"
                type="email"
                placeholder="답변이 필요하면 남겨주세요"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {recentErrors.length > 0 && (
              <div className="fb-field">
                <label className="fb-check">
                  <input type="checkbox" checked={attachErrors} onChange={(e) => setAttachErrors(e.target.checked)} />
                  {" "}최근 오류 {Math.min(recentErrors.length, 3)}건 첨부 <span className="muted">(원인 파악에 도움이 돼요)</span>
                </label>
              </div>
            )}

            {status === "error" && <div className="fb-err">{errMsg}</div>}
            {!cloudEnabled && (
              <div className="hint">※ 현재 환경에서는 피드백 전송이 비활성화되어 있어요.</div>
            )}

            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose}>취소</button>
              <button className="btn" onClick={send} disabled={!canSend}>
                {status === "sending" ? "보내는 중…" : "보내기"}
              </button>
            </div>
          </>
        )}
      </>
    </Modal>
  );
}
