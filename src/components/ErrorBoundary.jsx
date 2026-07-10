import React from "react";
import { exportAll } from "../lib/storage.js";
import { recordError } from "../lib/errorLog.js";

// 렌더 중 예외가 하나만 터져도 React 18은 트리 전체를 언마운트한다 → 백지 화면.
// 공개 서비스에서는 사용자가 그 상태에서 할 수 있는 일이 아무것도 없으므로,
// 최소한 (1) 무슨 일인지 알리고 (2) localStorage에 남은 데이터를 백업받게 하고
// (3) 복구 경로를 준다. exportAll 은 React 상태가 아니라 localStorage를 직접 읽으므로
// 트리가 죽은 뒤에도 동작한다.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 로컬에 남긴다. 외부로 자동 전송하지 않는다 — 사용자가 백업 내보내기나 피드백에 스스로 첨부한다.
    // recordError 는 절대 던지지 않는다(기록하다 실패하면 이 핸들러가 다시 돌아 무한 루프가 된다).
    recordError(error, "render");
    console.error("[fatal] 렌더 오류", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="wrap">
        <div className="card fatal">
          <h2>화면을 표시하지 못했어요</h2>
          <p className="desc">
            예기치 못한 오류가 발생했습니다. 저장된 데이터는 그대로 남아 있으니,
            아래에서 백업을 받아두신 뒤 새로고침해 주세요.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => location.reload()}>새로고침</button>
            <button className="btn ghost" onClick={exportAll}>데이터 내보내기 (백업)</button>
          </div>
          <p className="hint">
            새로고침해도 같은 화면이 나온다면, 백업을 받은 뒤 브라우저 저장소를 비우면 초기 상태로 돌아갑니다.
          </p>
          <details className="fatal-detail">
            <summary>오류 정보</summary>
            <pre>{String(this.state.error?.stack || this.state.error)}</pre>
          </details>
        </div>
      </div>
    );
  }
}
