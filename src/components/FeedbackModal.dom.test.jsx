// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // 첨부 미리보기가 부른다. jsdom 에는 없다.
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

const submitFeedback = vi.fn();
const uploadFeedbackAttachments = vi.fn();
const fetchMyFeedback = vi.fn();
const signedAttachmentUrls = vi.fn();

vi.mock("../lib/cloud.js", () => ({
  cloudEnabled: true,
  submitFeedback: (...a) => submitFeedback(...a),
  uploadFeedbackAttachments: (...a) => uploadFeedbackAttachments(...a),
  fetchMyFeedback: (...a) => fetchMyFeedback(...a),
  signedAttachmentUrls: (...a) => signedAttachmentUrls(...a),
}));
vi.mock("../lib/errorLog.js", () => ({
  getRecentErrors: () => [],
  formatErrorsForFeedback: () => "",
}));

const { default: FeedbackModal } = await import("./FeedbackModal.jsx");

const SESSION = { user: { id: "u-1", email: "me@example.com" } };

let container = null;
let root = null;

const render = async (props) => {
  await act(async () => { root.render(<FeedbackModal onClose={() => {}} {...props} />); });
};
const btn = (text) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const click = async (text) => {
  const b = btn(text);
  if (!b) throw new Error(`버튼 없음: ${text}`);
  await act(async () => { b.click(); });
};
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set;
  setter.call(el, value);
  await act(async () => { el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const has = (t) => container.textContent.includes(t);

// 파일 입력에 파일을 밀어 넣는다(브라우저의 파일 선택을 흉내).
const file = (name, type_, size) => {
  const f = new File(["x"], name, { type: type_ });
  Object.defineProperty(f, "size", { value: size });
  return f;
};
const pickFiles = async (files) => {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
};

beforeEach(() => {
  vi.clearAllMocks();
  submitFeedback.mockResolvedValue({ error: null });
  uploadFeedbackAttachments.mockResolvedValue({ paths: [], error: null });
  fetchMyFeedback.mockResolvedValue({ rows: [], error: null });
  signedAttachmentUrls.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("게스트", () => {
  it("탭이 없고(내 문의 없음), 첨부 대신 로그인 안내를 보여준다", async () => {
    await render({ session: null });
    expect(btn("내 문의")).toBeUndefined();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(has("로그인")).toBe(true);
  });

  it("문의는 보낼 수 있다 (첨부 없이)", async () => {
    await render({ session: null });
    await type(container.querySelector("textarea"), "게스트 문의");
    await click("보내기");
    expect(submitFeedback).toHaveBeenCalledTimes(1);
    expect(submitFeedback.mock.calls[0][0]).toMatchObject({ message: "게스트 문의", attachments: [] });
    expect(has("소중한 의견 감사합니다")).toBe(true);
  });
});

describe("첨부 (로그인)", () => {
  it("이미지를 고르면 썸네일이 붙고, 규칙 위반은 사유를 알린다", async () => {
    await render({ session: SESSION });
    await pickFiles([file("a.png", "image/png", 1000), file("clip.mp4", "video/mp4", 1000)]);
    expect(container.querySelectorAll(".fb-thumb")).toHaveLength(1);   // 이미지만 붙는다
    expect(has("이미지 파일이 아니라")).toBe(true);                      // 빠진 것은 조용히 넘어가지 않는다
  });

  it("5장까지만 붙는다", async () => {
    await render({ session: SESSION });
    await pickFiles(Array.from({ length: 7 }, (_, i) => file(`p${i}.png`, "image/png", 10)));
    expect(container.querySelectorAll(".fb-thumb")).toHaveLength(5);
    expect(has("최대 5장")).toBe(true);
  });

  it("업로드한 경로를 문의에 달아 보낸다 (업로드가 먼저)", async () => {
    const order = [];
    uploadFeedbackAttachments.mockImplementation(async () => {
      order.push("upload");
      return { paths: ["u-1/x.png"], error: null };
    });
    submitFeedback.mockImplementation(async () => { order.push("insert"); return { error: null }; });

    await render({ session: SESSION });
    await type(container.querySelector("textarea"), "스크린샷 첨부");
    await pickFiles([file("a.png", "image/png", 10)]);
    await click("보내기");

    expect(order).toEqual(["upload", "insert"]);
    expect(submitFeedback.mock.calls[0][0].attachments).toEqual(["u-1/x.png"]);
  });

  // 순서가 뒤집히면 첨부 없는 문의 행이 남는다(유저는 UPDATE 권한이 없어 고칠 수 없다).
  it("업로드가 실패하면 문의를 넣지 않는다", async () => {
    uploadFeedbackAttachments.mockResolvedValue({ paths: [], error: new Error("upload-failed") });
    await render({ session: SESSION });
    await type(container.querySelector("textarea"), "실패 경로");
    await pickFiles([file("a.png", "image/png", 10)]);
    await click("보내기");

    expect(submitFeedback).not.toHaveBeenCalled();
    expect(has("이미지 업로드에 실패")).toBe(true);
  });
});

describe("내 문의", () => {
  const ROW = {
    id: 7,
    created_at: "2026-07-14T02:00:00.000Z",
    category: "bug",
    message: "계산이 이상해요",
    status: "answered",
    reply: "수정했습니다!",
    replied_at: "2026-07-14T05:00:00.000Z",
    attachments: [],
  };

  it("로그인하면 탭이 생기고 목록을 불러온다", async () => {
    fetchMyFeedback.mockResolvedValue({ rows: [ROW], error: null });
    await render({ session: SESSION });
    await click("내 문의");
    expect(fetchMyFeedback).toHaveBeenCalled();
    expect(has("답변 완료")).toBe(true);       // 상태 배지
    expect(has("계산이 이상해요")).toBe(true);
  });

  it("펼치면 운영자 답변이 보인다", async () => {
    fetchMyFeedback.mockResolvedValue({ rows: [ROW], error: null });
    await render({ session: SESSION });
    await click("내 문의");
    await act(async () => { container.querySelector(".fb-item-head").click(); });
    expect(has("수정했습니다!")).toBe(true);
  });

  it("답변 전에는 상태 안내를 보여준다", async () => {
    fetchMyFeedback.mockResolvedValue({
      rows: [{ ...ROW, status: "in_progress", reply: null, replied_at: null }],
      error: null,
    });
    await render({ session: SESSION });
    await click("내 문의");
    expect(has("확인 중")).toBe(true);
    await act(async () => { container.querySelector(".fb-item-head").click(); });
    expect(has("살펴보고 있어요")).toBe(true);
  });

  it("첨부는 펼칠 때만 서명 URL 을 발급한다 (목록만 볼 때는 요청하지 않는다)", async () => {
    fetchMyFeedback.mockResolvedValue({ rows: [{ ...ROW, attachments: ["u-1/a.png"] }], error: null });
    signedAttachmentUrls.mockResolvedValue({ "u-1/a.png": "https://signed/a.png" });

    await render({ session: SESSION });
    await click("내 문의");
    expect(signedAttachmentUrls).not.toHaveBeenCalled();

    await act(async () => { container.querySelector(".fb-item-head").click(); });
    expect(signedAttachmentUrls).toHaveBeenCalledWith(["u-1/a.png"]);
    expect(container.querySelector(".fb-thumb img").getAttribute("src")).toBe("https://signed/a.png");
  });

  it("불러오기에 실패하면 알린다", async () => {
    fetchMyFeedback.mockResolvedValue({ rows: [], error: new Error("nope") });
    await render({ session: SESSION });
    await click("내 문의");
    expect(has("불러오지 못했어요")).toBe(true);
  });

  it("문의가 없으면 게스트 문의는 남지 않는다고 알린다", async () => {
    await render({ session: SESSION });
    await click("내 문의");
    expect(has("아직 보낸 문의가 없어요")).toBe(true);
  });
});

// Codex 지적: 닫아도 send() 는 계속 살아 문의를 넣는다 → 사용자는 취소한 줄 알지만 전송된다.
// 그래서 전송 중에는 나가는 길을 모두 잠근다(취소·× ·탭).
describe("전송 중 잠금", () => {
  it("보내는 동안 취소·닫기·탭이 모두 잠긴다", async () => {
    let release;
    uploadFeedbackAttachments.mockImplementation(
      () => new Promise((r) => { release = () => r({ paths: ["u-1/x.png"], error: null }); })
    );

    await render({ session: SESSION });
    await type(container.querySelector("textarea"), "전송 중");
    await pickFiles([file("a.png", "image/png", 10)]);
    await click("보내기");

    expect(btn("취소").disabled).toBe(true);
    expect(container.querySelector(".modal-x").disabled).toBe(true);
    expect(btn("내 문의").disabled).toBe(true);

    await act(async () => { release(); });
    expect(submitFeedback).toHaveBeenCalledTimes(1);
    expect(has("소중한 의견 감사합니다")).toBe(true);
  });
});
