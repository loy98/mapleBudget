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
  clearAccountData, setDataOwner, lockAccountWrites, __unlockAccountWrites,
  markRestorePending, isRestorePending, getRestorePending, RESTORE_KEY,
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
function Harness({ suspended = false }) {
  const [{ settings, charges, items }, setCalcState] = useState(loadCalcState);
  const [myItems, setMyItems] = useState(loadMyItems);
  const [ledger, setLedger] = useState(loadLedger);

  const hook = useCloudSync({ settings, charges, items, myItems, ledger, setCalcState, setMyItems, setLedger, suspended });
  api.flushPendingUpload = hook.flushPendingUpload;
  api.setLedger = setLedger;

  useEffect(() => { saveCalcState(settings, charges, items); }, [settings, charges, items]);
  useEffect(() => { saveMyItems(myItems); }, [myItems]);
  useEffect(() => { saveLedger(ledger); }, [ledger]);
  return null;
}

let container = null;
let root = null;

async function mount(props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<StrictMode><Harness {...props} /></StrictMode>);
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
  // 잠금은 모듈 전역이다 — 풀지 않으면 다음 테스트의 자동저장이 조용히 막혀 엉뚱한 실패를 낸다.
  __unlockAccountWrites();
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

// 백업 복원 후 새로고침을 아직 못 한 상태(알림을 넘길 저장소가 없어 모달로 요청 중).
// 이때 메모리는 **복원 전 옛 값**이다. 사용자 편집은 모달이 막지만, 프로그램적 상태 변경은 막지 못한다 —
// 지연됐던 app_config fetch 나 클라우드 최초 동기화가 resolve 되면 setCalcState/setMyItems 가 불리고,
// App 의 자동저장이 방금 복원한 데이터를 옛 값으로 덮어쓴다(Codex 4차 지적).
describe("복원 후 새로고침 대기(suspended) — 복원본을 지킨다", () => {
  const RESTORED_CALC = { mesoRate: 1234, charge: [{ name: "복원된카드", rate: 9, limit: 111111 }], items: [] };
  const RESTORED_ITEMS = [{ id: "r1", name: "복원된아이템", cash: 4200, mAllowed: true }];
  const RESTORED_LEDGER = { buys: [{ id: "restored-1", date: "2026-07-10", item: "복원된거래", qty: 2, price: 5900 }], sells: [], cashes: [], spends: [], deleted: {} };

  const seedRestored = () => {
    localStorage.setItem(KEY, JSON.stringify(RESTORED_CALC));
    localStorage.setItem(ITEMS_KEY, JSON.stringify(RESTORED_ITEMS));
    localStorage.setItem(LKEY, JSON.stringify(RESTORED_LEDGER));
  };

  it("지연된 app_config 가 resolve 돼도 복원된 저장소가 그대로다", async () => {
    seedRestored();
    lockAccountWrites();                 // App 이 복원 실패 경로에서 거는 잠금

    await mount({ suspended: true });    // 게스트 + suspended
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); // app_config resolve
    await settle();

    expect(JSON.parse(localStorage.getItem(KEY)).mesoRate).toBe(1234);       // force(1800)로 덮이지 않았다
    expect(localStorage.getItem(KEY)).toContain("복원된카드");
    expect(localStorage.getItem(ITEMS_KEY)).toContain("복원된아이템");
    expect(localStorage.getItem(LKEY)).toContain("restored-1");
  });

  it("로그인 세션이 들어와도 클라우드 동기화가 복원본을 덮지 않는다", async () => {
    seedRestored();
    lockAccountWrites();

    // 클라우드에는 전혀 다른 데이터가 있다 — 평소라면 병합돼 화면·저장소에 반영된다.
    fetchUserData.mockResolvedValue({
      updated_at: "2026-07-13T00:00:00Z",
      calc: { mesoRate: 9999, charge: [{ name: "클라우드카드", rate: 1, limit: 0 }] },
      my_items: [{ id: "c1", name: "클라우드아이템", cash: 1 }],
      ledger: { buys: [{ id: "cloud-1", date: "2026-07-01", item: "클라우드거래", qty: 1, price: 1 }], sells: [], cashes: [], spends: [], deleted: {} },
    });

    await mount({ suspended: true });
    await act(async () => emitSession({ user: { id: "user-a" } }));
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); }); // 디바운스(800ms) 초과
    await settle();

    // 저장소는 복원본 그대로 — 클라우드 값이 섞이지 않았다.
    expect(JSON.parse(localStorage.getItem(KEY)).mesoRate).toBe(1234);
    expect(localStorage.getItem(LKEY)).not.toContain("cloud-1");
    expect(localStorage.getItem(ITEMS_KEY)).not.toContain("클라우드아이템");
    expect(writeUserData).not.toHaveBeenCalled();
  });

  // **진짜 위험한 시나리오**: 이미 로그인·동기화가 끝난(cloudReady=true) 탭에서 복원이 일어나 suspended 로 바뀐다.
  // 이때 업로드 이펙트는 deps 에 suspended 가 있어 다시 실행되는데, 가드가 없으면
  // dirtyForFlush 를 세우고 디바운스를 걸어 **옛 메모리(복원 전 값)를 클라우드에 올려버린다.**
  // (처음부터 suspended 로 마운트하면 cloudReady 가 false 라 이 경로가 드러나지 않는다 — 그래서 전이로 테스트한다.)
  it("동기화가 끝난 뒤 복원으로 suspended 가 되면, 옛 메모리를 클라우드에 올리지 않는다", async () => {
    localStorage.setItem(KEY, JSON.stringify(A_CALC));
    setDataOwner(A_UID);

    await mount({ suspended: false });                       // 평소 상태로 로그인·동기화 완료
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await settle();

    // 여기서 사용자가 백업을 복원했다 → App 이 잠금 + suspended 로 전환한다.
    seedRestored();
    lockAccountWrites();
    writeUserData.mockClear();
    await act(async () => { root.render(<StrictMode><Harness suspended /></StrictMode>); });
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); }); // 디바운스 창을 지나 보낸다
    await settle();

    expect(writeUserData).not.toHaveBeenCalled();            // 스테일 업로드 없음
    expect(JSON.parse(localStorage.getItem(KEY)).mesoRate).toBe(1234); // 복원본도 그대로
  });

  // 저장소 잠금은 useCloudSync 가 아닌 **모든** 경로를 막는다. suspended 로 훅을 멈춰도,
  // 훅 바깥에서 상태가 바뀌면(타이머·이벤트 핸들러 등) 자동저장이 복원본을 덮는다 → 잠금이 마지막 방어선이다.
  it("훅 바깥에서 상태가 바뀌어도 잠금이 복원본을 지킨다", async () => {
    seedRestored();
    lockAccountWrites();
    await mount({ suspended: true });
    await settle();

    // Harness 는 App 과 같은 자동저장 이펙트를 갖고 있다 → 이 setLedger 는 곧장 saveLedger 를 부른다.
    await act(async () => { api.setLedger({ buys: [{ id: "stale-1", date: "2026-01-01", item: "옛거래" }], sells: [], cashes: [], spends: [], deleted: {} }); });
    await settle();

    expect(localStorage.getItem(LKEY)).toContain("restored-1"); // 복원본이 살아 있다
    expect(localStorage.getItem(LKEY)).not.toContain("stale-1"); // 옛 값이 쓰이지 않았다
  });

  // Codex 5차 지적: **이미 시작된** 업로드는 이펙트 가드를 지나온 뒤라 suspended 로 바뀌어도 계속 돈다.
  // await 를 건널 때마다 확인하지 않으면, 복원 도중에 옛 dataRef 가 클라우드에 계속 쓰인다.
  it("업로드가 진행 중일 때 복원으로 suspended 가 되면, 남은 쓰기를 중단한다", async () => {
    localStorage.setItem(KEY, JSON.stringify(A_CALC));
    setDataOwner(A_UID);

    // 첫 write 를 붙잡아 in-flight 상태를 만든다. 그 사이에 복원이 일어난다.
    let releaseFirstWrite;
    writeUserData.mockImplementationOnce(
      () => new Promise((res) => { releaseFirstWrite = () => res({ conflict: true }); }) // 충돌 → 재시도 루프 진입
    );
    writeUserData.mockImplementation(async () => ({ updatedAt: "2026-07-13T00:00:00Z" }));
    fetchUserData.mockResolvedValue({ updated_at: "2026-07-13T00:00:00Z", calc: {}, my_items: [], ledger: {} });

    await mount({ suspended: false });
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();
    await act(async () => { api.setLedger((l) => ({ ...l, spends: [{ id: "p1", date: "2026-07-13", amount: 1 }] })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); }); // 디바운스 → 업로드 시작(첫 write 에서 멈춤)

    const writesBefore = writeUserData.mock.calls.length;
    expect(writesBefore).toBeGreaterThan(0); // 업로드가 실제로 in-flight 다

    // 이 순간 사용자가 복원했다 → 잠금 + suspended 전환.
    seedRestored();
    lockAccountWrites();
    await act(async () => { root.render(<StrictMode><Harness suspended /></StrictMode>); });
    await act(async () => { releaseFirstWrite(); await new Promise((r) => setTimeout(r, 50)); });
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); }); // 재시도·디바운스 창을 지나 보낸다
    await settle();

    // 붙잡혔던 첫 write 이후로는 아무것도 더 쓰지 않았다(충돌 재시도가 옛 메모리를 다시 쓰지 않았다).
    expect(writeUserData.mock.calls.length).toBe(writesBefore);
    expect(JSON.parse(localStorage.getItem(KEY)).mesoRate).toBe(1234); // 복원본도 그대로
  });

  it("suspended 가 아니면 평소대로 동작한다(잠금·중단이 일반 경로를 죽이지 않는다)", async () => {
    localStorage.setItem(KEY, JSON.stringify(A_CALC));
    await mount({ suspended: false });
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await settle();
    // 기존 유저(저장 이력 있음)라도 force 는 모든 유저에게 적용된다 → 시세가 app_config 값으로 덮인다.
    expect(JSON.parse(localStorage.getItem(KEY)).mesoRate).toBe(1800);
  });
});

