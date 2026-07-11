import { useState } from "react";
import { IconChevron } from "./icons.jsx";

// ===== 숫자 입력 (테마 스테퍼) =====
// 편집 중에는 자유롭게 지울 수 있고(완전 삭제 가능), 다 지운 채 포커스를 벗어나면 0으로,
// 다 지우고 숫자를 입력하면 그 값으로 확정된다. 값은 문자열로 전달(계산부는 +x||0로 처리).
export function NumInput({ value, onChange, step = 1, width, noStepper, placeholder }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const display = value === "" || value == null ? "" : String(value);
  const shown = focused ? draft : display;

  const emit = (raw) => {
    // 숫자·소수점만 남기고, 소수점이 여러 개면 첫 번째만 유지(둘째 점 이후 병합) →
    // "1.2.3" 같은 입력이 blur에서 NaN→0 으로 소실되는 것 방지.
    const clean = raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    setDraft(clean);
    onChange(clean);
  };
  const onBlur = () => {
    setFocused(false);
    if (draft.trim() === "" || !isFinite(+draft)) onChange(0);
  };

  const inp = (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      style={width ? { width } : undefined}
      onFocus={() => { setDraft(display); setFocused(true); }}
      onBlur={onBlur}
      onChange={(e) => emit(e.target.value)}
    />
  );
  if (noStepper || width) return inp;
  const bump = (dir) => {
    const base = +(focused ? draft : value) || 0;
    const nv = String(base + dir * step);
    setDraft(nv);
    onChange(nv);
  };
  return (
    <span className="numwrap">
      {inp}
      <span className="stepbtns">
        <button type="button" className="stbtn up" aria-label={`${step} 증가`} onClick={() => bump(1)}>
          <IconChevron className="stico" />
        </button>
        <button type="button" className="stbtn dn" aria-label={`${step} 감소`} onClick={() => bump(-1)}>
          <IconChevron className="stico" />
        </button>
      </span>
    </span>
  );
}
