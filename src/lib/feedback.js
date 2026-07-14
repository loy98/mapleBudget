// 피드백(문의) 도메인 규칙 — 첨부 검증과 상태 표기.
// 순수 함수만 둔다(네트워크는 cloud.js). 그래야 테스트로 규칙을 못 박을 수 있다.

// 첨부는 **이미지만, 5MB × 5장**. 영상을 받지 않는 이유는 무료 스토리지(1GB)를 몇 개로 채우기 때문이다.
// 이 상수는 DB(storage 버킷의 file_size_limit / allowed_mime_types)와 **짝**이다 —
// 한쪽만 고치면 사용자는 통과했다고 믿고 업로드가 서버에서 거절된다. 함께 고칠 것(supabase/schema.sql).
export const ATTACH_MAX_FILES = 5;
export const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACH_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const ATTACH_ACCEPT = ATTACH_MIME.join(",");

const EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const mb = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

// 고른 파일들을 검증한다. **한 장이라도 문제면 전부 거절하지 않는다** — 통과한 것은 받고,
// 걸러낸 것은 사유를 돌려줘 사용자가 무엇이 빠졌는지 알게 한다(조용히 빠지면 첨부한 줄 안다).
// have = 이미 붙여 둔 장수.
export function validateAttachments(files, have = 0) {
  const accepted = [];
  const errors = [];
  const room = Math.max(0, ATTACH_MAX_FILES - have);

  for (const f of Array.from(files || [])) {
    if (accepted.length >= room) {
      errors.push(`최대 ${ATTACH_MAX_FILES}장까지만 첨부할 수 있어요. "${f.name}"은(는) 제외했습니다.`);
      continue;
    }
    if (!ATTACH_MIME.includes(f.type)) {
      errors.push(`"${f.name}"은(는) 이미지 파일이 아니라 첨부할 수 없어요 (png · jpg · webp · gif).`);
      continue;
    }
    if (f.size > ATTACH_MAX_BYTES) {
      errors.push(`"${f.name}"은(는) ${mb(f.size)}MB 라 너무 커요 (한 장당 ${mb(ATTACH_MAX_BYTES)}MB 까지).`);
      continue;
    }
    accepted.push(f);
  }
  return { accepted, errors };
}

// storage 경로 = `<uid>/<uuid>.<ext>`. 첫 폴더가 소유자라는 규약 위에 RLS 정책과 DB 트리거가 서 있다
// (supabase/schema.sql 의 feedback_validate / fb_attach_*_own). 규약을 바꾸면 그쪽도 함께 바꿔야 한다.
//
// 파일명(사용자가 지은 이름)은 경로에 넣지 않는다 — 한글·공백·`..` 이 섞이면 정책의 정규식과
// storage 키 규칙을 동시에 건드린다. 확장자만 MIME 에서 되찾는다.
export function attachmentPath(userId, file, uuid) {
  const ext = EXT[file?.type] || "bin";
  return `${userId}/${uuid}.${ext}`;
}

// 넥슨 문의 상태 표기를 참고한 4단계. DB의 check 제약(feedback_status_valid)과 같은 집합이다.
export const STATUS = {
  received: { label: "접수됨", tone: "muted", hint: "확인 대기 중이에요." },
  in_progress: { label: "확인 중", tone: "warn", hint: "내용을 살펴보고 있어요." },
  answered: { label: "답변 완료", tone: "good", hint: "답변이 등록됐어요." },
  closed: { label: "종료", tone: "muted", hint: "처리가 끝난 문의예요." },
};
// 모르는 상태(나중에 늘어난 값)를 받아도 화면이 깨지지 않게 한다 — DB 값을 그대로 믿지 않는다.
export const statusOf = (s) => STATUS[s] || STATUS.received;

export const CATEGORY_LABEL = {
  suggestion: "건의 · 개선",
  bug: "버그 신고",
  question: "질문",
  etc: "기타",
};
export const categoryLabel = (c) => CATEGORY_LABEL[c] || "기타";
