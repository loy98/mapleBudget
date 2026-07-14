import { useState, useMemo, useEffect, useRef } from "react";
import { computeCalc } from "./lib/calc.js";
import {
  loadCalcState, saveCalcState, loadMyItems, saveMyItems,
  loadLedger, saveLedger, exportAll, importAll, withRowKeys, markUserTouched, normalizeMyItems, deleteMyItem, addMyItems,
  lockAccountWrites,
} from "./lib/storage.js";
import { cloudEnabled } from "./lib/cloud.js";
import { useCloudSync } from "./lib/useCloudSync.js";
import { cumNow, hasLedgerEntries } from "./lib/ledger.js";
import { rulesAt } from "./lib/constants.js";
import CalcTab from "./components/CalcTab.jsx";
import LogTab from "./components/LogTab.jsx";
import ForecastTab from "./components/ForecastTab.jsx";
import AuthBar from "./components/AuthBar.jsx";
import ThemeMenu from "./components/ThemeMenu.jsx";
import { IconHelp, IconChat, IconCoffee } from "./components/ui/icons.jsx";
import HelpModal from "./components/HelpModal.jsx";
import FeedbackModal from "./components/FeedbackModal.jsx";
import DonateModal from "./components/DonateModal.jsx";
import { DONATE, donateOptions } from "./lib/donate.js";
import Modal from "./components/Modal.jsx";
import StorageAlert from "./components/StorageAlert.jsx";
import ToastHost from "./components/ui/Toast.jsx";
import RestoreReloadModal from "./components/RestoreReloadModal.jsx";
import { toast, queueToast, flushQueuedToast } from "./lib/toast.js";

// 후원 수단이 하나도 설정돼 있지 않으면 진입점 자체를 감춘다(빈 모달을 열게 두지 않는다).
// 설정은 상수라 렌더마다 같다 → 모듈 스코프에서 한 번만 계산.
const DONATE_ENABLED = donateOptions(DONATE).any;

const TABS = [
  { id: "calc", label: "계산기" },
  { id: "log", label: "거래 기록" },
  { id: "fore", label: "예상 & 추천" },
];

// 최초 로그인 병합 충돌 선택 모달(네이티브 confirm 대체 — 앱 테마·테스트 가능). 모듈 스코프(리마운트 방지).
// onClose 를 주지 않는다 = Esc·배경 클릭으로 닫히지 않음. 어느 쪽 데이터를 쓸지 반드시 골라야 하므로
// '그냥 닫기'라는 선택지가 존재하면 안 된다(닫으면 무엇을 적용할지 정의되지 않는다).
function ConflictModal({ onChoose }) {
  return (
    <Modal label="클라우드 설정 병합 선택">
      <>
        <div className="modal-title">클라우드에 저장된 설정이 있어요</div>
        <p className="modal-body">
          이 기기의 설정/자주 쓰는 아이템과 클라우드에 저장된 것이 서로 달라요. 어느 쪽을 쓸까요?
          <br /><span className="muted">※ 거래 기록은 어느 쪽을 고르든 모두 합쳐집니다.</span>
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={() => onChoose(true)}>클라우드 설정 사용</button>
          <button className="btn ghost" onClick={() => onChoose(false)}>이 기기 설정 사용</button>
        </div>
      </>
    </Modal>
  );
}

