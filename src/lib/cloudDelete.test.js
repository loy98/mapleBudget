import { describe, it, expect, vi, beforeEach } from "vitest";

// 탈퇴의 **순서**가 이 파일의 주제다. 되돌릴 수 없는 쪽(RPC)이 먼저고, 파일 삭제는 그 뒤다.
// 뒤집으면 "파일만 사라지고 계정은 남는" 상태가 생긴다 — 사용자는 실패를 보는데 데이터는 이미 없다.
//
// 그리고 파기 대상은 feedback.attachments(문의에 달린 것)만이 아니라 **내 폴더(`<uid>/`) 전체**다.
// "업로드 성공 → INSERT 실패"나 직접 업로드로 생긴 고아 파일까지 지워야 "탈퇴 시 첨부 파기"가 참이 된다.
const order = [];
const rpc = vi.fn();
const remove = vi.fn();
const list = vi.fn();
const getUser = vi.fn();
const signOut = vi.fn();

vi.mock("./supabaseClient.js", () => ({
  cloudEnabled: true,
  supabase: {
    rpc: (...a) => rpc(...a),
    storage: { from: () => ({ remove: (...a) => remove(...a), list: (...a) => list(...a) }) },
    auth: { signOut: (...a) => signOut(...a), getUser: (...a) => getUser(...a) },
  },
  fitsKeepalive: () => true,
  setKeepalive: () => {},
  KEEPALIVE_MAX_BYTES: 60000,
}));

const clearAccountData = vi.fn();
vi.mock("./storage.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, clearAccountData: (...a) => clearAccountData(...a) };
});

const { deleteAccount } = await import("./cloud.js");

// list 를 페이지 배열로 스텁한다: 각 호출이 다음 페이지를 돌려준다(마지막은 짧은 페이지 → 루프 종료).
function stubListPages(pages) {
  let i = 0;
  list.mockImplementation(async () => ({ data: pages[i++] ?? [], error: null }));
}

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  rpc.mockImplementation(async () => { order.push("rpc"); return { error: null }; });
  remove.mockImplementation(async (paths) => { order.push("remove:" + paths.join(",")); return { error: null }; });
  getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  signOut.mockResolvedValue({ error: null });
  stubListPages([[{ name: "a.png" }]]); // 기본: 내 폴더에 파일 1개
});

describe("deleteAccount — 순서와 실패 처리", () => {
  it("RPC(되돌릴 수 없는 삭제)가 먼저고, 첨부 파일 삭제는 그 뒤다", async () => {
    const { error } = await deleteAccount();
    expect(error).toBeNull();
    expect(order).toEqual(["rpc", "remove:u-1/a.png"]);
    expect(clearAccountData).toHaveBeenCalled();
  });

  it("문의에 안 달린 고아 파일도 폴더를 열거해 파기한다 (Codex 지적)", async () => {
    // b.png 는 어떤 feedback.attachments 에도 없지만, `<uid>/` 폴더에는 있다 → 지워져야 한다.
    stubListPages([[{ name: "a.png" }, { name: "orphan-b.png" }, { name: ".emptyFolderPlaceholder" }]]);
    await deleteAccount();
    expect(list).toHaveBeenCalledWith("u-1", expect.objectContaining({ offset: 0 }));
    expect(remove).toHaveBeenCalledWith([
      "u-1/a.png",
      "u-1/orphan-b.png",
      "u-1/.emptyFolderPlaceholder",
    ]);
  });

  it("폴더가 100개를 넘으면 페이지네이션으로 전부 모은다", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ name: `f${i}.png` }));
    stubListPages([full, [{ name: "last.png" }]]); // 100개(꽉 참) → 한 페이지 더
    await deleteAccount();
    expect(list).toHaveBeenCalledTimes(2);
    const removed = remove.mock.calls[0][0];
    expect(removed).toHaveLength(101);
    expect(removed[0]).toBe("u-1/f0.png");
    expect(removed[100]).toBe("u-1/last.png");
  });

  // 이게 뒤집히면(파일 먼저) 사용자는 "삭제 실패"를 보는데 첨부는 이미 사라진다.
  it("RPC 가 실패하면 파일을 지우지 않는다 (아무것도 잃지 않고 재시도할 수 있다)", async () => {
    rpc.mockImplementation(async () => { order.push("rpc"); return { error: new Error("network") }; });
    const { error } = await deleteAccount();
    expect(error).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    expect(clearAccountData).not.toHaveBeenCalled(); // 로컬 데이터도 지킨다
  });

  it("파일 삭제가 실패해도 탈퇴는 성공이다 (계정은 이미 사라졌다 — 고아 파일만 남는다)", async () => {
    remove.mockResolvedValue({ error: new Error("storage down") });
    const { error } = await deleteAccount();
    expect(error).toBeNull();
    expect(clearAccountData).toHaveBeenCalled();
  });

  it("폴더 열거가 실패해도 탈퇴는 진행한다", async () => {
    getUser.mockRejectedValue(new Error("boom"));
    const { error } = await deleteAccount();
    expect(error).toBeNull();
    expect(order).toEqual(["rpc"]); // 지울 경로를 몰라 파일 삭제는 건너뛴다
    expect(remove).not.toHaveBeenCalled();
  });

  it("내 폴더가 비어 있으면 스토리지 remove 를 부르지 않는다", async () => {
    stubListPages([[]]);
    await deleteAccount();
    expect(remove).not.toHaveBeenCalled();
  });
});
