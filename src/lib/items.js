import { DEFAULT_ITEMS, itemCat } from "./constants.js";

// ============================================================
// 카탈로그(운영자) / 내 아이템(유저) 분리
//
// 예전에는 둘이 **한 배열**(user_data.my_items)에 섞여 있었다. 그래서 운영자가 기본값을 고치려면
// 유저 배열을 통째로 덮어쓰는 수밖에 없었고(app_config.force), 그 순간 유저가 직접 추가한 아이템이
// **삭제 표식도 없이** 사라졌다. 실제로 한 번 사고가 났다.
//
// 이제 소유자가 다르면 저장소도 다르다:
//   · 카탈로그 = app_config.defaultItems  — 운영자 소유. 유저 데이터에 복사하지 않는다.
//                가격을 고치거나 아이템을 넣고 빼도 전원에게 즉시 반영된다(재배포·force 불필요).
//   · 내 아이템 = user_data.my_items      — 유저 소유. 운영자는 절대 건드리지 않는다.
//
// **동기화 로직은 한 줄도 바뀌지 않는다.** 숨김도 수정본도 전부 my_items 의 '행'으로 표현하므로
// 기존의 합집합 병합 + 삭제 표식 + `at` 순서 규칙이 그대로 적용된다(cloud.js mergeMyItems).
//
// my_items 행의 확장 필드:
//   origin: "user"  — 이 행은 유저가 만든 것이다. **마이그레이션이 지우지 않는다**(아래 참고).
//   hidden: true    — 같은 이름의 카탈로그 아이템을 이 유저에게만 감춘다. 칩으로 그리지 않는다.
//                     숨김 해제 = 이 행을 삭제(deleteMyItem) → 카탈로그 아이템이 다시 보인다.
//
// 아이템의 정체성은 **이름**이다(id 도 이름에서 유도한다). 그래서 카탈로그와 my_items 를 이름으로 맞춘다.
// ============================================================

const isRow = (x) => !!x && typeof x === "object" && !Array.isArray(x) && typeof x.name === "string";

// DB(app_config)에서 온 카탈로그는 신뢰하지 않는다. malformed 원소 하나가 렌더를 통째로 깨뜨릴 수 있다.
// 이름 없는 원소는 버리고, cat 은 아는 값만 통과시킨다(itemCat).
export function validCatalog(catalog) {
  const rows = Array.isArray(catalog) && catalog.length ? catalog : DEFAULT_ITEMS;
  return rows.filter(isRow).map((c) => ({ ...c, cat: itemCat(c.cat) }));
}

// 화면에 그릴 목록을 만든다. 카탈로그를 깔고, 같은 이름의 내 아이템이 있으면 그것으로 덮는다.
//
// 반환:
//   items  — 칩·표에 그릴 목록. 각 원소에 표시용 메타가 붙는다:
//              source: "catalog" | "user"
//              overrides: true   → 같은 이름의 카탈로그 아이템을 가리고 있는 수정본
//              base              → 그 원본 카탈로그 아이템(되돌리기·비교용)
//   hidden — 이 유저가 숨긴 목록(숨김 관리 UI 용). userRowId = 숨김을 만든 my_items 행의 id(해제에 필요).
export function composeItems(catalog, myItems) {
  const cat = validCatalog(catalog);
  const mine = (myItems || []).filter(isRow);

  // 같은 이름의 내 아이템이 여럿이면 뒤엣것이 이긴다(id 는 달라도 화면엔 하나만 보여야 한다).
  const byName = new Map();
  mine.forEach((r) => byName.set(r.name, r));

  const items = [];
  const hidden = [];
  const catNames = new Set();

  cat.forEach((c) => {
    catNames.add(c.name);
    const u = byName.get(c.name);
    if (!u) {
      items.push({ ...c, _k: "cat:" + c.name, source: "catalog", overrides: false, base: null });
      return;
    }
    if (u.hidden) {
      hidden.push({ ...c, _k: "hid:" + c.name, source: "catalog", userRowId: u.id });
      return;
    }
    items.push({ ...u, source: "user", overrides: true, base: c });
  });

  mine.forEach((u) => {
    if (catNames.has(u.name)) return; // 위 루프에서 이미 처리했다
    if (u.hidden) {
      hidden.push({ ...u, source: "user", userRowId: u.id });
      return;
    }
    items.push({ ...u, source: "user", overrides: false, base: null });
  });

  return { items, hidden };
}

// 카탈로그 아이템과 내 수정본이 실제로 다른 값인가(되돌리기 버튼을 보여줄지 판단).
// 이름은 같다는 전제(그래서 매칭된 것이다) — 나머지 필드만 본다.
export function differsFromBase(row, base) {
  if (!base) return false;
  return (
    +row.cash !== +base.cash ||
    row.mAllowed !== false !== (base.mAllowed !== false) ||
    itemCat(row.cat) !== itemCat(base.cat) ||
    (row.icon || "") !== (base.icon || "")
  );
}

// ===== 구 데이터 마이그레이션 =====
// 예전 my_items 에는 기본 아이템의 **복사본**이 그대로 들어 있다(운영자가 force 로 밀어 넣었으니까).
// 그걸 남겨 두면 나중에 운영자가 카탈로그 가격을 고쳐도 이 유저는 옛 복사본을 계속 보게 된다.
// → 이름이 카탈로그에 있는 복사본은 지운다. 카탈로그가 그 자리를 대신 채운다.
//
// **`origin: "user"` 가 붙은 행은 절대 지우지 않는다.** 이 표식이 없으면, 유저가 나중에 만든
// 수정본(= 카탈로그와 같은 이름을 갖는 것이 정상이다)까지 다음 로드에서 지워 버린다 —
// 수정 기능 자체가 성립하지 않는다.
//
// 카탈로그에 없는 이름(= 진짜 커스텀 아이템)은 살리되 `origin: "user"` 를 찍어 준다.
// 그래야 나중에 운영자가 같은 이름을 카탈로그에 추가해도 그 유저의 아이템이 사라지지 않는다.
//
// 이 함수는 **멱등**이다: 한 번 돌고 나면 남은 행은 전부 origin:"user" 라서 다음 호출은 아무것도 하지 않는다.
export function planItemMigration(myItems, catalog) {
  const names = new Set(validCatalog(catalog).map((c) => c.name));
  const rows = (myItems || []).filter(isRow);

  const removeIds = []; // 삭제 표식을 남길 id (다른 기기의 복사본까지 정리된다)
  const stamp = [];     // origin 을 찍어 줄 행

  rows.forEach((r) => {
    if (r.origin === "user") return;    // 유저가 만든 것 — 손대지 않는다
    if (names.has(r.name)) removeIds.push(r.id);
    else stamp.push(r);
  });

  return { removeIds, stampIds: stamp.map((r) => r.id), changed: removeIds.length > 0 || stamp.length > 0 };
}

// 마이그레이션 결과를 my_items 에 적용한다(삭제는 호출측이 deleteMyItem 으로 표식을 남긴다).
export function applyItemStamps(myItems, stampIds) {
  if (!stampIds || !stampIds.length) return myItems;
  const set = new Set(stampIds);
  return (myItems || []).map((r) => (isRow(r) && set.has(r.id) ? { ...r, origin: "user" } : r));
}
