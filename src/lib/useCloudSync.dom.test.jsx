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

  afterEach(() => { __unlockAccountWrites(); });

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
