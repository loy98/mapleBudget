import { won, todayStr, uid } from "../../lib/util.js";
import { cashWonOf } from "../../lib/ledger.js";
import { DateInput, ItemCombo, NumInput } from "../ui.jsx";

export const EMPTY_DRAFT = { buys: [], sells: [], cashes: [], spends: [] };

// ===== 거래 입력 (드래프트) =====
// 원장 커밋까지 자기 안에서 끝내는 독립 유닛이라 ledger/setLedger 를 직접 받는다.
export default function EntryForm({ draft, setDraft, entryDate, setEntryDate, myItems, soldNames, onCommit, ledger, setLedger }) {
  const upd = (kind, i, patch) =>
    setDraft({ ...draft, [kind]: draft[kind].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const del = (kind, i) => setDraft({ ...draft, [kind]: draft[kind].filter((_, j) => j !== i) });
  const add = (kind, base) => setDraft({ ...draft, [kind]: [...draft[kind], { ...base, _k: uid() }] });

  const commit = () => {
    const date = entryDate || todayStr();
    let n = 0;
    const next = { ...ledger };
    const buys = draft.buys.filter((x) => x.item || x.price);
    const sells = draft.sells.filter((x) => x.item || x.meso);
    const cashes = draft.cashes.filter((x) => x.meso || x.rate);
    const spends = draft.spends.filter((x) => x.amount);
    n = buys.length + sells.length + cashes.length + spends.length;
    if (n === 0) { alert("입력된 항목이 없습니다."); return; }
    next.buys = [...ledger.buys, ...buys.map((x) => ({ id: uid(), date, item: x.item, qty: x.qty, price: x.price, mil: x.mil }))];
    next.sells = [...ledger.sells, ...sells.map((x) => ({ id: uid(), date, item: x.item, qty: x.qty, meso: x.meso }))];
    next.cashes = [...ledger.cashes, ...cashes.map((x) => ({ id: uid(), date, meso: x.meso, rate: x.rate }))];
    next.spends = [...ledger.spends, ...spends.map((x) => ({ id: uid(), date, amount: x.amount, memo: x.memo }))];
    setLedger(next);
    setDraft(EMPTY_DRAFT);
    onCommit(n, date);
  };

  return (
    <div className="card">
      <h2><span className="n">✎</span>새 거래 입력</h2>
      <p className="desc">한 날짜의 거래를 입력하고 저장하면 달력의 해당 날짜에 기록됩니다. 저장 후 수정·삭제는 '달력 &amp; 통계'에서 날짜를 눌러서 하세요.</p>
      <label style={{ maxWidth: 220 }}>날짜</label>
      <DateInput value={entryDate} width={220} onChange={setEntryDate} />

      <div className="draftblock" style={{ marginTop: 12 }}>
        <div className="bt">🛒 구매 (아이템 → 캐시 사용)</div>
        <div className="tblx"><table>
          <thead><tr><th>아이템</th><th>수량</th><th>개당 캐시가(원)</th><th className="milh">마일</th><th></th></tr></thead>
          <tbody>
            {draft.buys.map((x, i) => (
              <tr key={x._k}>
                <td><ItemCombo value={x.item || ""} options={myItems} onChange={(name) => {
                  const mi = myItems.find((m) => m.name === name);
                  upd("buys", i, mi && !x.price ? { item: name, price: +mi.cash } : { item: name });
                }} /></td>
                <td><NumInput noStepper width={54} value={x.qty != null ? x.qty : 1} onChange={(v) => upd("buys", i, { qty: v })} /></td>
                <td><NumInput noStepper width={88} value={x.price != null ? x.price : ""} onChange={(v) => upd("buys", i, { price: v })} /></td>
                <td className="mil-cell"><input type="checkbox" checked={!!x.mil} onChange={(e) => upd("buys", i, { mil: e.target.checked })} /></td>
                <td><button className="del" onClick={() => del("buys", i)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="row-actions"><button className="btn sm" onClick={() => add("buys", { item: "", qty: 1, price: "", mil: false })}>+ 구매 항목</button></div>
      </div>

      <div className="draftblock">
        <div className="bt">💰 판매 (경매장 → 메소)</div>
        <div className="tblx"><table>
          <thead><tr><th>아이템</th><th>수량</th><th>개당 판매가(억)</th><th></th></tr></thead>
          <tbody>
            {draft.sells.map((x, i) => (
              <tr key={x._k}>
                <td><ItemCombo value={x.item || ""} options={soldNames} onChange={(v) => upd("sells", i, { item: v })} /></td>
                <td><NumInput noStepper width={54} value={x.qty != null ? x.qty : 1} onChange={(v) => upd("sells", i, { qty: v })} /></td>
                <td><NumInput noStepper width={88} step={0.01} value={x.meso != null ? x.meso : ""} onChange={(v) => upd("sells", i, { meso: v })} /></td>
                <td><button className="del" onClick={() => del("sells", i)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="row-actions"><button className="btn sm" onClick={() => add("sells", { item: "", qty: 1, meso: "" })}>+ 판매 항목</button></div>
      </div>

      <div className="draftblock">
        <div className="bt">🏦 현금화 (메소 → 현금)</div>
        <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 8 }}>
          현금화한 메소(억)와 억당 판매 비율(원/억)을 입력하면 판매 현금이 자동 계산됩니다.
        </div>
        <div className="tblx"><table>
          <thead><tr><th>메소(억)</th><th>억당(원)</th><th>판매 현금(자동)</th><th></th></tr></thead>
          <tbody>
            {draft.cashes.map((x, i) => (
              <tr key={x._k}>
                <td><NumInput noStepper width={88} step={0.01} value={x.meso != null ? x.meso : ""} onChange={(v) => upd("cashes", i, { meso: v })} /></td>
                <td><NumInput noStepper width={110} step={1000} value={x.rate != null ? x.rate : ""} onChange={(v) => upd("cashes", i, { rate: v })} /></td>
                <td className="num">{x.meso && x.rate ? won(cashWonOf(x)) : "–"}</td>
                <td><button className="del" onClick={() => del("cashes", i)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="row-actions"><button className="btn sm" onClick={() => add("cashes", { meso: "", rate: "" })}>+ 현금화 항목</button></div>
      </div>

      <div className="draftblock">
        <div className="bt">💳 기타 캐시 사용 (엠작 외 · MVP 과금에 포함)</div>
        <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 8 }}>
          충전은 많이 했어도 엠작 외 다른 데 쓴 넥슨캐시. 사용액이 MVP 과금(실적)에 잡히므로 여기에 기입하면 주차별 과금이 정확해집니다.
        </div>
        <div className="tblx"><table>
          <thead><tr><th>사용액(원)</th><th>메모</th><th></th></tr></thead>
          <tbody>
            {draft.spends.map((x, i) => (
              <tr key={x._k}>
                <td><NumInput noStepper width={110} step={1000} value={x.amount != null ? x.amount : ""} onChange={(v) => upd("spends", i, { amount: v })} /></td>
                <td><input value={x.memo || ""} onChange={(e) => upd("spends", i, { memo: e.target.value })} /></td>
                <td><button className="del" onClick={() => del("spends", i)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="row-actions"><button className="btn sm" onClick={() => add("spends", { amount: "", memo: "" })}>+ 캐시 사용</button></div>
      </div>

      <div className="row-actions" style={{ marginTop: 16 }}>
        <button className="btn big" onClick={commit}>이 날짜로 저장</button>
        <button className="btn ghost" onClick={() => setDraft(EMPTY_DRAFT)}>입력 초기화</button>
      </div>
    </div>
  );
}
