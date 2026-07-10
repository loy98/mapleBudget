import { useEffect, useState } from "react";
import { getStorageIssues, onStorageIssue, exportAll, corruptSlots } from "../lib/storage.js";

// 저장소 문제를 사용자에게 알린다. 이전에는 손상·쿼터 초과가 조용히 삼켜져서,
// 화면에는 데이터가 보이는데 새로고침하면 사라지는 상황을 사용자가 알 방법이 없었다.
// 모듈 스코프 컴포넌트(리마운트 방지 규칙 준수).
export default function StorageAlert() {
  const [issues, setIssues] = useState(getStorageIssues);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onStorageIssue(setIssues), []);

  const hasCorrupt = issues.corruptKeys.length > 0;
  if (dismissed || (!hasCorrupt && !issues.quotaHit)) return null;

  const unbacked = issues.unbackedKeys.length > 0;

  return (
    <div className={"storage-alert" + (unbacked ? " danger" : "")} role="alert">
      <div className="sa-body">
        {hasCorrupt && (
          <p>
            <b>저장된 데이터 일부를 읽지 못했습니다.</b>{" "}
            {unbacked ? (
              <>
                원본을 백업할 공간이 없어 <b>덮어쓰기를 중단했습니다.</b> 브라우저 저장소를 정리하기 전에는
                이 데이터가 저장되지 않습니다.
              </>
            ) : (
              <>
                원본은 <code>{corruptSlots(issues.corruptKeys[0])[0]}</code> 에 그대로 보관했습니다.
                아래에서 백업을 받아두시면 나중에 복구할 수 있습니다.
              </>
            )}
          </p>
        )}
        {issues.quotaHit && (
          <p>
            <b>브라우저 저장 공간이 가득 찼습니다.</b> 변경사항이 이 기기에 저장되지 않고 있어요.
            로그인하면 클라우드에 보관되고, 그렇지 않으면 새로고침 시 사라집니다.
          </p>
        )}
      </div>
      <div className="sa-actions">
        <button className="btn sm" onClick={exportAll}>데이터 내보내기 (백업)</button>
        <button className="btn ghost sm" onClick={() => setDismissed(true)}>닫기</button>
      </div>
    </div>
  );
}
