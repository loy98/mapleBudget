import { useState, useMemo } from "react";
import { TIERS, CHARGE_METHODS, MVP_GRADES, SPLITS, DEFAULT_SETTINGS, ITEM_CATS, itemCat, isAllowedIconUrl } from "../lib/constants.js";
import { won, pct, eok, ml, mlN, uid } from "../lib/util.js";
import { hasFeeBenefit } from "../lib/calc.js";
import { NumInput, CSelect, KpiBox, CostLabel, PlLabel, MilUse, IconView, ProgressRing } from "./ui.jsx";
import { IconSliders } from "./ui/icons.jsx";
import { composeItems } from "../lib/items.js";
import ItemEditModal from "./ItemEditModal.jsx";

const tierOptionsOf = (tiers) =>
  tiers.map((t, i) => ({ value: i, label: `${t.name} (${(t.amt / 10000).toLocaleString()}만원)` }));
const gradeOptions = MVP_GRADES.map((g, i) => ({ value: i, label: g }));
const splitOptions = SPLITS.map((s, i) => ({ value: i, label: s.label }));
const catOptions = ITEM_CATS.map((c) => ({ value: c.id, label: c.label }));

export default function CalcTab({ settings, setSettings, charges, setCharges, items, setItems, myItems, setMyItems, onRemoveMyItem, onAddMyItems, catalog = [], onOverrideCatalogItem, onHideCatalogItem, onRevertToCatalog, chargeMethods = CHARGE_METHODS, calc, tiers = TIERS, ledgerCum = 0, hasLedger = false }) {
  const [preset, setPreset] = useState("0");
  const [editorOpen, setEditorOpen] = useState(false);
  const [cat, setCat] = useState("all"); // 자주 쓰는 아이템 카테고리 필터("all" = 전체)
  const [editing, setEditing] = useState(null); // 수정 모달을 띄운 카탈로그 아이템
  // 등급 기준은 app_config(rules.tiers)에서 올 수 있다 → 목록 길이가 바뀌어도 인덱스가 깨지지 않게 방어.
  const tierOptions = useMemo(() => tierOptionsOf(tiers), [tiers]);
  // 충전 방식 프리셋 옵션 — DB 설정 목록(chargeMethods) 기반. DB에 malformed/null 원소가 섞여도
  // 안전하도록 name 있는 원소만 사용(옵션·addPreset이 같은 목록을 써 인덱스 정합 유지). 기본은 constants.
  const validCharges = (chargeMethods || []).filter((m) => m && typeof m.name === "string");
  const presetOptions = validCharges.map((m, i) => ({ value: i, label: m.name + (m.rate ? ` (${m.rate}%)` : "") }));

  const c = calc;
  // 조건을 여기서 다시 쓰지 않는다 — 화면 설명과 실제 계산이 갈라지지 않게 calc.js 의 판정을 그대로 쓴다.
  const feeBenefit = hasFeeBenefit(settings.mvpGrade, settings.pcRoom);
  const basicName = c.giftBest ? "선물식" : "메소마켓";

  // ----- 히어로/방식비교 파생값 -----
  const goalAmt = +settings.tierAmt || 0;
  // '내 기록' 모드에서는 원장의 13주 누적이 실적이다. 그 분기를 여기서 다시 쓰지 않고 c.cur 를 읽는다 —
  // 화면의 진행률과 실제 계산이 갈라지지 않게(hasFeeBenefit 과 같은 이유).
  const fromLedger = settings.curSource === "ledger";
  const curAch = c.cur;
  const rawProgPct = c.remain <= 0 ? 100 : goalAmt > 0 ? (curAch / goalAmt) * 100 : 0;
  const progPct = Math.max(0, Math.min(100, Number.isFinite(rawProgPct) ? rawProgPct : 0));
  const targetName = (tiers[+settings.tierSel] || {}).name || "목표";
  const optName = c.useItem ? "경매장 되팔기" : basicName;
  const bestBasicVal = Math.min(c.gift, c.market);
  // 순비용은 음수(이득)일 수 있어 0을 포함한 범위로 정규화 후 0~100 클램프(바 폭 왜곡 방지)
  const barVals = [c.gift, c.market].filter(Number.isFinite);
  const barLo = Math.min(0, ...barVals);
  const barSpan = Math.max(0, ...barVals) - barLo || 1;
  const barW = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(((v - barLo) / barSpan) * 100))) : 0) + "%";

  // ----- 충전 방식 -----
  const setCharge = (i, patch) => setCharges(charges.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const delCharge = (i) => setCharges(charges.filter((_, j) => j !== i));
  const addPreset = () => {
    const m = validCharges[+preset];
    if (!m) return;
    setCharges([...charges, { name: m.name, rate: m.rate, limit: m.limit }]);
  };

  // ----- 계산기 아이템 -----
  const setItem = (i, patch) => setItems(items.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const delItem = (i) => setItems(items.filter((_, j) => j !== i));
  const addItem = (data) =>
    setItems([...items, data || { name: "", cash: "", sell: "", mAllowed: true, mil: false }]);

  // ----- 자주 쓰는 아이템 -----
  // 화면 목록 = 카탈로그(운영자) + 내 아이템(유저). 같은 이름이면 내 것이 카탈로그를 가린다.
  // 두 저장소를 합치는 규칙은 items.js 한 곳에만 있다 — 화면이 제 나름대로 합치기 시작하면 곧 갈라진다.
  const { items: listItems, hidden: hiddenItems } = useMemo(
    () => composeItems(catalog, myItems),
    [catalog, myItems]
  );

  // 카테고리별 개수. 아이템이 하나도 없는 카테고리는 탭을 만들지 않는다.
  const shownCats = useMemo(() => {
    const n = {};
    listItems.forEach((p) => { const k = itemCat(p.cat); n[k] = (n[k] || 0) + 1; });
    return ITEM_CATS.filter((k) => n[k.id]).map((k) => ({ ...k, n: n[k.id] }));
  }, [listItems]);
  // 선택한 카테고리가 사라지면(그 카테고리 아이템을 다 지우면) 빈 목록에 갇힌다 → '전체'로 되돌린다.
  // 되돌린 결과는 activeCat 하나로 표현한다. cat 만 보고 목록을 고르면 전체 아이템이 보이는데
  // '전체' 탭은 선택돼 있지 않은 상태가 된다(어느 탭도 강조되지 않음).
  const catExists = cat === "all" || shownCats.some((k) => k.id === cat);
  const activeCat = catExists ? cat : "all";
  const shownItems = useMemo(
    () => (activeCat === "all" ? listItems : listItems.filter((p) => itemCat(p.cat) === activeCat)),
    [listItems, activeCat]
  );

  // 내 아이템 행만 직접 편집할 수 있다. 카탈로그 행은 수정 모달을 거쳐 사본이 된다.
  const setMyItem = (id, patch) => setMyItems(myItems.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  // 배열에서 빼기만 하면 그 아이템을 아직 가진 기기가 다음 접속 때 되살린다 → 삭제 표식을 남기는 App 핸들러를 쓴다.
  const delMyItem = (id) => onRemoveMyItem(id);
  const addTableRowsToList = () => {
    const add = items.filter(
      (r) => r.name && r.name.trim() && !myItems.some((m) => m.name === r.name && "" + m.cash === "" + r.cash)
    );
    // 추가 시각(at)은 App 이 찍는다 — 예전에 지운 같은 이름의 삭제 표식보다 뒤여야 살아남는다.
    if (add.length) onAddMyItems(add.map((r) => ({ name: r.name, cash: +r.cash, mAllowed: r.mAllowed !== false })));
  };

  const resetAll = () => {
    // '시세/조건 초기화'는 시세·마일리지·환경만 되돌린다. 목표와 실적(그 실적을 어디서 읽는지 포함)은 사용자 데이터다.
    setSettings({ ...DEFAULT_SETTINGS, tierSel: settings.tierSel, tierAmt: settings.tierAmt, curAchieved: settings.curAchieved, curSource: settings.curSource, months: settings.months });
    setCharges([{ name: "정가 (할인 없음)", rate: 0, limit: 0 }]);
  };

  const optDisp = c.useItem ? (
    <>
      <span className="mlabel">경매장 판매</span>
      <span className="mname">{c.bestName}</span>
    </>
  ) : (
    <span className="mname">{basicName}</span>
  );

  const installRows = (totalCost) => {
    if (!(c.remain > 0 && c.installments > 1)) return null;
    return (
      <div className="mplan">
        <table>
          <thead><tr><th>회차</th><th>회당 실적</th><th>회당 실비용</th></tr></thead>
          <tbody>
            {Array.from({ length: c.installments }, (_, k) => (
              <tr key={k}>
                <td>{k + 1}회차</td>
                <td className="num">{won(c.remain / c.installments)}</td>
                <td className="num"><CostLabel n={totalCost / c.installments} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      <div className="navpills">
        <a href="#hero">요약</a><a href="#sec1">방식 비교</a><a href="#sec2">총비용</a>
        <a href="#sec3">경매장</a><a href="#sec4">통합 최적</a><a href="#sec5">마일리지</a><a href="#sec6">최적 플랜</a>
      </div>
      <div className="grid">
        {/* ===== 사이드바: 시세 & 조건 ===== */}
        <div className="sticky">
          <div className="card">
            <h2><span className="n ico"><IconSliders /></span>시세 &amp; 조건</h2>
            <div className="subhead">거래 시세</div>
            <label>메소 시세 (원 / 1억 메소)</label>
            <NumInput value={settings.mesoRate} step={1} onChange={(v) => setSettings({ mesoRate: v })} />
            <div className="hint">라운지 실거래 기준</div>
            <label>선물식 비율 (메소 : 1메포)</label>
            <NumInput value={settings.giftRatio} step={100} onChange={(v) => setSettings({ giftRatio: v })} />
            <label>메소마켓 비율 (메소 / 1메포)</label>
            <NumInput value={settings.marketRatio} step={100} onChange={(v) => setSettings({ marketRatio: v })} />

            <div className="subhead">충전 방식 (여러 개)</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <CSelect value={preset} onChange={setPreset} options={presetOptions} style={{ flex: 1 }} />
              <button className="btn sm" onClick={addPreset}>+ 추가</button>
            </div>
            <table className="ctable">
              <thead><tr><th>방식</th><th>할인%</th><th>월한도(원)</th><th></th></tr></thead>
              <tbody>
                {charges.map((r, i) => (
                  <tr key={r._k}>
                    <td><input value={r.name} onChange={(e) => setCharge(i, { name: e.target.value })} /></td>
                    <td><NumInput noStepper width={58} step={0.1} value={r.rate} onChange={(v) => setCharge(i, { rate: v })} /></td>
                    <td><NumInput noStepper width={88} step={10000} value={r.limit} onChange={(v) => setCharge(i, { limit: v })} /></td>
                    <td><button className="del" onClick={() => delCharge(i)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint">할인율이 높은 것부터 한도만큼 채워 씁니다. 한도를 0으로 두면 무제한입니다.</div>

            <div className="subhead">경매장 수수료 (자동)</div>
            <label>현재 MVP 등급</label>
            <CSelect value={settings.mvpGrade} onChange={(v) => setSettings({ mvpGrade: v })} options={gradeOptions} />
            <label>이용 환경</label>
            <CSelect
              value={settings.pcRoom}
              onChange={(v) => setSettings({ pcRoom: v })}
              options={[{ value: 0, label: "일반 환경 (집 등)" }, { value: 1, label: "프리미엄 PC방" }]}
            />
            <div className="hint">적용 수수료 <b>{c.feePct}%</b> — {feeBenefit ? "MVP 브론즈+ 또는 PC방" : "기본 요율"}</div>

            <div className="subhead">마일리지</div>
            {/* 마일리지 결제 비율은 넥슨이 정하는 상한이라 사용자가 바꾸는 값이 아니다.
                예전에는 입력칸이었고, 바꾸면 13주 누적 과금이 재계산되어 과거 기록과 표시 등급이 흔들렸다. */}
            <div className="hint" style={{ marginTop: 8 }}>
              마일리지 결제 비율 <b>{Math.round((c.mileageR || 0) * 100)}%</b> — 게임 규칙(고정)
            </div>
            <label>월 사용 가능 마일리지</label>
            <NumInput value={settings.milAvail} step={1000} onChange={(v) => setSettings({ milAvail: v })} />
            <label>월 적립 한도 (참고)</label>
            <NumInput value={settings.milCap} step={1000} onChange={(v) => setSettings({ milCap: v })} />
            <div className="row-actions"><button className="btn ghost" onClick={resetAll}>시세/조건 초기화</button></div>
          </div>
        </div>

        {/* ===== 본문 ===== */}
        <div>
          <div className="hero herox" id="hero">
            <div className="hx-main">
              <div className="hx-eyebrow">목표까지 총 실비용 · {optName} 기준</div>
              <div className="hx-num">
                {c.remain <= 0 ? "목표 달성 완료 🎉" : <CostLabel n={c.optTotal} />}
              </div>
              <div className="hx-sub">
                현재 누적 <b className="num">{won(curAch)}</b> → 목표 <b className="num">{won(goalAmt)}</b>까지{" "}
                <b className="num">{won(c.remain)}</b> 남음. 적용 충전 할인 <b>{pct(c.effD * 100)}</b>.
              </div>
              <div className="hx-chips">
                <span className="hx-chip dot">1만원 실적당 <span className="num">{won(c.optPer10k)}</span></span>
                {c.remain > 0 && (
                  <span className="hx-chip">이번 달 <CostLabel n={c.plan.totalCost} /></span>
                )}
                <span className="hx-chip">회수 후 순비용률 <span className="num">{pct(c.netRate)}</span></span>
              </div>
            </div>
            <div className="hx-ring">
              <ProgressRing pct={progPct}>
                <div className="pct">{Math.round(progPct)}%</div>
                <div className="to">목표 <b>{targetName}</b>까지</div>
              </ProgressRing>
              <div className="hx-ringcap">
                현재 <b>{MVP_GRADES[+settings.mvpGrade] || "무등급"}</b> · 최적 <b>{optName}</b>
              </div>
            </div>
          </div>

          {/* 1. 방식 비교 */}
          <div className="card" id="sec1">
            <h2><span className="n">1</span>기초 엠작 방식 비교</h2>
            <p className="desc">1만원치 실적을 쌓는 데 실제로 나가는 현금입니다. 낮을수록 이득이고, 시세가 좋으면 마이너스(=돈이 남음)도 나옵니다.</p>
            <div className="mcards">
              <div className={"mcard" + (c.giftBest ? " best" : "")}>
                <div className="mc-name">선물식</div>
                <div className="mc-val num">{won(c.gift)}</div>
                <div className="mc-sub">1만원 실적당 순현금</div>
                <div className="mc-bar"><i style={{ width: barW(c.gift) }} /></div>
                <div className="mc-delta">{c.giftBest ? "기준 · 최저" : <>메소마켓 대비 +{won(c.gift - bestBasicVal)}</>}</div>
              </div>
              <div className={"mcard" + (!c.giftBest ? " best" : "")}>
                <div className="mc-name">메소마켓</div>
                <div className="mc-val num">{won(c.market)}</div>
                <div className="mc-sub">1만원 실적당 순현금</div>
                <div className="mc-bar"><i style={{ width: barW(c.market) }} /></div>
                <div className="mc-delta">{!c.giftBest ? "기준 · 최저" : <>선물식 대비 +{won(c.market - bestBasicVal)}</>}</div>
              </div>
            </div>
            <div className="note">
              현재 시세에서 <b>{basicName}</b>이 1만원당 {won(Math.abs(c.gift - c.market))} 더 쌉니다.
              적용 충전 할인 <b>{pct(c.effD * 100)}</b>, 최적 순비용률 <b>{pct(c.netRate)}</b>{c.netRate < 0 ? " (이득!)" : ""}.
            </div>
          </div>

          {/* 2. 목표 총비용 */}
          <div className="card" id="sec2">
            <h2><span className="n">2</span>목표 등급까지 총비용 (기초 방식)</h2>
            <p className="desc">지금 누적에서 목표 등급까지 채우는 데 최소 얼마가 드는지 봅니다.</p>

            {/* 현재 누적 실적을 어디서 가져올지. 이 선택 하나가 히어로의 진행률 링과 아래 모든 비용을 좌우한다.
                예전에는 '직접 입력'만 있었고 기본값이 0이라, 실제로는 다이아인 사람도 링이 0% 로 보였다. */}
            <div className="curmode">
              <div className="calmodes" role="group" aria-label="현재 누적 실적 기준">
                <button className={"calmode" + (!fromLedger ? " on" : "")}
                  aria-pressed={!fromLedger} onClick={() => setSettings({ curSource: "manual" })}>
                  직접 입력
                </button>
                <button className={"calmode" + (fromLedger ? " on" : "")}
                  aria-pressed={fromLedger} onClick={() => setSettings({ curSource: "ledger" })}>
                  내 기록 사용
                </button>
              </div>
              <span className="hint curmode-hint">
                {fromLedger
                  ? <>거래 기록에 쌓인 <b>최근 13주 누적 {won(ledgerCum)}</b>을 실적으로 쓰고 있습니다.</>
                  : hasLedger
                    ? <>넣은 숫자로 계산합니다. 참고로 거래 기록 기준 누적은 <b>{won(ledgerCum)}</b>입니다.</>
                    : <>넣은 숫자로 계산합니다. 거래 기록을 쌓으면 실제 누적을 불러올 수 있습니다.</>}
              </span>
            </div>

            <div className="formgrid">
              <div>
                <label>목표 등급</label>
                <CSelect value={settings.tierSel} options={tierOptions}
                  onChange={(v) => setSettings({ tierSel: v, tierAmt: (tiers[+v] || tiers[tiers.length - 1]).amt })} />
              </div>
              <div><label>목표 기준 금액 (원)</label><NumInput value={settings.tierAmt} step={10000} onChange={(v) => setSettings({ tierAmt: v })} /></div>
              <div>
                <label>현재 누적 실적 (원)</label>
                {/* '내 기록' 모드에서는 원장이 진실이라 편집할 것이 없다. 직접 입력값은 지우지 않고 보존한다 —
                    '직접 입력'으로 되돌리면 예전에 넣어 둔 값이 그대로 돌아온다. */}
                {fromLedger
                  ? <div className="readnum num" aria-readonly="true">{won(ledgerCum)}</div>
                  : <NumInput value={settings.curAchieved} step={10000} onChange={(v) => setSettings({ curAchieved: v })} />}
              </div>
              <div><label>분할 방식</label><CSelect value={settings.months} onChange={(v) => setSettings({ months: v })} options={splitOptions} /></div>
            </div>
            <div className="kpi">
              <KpiBox title="남은 실적">{won(c.remain)}</KpiBox>
              <KpiBox title="최소 실비용 (기초 최적)" best><CostLabel n={c.bestTotal} /></KpiBox>
              <KpiBox title="평균 충전 할인">{pct(c.effD * 100)}</KpiBox>
            </div>
            {installRows(c.bestTotal)}
            <div className="note">
              {c.remain <= 0 ? "이미 목표 실적을 달성했습니다. 🎉" : (
                <>
                  남은 <b>{won(c.remain)}</b>을 <b className="muted">{basicName}</b>으로 채우면 실제 지출 <CostLabel n={c.bestTotal} />.
                  {c.installments > 1 && <><br />· 분할: {c.installments}회, 회당 {won(c.remain / c.installments)} 충전</>}
                  {c.alloc.breakdown.length > 0 && <><br />· 충전 배분: {c.alloc.breakdown.map((b) => `${b.name} ${won(b.use)}(${b.rate}%)`).join(", ")}</>}
                  {c.alloc.leftover > 0 && <><br />· 한도 초과 {won(c.alloc.leftover)}은 정가 충전</>}
                </>
              )}
            </div>
          </div>

          {/* 3. 경매장 되팔기 */}
          <div className="card" id="sec3">
            <h2><span className="n">3</span>경매장 캐시템 되팔기 분석</h2>
            <p className="desc">캐시템을 사서 경매장에 되파는 방식입니다. 얼마에 팔아야 본전인지, 실제로 얼마가 돌아오는지 아이템별로 비교합니다.</p>
            <div className="hint" style={{ marginBottom: 12 }}>
              억당 회수 현금(수수료 {c.feePct}% 반영): <b>{won(1e8 * (1 - c.f) * c.s)}</b> / 1억 메소
            </div>
            {/* 기본 목록이 20종을 넘어 한 줄에 다 깔면 아무것도 찾을 수 없다 → 카테고리 필터로 접는다.
                비어 있는 카테고리는 탭 자체를 감춘다(목록을 커스터마이즈한 사용자에게 죽은 탭을 보이지 않게). */}
            <div className="presetbar">
              <span className="pblabel">자주 쓰는 아이템</span>
              <div className="catpills" role="tablist" aria-label="아이템 카테고리">
                <button role="tab" aria-selected={activeCat === "all"}
                  className={"catpill" + (activeCat === "all" ? " on" : "")} onClick={() => setCat("all")}>
                  전체 <span className="cnt">{listItems.length}</span>
                </button>
                {shownCats.map((k) => (
                  <button key={k.id} role="tab" aria-selected={activeCat === k.id}
                    className={"catpill" + (activeCat === k.id ? " on" : "")} onClick={() => setCat(k.id)}>
                    {k.label} <span className="cnt">{k.n}</span>
                  </button>
                ))}
              </div>
              <button className="btn ghost sm" onClick={() => setEditorOpen(!editorOpen)}>목록 편집</button>
            </div>
            <div className="chips itemchips">
              {shownItems.map((p) => (
                <span key={p._k} className={"chip" + (p.source === "user" ? " mine" : "")}
                  title={p.source === "user" ? (p.overrides ? "기본 아이템을 수정한 내 아이템" : "내가 추가한 아이템") : "기본 아이템"}
                  onClick={() => addItem({ name: p.name, cash: p.cash, sell: "", mAllowed: p.mAllowed !== false, mil: p.mAllowed !== false })}>
                  <IconView icon={p.icon} />{p.name || "(무명)"}{" "}
                  <span className="fx">{p.cash ? (+p.cash).toLocaleString() + "원" : ""}{p.mAllowed === false ? " · 마일불가" : ""}</span>
                  {p.source === "user" && <span className="own">{p.overrides ? "수정됨" : "내 것"}</span>}
                </span>
              ))}
              {!shownItems.length && <span className="hint">이 분류에 표시할 아이템이 없습니다.</span>}
            </div>
            {editorOpen && (
              <div className="editor">
                <div className="hint" style={{ marginBottom: 10 }}>
                  <b>기본</b> 아이템은 모두에게 제공되는 목록이라 직접 고칠 수 없습니다. 값을 바꾸면 <b>내 아이템</b>으로 복사본이 생기고,
                  이 계정에서는 그 복사본이 기본 아이템을 대신합니다. 안 쓰는 건 숨길 수 있고, 언제든 되돌릴 수 있습니다.
                </div>
                <table className="itemedit">
                  {/* 열 너비 고정. 기본 행은 텍스트, 내 아이템 행은 입력 컨트롤이라 열 너비를 자동으로 두면
                      같은 열이 행마다 다른 폭을 요구해 칸 크기가 들쭉날쭉해진다. */}
                  <colgroup>
                    <col style={{ width: "16%" }} /><col style={{ width: "24%" }} /><col style={{ width: "15%" }} />
                    <col style={{ width: "13%" }} /><col style={{ width: "9%" }} /><col style={{ width: "10%" }} />
                    <col style={{ width: "13%" }} />
                  </colgroup>
                  <thead><tr><th>아이콘</th><th>이름</th><th>분류</th><th>캐시가(원)</th><th className="milh">마일가능</th><th>구분</th><th></th></tr></thead>
                  <tbody>
                    {listItems.map((it) => {
                      const mine = it.source === "user";
                      // 아이콘은 행마다 **한 번만** 보여준다.
                      // 이모지는 입력칸 안에서 그대로 이모지로 보이므로 옆에 미리보기를 또 그리면 같은 그림이 두 개가 된다.
                      // 미리보기는 입력칸에 원문(긴 URL)만 보이는 이미지 아이콘일 때만 붙인다.
                      // 아이콘 값은 app_config(DB)/클라우드에서 오므로 문자열이 아닐 수 있다(객체·숫자).
                      // IconView 는 그걸 막지만, 여기서 먼저 .trim() 을 부르면 그 방어 앞에서 렌더가 깨진다.
                      const iconText = typeof it.icon === "string" ? it.icon.trim() : "";
                      const urlIcon = isAllowedIconUrl(iconText);
                      return (
                        <tr key={it._k} className={mine ? "row-mine" : "row-base"}>
                          <td>
                            <span className="icocell">
                              {mine ? (
                                <>
                                  {/* 미리보기 칸은 이모지일 때도 자리를 비워 둔다 — 입력칸 시작점이 행마다 어긋나지 않게. */}
                                  <span className="prev">{urlIcon ? <IconView icon={iconText} /> : null}</span>
                                  <input value={iconText} placeholder="🫐/URL" onChange={(e) => setMyItem(it.id, { icon: e.target.value })} />
                                </>
                              ) : (
                                <span className="prev">{iconText ? <IconView icon={iconText} /> : <span className="ro">–</span>}</span>
                              )}
                            </span>
                          </td>
                          <td>
                            {mine
                              ? <input value={it.name || ""} onChange={(e) => setMyItem(it.id, { name: e.target.value })} />
                              : <span className="ro name-ro" title={it.name}>{it.name}</span>}
                          </td>
                          <td>
                            {mine
                              ? <CSelect value={itemCat(it.cat)} options={catOptions} onChange={(v) => setMyItem(it.id, { cat: v })} />
                              : <span className="ro">{(ITEM_CATS.find((k) => k.id === itemCat(it.cat)) || {}).label}</span>}
                          </td>
                          <td>
                            {mine
                              ? <NumInput noStepper step={100} value={it.cash || ""} onChange={(v) => setMyItem(it.id, { cash: v })} />
                              : <span className="ro num">{it.cash ? (+it.cash).toLocaleString() : "–"}</span>}
                          </td>
                          <td className="mil-cell">
                            {mine
                              ? <input type="checkbox" checked={it.mAllowed !== false} onChange={(e) => setMyItem(it.id, { mAllowed: e.target.checked })} />
                              : <span className="ro">{it.mAllowed === false ? "불가" : "가능"}</span>}
                          </td>
                          <td>
                            {mine
                              ? <span className={"tag " + (it.overrides ? "edited" : "own")}>{it.overrides ? "수정됨" : "내 아이템"}</span>
                              : <span className="tag base">기본</span>}
                          </td>
                          <td className="rowbtns">
                            {/* 플렉스는 td 가 아니라 안쪽 래퍼에 준다 — td 를 flex 로 만들면 표 셀 박스에서 빠져
                                행 밑줄이 이 칸 앞에서 끊긴다. */}
                            <div className="btns">
                              {/* 수정본이면 '되돌리기'(그 행을 지우면 카탈로그 원본이 다시 보인다), 내가 만든 것이면 '삭제'. */}
                              {mine ? (
                                it.overrides
                                  ? <button className="mini" title="기본값으로 되돌리기" onClick={() => onRevertToCatalog(it.id)}>되돌리기</button>
                                  : <button className="del" title="삭제" onClick={() => delMyItem(it.id)}>×</button>
                              ) : (
                                <>
                                  <button className="mini" title="내 아이템으로 복사해서 수정" onClick={() => setEditing(it)}>수정</button>
                                  <button className="mini" title="이 목록에서 숨기기" onClick={() => onHideCatalogItem(it)}>숨기기</button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="hint" style={{ marginTop: 4 }}>
                  아이콘은 이모지(🫐)나 <b>maplestory.io</b> 의 https 이미지 주소를 넣을 수 있습니다. 다른 주소는 안전 때문에 표시하지 않습니다.
                </div>

                {hiddenItems.length > 0 && (
                  <>
                    <div className="subhead">숨긴 아이템 ({hiddenItems.length})</div>
                    <div className="chips">
                      {hiddenItems.map((h) => (
                        <span key={h._k} className="chip ghosted">
                          <IconView icon={h.icon} />{h.name}
                          <button className="mini" onClick={() => onRevertToCatalog(h.userRowId)}>다시 표시</button>
                        </span>
                      ))}
                    </div>
                  </>
                )}

                <div className="row-actions">
                  {/* 빈 이름으로 시작하므로 id 를 이름에서 유도하면 두 기기의 새 행이 같은 id 가 된다 → 여기서만 uid 를 준다.
                      (id 는 한 번 정해지면 바뀌지 않는다. 이름을 입력할 때 id 를 다시 계산하면 React key 가 바뀌어
                       입력 도중 리마운트로 포커스를 잃는다.) */}
                  <button className="btn sm" onClick={() => onAddMyItems([{ id: uid(), name: "", cash: "", mAllowed: true, icon: "", cat: "etc" }])}>+ 새 항목</button>
                  <button className="btn ghost sm" onClick={addTableRowsToList}>아래 표를 목록에 추가</button>
                </div>
              </div>
            )}
            <div className="tblx">
              <table id="itemTable">
                <thead>
                  <tr><th>아이템</th><th>캐시가격(원)</th><th>판매가(억메소)</th><th className="milh">마일리지</th><th>본전(억)</th><th>회수(현금)</th><th>손익(현금)</th><th>1만원 실적당</th><th>회수율</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const r = c.itemRows[i] || { empty: true };
                    return (
                      <tr key={it._k} className={r.win ? "win" : ""}>
                        <td><input placeholder="아이템명" value={it.name || ""} onChange={(e) => setItem(i, { name: e.target.value })} /></td>
                        <td><NumInput noStepper step={100} placeholder="예:5900" value={it.cash || ""} onChange={(v) => setItem(i, { cash: v })} /></td>
                        <td><NumInput noStepper step={0.01} placeholder="예:0.9" value={it.sell || ""} onChange={(v) => setItem(i, { sell: v })} /></td>
                        <td className="mil-cell">
                          {it.mAllowed !== false ? (
                            <input type="checkbox" checked={!!it.mil} onChange={(e) => setItem(i, { mil: e.target.checked })} />
                          ) : (
                            <span className="fx" title="마일리지 사용 불가">불가</span>
                          )}
                        </td>
                        <td className="num">{r.empty ? "–" : eok(r.breakEok)}</td>
                        <td className="num">{r.empty ? "–" : won(r.recoveredItem)}</td>
                        <td className="num">{r.empty ? "–" : <PlLabel p={r.profit} />}</td>
                        <td className="num">{r.empty ? "–" : <CostLabel n={r.perCost} />}</td>
                        <td className="num">{r.empty ? "–" : pct(r.recRate)}</td>
                        <td><button className="del" title="삭제" onClick={() => delItem(i)}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row-actions"><button className="btn" onClick={() => addItem()}>+ 빈 행 추가</button></div>
            <div className="kpi">
              <KpiBox title="합계 실적">{c.sumAch ? won(c.sumAch) : "–"}</KpiBox>
              <KpiBox title="합계 순비용">{c.sumAch ? <CostLabel n={c.sumCost} /> : "–"}</KpiBox>
              <div className="box">
                <div className="t">가장 효율적인 아이템</div>
                <div className="v" style={{ fontSize: 16 }}>
                  {c.bestName === "–" ? "–" : (
                    <>
                      {c.bestName}<br />
                      <span className="hint">
                        1만원당 {won(c.bestPer)} {isFinite(c.bestPer) && c.bestPer < c.bestBasic && <span className="good">(1·2번보다 유리)</span>}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="note">본전가보다 비싸게 팔면 이득(초록), 싸게 팔면 손해(빨강)입니다. 경매장 시세는 매일 움직이니 팔기 전에 한 번 확인하세요.</div>
          </div>

          {/* 4. 통합 최적 */}
          <div className="card" id="sec4">
            <h2><span className="n">4</span>통합 최적 총비용 (경매장 포함)</h2>
            <p className="desc">선물식, 메소마켓, 경매장 되팔기 중에서 지금 시세로 제일 싼 걸 골라 총비용을 냅니다.</p>
            <div className="kpi">
              <div className="box best"><div className="t">최적 방식</div><div className="v" style={{ fontSize: 17 }}>{optDisp}</div></div>
              <KpiBox title="1만원 실적당 단가"><CostLabel n={c.optPer10k} /></KpiBox>
              <KpiBox title="목표까지 총 실비용"><CostLabel n={c.optTotal} /></KpiBox>
            </div>
            {installRows(c.optTotal)}
            <div className="note">
              {c.remain <= 0 ? "이미 목표 실적을 달성했습니다. 🎉" : c.useItem ? (
                <>
                  <b className="good">경매장 되팔기</b> · {c.bestName}<br />
                  기초 방식보다 저렴 → 2번 대비 <span className="good">{won(c.bestTotal - c.optTotal)} 추가 절감</span><br />
                  <span className="muted">※ 되팔기·마일리지 등 현실 제약은 근사</span>
                </>
              ) : (
                <>
                  <b className="muted">{basicName}</b>이 경매장 되팔기보다 싸거나 같습니다.<br />
                  3번에 되팔 아이템을 입력하면 이 비교에 자동 반영됩니다.
                </>
              )}
            </div>
          </div>

          {/* 5. 마일리지 */}
          <div className="card" id="sec5">
            <h2><span className="n">5</span>마일리지 수급</h2>
            <p className="desc">이번 충전으로 쌓이는 마일리지와, 3번에서 마일리지로 결제하기로 한 아이템에 필요한 양입니다.</p>
            <div className="kpi">
              <KpiBox title="월 적립 (≈5%, 한도 반영)"><span className="mil"><span className="num">{mlN(c.earnPerMonth)}</span><span className="u"> 마일리지 적립</span></span></KpiBox>
              <KpiBox title="3번 마일 아이템 소요(1세트)"><MilUse n={c.milNeed} /></KpiBox>
              <KpiBox title="월 사용 가능(보유)"><span className="num">{mlN(c.milAvail)}</span><span className="u"> 마일리지</span></KpiBox>
            </div>
            <div className="note">
              {c.remain <= 0 && c.milNeed <= 0 ? "목표·아이템을 입력하면 마일리지 적립/소요가 계산됩니다." : (
                <>
                  월 넥슨캐시 사용액 {won(c.monthlyCharge)}의 약 5%를 매월 적립{c.rawMonth > c.capM ? ` (월 한도 ${ml(c.capM)} 적용)` : ""}.
                  {" "}{c.months}개월 누적 약 <b>{ml(c.earnTotal)}</b>. 3번 마일 아이템 1세트 소요 {c.milNeed > 0 ? ml(c.milNeed) : "0"}.
                </>
              )}
            </div>
          </div>

          {/* 6. 최적 플랜 */}
          <div className="card" id="sec6">
            <h2><span className="n">6</span>이번 달 최적 실행 플랜</h2>
            <p className="desc">이번 달 채울 실적을 어떤 조합으로 사는 게 제일 싼지 짜 줍니다. 마일리지는 보유량 안에서 효율 좋은 쪽에 먼저 씁니다.</p>
            <div className="tblx"><table>
              <thead><tr><th>구성 (구매/판매 방식)</th><th>채우는 실적</th><th>실비용</th><th>마일리지 소모</th></tr></thead>
              <tbody>
                {c.remain <= 0 ? (
                  <tr><td colSpan={4}>목표 실적을 이미 달성했습니다. 🎉</td></tr>
                ) : (
                  c.plan.steps.map((st, i) => (
                    <tr key={i}>
                      <td>{st.label}</td>
                      <td className="num">{won(st.ach)}</td>
                      <td className="num"><CostLabel n={st.cost} /></td>
                      <td className="num"><MilUse n={st.mil} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table></div>
            <div className="kpi">
              <KpiBox title="이번 달 총 실비용" best>{c.remain <= 0 ? "–" : <CostLabel n={c.plan.totalCost} />}</KpiBox>
              <KpiBox title="이번 달 마일리지 소모">{c.remain <= 0 ? "–" : <MilUse n={c.plan.milUsed} />}</KpiBox>
              <KpiBox title="전체(개월 합산) 실비용">{c.remain <= 0 ? "–" : <CostLabel n={c.plan.totalCost * c.months} />}</KpiBox>
            </div>
            {c.remain > 0 && (
              <div className="note">
                이번 달 목표 실적 <b>{won(c.monthlyAch)}</b> · 실비용 <CostLabel n={c.plan.totalCost} /> · 마일리지 <MilUse n={c.plan.milUsed} />.
                {c.plan.milUsed >= c.milAvail - 1 && c.plan.steps.some((x) => x.mil > 0) && <><br />· 마일리지 월 한도를 모두 사용했습니다.</>}
                <br />· 전체 {c.months}개월 누적 실비용 약 {won(c.plan.totalCost * c.months)}.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 기본 아이템 수정 = '내 아이템으로 복사' 안내를 거친다. 카탈로그는 운영자 소유라 직접 못 고친다. */}
      {editing && (
        <ItemEditModal
          item={editing}
          onCancel={() => setEditing(null)}
          onConfirm={(row) => { onOverrideCatalogItem(row); setEditing(null); }}
        />
      )}
    </div>
  );
}