// 백업 복원 → 새로고침 → 최초 동기화.
// 회귀: 복원한 사실을 어디에도 남기지 않아, mergeSnapshots 의 기본 정책(클라우드 우선)이
// 복원한 calc 를 클라우드 옛값으로 조용히 되돌렸다. 충돌 선택 모달은 최초 로그인 때만 뜨므로
// **이미 동기화된 사용자는 물어보지도 않고 잃었다.** 복원 마커로 그 한 번은 로컬이 이기게 한다.
describe("백업 복원 — 새로고침 뒤 클라우드가 복원본을 덮지 않는다", () => {
  const RESTORED_CALC = { mesoRate: 1234, charge: [{ name: "복원된카드", rate: 9, limit: 111111 }], items: [] };
  const CLOUD_ROW = {
    updated_at: "2026-07-13T00:00:00Z",
    calc: { mesoRate: 9999, charge: [{ name: "클라우드카드", rate: 1, limit: 0 }] },
    my_items: [{ id: "c1", name: "클라우드아이템", cash: 1 }],
    ledger: { buys: [{ id: "cloud-1", date: "2026-07-01", item: "클라우드거래", qty: 1, price: 1 }], sells: [], cashes: [], spends: [], deleted: {} },
  };

  it("복원 마커가 있으면 복원한 calc 가 살아남고, 클라우드에 올라간다", async () => {
    // 복원 직후 새로고침한 상태를 재현한다(importAll 이 쓴 결과 + 마커).
    localStorage.setItem(KEY, JSON.stringify(RESTORED_CALC));
    setDataOwner(A_UID);
    markRestorePending({ calc: true, my_items: true, ledger: true });
    fetchUserData.mockResolvedValue(CLOUD_ROW);
    localStorage.setItem("mvpCloudSyncedUid", A_UID); // 이미 동기화된 사용자 = firstLogin 아님(모달 안 뜸)

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); }); // 디바운스 통과
    await settle();

    // 화면·저장소는 복원본이다.
    // (mesoRate 는 app_config.force 대상이라 모든 유저에게 덮인다 → sentinel 로 쓰면 안 된다. charge 로 판정한다.)
    const calc = JSON.parse(localStorage.getItem(KEY));
    expect(JSON.stringify(calc.charge)).toContain("복원된카드");
    expect(JSON.stringify(calc.charge)).not.toContain("클라우드카드");

    // 그리고 그 복원본이 클라우드로 올라갔다(다른 기기도 따라온다).
    const uploads = writeUserData.mock.calls.filter(([uid]) => uid === A_UID);
    expect(uploads.length).toBeGreaterThan(0);
    expect(JSON.stringify(uploads[uploads.length - 1][1].calc)).toContain("복원된카드");

    // 거래는 합집합 — 클라우드 거래를 지우지 않았다.
    expect(localStorage.getItem(LKEY)).toContain("cloud-1");

    // 업로드가 끝났으니 마커는 사라진다(다음 로드부터는 평소 정책).
    expect(isRestorePending()).toBe(false);
  });

  it("업로드가 실패하면 마커를 지우지 않는다(다음 로드에서 다시 시도)", async () => {
    localStorage.setItem(KEY, JSON.stringify(RESTORED_CALC));
    setDataOwner(A_UID);
    markRestorePending({ calc: true, my_items: true, ledger: true });
    fetchUserData.mockResolvedValue(CLOUD_ROW);
    writeUserData.mockRejectedValue(new Error("network down"));

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await settle();

    expect(isRestorePending()).toBe(true); // 못 올렸으면 마커는 남는다
  });

  it("마커가 없으면 평소대로 클라우드가 이긴다(정책을 바꾸지 않았다)", async () => {
    localStorage.setItem(KEY, JSON.stringify(RESTORED_CALC));
    setDataOwner(A_UID);
    localStorage.setItem("mvpCloudSyncedUid", A_UID);
    fetchUserData.mockResolvedValue(CLOUD_ROW);

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();

    const calc = JSON.parse(localStorage.getItem(KEY));
    expect(JSON.stringify(calc.charge)).toContain("클라우드카드"); // 클라우드 우선(기존 동작)
    expect(JSON.stringify(calc.charge)).not.toContain("복원된카드");
  });

  // 소유자가 다른 계정이면 local 은 EMPTY_SNAPSHOT 이다. 여기서 '로컬이 이긴다'가 그대로 적용되면
  // 빈 {} 로 남의 클라우드 설정을 날려 버린다 — 막으려던 것보다 나쁜 손실이다.
  // (실제로 막는 것은 mergeSnapshots 의 '로컬 calc 가 비면 클라우드를 쓴다' 다. 이 테스트는 그 **결과**를 고정한다.)
  it("로컬 데이터의 소유자가 다른 계정이면 복원본으로 클라우드를 덮지 않는다", async () => {
    localStorage.setItem(KEY, JSON.stringify(RESTORED_CALC));
    setDataOwner("someone-else");   // 남의 데이터
    markRestorePending({ calc: true, my_items: true, ledger: true });
    fetchUserData.mockResolvedValue(CLOUD_ROW);

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await settle();

    // 클라우드 설정이 그대로 살아 있다(빈 값으로 날아가지 않았다).
    expect(JSON.stringify(JSON.parse(localStorage.getItem(KEY)).charge)).toContain("클라우드카드");
    const uploads = writeUserData.mock.calls.filter(([uid]) => uid === A_UID);
    for (const [, snap] of uploads) expect(JSON.stringify(snap.calc)).toContain("클라우드카드");
  });

  it("로그아웃하면 복원 마커도 지워진다(다음 계정에 적용되지 않는다)", async () => {
    localStorage.setItem(KEY, JSON.stringify(RESTORED_CALC));
    setDataOwner(A_UID);
    markRestorePending({ calc: true, my_items: true, ledger: true });
    expect(getRestorePending()).toEqual({ calc: true, my_items: true, ledger: true });

    clearAccountData();
    expect(localStorage.getItem(RESTORE_KEY)).toBe(null);
  });
});

