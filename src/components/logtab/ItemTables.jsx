import { won, eok } from "../../lib/util.js";
import { IconView } from "../ui.jsx";

// 품목 셀 — 렌더 함수 안에서 정의하면 리마운트되므로 모듈 스코프에 둔다.
export const ItemName = ({ name, icon }) => (
  <span className="iname">
    <IconView icon={icon} />
    <span className="int">{name}</span>
  </span>
);
// 수량 셀: 0이면 '–'
export const Qty = ({ n }) => (n ? <>{n}<span className="muted u">개</span></> : <>–</>);

// 주차 확장 행의 품목 서브행. 현금화는 메소를 한꺼번에 파는 것이라 품목에 귀속되지 않으므로
// '현금화 메소'·'현금화 필요' 두 칸은 개당 평균가로 대체한다.
export const ItemSubRow = ({ r, icon, last }) => (
  <tr className={"itemrow" + (last ? " lastitem" : "")}>
    <td className="expc"></td>
    <td className="lh"><ItemName name={r.name} icon={icon} /></td>
    <td className="num qty"><Qty n={r.buyQty} /></td>
    <td className="num qty sep"><Qty n={r.sellQty} /></td>
    <td className="num">{r.sellQty ? eok(r.sold) : "–"}</td>
    <td className="num avgc" colSpan={2}>{r.sellQty ? <>개당 {eok(r.avg)}</> : "–"}</td>
  </tr>
);

// (B) 품목별 누적 요약표. rows=itemSummary 결과, iconOf=이름→아이콘, rateWon/measuredRate=손익 환산 근거.
export function ItemSummary({ rows, iconOf, rateWon, measuredRate }) {
  // itemSummary 의 profit 계산과 같은 조건으로 안내 분기(비유한 값이면 손익=null 이므로 안내도 '시세 없음').
  const hasRate = isFinite(rateWon) && rateWon > 0;
  return (
    <>
      <div className="calwrap">
        <table>
          <thead>
            <tr>
              <th className="lh">품목</th>
              <th className="qh">구매</th><th className="qh sep">판매</th>
              <th>개당 평균가</th><th>추정 손익</th><th>재고</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className="lh muted" colSpan={6}>이 기간에 구매·판매 기록이 없어요.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="lh"><ItemName name={r.name} icon={iconOf[r.name]} /></td>
                <td className="num qty"><Qty n={r.buyQty} /></td>
                <td className="num qty sep"><Qty n={r.sellQty} /></td>
                <td className="num">{r.sellQty ? eok(r.avg) : "–"}</td>
                <td className="num">
                  {r.profit == null
                    ? "–"
                    : <span className={r.profit >= 0 ? "good" : "bad"}>{won(Math.abs(r.profit))} {r.profit >= 0 ? "이득" : "손해"}</span>}
                </td>
                <td className={"num qty" + (r.stock > 0 ? " stock" : r.stock < 0 ? " bad" : "")}>
                  {r.stock ? <>{r.stock}<span className="muted u">개</span></> : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ marginTop: 4 }}>
        구매·판매·평균가는 <b>선택한 기간</b> 기준, <b>재고</b>는 산 주와 판 주가 다를 수 있어 <b>전체 기간 누적</b>(구매−판매)으로 셉니다.
        '추정 손익'은 판매 실수령 메소를{" "}
        {hasRate
          ? <>억당 {won(rateWon)}({measuredRate ? "이 기간 실제 현금화 평균" : "계산기 시세"})으로 환산해 구매 실지출을 뺀 값이에요. 현금화는 메소를 한꺼번에 파는 것이라 품목별로 정확히 나눌 수 없어 <b>추정치</b>입니다.</>
          : <>환산할 억당 시세가 없어 계산할 수 없어요. 계산기 탭에서 메소 시세를 입력해 주세요.</>}
      </div>
    </>
  );
}
