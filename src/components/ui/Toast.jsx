import { useEffect, useState } from "react";
import { getToasts, onToast, dismissToast } from "../../lib/toast.js";
import { IconCheck, IconInfo } from "./icons.jsx";

// 성공만 체크 표시, 나머지(info/warn/error)는 정보 아이콘. 심각도 구분은 색(.toast.error 등)이 한다.
const ICONS = { success: IconCheck, info: IconInfo, warn: IconInfo, error: IconInfo };

// 토스트 하나. 모듈 스코프에 둔다(렌더 함수 안에 정의하면 매 렌더 리마운트된다 — 프로젝트 규칙).
function ToastRow({ t }) {
  const Icon = ICONS[t.kind] || IconInfo;
  return (
    <div className={"toast " + t.kind}>
      <Icon className="toast-ico" />
      <div className="toast-body">
        <div className="toast-msg">{t.message}</div>
        {t.detail.length > 0 && (
          <ul className="toast-detail">
            {t.detail.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        )}
      </div>
      {/* 닫기는 '×' 문자 — 충전 방식 행 등 기존 삭제 버튼과 같은 관례 */}
      <button className="toast-x" onClick={() => dismissToast(t.id)} aria-label="알림 닫기" title="닫기">×</button>
    </div>
  );
}

// 화면 한 곳에서만 렌더한다(App). alert 와 달리 화면을 막지 않는다.
//
// **비어 있어도 컨테이너를 항상 렌더한다.** live region 을 그때그때 DOM 에 새로 넣으면
// 일부 스크린리더가 첫 알림을 읽지 못한다(이미 존재하던 영역의 '변경'만 안정적으로 읽는다).
// alert 는 거슬려도 강제로 읽혔으니, 대체하면서 그걸 잃으면 접근성 후퇴다.
// 빈 컨테이너는 pointer-events:none 이라 화면을 가리거나 클릭을 먹지 않는다.
export default function ToastHost() {
  const [toasts, setToasts] = useState(getToasts);
  useEffect(() => onToast(setToasts), []);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => <ToastRow key={t.id} t={t} />)}
    </div>
  );
}