// Codex 지적: 복원한 탭만 보호하면 부족하다. **이미 열려 있던 다른 탭**은 복원 전 메모리를 그대로 갖고 있고,
// 그 탭이 업로드하면 mergeForUpload 가 '이 탭의 calc'를 우선하므로 서버의 복원본을 그대로 덮는다.
describe("다른 탭이 복원한 경우 — 이 탭이 옛 값으로 클라우드를 덮지 않는다", () => {
  const RESTORED = JSON.stringify({ calc: true, my_items: true });

  it("storage 이벤트를 받으면 이 탭은 저장·업로드를 멈춘다", async () => {
    localStorage.setItem(KEY, JSON.stringify(A_CALC));   // 이 탭의 옛 값
    setDataOwner(A_UID);
    fetchUserData.mockResolvedValue({ updated_at: "2026-07-13T00:00:00Z", calc: {}, my_items: [], ledger: {} });

    await mount();                                        // 평범하게 로그인·동기화된 탭
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await settle();

    // 다른 탭이 백업을 복원했다 → 마커가 생기고 storage 이벤트가 이 탭에 도착한다.
    writeUserData.mockClear();
    localStorage.setItem(RESTORE_KEY, RESTORED);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: RESTORE_KEY, newValue: RESTORED }));
    });
    await settle();

    // 이 탭에서 무엇이든 바뀌어도(사용자 편집·프로그램적 변경) 저장·업로드가 일어나지 않는다.
    await act(async () => { api.setLedger((l) => ({ ...l, spends: [{ id: "stale-2", date: "2026-07-13", amount: 1 }] })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await settle();

    expect(writeUserData).not.toHaveBeenCalled();                 // 옛 calc 를 클라우드에 올리지 않았다
    expect(localStorage.getItem(LKEY) || "").not.toContain("stale-2"); // 저장소도 잠겼다
  });

  // storage 이벤트를 처리하기 전의 짧은 창: 이미 시작된 업로드가 남의 복원본을 덮으면 안 된다.
  it("복원 마커의 주인이 아닌 탭은 업로드 자체를 중단한다", async () => {
    localStorage.setItem(KEY, JSON.stringify(A_CALC));
    setDataOwner(A_UID);
    fetchUserData.mockResolvedValue({ updated_at: "2026-07-13T00:00:00Z", calc: {}, my_items: [], ledger: {} });

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await settle();

    // 마커만 심는다(이벤트는 아직 도착하지 않았다 = 처리 전의 창).
    writeUserData.mockClear();
    localStorage.setItem(RESTORE_KEY, RESTORED);

    await act(async () => { api.setLedger((l) => ({ ...l, spends: [{ id: "stale-3", date: "2026-07-13", amount: 1 }] })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await settle();

    expect(writeUserData).not.toHaveBeenCalled(); // 이 탭은 그 복원의 주인이 아니다 → 올리지 않는다
  });
});

// Codex 지적: 마커가 전역이면, 거래만 든 백업을 복원했는데 **복원하지도 않은 옛 calc** 가 클라우드를 덮는다.
describe("부분 백업 — 복원한 필드에만 권위를 준다", () => {
  it("거래만 복원했으면 옛 로컬 calc 가 클라우드를 덮지 않는다", async () => {
    localStorage.setItem(KEY, JSON.stringify(A_CALC));    // 복원하지 않은, 저장소에 남아 있던 옛 calc
    setDataOwner(A_UID);
    localStorage.setItem("mvpCloudSyncedUid", A_UID);
    markRestorePending({ calc: false, my_items: false, ledger: true }); // 거래만 든 백업
    fetchUserData.mockResolvedValue({
      updated_at: "2026-07-13T00:00:00Z",
      calc: { charge: [{ name: "클라우드카드", rate: 1, limit: 0 }] },
      my_items: [], ledger: {},
    });

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();

    // 마커는 남는다 — 거래만 복원해도 **다른 탭을 멈춰야** 하기 때문이다(권위와 정지 신호는 다른 일이다).
    expect(getRestorePending()).toEqual({ calc: false, my_items: false, ledger: true });
    const calc = JSON.parse(localStorage.getItem(KEY));
    expect(JSON.stringify(calc.charge)).toContain("클라우드카드");        // 클라우드 유지
    expect(JSON.stringify(calc.charge)).not.toContain("도서문화상품권");  // 옛 로컬이 이기지 않았다
  });

  it("calc 만 든 백업이면 아이템에는 권위를 주지 않는다", async () => {
    localStorage.setItem(KEY, JSON.stringify({ charge: [{ name: "복원된카드", rate: 9, limit: 1 }] }));
    localStorage.setItem(ITEMS_KEY, JSON.stringify([{ id: "i1", name: "옛로컬아이템", cash: 111 }]));
    setDataOwner(A_UID);
    localStorage.setItem("mvpCloudSyncedUid", A_UID);
    markRestorePending({ calc: true, my_items: false, ledger: false });   // calc 만 복원했다
    fetchUserData.mockResolvedValue({
      updated_at: "2026-07-13T00:00:00Z",
      calc: { charge: [{ name: "클라우드카드", rate: 1, limit: 0 }] },
      my_items: [{ id: "i1", name: "클라우드아이템", cash: 999 }],
      ledger: {},
    });

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();

    expect(JSON.stringify(JSON.parse(localStorage.getItem(KEY)).charge)).toContain("복원된카드"); // calc 는 로컬 승
    const items = JSON.parse(localStorage.getItem(ITEMS_KEY));
    const i1 = items.find((x) => x.id === "i1");
    expect(i1.cash).toBe(999); // 아이템은 평소대로 클라우드 승(권위를 주지 않았다)
  });
});

// Codex 2차 지적: 마커의 두 역할(병합 권위 / 다른 탭 정지)을 섞으면, 거래만 든 백업에서
// 마커가 아예 안 생겨 **다른 탭이 멈추지 않는다** → 그 탭의 옛 원장이 복원된 원장을 덮는다.
describe("거래만 든 백업도 다른 탭을 멈춘다", () => {
  it("ledger-only 복원 마커에도 다른 탭이 저장·업로드를 멈춘다", async () => {
    const LEDGER_ONLY = JSON.stringify({ calc: false, my_items: false, ledger: true });
    localStorage.setItem(KEY, JSON.stringify(A_CALC));
    localStorage.setItem(LKEY, JSON.stringify(A_LEDGER)); // 이 탭의 옛 원장
    setDataOwner(A_UID);
    fetchUserData.mockResolvedValue({ updated_at: "2026-07-13T00:00:00Z", calc: {}, my_items: [], ledger: {} });

    await mount();
    await act(async () => emitSession({ user: { id: A_UID } }));
    await settle();
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await settle();

    // 다른 탭이 '거래만 든' 백업을 복원했다.
    writeUserData.mockClear();
    localStorage.setItem(RESTORE_KEY, LEDGER_ONLY);
    localStorage.setItem(LKEY, JSON.stringify({ buys: [{ id: "restored-only" }], sells: [], cashes: [], spends: [], deleted: {} }));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: RESTORE_KEY, newValue: LEDGER_ONLY }));
    });
    await settle();

    await act(async () => { api.setLedger((l) => ({ ...l, spends: [{ id: "stale-4", date: "2026-07-13", amount: 1 }] })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await settle();

    expect(localStorage.getItem(LKEY)).toContain("restored-only");  // 복원된 원장이 살아 있다
    expect(localStorage.getItem(LKEY)).not.toContain("a-buy-1");    // 이 탭의 옛 원장이 덮지 않았다
    expect(writeUserData).not.toHaveBeenCalled();                   // 클라우드에도 올리지 않았다
  });

  it("구버전 전역 마커('1')는 모든 필드를 복원한 것으로 읽는다", () => {
    localStorage.setItem(RESTORE_KEY, "1");
    expect(getRestorePending()).toEqual({ calc: true, my_items: true, ledger: true });
  });

  it("형태가 깨진 마커는 무시한다(평소 정책으로)", () => {
    localStorage.setItem(RESTORE_KEY, "{깨진 JSON");
    expect(getRestorePending()).toBe(null);
    localStorage.setItem(RESTORE_KEY, JSON.stringify([1, 2]));
    expect(getRestorePending()).toBe(null);
  });
});
