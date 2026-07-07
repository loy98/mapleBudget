import { useState } from "react";
import { TIERS, CHARGE_METHODS, MVP_GRADES, SPLITS, DEFAULT_ITEMS, DEFAULT_SETTINGS } from "../lib/constants.js";
import { won, pct, eok, ml, mlN } from "../lib/util.js";
import { NumInput, CSelect, KpiBox, CostLabel, PlLabel, MilUse, IconView, ProgressRing } from "./ui.jsx";

const tierOptions = TIERS.map((t, i) => ({ value: i, label: `${t.name} (${(t.amt / 10000).toLocaleString()}만원)` }));
const gradeOptions = MVP_GRADES.map((g, i) => ({ value: i, label: g }));
const splitOptions = SPLITS.map((s, i) => ({ value: i, label: s.label }));

export default function CalcTab({ settings, setSettings, charges, setCharges, items, setItems, myItems, setMyItems, chargeMethods = CHARGE_METHODS, calc }) {
  const [preset, setPreset] = useState("0");
  const [editorOpen, setEditorOpen] = useState(false);
  // 충전 방식 프리셋 옵션 — DB 설정 목록(chargeMethods) 기반. DB에 malformed/null 원소가 섞여도
  // 안전하도록 name 있는 원소만 사용(옵션·addPreset이 같은 목록을 써 인덱스 정합 유지). 기본은 constants.
  const validCharges = (chargeMethods || []).filter((m) => m && typeof m.name === "string");
  const presetOptions = validCharges.map((m, i) => ({ value: i, label: m.name + (m.rate ? ` (${m.rate}%)` : "") }));

  const c = calc;
  const feeBenefit = +settings.mvpGrade >= 1 || settings.pcRoom === "1";
  const basicName = c.giftBest ? "선물식" : "메소마켓";

  // ----- 히어로/방식비교 파생값 -----
  const goalAmt = +settings.tierAmt || 0;
  const curAch = +settings.curAchieved || 0;
  const progPct = c.remain <= 0 ? 100 : goalAmt > 0 ? Math.min(100, (curAch / goalAmt) * 100) : 0;
  const targetName = (TIERS[+settings.tierSel] || {}).name || "목표";
  const optName = c.useItem ? "경매장 되팔기" : basicName;
  const maxBasic = Math.max(c.gift, c.market) || 1;
  const bestBasicVal = Math.min(c.gift, c.market);
  const barW = (v) => Math.round((v / maxBasic) * 100) + "%";

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
  const setMyItem = (i, patch) => setMyItems(myItems.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const delMyItem = (i) => setMyItems(myItems.filter((_, j) => j !== i));
  const addTableRowsToList = () => {
    const add = items.filter(
      (r) => r.name && r.name.trim() && !myItems.some((m) => m.name === r.name && "" + m.cash === "" + r.cash)
    );
    if (add.length) setMyItems([...myItems, ...add.map((r) => ({ name: r.name, cash: +r.cash, mAllowed: r.mAllowed !== false }))]);
  };

  const resetAll = () => {
    setSettings({ ...DEFAULT_SETTINGS, tierSel: settings.tierSel, tierAmt: settings.tierAmt, curAchieved: settings.curAchieved, months: settings.months });
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
            <h2><span className="n">＊</span>시세 &amp; 조건</h2>
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
            <div className="hint">할인율 높은 방식부터 한도만큼 배분. 한도 0=무제한.</div>

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
            <label>마일리지 결제 비율 (%)</label>
            <NumInput value={settings.mileageRate} step={1} onChange={(v) => setSettings({ mileageRate: v })} />
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
            <p className="desc">1만원 실적을 쌓는 데 드는 실제 현금 비용(회수 후 순비용). 낮을수록 이득.</p>
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
            <p className="desc">현재 13주 누적 실적에서 목표 등급까지 채우는 최소 실비용.</p>
            <div className="formgrid">
              <div>
                <label>목표 등급</label>
                <CSelect value={settings.tierSel} options={tierOptions}
                  onChange={(v) => setSettings({ tierSel: v, tierAmt: TIERS[+v].amt })} />
              </div>
              <div><label>목표 기준 금액 (원)</label><NumInput value={settings.tierAmt} step={10000} onChange={(v) => setSettings({ tierAmt: v })} /></div>
              <div><label>현재 누적 실적 (원)</label><NumInput value={settings.curAchieved} step={10000} onChange={(v) => setSettings({ curAchieved: v })} /></div>
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
            <p className="desc">판매 가능한 캐시 아이템을 사서 경매장에 되파는 방식. 본전가·회수현금·손익·효율 비교.</p>
            <div className="hint" style={{ marginBottom: 12 }}>
              억당 회수 현금(수수료 {c.feePct}% 반영): <b>{won(1e8 * (1 - c.f) * c.s)}</b> / 1억 메소
            </div>
            <div className="presetbar">
              <span className="pblabel">자주 쓰는 아이템</span>
              <div className="chips">
                {myItems.map((p, i) => (
                  <span key={p._k} className="chip"
                    onClick={() => addItem({ name: p.name, cash: p.cash, sell: "", mAllowed: p.mAllowed !== false, mil: p.mAllowed !== false })}>
                    <IconView icon={p.icon} />{p.name || "(무명)"}{" "}
                    <span className="fx">{p.cash ? (+p.cash).toLocaleString() + "원" : ""}{p.mAllowed === false ? " · 마일불가" : ""}</span>
                  </span>
                ))}
              </div>
              <button className="btn ghost sm" onClick={() => setEditorOpen(!editorOpen)}>목록 편집</button>
            </div>
            {editorOpen && (
              <div className="editor">
                <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 8 }}>
                  자주 쓰는 아이템 목록 편집. 마일리지 사용 가능 여부도 설정. (자동 저장)
                </div>
                <table>
                  <thead><tr><th>아이콘</th><th>이름</th><th>캐시가(원)</th><th className="milh">마일가능</th><th></th></tr></thead>
                  <tbody>
                    {myItems.map((it, i) => (
                      <tr key={it._k}>
                        <td>
                          <span className="prev"><IconView icon={it.icon} /></span>{" "}
                          <input value={it.icon || ""} style={{ width: 64 }} placeholder="🫐/URL" onChange={(e) => setMyItem(i, { icon: e.target.value })} />
                        </td>
                        <td><input value={it.name || ""} onChange={(e) => setMyItem(i, { name: e.target.value })} /></td>
                        <td><NumInput noStepper width={100} step={100} value={it.cash || ""} onChange={(v) => setMyItem(i, { cash: v })} /></td>
                        <td className="mil-cell"><input type="checkbox" checked={it.mAllowed !== false} onChange={(e) => setMyItem(i, { mAllowed: e.target.checked })} /></td>
                        <td><button className="del" onClick={() => delMyItem(i)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="hint" style={{ marginTop: 4 }}>
                  아이콘은 이모지(🫐) 또는 이미지 URL을 넣을 수 있어요. 실제 메이플 아이콘 URL(예: maplestory.io)을 붙여넣으면 그대로 표시됩니다.
                </div>
                <div className="row-actions">
                  <button className="btn sm" onClick={() => setMyItems([...myItems, { name: "", cash: "", mAllowed: true, icon: "" }])}>+ 새 항목</button>
                  <button className="btn ghost sm" onClick={addTableRowsToList}>아래 표를 목록에 추가</button>
                  <button className="btn ghost sm" onClick={() => setMyItems(DEFAULT_ITEMS.map((x) => ({ ...x })))}>기본 목록 복원</button>
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
            <div className="note">본전가보다 높게 팔면 이득(초록), 낮으면 손해(빨강).</div>
          </div>

          {/* 4. 통합 최적 */}
          <div className="card" id="sec4">
            <h2><span className="n">4</span>통합 최적 총비용 (경매장 포함)</h2>
            <p className="desc">선물식·메소마켓·경매장 되팔기 중 실제로 가장 싼 방식으로 총 실비용 계산.</p>
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
            <p className="desc">이번 엠작 충전으로 쌓이는 마일리지와 3번 아이템 필요 마일리지.</p>
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
            <p className="desc">이번 달 채울 실적을 가장 싼 구성으로 제시. 마일리지는 '월 사용 가능' 한도 내 우선 배정.</p>
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
    </div>
  );
}
