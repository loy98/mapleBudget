// 기본(카탈로그) 아이템 수정 안내 + 편집. 모듈 스코프 컴포넌트(렌더 함수 안에 정의하면 리마운트로 포커스를 잃는다).
//
// 카탈로그는 운영자 소유라 유저가 직접 못 고친다. 대신 '내 아이템'으로 복사해서 그 사본을 고친다.
// 사본은 같은 이름이라 화면에서 원본을 가린다(items.js composeItems) → 이 유저에게만 수정본이 보인다.
import { useState } from "react";
import Modal from "./Modal.jsx";
import { NumInput, CSelect, IconView } from "./ui.jsx";
import { ITEM_CATS, itemCat } from "../lib/constants.js";

const catOptions = ITEM_CATS.map((c) => ({ value: c.id, label: c.label }));

export default function ItemEditModal({ item, onCancel, onConfirm }) {
  // 이름은 고치지 못한다. 수정본이 원본을 가리는 판정이 **이름**이기 때문이다(composeItems).
  // 이름을 바꾸면 원본 카탈로그 아이템이 그대로 남고 전혀 다른 아이템이 하나 더 생긴다 —
  // 사용자가 의도한 '이 아이템의 값을 고친다'와 결과가 어긋난다. 다른 이름이 필요하면 '+ 새 항목'을 쓴다.
  const [row, setRow] = useState(() => ({
    cash: item.cash ?? "",
    mAllowed: item.mAllowed !== false,
    icon: item.icon || "",
    cat: itemCat(item.cat),
  }));
  const set = (patch) => setRow((r) => ({ ...r, ...patch }));
  const name = item.name;

  return (
    <Modal onClose={onCancel} label="기본 아이템 수정">
      <>
        <div className="modal-title">기본 아이템은 직접 고칠 수 없어요</div>
        <p className="modal-body">
          <b>{item.name}</b> 은(는) 모두에게 제공되는 <b>기본 아이템</b>입니다.
          값을 바꾸면 <b>내 아이템으로 복사본</b>이 만들어지고, 이 브라우저·계정에서는 그 복사본이 기본 아이템을 대신합니다.
          <br />
          <span className="muted">언제든 '기본값으로 되돌리기'로 원래대로 돌아갈 수 있어요.</span>
        </p>

        <div className="itemform">
          <div>
            <label>이름 (고정)</label>
            <div className="readnum">{name}</div>
            <div className="hint">이름을 바꾸려면 '+ 새 항목'으로 따로 추가하세요.</div>
          </div>
          <div>
            <label>캐시가 (원)</label>
            <NumInput value={row.cash} step={100} onChange={(v) => set({ cash: v })} />
          </div>
          <div>
            <label>분류</label>
            <CSelect value={row.cat} options={catOptions} onChange={(v) => set({ cat: v })} />
          </div>
          <div>
            <label>아이콘</label>
            <div className="iconrow">
              <span className="prev"><IconView icon={row.icon} /></span>
              <input value={row.icon} placeholder="🫐 / https://maplestory.io/..." onChange={(e) => set({ icon: e.target.value })} />
            </div>
          </div>
          <div className="milrow">
            <label className="chk">
              <input type="checkbox" checked={row.mAllowed} onChange={(e) => set({ mAllowed: e.target.checked })} />
              마일리지 사용 가능
            </label>
            <div className="hint">랜덤박스류(원더베리·로얄 스타일 등)는 마일리지를 쓸 수 없어요.</div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={() => onConfirm({ ...row, name })}>내 아이템으로 복사</button>
          <button className="btn ghost" onClick={onCancel}>취소</button>
        </div>
      </>
    </Modal>
  );
}
