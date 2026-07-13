// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

// supabaseClient 는 import.meta.env 를 읽는다. 비활성(게스트)으로 두면 createClient 를 부르지 않는다.
beforeAll(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

// 세션 이벤트를 테스트가 직접 밀어 넣는다. 병합·tombstone 순수 함수는 실제 구현을 쓴다.
let emitSession = () => {};
const fetchUserData = vi.fn();
const writeUserData = vi.fn();
const fetchAppConfig = vi.fn();

vi.mock("./cloud.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onAuthChange: (cb) => { emitSession = cb; cb(null); return () => {}; },
    fetchUserData: (...a) => fetchUserData(...a),
    writeUserData: (...a) => writeUserData(...a),
    fetchAppConfig: (...a) => fetchAppConfig(...a),
  };
});

const { useCloudSync } = await import("./useCloudSync.js");
const {
  KEY, ITEMS_KEY, LKEY, OWNER_KEY,
  loadCalcState, loadMyItems, loadLedger,
  saveCalcState, saveMyItems, saveLedger,
  clearAccountData, setDataOwner,
} = await import("./storage.js");

// 프로덕션 app_config 와 같은 형태. force 가 시세 3종을 '모든 유저'에게 덮어쓴다 —
// 이 덮어쓰기가 로그아웃 직후 settings identity 를 바꿔 자동저장을 재실행시킨 것이 유출의 방아쇠였다.
const CONFIG = {
  mesoRate: 1800, giftRatio: 7200, marketRatio: 2650,
  force: ["mesoRate", "giftRatio", "marketRatio"],
};

// A 계정이 이 브라우저에 남긴 것. charges/items 는 기본값과 확실히 다르게 둔다(기본: 넥슨 현대카드 1개).
const A_UID = "user-a";
const A_CALC = {
  mesoRate: 1800, giftRatio: 7200, marketRatio: 2650, mvpGrade: "4", tierSel: "4", months: "2",
  charge: [
    { name: "넥슨 현대카드", rate: 10, limit: 200000 },
    { name: "도서문화상품권", rate: 6, limit: 400000 },   // ← A 만의 것. 기본값엔 없다.
  ],
  items: [{ name: "플래티넘 카르마의 가위", cash: 5900, sell: "2.2", mAllowed: true, mil: true }],
};
const A_LEDGER = {
  buys: [{ id: "a-buy-1", date: "2026-07-03", item: "플래티넘 카르마의 가위", qty: 10, price: 5900 }],
  sells: [], cashes: [], spends: [], deleted: {},
};
const A_ITEMS = [{ name: "A 전용 아이템", cash: 1234, mAllowed: true }];

// App.jsx 와 동일한 구조: 상태를 소유하고, 변경 시 localStorage 에 자동저장한다.
// 이 자동저장 이펙트가 바로 유출의 마지막 고리이므로 테스트도 반드시 같이 재현해야 한다.
// api 로 훅 반환값과 setLedger 를 밖으로 빼 테스트가 '편집'과 'flush' 를 직접 구동한다.
const api = {};
function Harness() {
  const [{ settings, charges, items }, setCalcState] = useState(loadCalcState);
  const [myItems, setMyItems] = useState(loadMyItems);
  const [ledger, setLedger] = useState(loadLedger);

  const hook = useCloudSync({ settings, charges, items, myItems, ledger, setCalcState, setMyItems, setLedger });
  api.flushPendingUpload = hook.flushPendingUpload;
  api.setLedger = setLedger;

  useEffect(() => { saveCalcState(settings, charges, items); }, [settings, charges, items]);
  useEffect(() => { saveMyItems(myItems); }, [myItems]);
  useEffect(() => { saveLedger(ledger); }, [ledger]);
  return null;
}

