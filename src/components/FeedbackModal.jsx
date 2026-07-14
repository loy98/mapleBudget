// 피드백 모달 — 보내기(게스트 포함) + 내 문의 내역(로그인 시).
// 모듈 스코프 컴포넌트(리마운트로 입력 포커스 유실 방지 규칙 준수).
import { useState, useRef, useEffect, useCallback } from "react";
import {
  submitFeedback, cloudEnabled, uploadFeedbackAttachments, fetchMyFeedback, signedAttachmentUrls,
} from "../lib/cloud.js";
import { getRecentErrors, formatErrorsForFeedback } from "../lib/errorLog.js";
import {
  ATTACH_ACCEPT, ATTACH_MAX_FILES, ATTACH_MAX_BYTES, validateAttachments, mb, statusOf, categoryLabel,
} from "../lib/feedback.js";
import { CSelect } from "./ui.jsx";
import { IconChat, IconImage, IconTrash } from "./ui/icons.jsx";
import Modal from "./Modal.jsx";

const CATEGORIES = [
  { value: "suggestion", label: "건의 · 개선" },
  { value: "bug", label: "버그 신고" },
  { value: "question", label: "질문" },
  { value: "etc", label: "기타" },
];
const MAX = 4000;

const fmtDate = (iso) => {
  // 문의 시각은 '언제 보냈는지'를 보는 용도다. 브라우저 로컬 시간으로 충분하다(주차 계산이 아니다).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ===== 첨부 고르기 =====
function AttachPicker({ files, setFiles, disabled }) {
  const inputRef = useRef(null);
  const [errs, setErrs] = useState([]);
  // 미리보기 URL 은 파일마다 만들고 **떼어낼 때 반드시 해제**한다(안 하면 blob 이 탭에 쌓인다).
  const [previews, setPreviews] = useState([]);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const onPick = (e) => {
    const { accepted, errors } = validateAttachments(e.target.files, files.length);
    setErrs(errors);
    if (accepted.length) setFiles([...files, ...accepted]);
    // 같은 파일을 다시 고를 수 있게 값을 비운다(안 그러면 change 가 안 뜬다).
    e.target.value = "";
  };
  const remove = (i) => {
    setErrs([]);
    setFiles(files.filter((_, k) => k !== i));
  };

  return (
    <div className="fb-field">
      <label>
        첨부 이미지 <span className="muted">(선택 · 최대 {ATTACH_MAX_FILES}장 · 한 장당 {mb(ATTACH_MAX_BYTES)}MB)</span>
      </label>
      <div className="fb-attach-row">
        {files.map((f, i) => (
          <div className="fb-thumb" key={f.name + i}>
            {previews[i] && <img src={previews[i]} alt={f.name} />}
            <button
              type="button"
              className="fb-thumb-x"
              onClick={() => remove(i)}
              disabled={disabled}
              aria-label={`${f.name} 첨부 제거`}
            >
              <IconTrash />
            </button>
          </div>
        ))}
        {files.length < ATTACH_MAX_FILES && (
          <button
            type="button"
            className="fb-attach-add"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            <IconImage />
            <span>사진 추가</span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ATTACH_ACCEPT}
          multiple
          style={{ display: "none" }}
          onChange={onPick}
        />
      </div>
      {errs.map((e, i) => (
        <div className="fb-err" key={i}>{e}</div>
      ))}
    </div>
  );
}

// ===== 보내기 =====
function SendPanel({ session, onClose, onSent, onBusy }) {
  const [category, setCategory] = useState("suggestion");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(session?.user?.email || "");
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [progress, setProgress] = useState(null);
  // 최근 오류가 있으면 첨부 여부를 묻는다. 오류는 로컬에만 쌓이고, **사용자가 켰을 때만** 전송된다.
  const [recentErrors] = useState(getRecentErrors);
  const [attachErrors, setAttachErrors] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const userId = session?.user?.id || null;
  const canSend = message.trim().length > 0 && status !== "sending";

  // 보내는 동안에는 모달을 닫을 수 없다(× · Esc · 배경 클릭 모두). 부모가 잠근다.
  useEffect(() => { onBusy?.(status === "sending"); }, [status, onBusy]);

  // 전송 중에는 모달이 잠긴다(취소·×·Esc·탭). 그러므로 **어떤 경로로도 status 가 "sending" 에
  // 머물러선 안 된다** — 예외 하나가 모달을 영영 못 닫게 만든다(Codex 2차 지적).
  // 그래서 전 구간을 try/catch 로 감싸고, 예상 못 한 예외도 '오류' 상태로 떨어뜨린다.
  const send = async () => {
    if (!canSend) return;
    setStatus("sending");
    setErrMsg("");

    try {
      // 이미지 먼저 올리고, 그 경로를 달아 문의를 넣는다(cloud.js 의 순서 주석 참고).
      let paths = [];
      if (files.length && userId) {
        setProgress({ done: 0, total: files.length });
        const up = await uploadFeedbackAttachments(files, userId, (done, total) => setProgress({ done, total }));
        if (up.error) {
          setStatus("error");
          setErrMsg(
            up.error.message === "attach-rejected"
              ? "이미지를 올릴 수 없었어요. 짧은 시간에 너무 많이 올렸다면 잠시 뒤 다시 시도해 주세요."
              : "이미지 업로드에 실패했어요. 네트워크를 확인한 뒤 다시 시도해 주세요."
          );
          return;
        }
        paths = up.paths;
      }

      // 첨부는 본문 뒤에 붙인다(서버가 message 를 4000자로 자르므로 사용자 글이 먼저 온다).
      const body = attachErrors ? message + formatErrorsForFeedback(recentErrors) : message;
      const { error } = await submitFeedback({ message: body, category, email, attachments: paths });
      if (error) {
        setStatus("error");
        setErrMsg(
          error.message === "cloud-disabled"
            ? "지금은 피드백 전송을 사용할 수 없어요. 잠시 후 다시 시도해 주세요."
            : error.message === "rate-limited"
            ? "짧은 시간에 너무 많이 보내셨어요. 10분 뒤에 다시 시도해 주세요."
            : error.message === "bad-attachment"
            ? "첨부 이미지를 처리하지 못했어요. 이미지를 빼고 다시 시도해 주세요."
            : "전송에 실패했어요. 잠시 후 다시 시도해 주세요."
        );
        return;
      }
      setStatus("sent");
      onSent?.();
    } catch (e) {
      console.warn("[feedback] 전송 중 예외", e);
      setStatus("error");
      setErrMsg("전송 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setProgress(null);
    }
  };

  if (status === "sent") {
    return (
      <>
        <p className="modal-body">
          소중한 의견 감사합니다! 🙌<br />
          보내주신 내용은 잘 전달됐어요.
          {userId
            ? <><br />처리 상태와 답변은 <b>내 문의</b> 탭에서 확인하실 수 있어요.</>
            : <><br />답변을 앱에서 보시려면 다음부터는 <b>로그인 후</b> 문의해 주세요.</>}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </>
    );
  }

  return (
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

      {userId ? (
        <AttachPicker files={files} setFiles={setFiles} disabled={status === "sending"} />
      ) : (
        <div className="hint">※ 사진 첨부와 답변 확인은 <b>로그인</b> 후에 이용할 수 있어요.</div>
      )}

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

      {/* 보내는 중에는 취소를 잠근다. 닫아도 send() 프로미스는 계속 살아 업로드·INSERT 를 끝내므로,
          사용자는 취소했다고 믿는데 문의는 전송된다(Codex 지적). 나갈 길을 아예 막는 편이 정직하다.
          모달 자체의 닫기(×·Esc·배경 클릭)도 같은 이유로 함께 잠근다(FeedbackModal 이 onClose 를 넘기지 않는다). */}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose} disabled={status === "sending"}>취소</button>
        <button className="btn" onClick={send} disabled={!canSend}>
          {status === "sending"
            ? progress
              ? `이미지 올리는 중… (${progress.done}/${progress.total})`
              : "보내는 중…"
            : "보내기"}
        </button>
      </div>
    </>
  );
}

// ===== 내 문의 한 건 =====
function FeedbackRow({ row }) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState({});
  const st = statusOf(row.status);

  // 서명 URL 은 수명이 짧다 → 펼칠 때 발급한다(목록만 볼 때는 요청하지 않는다).
  useEffect(() => {
    let alive = true;
    if (!open || !row.attachments.length) return undefined;
    signedAttachmentUrls(row.attachments).then((m) => { if (alive) setUrls(m); });
    return () => { alive = false; };
  }, [open, row.attachments]);

  return (
    <li className="fb-item">
      <button className="fb-item-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={"fb-badge " + st.tone}>{st.label}</span>
        <span className="fb-item-cat">{categoryLabel(row.category)}</span>
        <span className="fb-item-msg">{row.message}</span>
        <span className="fb-item-date">{fmtDate(row.created_at)}</span>
      </button>

      {open && (
        <div className="fb-item-body">
          <div className="fb-item-full">{row.message}</div>

          {row.attachments.length > 0 && (
            <div className="fb-attach-row">
              {row.attachments.map((p) => (
                <a
                  key={p}
                  className="fb-thumb"
                  href={urls[p] || undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="첨부 이미지 원본 보기"
                >
                  {urls[p]
                    ? <img src={urls[p]} alt="첨부 이미지" />
                    : <span className="fb-thumb-load">불러오는 중…</span>}
                </a>
              ))}
            </div>
          )}

          {row.reply ? (
            <div className="fb-reply">
              <div className="fb-reply-head">답변 {row.replied_at && <span className="muted">· {fmtDate(row.replied_at)}</span>}</div>
              <div className="fb-reply-body">{row.reply}</div>
            </div>
          ) : (
            <div className="hint">{st.hint}</div>
          )}
        </div>
      )}
    </li>
  );
}

// ===== 내 문의 목록 =====
function MyPanel({ onClose, reloadKey }) {
  const [state, setState] = useState({ loading: true, rows: [], error: "" });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const { rows, error } = await fetchMyFeedback();
    setState({
      loading: false,
      rows,
      error: error ? "문의 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." : "",
    });
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  return (
    <>
      {state.loading ? (
        <p className="modal-body muted">불러오는 중…</p>
      ) : state.error ? (
        <div className="fb-err">{state.error}</div>
      ) : state.rows.length === 0 ? (
        <p className="modal-body muted">
          아직 보낸 문의가 없어요.<br />
          <span className="hint">로그인 상태로 보낸 문의만 여기에 남습니다(게스트 문의는 주인을 확인할 수 없어요).</span>
        </p>
      ) : (
        <ul className="fb-list">
          {state.rows.map((r) => <FeedbackRow key={r.id} row={r} />)}
        </ul>
      )}
      <div className="modal-actions">
        <button className="btn ghost" onClick={load} disabled={state.loading}>새로고침</button>
        <button className="btn" onClick={onClose}>닫기</button>
      </div>
    </>
  );
}

export default function FeedbackModal({ onClose, session }) {
  const [tab, setTab] = useState("send"); // send | my
  const [reloadKey, setReloadKey] = useState(0);
  // 전송 중에는 닫기를 잠근다 — 닫아도 전송은 계속되므로, 취소한 줄 알고 나가는 길을 만들지 않는다.
  const [sending, setSending] = useState(false);
  const loggedIn = !!session?.user?.id;
  const close = sending ? undefined : onClose;

  return (
    <Modal onClose={close} label="피드백 보내기" cardClass="feedback">
      <>
        <div className="modal-head">
          <div className="modal-title"><IconChat />{tab === "my" ? "내 문의" : "피드백 보내기"}</div>
          <button className="modal-x" onClick={close} disabled={sending} aria-label="닫기">×</button>
        </div>

        {/* 전송 중에는 탭도 잠근다. 탭을 옮기면 SendPanel 이 언마운트되는데, 전송 프로미스는 계속 살아
            문의를 넣고, 잠금(sending)은 풀리지 않아 모달이 영영 닫히지 않는다. */}
        {loggedIn && (
          <div className="fb-tabs" role="tablist">
            {/* 탭 이름은 전송 버튼("보내기")과 겹치지 않게 둔다 — 겹치면 화면에서도, 스크린리더에서도
                같은 이름의 조작이 둘이 된다(테스트에서 실제로 잘못 눌렸다). */}
            <button
              role="tab"
              aria-selected={tab === "send"}
              className={"fb-tab " + (tab === "send" ? "on" : "")}
              onClick={() => setTab("send")}
              disabled={sending}
            >
              문의하기
            </button>
            <button
              role="tab"
              aria-selected={tab === "my"}
              className={"fb-tab " + (tab === "my" ? "on" : "")}
              onClick={() => setTab("my")}
              disabled={sending}
            >
              내 문의
            </button>
          </div>
        )}

        {tab === "send" ? (
          <SendPanel
            session={session}
            onClose={close}
            onSent={() => setReloadKey((k) => k + 1)}
            onBusy={setSending}
          />
        ) : (
          <MyPanel onClose={onClose} reloadKey={reloadKey} />
        )}
      </>
    </Modal>
  );
}
