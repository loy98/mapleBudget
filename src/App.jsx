import { useState, useMemo, useEffect, useRef } from "react";
import { computeCalc } from "./lib/calc.js";
import {
  loadCalcState, saveCalcState, loadMyItems, saveMyItems,
  loadLedger, saveLedger, exportAll, importAll, withRowKeys, markUserTouched, normalizeMyItems, deleteMyItem, restoreDefaultMyItems, addMyItems,
} from "./lib/storage.js";
import { cloudEnabled } from "./lib/cloud.js";
import { useCloudSync } from "./lib/useCloudSync.js";
import CalcTab from "./components/CalcTab.jsx";
import LogTab from "./components/LogTab.jsx";
import ForecastTab from "./components/ForecastTab.jsx";
import AuthBar from "./components/AuthBar.jsx";
import ThemeMenu from "./components/ThemeMenu.jsx";
import { IconHelp, IconChat } from "./components/ui/icons.jsx";
import HelpModal from "./components/HelpModal.jsx";
import FeedbackModal from "./components/FeedbackModal.jsx";
import Modal from "./components/Modal.jsx";
import StorageAlert from "./components/StorageAlert.jsx";

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
  // 테마 모드: "system"(기본) | "light" | "dark". index.html 인라인 스크립트가 최초 flash 없이 선반영.
  // "system" 은 OS 설정(prefers-color-scheme)을 따르고, OS 가 바뀌면 실시간으로 따라간다.
  const [themeMode, setThemeMode] = useState(() => {
    try {
      const v = localStorage.getItem("mvpTheme");
      if (v === "light" || v === "dark" || v === "system") return v;
    } catch {}
    return "system";
  });
  const fileRef = useRef(null);

  // 테마 적용 + 저장 + 모바일 주소창 색(theme-color) 동기화.
  // 다크가 기본(:root), 라이트는 data-theme="light" 로 켠다. 실제 다크 여부는 모드+OS 로 계산한다.
  useEffect(() => {
    const el = document.documentElement;
    // matchMedia 가 없는 환경(구형 웹뷰·jsdom 등)에서도 안전하게 — index.html 인라인 스크립트와 같은 가드.
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
  const { session, syncState, chargeOptions, conflictPrompt, rules, ruleHistory } = useCloudSync({
    settings, charges, items, myItems, ledger,
    setCalcState, setMyItems, setLedger,
  });

  // 파생 계산 (기존 render()의 순수 버전). rules 는 app_config 에서 오거나 constants 폴백.
  const calc = useMemo(() => computeCalc(settings, charges, items, rules), [settings, charges, items, rules]);

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
  // '기본 목록 복원'. 지운 기본 아이템의 삭제 표식은 합집합이라 로컬에서 지워도 클라우드에서 되살아난다.
  // 그래서 남아 있는 표식보다 뒤인 시각을 아이템에 찍어 표식을 이기게 한다.
  const restoreDefaultItems = () => { markUserTouched(); setMyItems(restoreDefaultMyItems(ledger.deleted)); };
  // 새 아이템 추가도 같은 이유로 App 을 거친다 — 예전에 같은 이름을 지웠다면 그 표식보다 뒤여야 살아남는다.
  const addItemsToMyList = (rows) => { markUserTouched(); setMyItems(addMyItems(myItems, ledger.deleted, rows)); };

  const onImportFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const r = importAll(reader.result);
      if (r.ok) {
        // 경고를 삼키면 "복원 완료"만 보고 데이터가 빠진 것을 나중에야 안다(B-6).
        const notes = (r.warnings || []).length ? "\n\n" + r.warnings.map((w) => "· " + w).join("\n") : "";
        alert("복원 완료! 페이지를 새로고침합니다." + notes);
        location.reload();
      } else {
        alert(r.error);
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
          <AuthBar session={session} syncState={syncState} />
        </div>
      </header>

      <StorageAlert />

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "calc" && (
        <CalcTab
          settings={settings} setSettings={setSettings}
          charges={charges} setCharges={setCharges}
          items={items} setItems={setItems}
          myItems={myItems} setMyItems={applyMyItems} onRemoveMyItem={removeMyItem} onRestoreDefaultItems={restoreDefaultItems} onAddMyItems={addItemsToMyList}
          chargeMethods={chargeOptions}
          calc={calc}
          tiers={rules.tiers}
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
        {/* 정적 페이지(public/)라 SPA 라우팅이 아닌 전체 이동. 크롤러가 직접 읽을 수 있어야 함. */}
        <p className="legal-links">
          <a href="/privacy.html">개인정보처리방침</a>
          <span aria-hidden="true"> · </span>
          <a href="/terms.html">이용약관</a>
        </p>
        <p className="disclaimer">
          본 사이트는 넥슨코리아 및 「메이플스토리」와 무관한 비공식 팬 사이트입니다.
          「메이플스토리」와 관련 명칭·이미지의 모든 권리는 ㈜넥슨코리아에 있습니다.
        </p>
      </footer>

      {conflictPrompt && <ConflictModal onChoose={conflictPrompt.onChoose} />}
      {modal === "help" && <HelpModal onClose={() => setModal(null)} />}
      {modal === "feedback" && <FeedbackModal session={session} onClose={() => setModal(null)} />}
    </div>
  );
}