let container = null;
let root = null;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<StrictMode><Harness /></StrictMode>);
  });
}
async function settle() {
  // 세션 이벤트 → 이펙트 → setState → 자동저장 이펙트까지 전부 흘려보낸다.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  fetchAppConfig.mockResolvedValue(CONFIG);
  fetchUserData.mockResolvedValue(null);
  writeUserData.mockResolvedValue({ updatedAt: "2026-07-13T00:00:00Z" });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null; container = null;
});

describe("로그아웃 — 이전 계정 데이터가 다음 계정으로 유입되지 않는다", () => {
  // 공용 브라우저: A 로그아웃 → B 로그인. A 의 계산기 설정이 B 계정 행에 업로드되면 안 된다.
  //
  // 회귀: clearAccountData() 는 localStorage 만 지웠고 React 메모리엔 A 의 charges/items 가 남아 있었다.
  // 로그아웃으로 userId 가 null 이 되면 force 이펙트가 '__guest__' 컨텍스트로 시세를 덮어써
  // settings identity 를 바꾸고 → App 의 자동저장이 **A 의 charges/items 를 그대로 다시 써 넣었다**.
  // 소유자 마커는 이미 지워졌으므로 다음 로그인은 그것을 '진짜 게스트 데이터'로 보고 B 행에 올렸다.
  it("로그아웃하면 localStorage 의 계산기 설정이 기본값으로 돌아간다(옛 계정 값이 되살아나지 않는다)", async () => {
    localStorage.setItem(KEY, JSON.stringify(A_CALC));
    localStorage.setItem(ITEMS_KEY, JSON.stringify(A_ITEMS));
    localStorage.setItem(LKEY, JSON.stringify(A_LEDGER));
    setDataOwner(A_UID);

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();

    // 로그아웃: cloud.signOut() 과 같은 순서 — localStorage 를 지우고 SIGNED_OUT 을 흘린다.
    await act(async () => {
      clearAccountData();
      emitSession(null);
    });
    await settle();

    const calc = JSON.parse(localStorage.getItem(KEY) || "{}");
    const names = (calc.charge || []).map((c) => c.name);
    expect(names).not.toContain("도서문화상품권");           // A 만 갖고 있던 충전 방식
    expect(calc.mvpGrade ?? "0").toBe("0");                  // A 의 다이아 등급이 남으면 안 된다
    expect(JSON.stringify(calc.items || [])).not.toContain("2.2"); // A 의 판매가 스냅샷

    // 원장·아이템도 남으면 안 된다(원장은 회귀 당시에도 통과했지만 같이 지킨다).
    expect(localStorage.getItem(LKEY) || "").not.toContain("a-buy-1");
    expect(localStorage.getItem(ITEMS_KEY) || "").not.toContain("A 전용 아이템");
    expect(localStorage.getItem(OWNER_KEY)).toBe(null);
  });

  it("로그아웃 후 B 로그인 시, B 행에 올라가는 payload 에 A 의 설정이 없다", async () => {
    localStorage.setItem(KEY, JSON.stringify(A_CALC));
    localStorage.setItem(ITEMS_KEY, JSON.stringify(A_ITEMS));
    localStorage.setItem(LKEY, JSON.stringify(A_LEDGER));
    setDataOwner(A_UID);

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();

    await act(async () => { clearAccountData(); emitSession(null); });
    await settle();

    // B 로그인(리로드 없이 같은 탭 — 다른 탭 시나리오와 동치).
    writeUserData.mockClear();
    await act(async () => emitSession({ user: { id: "user-b" } }));
    await settle();
    // 디바운스(800ms) 통과
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await settle();

    const writes = writeUserData.mock.calls.filter(([uid]) => uid === "user-b");
    expect(writes.length).toBeGreaterThan(0);
    for (const [, snap] of writes) {
      const blob = JSON.stringify(snap);
      expect(blob).not.toContain("도서문화상품권");
      expect(blob).not.toContain("A 전용 아이템");
      expect(blob).not.toContain("a-buy-1");
    }
    // A 의 행에는 아무것도 쓰지 않았다.
    expect(writeUserData.mock.calls.some(([uid]) => uid === A_UID)).toBe(false);
  });

  // 다른 탭에서 로그아웃하면 이 탭은 SIGNED_OUT 만 받는다 — clearAccountData() 도, location.reload() 도 없다.
  // 그래도 이 탭의 메모리·localStorage 에서 계정 데이터가 사라져야 한다(안 그러면 같은 유출이 이 탭을 통해 일어난다).
  it("다른 탭에서 로그아웃해도(SIGNED_OUT 만 수신) 이 탭의 계정 데이터가 지워진다", async () => {
    localStorage.setItem(KEY, JSON.stringify(A_CALC));
    localStorage.setItem(ITEMS_KEY, JSON.stringify(A_ITEMS));
    localStorage.setItem(LKEY, JSON.stringify(A_LEDGER));
    setDataOwner(A_UID);

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();

    await act(async () => emitSession(null)); // clearAccountData() 없이 — 다른 탭이 로그아웃했다
    await settle();

    const calc = JSON.parse(localStorage.getItem(KEY) || "{}");
    expect((calc.charge || []).map((c) => c.name)).not.toContain("도서문화상품권");
    expect(localStorage.getItem(LKEY) || "").not.toContain("a-buy-1");
    expect(localStorage.getItem(ITEMS_KEY) || "").not.toContain("A 전용 아이템");
    expect(localStorage.getItem(OWNER_KEY)).toBe(null);
  });

  // Codex 지적: 로그아웃은 로컬 계정 데이터를 지우므로, 디바운스(800ms) 대기 중이던 편집은
  // 클라우드에 못 올라간 채 사라진다("데이터는 클라우드에 있다"는 전제가 그 창 안에서는 거짓).
  // → AuthBar 가 signOut 전에 flushPendingUpload() 를 await 한다.
  it("로그아웃 직전 플러시가 디바운스 대기 중인 편집을 올린다", async () => {
    setDataOwner(A_UID);
    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();

    writeUserData.mockClear();
    // 편집 직후(디바운스 800ms 가 아직 안 지남) 로그아웃을 누른다.
    await act(async () => {
      api.setLedger((l) => ({ ...l, spends: [{ id: "pending-1", date: "2026-07-13", memo: "직전 편집", amount: 5000 }] }));
    });
    expect(writeUserData).not.toHaveBeenCalled(); // 아직 디바운스 대기 중

    let res;
    await act(async () => { res = await api.flushPendingUpload(); });
    expect(res.ok).toBe(true);

    const uploaded = writeUserData.mock.calls.map(([, snap]) => JSON.stringify(snap)).join("");
    expect(uploaded).toContain("pending-1"); // 로그아웃 전에 클라우드로 올라갔다
  });

  it("플러시가 실패하면 ok:false 를 돌려준다(호출측이 사용자 확인을 받는다)", async () => {
    setDataOwner(A_UID);
    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();

    writeUserData.mockRejectedValue(new Error("network down"));
    await act(async () => {
      api.setLedger((l) => ({ ...l, spends: [{ id: "pending-2", date: "2026-07-13", memo: "x", amount: 1 }] }));
    });
    let res;
    await act(async () => { res = await api.flushPendingUpload(); });
    expect(res.ok).toBe(false);
  });

  it("로그아웃한 게스트는 app_config 시세를 다시 받는다(초기화가 설정 적용을 깨지 않는다)", async () => {
    localStorage.setItem(KEY, JSON.stringify(A_CALC));
    setDataOwner(A_UID);

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();
    await act(async () => { clearAccountData(); emitSession(null); });
    await settle();

    const calc = JSON.parse(localStorage.getItem(KEY) || "{}");
    expect(calc.mesoRate).toBe(1800);   // force 는 게스트에게도 그대로 적용된다
    expect(calc.giftRatio).toBe(7200);
  });
});
