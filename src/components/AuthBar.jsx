import { useState } from "react";
import { cloudEnabled, signInWithGoogle, signInWithEmail, signOut } from "../lib/cloud.js";

export default function AuthBar({ session, syncState }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!cloudEnabled) return null;

  // 로그아웃은 이 기기에서 계정 데이터를 지운다(공용 브라우저 대비). 지운 뒤 리로드해야
  // 메모리에 남은 React 상태가 자동저장 이펙트로 localStorage 에 되살아나지 않는다.
  const logout = async () => {
    const { error } = await signOut();
    if (error) { alert("로그아웃 실패: " + error.message); return; }
    location.reload();
  };

  if (session) {
    const label = session.user?.email || "로그인됨";
    const sync =
      syncState === "syncing" ? "동기화 중…" :
      syncState === "error" ? "동기화 오류" : "동기화됨";
    const cls = syncState === "error" ? "bad" : syncState === "syncing" ? "muted" : "good";
    return (
      <div className="authbar">
        <span className={"sync " + cls}>☁ {sync}</span>
        <span className="muted" style={{ fontSize: 12 }}>{label}</span>
        <button className="btn ghost sm" onClick={logout}>로그아웃</button>
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
