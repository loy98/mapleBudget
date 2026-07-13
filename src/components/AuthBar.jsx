import { useState, useRef, useEffect } from "react";
import { cloudEnabled, signInWithGoogle, signInWithEmail, signOut } from "../lib/cloud.js";
import { IconCloud } from "./ui/icons.jsx";
import Modal from "./Modal.jsx";

// 아직 클라우드에 못 올린 변경이 있는데 로그아웃하려 할 때. 로그아웃은 이 기기의 계정 데이터를 지우므로
// 그대로 진행하면 그 변경은 영구 소실된다 → 반드시 사용자에게 알리고 고르게 한다.
// 네이티브 confirm 대신 앱 테마 모달(ConflictModal 과 같은 이유 — 테스트 가능·UI 일관성).
function UnsyncedLogoutModal({ onChoose }) {
  return (
    <Modal label="동기화되지 않은 변경">
      <>
        <div className="modal-title">아직 저장되지 않은 변경이 있어요</div>
        <p className="modal-body">
          최근 변경사항을 클라우드에 올리지 못했습니다(네트워크 문제일 수 있어요).
          <br />지금 로그아웃하면 이 기기에서 <b>그 변경은 사라집니다.</b>
        </p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => onChoose(false)}>취소 (다시 시도)</button>
          <button className="btn" onClick={() => onChoose(true)}>그래도 로그아웃</button>
        </div>
      </>
    </Modal>
  );
}

export default function AuthBar({ session, syncState, flushPendingUpload }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askUnsynced, setAskUnsynced] = useState(false);

  const userId = session?.user?.id ?? null;
  const userIdRef = useRef(null);
  userIdRef.current = userId;
  // 모달이 떠 있는 동안 대기 중인 resolver. state 가 아니라 ref 로 든다 —
  // 계정 전환/언마운트에서 **반드시 해소**해야 하기 때문이다. 해소하지 않으면 logout() 이 await 에 갇히고,
  // 그 continuation 이 나중에 살아나 **다른 계정을 로그아웃**시킬 수 있다.
  const pendingConfirmRef = useRef(null);

  const resolvePending = (v) => {
    const p = pendingConfirmRef.current;
    pendingConfirmRef.current = null;
    setAskUnsynced(false);
    p?.resolve(v);
  };
  // 계정이 바뀌면(다른 탭 로그아웃·재로그인 등) 대기 중 선택을 취소로 해소한다.
  useEffect(() => {
    const p = pendingConfirmRef.current;
    if (p && p.userId !== userId) resolvePending(false);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { const p = pendingConfirmRef.current; pendingConfirmRef.current = null; p?.resolve(false); }, []);

  if (!cloudEnabled) return null;

  // 로그아웃은 이 기기에서 계정 데이터를 지운다(공용 브라우저 대비). 지운 뒤 리로드해야
  // 메모리에 남은 React 상태가 자동저장 이펙트로 localStorage 에 되살아나지 않는다.
  //
  // 지우기 전에 **대기 중인 업로드를 먼저 흘려보낸다.** 업로드는 800ms 디바운스라, 편집 직후 로그아웃하면
  // 그 편집은 로컬에만 있고 클라우드엔 없다 → 로컬을 지우는 순간 영구 소실된다.
  const doLogout = async () => {
    const { error } = await signOut();
    if (error) { alert("로그아웃 실패: " + error.message); return; }
    location.reload();
  };
  const logout = async () => {
    if (busy) return;
    const uid = userIdRef.current;   // 이 로그아웃이 대상으로 삼은 계정. 아래 await 마다 아직 그 계정인지 확인한다.
    if (!uid) return;
    setBusy(true);
    let ok = true;
    try { ({ ok } = await flushPendingUpload()); } catch { ok = false; }
    setBusy(false);
    if (userIdRef.current !== uid) return; // 플러시 중 계정이 바뀌었다 → 이 로그아웃 요청은 무효
    if (ok) { await doLogout(); return; }
    // 못 올린 변경이 남았다 → 사용자가 고른다.
    const proceed = await new Promise((resolve) => {
      pendingConfirmRef.current = { userId: uid, resolve };
      setAskUnsynced(true);
    });
    if (!proceed || userIdRef.current !== uid) return;
    await doLogout();
  };

  if (session) {
    const label = session.user?.email || "로그인됨";
    const sync =
      syncState === "syncing" ? "동기화 중…" :
      syncState === "error" ? "동기화 오류" : "동기화됨";
    const cls = syncState === "error" ? "bad" : syncState === "syncing" ? "muted" : "good";
    return (
      <div className="authbar">
        <span className={"sync " + cls}><IconCloud />{sync}</span>
        <span className="muted" style={{ fontSize: 12 }}>{label}</span>
        <button className="btn ghost sm" onClick={logout} disabled={busy}>
          {busy ? "저장 중…" : "로그아웃"}
        </button>
        {askUnsynced && <UnsyncedLogoutModal onChoose={resolvePending} />}
      </div>
    );
  }

  const sendLink = async () => {
    if (!email || busy) return;
    setBusy(true);
    // Supabase auth는 throw하지 않고 {error}를 반환 → 반드시 확인.
    const { error } = await signInWithEmail(email);
    setBusy(false);
    if (error) { alert("메일 전송 실패: " + error.message); return; }
    setSent(true);
  };
  const google = async () => {
    const { error } = await signInWithGoogle();
    if (error) alert("Google 로그인 실패: " + error.message);
  };

  return (
    <div className="authbar">
      <button className="btn sm" onClick={() => setOpen((v) => !v)}>로그인</button>
      {open && (
        <div className="authpop">
          <button className="btn ghost sm" onClick={google}>Google로 계속</button>
          <div className="author">또는 이메일 링크</div>
          <div className="emailrow">
            <input placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn sm" onClick={sendLink} disabled={busy}>보내기</button>
          </div>
          {sent && <div className="hint" style={{ marginTop: 6 }}>메일로 보낸 로그인 링크를 눌러주세요.</div>}
        </div>
      )}
    </div>
  );
}
