import { describe, it, expect, vi, beforeEach } from "vitest";

// 탈퇴의 **순서**가 이 파일의 주제다. 되돌릴 수 없는 쪽(RPC)이 먼저고, 파일 삭제는 그 뒤다.
// 뒤집으면 "파일만 사라지고 계정은 남는" 상태가 생긴다 — 사용자는 실패를 보는데 데이터는 이미 없다.
const order = [];
const rpc = vi.fn(async () => { order.push("rpc"); return { error: null }; });
const remove = vi.fn(async (paths) => { order.push("remove:" + paths.join(",")); return { error: null }; });
const select = vi.fn(async () => ({ data: [{ attachments: ["u-1/a.png"] }, { attachments: [] }], error: null }));
const signOut = vi.fn(async () => ({ error: null }));

vi.mock("./supabaseClient.js", () => ({
  cloudEnabled: true,
  supabase: {
    rpc: (...a) => rpc(...a),
    from: () => ({ select: (...a) => select(...a) }),
    storage: { from: () => ({ remove: (...a) => remove(...a) }) },
    auth: { signOut: (...a) => signOut(...a) },
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

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  rpc.mockImplementation(async () => { order.push("rpc"); return { error: null }; });
  remove.mockImplementation(async (paths) => { order.push("remove:" + paths.join(",")); return { error: null }; });
  select.mockResolvedValue({ data: [{ attachments: ["u-1/a.png"] }], error: null });
  signOut.mockResolvedValue({ error: null });
});

describe("deleteAccount — 순서와 실패 처리", () => {
  it("RPC(되돌릴 수 없는 삭제)가 먼저고, 첨부 파일 삭제는 그 뒤다", async () => {
    const { error } = await deleteAccount();
    expect(error).toBeNull();
    expect(order).toEqual(["rpc", "remove:u-1/a.png"]);
    expect(clearAccountData).toHaveBeenCalled();
  });

  // 이게 뒤집히면(파일 먼저) 사용자는 "삭제 실패"를 보는데 첨부는 이미 사라진다.
  it("RPC 가 실패하면 파일을 지우지 않는다 (아무것도 잃지 않고 재시도할 수 있다)", async () => {
    rpc.mockImplementation(async () => { order.push("rpc"); return { error: new Error("network") }; });
    const { error } = await deleteAccount();
    expect(error).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    expect(clearAccountData).not.toHaveBeenCalled(); // 로컬 데이터도 지키다
  });

  it("파일 삭제가 실패해도 탈퇴는 성공이다 (계정은 이미 사라졌다 — 고아 파일만 남는다)", async () => {
    remove.mockResolvedValue({ error: new Error("storage down") });
    const { error } = await deleteAccount();
    expect(error).toBeNull();
    expect(clearAccountData).toHaveBeenCalled();
  });

  it("첨부 목록을 못 읽어도 탈퇴는 진행한다", async () => {
    select.mockRejectedValue(new Error("boom"));
    const { error } = await deleteAccount();
    expect(error).toBeNull();
    expect(order).toEqual(["rpc"]); // 지울 경로를 몰라 파일 삭제는 건너뛴다
  });

  it("첨부가 없으면 스토리지를 부르지 않는다", async () => {
    select.mockResolvedValue({ data: [{ attachments: [] }], error: null });
    await deleteAccount();
    expect(remove).not.toHaveBeenCalled();
  });
});