export default function App() {
  const [tab, setTab] = useState("calc");
  const [{ settings, charges, items }, setCalcState] = useState(loadCalcState);
  const [myItems, setMyItems] = useState(loadMyItems);
  const [ledger, setLedger] = useState(loadLedger);
  const [modal, setModal] = useState(null); // null | "help" | "feedback"
  // 복원은 됐는데 알림을 새로고침 너머로 넘기지 못한 상태. { warnings } — 편집을 봉쇄하는 모달을 띄운다.
  const [restoreNeedsReload, setRestoreNeedsReload] = useState(null);
  // 테마 모드: "system"(기본) | "light" | "dark". public/theme-init.js 가 최초 flash 없이 선반영.
  // "system" 은 OS 설정(prefers-color-scheme)을 따르고, OS 가 바뀌면 실시간으로 따라간다.
  const [themeMode, setThemeMode] = useState(() => {
    try {
      const v = localStorage.getItem("mvpTheme");
      if (v === "light" || v === "dark" || v === "system") return v;
    } catch {}
    return "system";
  });
  const fileRef = useRef(null);

  // 새로고침을 건너온 토스트(백업 복원)를 마운트 시 한 번 꺼내 띄운다.
  useEffect(() => { flushQueuedToast(); }, []);

  // 테마 적용 + 저장 + 모바일 주소창 색(theme-color) 동기화.
  // 다크가 기본(:root), 라이트는 data-theme="light" 로 켠다. 실제 다크 여부는 모드+OS 로 계산한다.
  useEffect(() => {
    const el = document.documentElement;
    // matchMedia 가 없는 환경(구형 웹뷰·jsdom 등)에서도 안전하게 — theme-init.js 와 같은 가드.
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = () => {
      const dark = themeMode === "dark" || (themeMode === "system" && !!mq?.matches);
      if (dark) el.removeAttribute("data-theme");
      else el.setAttribute("data-theme", "light");
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute("content", dark ? "#0a0b0e" : "#f4efe4");
    };
    apply();
    try { localStorage.setItem("mvpTheme", themeMode); } catch {}
    // 시스템 모드일 때만 OS 변경을 구독한다(라이트/다크 고정 시엔 불필요).
    // 구형 Safari(<14)는 addEventListener 대신 addListener 만 있으므로 폴백을 둔다.
    if (themeMode === "system" && mq) {
      if (mq.addEventListener) {
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
      }
      if (mq.addListener) {
        mq.addListener(apply);
        return () => mq.removeListener(apply);
      }
    }
  }, [themeMode]);

  // 세션·app_config·클라우드 동기화·업로드는 useCloudSync 훅이 담당(App은 계산기 상태·렌더만 소유).
  // 파생 계산보다 먼저 호출해야 rules(게임 규칙)를 computeCalc 에 넘길 수 있다.
  // 복원 후 새로고침 대기 중에는 훅을 멈춘다 — 메모리는 복원 전 옛 값이라, 이 훅이 상태를 건드리거나
  // 업로드하면 방금 복원한 데이터를 옛 값으로 덮어쓴다(로컬은 storage 잠금이, 클라우드는 이 신호가 막는다).
  const { session, syncState, chargeOptions, catalog, conflictPrompt, rules, ruleHistory, flushPendingUpload, restoreFromOtherTab } = useCloudSync({
    settings, charges, items, myItems, ledger,
    setCalcState, setMyItems, setLedger,
    suspended: !!restoreNeedsReload,
  });

  // 거래 기록의 13주 누적 실적. 거래일마다 그 날 유효했던 마일리지 규칙을 적용해야
  // 거래 기록·예상 탭이 내는 누적과 계산기가 쓰는 누적이 일치한다(ForecastTab 과 같은 식).
  const mileageROf = useMemo(
    () => (b) => (rulesAt(ruleHistory, b && b.date).mileageRate || 0) / 100,
    [ruleHistory]
  );
  const ledgerCum = useMemo(() => cumNow(ledger, mileageROf), [ledger, mileageROf]);

  // 계산기가 실제로 쓰는 설정. '내 기록' 모드면 '현재 누적 실적'을 원장에서 끌어온다.
  // settings.curAchieved(직접 입력값)는 지우지 않고 보존한다 — 모드를 되돌리면 그대로 돌아온다.
  const calcSettings = useMemo(
    () => (settings.curSource === "ledger" ? { ...settings, curAchieved: ledgerCum } : settings),
    [settings, ledgerCum]
  );

  // 파생 계산 (기존 render()의 순수 버전). rules 는 app_config 에서 오거나 constants 폴백.
  const calc = useMemo(() => computeCalc(calcSettings, charges, items, rules), [calcSettings, charges, items, rules]);

  // 로컬 자동 저장 (게스트/로그인 공통 캐시)
  // 반드시 블록 본문으로 둔다 — save* 는 성공 여부(boolean)를 반환하므로, 화살표 축약형이면
  // 그 값이 useEffect 의 cleanup 으로 해석되어 React 가 던진다.
  useEffect(() => { saveCalcState(settings, charges, items); }, [settings, charges, items]);
  useEffect(() => { saveMyItems(myItems); }, [myItems]);
  useEffect(() => { saveLedger(ledger); }, [ledger]);

  // 사용자 직접 편집용 setter. withRowKeys로 안정 key를 부여하고, markUserTouched로 '사용자가 손댔음'을 기록
  // → 최초 로그인 병합에서 거래 없이 설정/아이템만 바꾼 게스트의 데이터도 보호(P1-4). config/sync 프로그램적
  //   변경은 훅이 setCalcState/setMyItems를 직접 호출하므로 여기 표시가 붙지 않는다.
  const setSettings = (patch) => { markUserTouched(); setCalcState((s) => ({ ...s, settings: { ...s.settings, ...patch } })); };
  const setCharges = (charges) => { markUserTouched(); setCalcState((s) => ({ ...s, charges: withRowKeys(charges) })); };
  const setItems = (items) => { markUserTouched(); setCalcState((s) => ({ ...s, items: withRowKeys(items) })); };
  const applyMyItems = (arr) => { markUserTouched(); setMyItems(normalizeMyItems(arr)); };
  // 아이템 삭제는 목록에서 빼는 것만으로 부족하다 — 그 아이템을 아직 가진 기기가 다음 접속 때 되살린다.
  // `ledger.deleted` 에 `item:<id>` 표식을 남겨야 전파된다(B-2b). ledger 도 함께 갱신되므로 App 이 소유한다.
  const removeMyItem = (id) => {
    markUserTouched();
    const next = deleteMyItem(myItems, ledger, id);
    setMyItems(next.myItems);
    setLedger(next.ledger);
  };
  // 새 아이템 추가. 예전에 같은 이름을 지웠다면 그 삭제 표식보다 뒤인 `at` 이어야 살아남는다 → App 을 거친다.
  // origin:"user" 를 반드시 찍는다 — 이게 없으면 구 데이터 정리(planItemMigration)가
  // 카탈로그와 이름이 겹치는 수정본을 다음 로드에서 지워 버린다.
  const addItemsToMyList = (rows) => {
    markUserTouched();
    setMyItems(addMyItems(myItems, ledger.deleted, rows.map((r) => ({ ...r, origin: "user" }))));
  };

  // composeItems 가 붙인 표시용 메타(source/overrides/base/_k)는 저장하지 않는다 — 데이터 필드만 남긴다.
  // 안 그러면 base(카탈로그 원본 전체)가 my_items 에 통째로 실려 클라우드로 올라간다.
  const itemFields = (r) => ({
    name: r.name, cash: r.cash, mAllowed: r.mAllowed !== false, icon: r.icon || "", cat: r.cat,
  });

  // 기본(카탈로그) 아이템을 '내 아이템'으로 복사해 수정한다. 카탈로그 자체는 운영자 소유라 건드리지 않는다.
  // 같은 이름의 내 아이템이 카탈로그를 가리므로(composeItems), 결과적으로 이 유저에게만 수정본이 보인다.
  const overrideCatalogItem = (row) => addItemsToMyList([{ ...itemFields(row), hidden: false }]);

  // 기본 아이템 숨기기 = 같은 이름의 '숨김 행'을 내 아이템에 넣는다. 새 병합 규칙을 만들지 않고
  // 기존 합집합·표식·at 순서를 그대로 재사용하기 위한 표현이다(items.js 참고).
  const hideCatalogItem = (row) => addItemsToMyList([{ ...itemFields(row), hidden: true }]);

  // 숨김 해제 / 기본값으로 되돌리기 — 둘 다 '그 my_items 행을 지운다'는 같은 동작이다.
  // 행이 사라지면 카탈로그 원본이 다시 보인다.
  const revertToCatalog = (id) => removeMyItem(id);

  const onImportFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const r = importAll(reader.result);
      if (r.ok) {
        // 복원은 곧바로 새로고침해야 한다 — 복원본은 저장소에 들어갔지만 메모리의 React 상태는 아직 옛것이라,
        // 새로고침하지 않으면 자동저장 이펙트가 방금 복원한 데이터를 옛 값으로 덮어쓴다.
        // 그런데 새로고침은 지금 띄운 토스트도 함께 지운다 → 알림을 저장소로 넘겨 새로고침 뒤에 띄운다.
        // 경고가 있으면 sticky: 경고를 삼키면 "복원 완료"만 보고 데이터가 빠진 걸 나중에야 안다(B-6).
        const warnings = r.warnings || [];
        const queued = queueToast("success", "복원 완료.", { detail: warnings, sticky: warnings.length > 0 });
        if (!queued) {
          // 알림을 새로고침 너머로 넘길 수 없다 → 여기서 바로 새로고침하면 경고가 통째로 사라진다.
          // 그렇다고 안내만 하면 새로고침 전에 상태가 바뀔 수 있고, 그러면 자동저장이
          // **옛 메모리 상태로 방금 복원한 데이터를 덮어쓴다.** 위험은 사용자 편집만이 아니다 —
          // app_config 적용·클라우드 최초 동기화·충돌 병합 같은 프로그램적 변경도 같은 일을 한다.
          // 그래서 세 겹으로 막는다:
          //  ① 저장소 쓰기 잠금(어떤 경로로 setState 가 일어나도 복원본은 안전하다)
          //  ② useCloudSync 중단(스테일 메모리가 클라우드로 올라가지 않는다 — 잠금이 못 막는 곳)
          //  ③ 닫을 수 없는 모달(사용자 편집 봉쇄 + 나갈 길은 새로고침 하나)
          lockAccountWrites();
          setRestoreNeedsReload({ warnings });
          return;
        }
        // 새로고침이 막힌 환경이면(throw/무동작) 최소한 지금 화면에라도 띄운다 — 침묵보다 낫다.
        try { location.reload(); } catch { flushQueuedToast(); }
      } else {
        toast.error(r.error);
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  return (
    <div className="wrap">
      <header>
        <span className="logo" aria-hidden="true">M</span>
        <h1>메이플 MVP작 효율 계산기</h1>
        <span className="sub">엠작 최적화 · 계산기 + 거래 기록/13주 달력</span>
        <div className="headright">
          <ThemeMenu mode={themeMode} setMode={setThemeMode} />
          <button className="hbtn" onClick={() => setModal("help")} aria-label="도움말" title="도움말">
            <IconHelp className="hbtn-ico" /><span className="hbtn-lbl">도움말</span>
          </button>
          <button className="hbtn" onClick={() => setModal("feedback")} aria-label="피드백" title="피드백">
            <IconChat className="hbtn-ico" /><span className="hbtn-lbl">피드백</span>
          </button>
          <AuthBar session={session} syncState={syncState} flushPendingUpload={flushPendingUpload} />
        </div>
      </header>

      <StorageAlert />

      {/* 탭 줄 오른쪽에 후원 버튼. 헤더(로그인·테마·도움말)보다 한 칸 아래라 헤더가 붐비지 않으면서도
          첫 화면에서 바로 보인다. */}
      <div className="tabsrow">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={"tab" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {DONATE_ENABLED && (
          <button className="hbtn donate" onClick={() => setModal("donate")} title="개발자에게 커피 한잔">
            <IconCoffee className="hbtn-ico" /><span className="hbtn-lbl">개발자에게 커피 한잔</span>
          </button>
        )}
      </div>

      {tab === "calc" && (
        <CalcTab
          settings={settings} setSettings={setSettings}
          charges={charges} setCharges={setCharges}
          items={items} setItems={setItems}
          myItems={myItems} setMyItems={applyMyItems} onRemoveMyItem={removeMyItem} onAddMyItems={addItemsToMyList}
          catalog={catalog}
          onOverrideCatalogItem={overrideCatalogItem}
          onHideCatalogItem={hideCatalogItem}
          onRevertToCatalog={revertToCatalog}
          chargeMethods={chargeOptions}
          calc={calc}
          tiers={rules.tiers}
          ledgerCum={ledgerCum}
          hasLedger={hasLedgerEntries(ledger)}
        />
      )}
      {tab === "log" && (
        <LogTab ledger={ledger} setLedger={setLedger} myItems={myItems} calc={calc} tiers={rules.tiers} ruleHistory={ruleHistory} />
      )}
      {tab === "fore" && <ForecastTab ledger={ledger} calc={calc} tiers={rules.tiers} ruleHistory={ruleHistory} />}

      <footer className="site">
        <div className="backupbar" style={{ justifyContent: "center" }}>
          <button className="btn ghost sm" onClick={exportAll}>데이터 내보내기 (백업)</button>
          <button className="btn ghost sm" onClick={() => fileRef.current.click()}>데이터 가져오기 (복원)</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={onImportFile} />
        </div>
        <p>
          {cloudEnabled
            ? "로그인하면 기기 간 자동 동기화됩니다. 로그인 없이는 이 브라우저(localStorage)에만 저장됩니다."
            : "모든 데이터는 이 브라우저(localStorage)에만 저장됩니다. 기기 변경 시 내보내기/가져오기를 사용하세요."}
        </p>
        {DONATE_ENABLED && (
          <p className="donate-foot">
            <button className="linklike" onClick={() => setModal("donate")}>
              <IconCoffee /> 개발자에게 커피 한잔
            </button>
            <span className="hint"> — 계산기는 계속 무료입니다. 응원은 큰 힘이 됩니다.</span>
          </p>
        )}
        {/* 정적 페이지(public/)라 SPA 라우팅이 아닌 전체 이동. 크롤러가 직접 읽을 수 있어야 함. */}
        <p className="legal-links">
          <a href="/guide">엠작 가이드</a>
          <span aria-hidden="true"> · </span>
          <a href="/privacy">개인정보처리방침</a>
          <span aria-hidden="true"> · </span>
          <a href="/terms">이용약관</a>
        </p>
        <p className="disclaimer">
          본 사이트는 넥슨코리아 및 「메이플스토리」와 무관한 비공식 팬 사이트입니다.
          「메이플스토리」와 관련 명칭·이미지의 모든 권리는 ㈜넥슨코리아에 있습니다.
        </p>
      </footer>

      <ToastHost />

      {/* 이 탭이 복원했는데 알림을 넘기지 못했거나(restoreNeedsReload), 다른 탭이 복원했거나(restoreFromOtherTab).
          어느 쪽이든 이 화면의 메모리는 복원 전 값이라, 새로고침 전에는 아무것도 저장/업로드하면 안 된다. */}
      {(restoreNeedsReload || restoreFromOtherTab) && (
        <RestoreReloadModal
          warnings={restoreNeedsReload?.warnings || []}
          otherTab={!restoreNeedsReload && restoreFromOtherTab}
          onReload={() => location.reload()}
        />
      )}
      {conflictPrompt && <ConflictModal onChoose={conflictPrompt.onChoose} />}
      {modal === "help" && <HelpModal onClose={() => setModal(null)} />}
      {modal === "feedback" && <FeedbackModal session={session} onClose={() => setModal(null)} />}
      {modal === "donate" && <DonateModal onClose={() => setModal(null)} />}
    </div>
  );
}
