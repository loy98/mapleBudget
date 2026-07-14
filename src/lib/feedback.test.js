import { describe, it, expect } from "vitest";
import {
  validateAttachments, attachmentPath, statusOf, categoryLabel,
  ATTACH_MAX_FILES, ATTACH_MAX_BYTES,
} from "./feedback.js";

// File 을 흉내 낸다(Node 에도 File 이 있지만, 크기를 쉽게 정하려고 최소 형태를 쓴다).
const f = (name, type, size) => ({ name, type, size });

describe("첨부 검증 (validateAttachments)", () => {
  it("이미지 파일은 받는다", () => {
    const { accepted, errors } = validateAttachments([f("a.png", "image/png", 1000)]);
    expect(accepted).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("이미지가 아니면 거른다 (영상 포함 — 스토리지 정책)", () => {
    const { accepted, errors } = validateAttachments([
      f("clip.mp4", "video/mp4", 1000),
      f("doc.pdf", "application/pdf", 1000),
    ]);
    expect(accepted).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it("5MB 를 넘으면 거른다", () => {
    const { accepted, errors } = validateAttachments([f("big.jpg", "image/jpeg", ATTACH_MAX_BYTES + 1)]);
    expect(accepted).toEqual([]);
    expect(errors[0]).toMatch(/너무 커요/);
  });

  it("경계값(정확히 5MB)은 통과한다 — DB의 file_size_limit 과 같은 기준", () => {
    const { accepted } = validateAttachments([f("edge.jpg", "image/jpeg", ATTACH_MAX_BYTES)]);
    expect(accepted).toHaveLength(1);
  });

  // 조용히 빠지면 사용자는 첨부한 줄 안다 → 통과한 것은 받고, 걸러낸 것은 반드시 사유를 돌려준다.
  it("한 장이 문제여도 나머지는 받고, 뺀 것은 사유를 알린다", () => {
    const { accepted, errors } = validateAttachments([
      f("ok.png", "image/png", 100),
      f("bad.mp4", "video/mp4", 100),
    ]);
    expect(accepted.map((x) => x.name)).toEqual(["ok.png"]);
    expect(errors).toHaveLength(1);
  });

  it("최대 장수를 넘으면 넘친 것만 거른다", () => {
    const files = Array.from({ length: ATTACH_MAX_FILES + 2 }, (_, i) => f(`p${i}.png`, "image/png", 10));
    const { accepted, errors } = validateAttachments(files);
    expect(accepted).toHaveLength(ATTACH_MAX_FILES);
    expect(errors).toHaveLength(2);
  });

  it("이미 붙인 장수를 감안한다", () => {
    const files = Array.from({ length: 3 }, (_, i) => f(`p${i}.png`, "image/png", 10));
    const { accepted, errors } = validateAttachments(files, ATTACH_MAX_FILES - 1);
    expect(accepted).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });

  it("빈 입력·null 에도 터지지 않는다", () => {
    expect(validateAttachments(null).accepted).toEqual([]);
    expect(validateAttachments([]).accepted).toEqual([]);
  });
});

describe("첨부 경로 (attachmentPath)", () => {
  const UID = "11111111-2222-3333-4444-555555555555";

  // 경로 규약(`<uid>/<uuid>.<ext>`)은 DB 트리거(feedback_validate)의 정규식과 storage RLS 정책이
  // 함께 딛고 선 바닥이다. 규약이 깨지면 서버가 문의를 거절한다.
  it("첫 폴더가 소유자 uid 다", () => {
    expect(attachmentPath(UID, f("a.png", "image/png", 1), "abc")).toBe(`${UID}/abc.png`);
  });

  it("사용자가 지은 파일명은 경로에 넣지 않는다 (한글·공백·'..' 차단)", () => {
    const p = attachmentPath(UID, f("../나쁜 이름.png", "image/png", 1), "xyz");
    expect(p).toBe(`${UID}/xyz.png`);
    expect(p).not.toContain("..");
    expect(p).not.toContain(" ");
  });

  it("확장자는 MIME 에서 되찾는다 (jpeg → jpg)", () => {
    expect(attachmentPath(UID, f("x", "image/jpeg", 1), "u")).toBe(`${UID}/u.jpg`);
    expect(attachmentPath(UID, f("x", "image/webp", 1), "u")).toBe(`${UID}/u.webp`);
  });

  // 서버 정규식은 `[A-Za-z0-9._-]{1,120}` 만 허용한다 → 알 수 없는 타입도 그 안에 떨어져야 한다.
  it("모르는 타입이어도 경로 규약을 깨지 않는다", () => {
    expect(attachmentPath(UID, f("x", "image/heic", 1), "u")).toBe(`${UID}/u.bin`);
  });
});

describe("상태 표기", () => {
  it("DB 의 네 상태를 모두 라벨로 옮긴다", () => {
    expect(statusOf("received").label).toBe("접수됨");
    expect(statusOf("in_progress").label).toBe("확인 중");
    expect(statusOf("answered").label).toBe("답변 완료");
    expect(statusOf("closed").label).toBe("종료");
  });

  // DB 값을 그대로 믿지 않는다(CLAUDE.md) — 나중에 상태가 늘어도 화면이 깨지지 않아야 한다.
  it("모르는 상태는 '접수됨'으로 떨어뜨린다", () => {
    expect(statusOf("weird").label).toBe("접수됨");
    expect(statusOf(undefined).label).toBe("접수됨");
    expect(statusOf(null).label).toBe("접수됨");
  });

  it("모르는 분류는 '기타'로 떨어뜨린다", () => {
    expect(categoryLabel("bug")).toBe("버그 신고");
    expect(categoryLabel("nope")).toBe("기타");
    expect(categoryLabel(null)).toBe("기타");
  });
});
