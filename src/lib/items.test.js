import { describe, it, expect } from "vitest";
import { composeItems, validCatalog, planItemMigration, applyItemStamps, differsFromBase } from "./items.js";
import { canonicalizeMyItems, deleteMyItem, addMyItems } from "./storage.js";
import { mergeMyItems } from "./cloud.js";
import { DEFAULT_ITEMS } from "./constants.js";

const CAT = [
  { name: "원더베리", cash: 5400, mAllowed: false, icon: "🫐", cat: "pet" },
  { name: "플래티넘 카르마의 가위", cash: 5900, mAllowed: true, icon: "✂️", cat: "karma" },
];

describe("validCatalog — DB에서 온 카탈로그를 믿지 않는다", () => {
  it("malformed 원소를 걸러내고 모르는 cat 은 기타로 떨어뜨린다", () => {
    const out = validCatalog([
      { name: "정상", cash: 100, cat: "pet" },
      { name: "이상한분류", cash: 200, cat: "__주입__" },
      null,
      { cash: 300 },            // 이름 없음
      "문자열",
      [],
    ]);
    expect(out.map((x) => x.name)).toEqual(["정상", "이상한분류"]);
    expect(out[1].cat).toBe("etc");
  });

  it("비었거나 배열이 아니면 코드 폴백(DEFAULT_ITEMS)을 쓴다 — 오프라인에서도 목록이 비지 않는다", () => {
    expect(validCatalog(null).length).toBe(DEFAULT_ITEMS.length);
    expect(validCatalog([]).length).toBe(DEFAULT_ITEMS.length);
    expect(validCatalog("nope").length).toBe(DEFAULT_ITEMS.length);
  });
});

describe("composeItems — 카탈로그 + 내 아이템", () => {
  it("내 아이템이 없으면 카탈로그만 보인다(유저 데이터는 비어 있다)", () => {
    const { items, hidden } = composeItems(CAT, []);
    expect(items.map((x) => x.name)).toEqual(["원더베리", "플래티넘 카르마의 가위"]);
    expect(items.every((x) => x.source === "catalog")).toBe(true);
    expect(hidden).toEqual([]);
  });

  it("같은 이름의 내 아이템이 카탈로그를 가린다(수정본) — 중복해서 두 번 보이지 않는다", () => {
    const mine = canonicalizeMyItems([{ name: "원더베리", cash: 5000, mAllowed: false, cat: "pet", origin: "user" }]);
    const { items } = composeItems(CAT, mine);
    expect(items.length).toBe(2); // 3개가 아니다
    const w = items.find((x) => x.name === "원더베리");
    expect(w.source).toBe("user");
    expect(w.overrides).toBe(true);
    expect(+w.cash).toBe(5000);
    expect(w.base.cash).toBe(5400); // 되돌리기용 원본
  });

  it("카탈로그에 없는 이름은 '내가 추가한 것'으로 나온다", () => {
    const mine = canonicalizeMyItems([{ name: "금손은손 헤어쿠폰", cash: 5500, origin: "user" }]);
    const { items } = composeItems(CAT, mine);
    const u = items.find((x) => x.name === "금손은손 헤어쿠폰");
    expect(u.source).toBe("user");
    expect(u.overrides).toBe(false);
  });

  it("hidden 행은 목록에서 빠지고 숨김 목록으로 간다", () => {
    const mine = canonicalizeMyItems([{ name: "원더베리", hidden: true, origin: "user" }]);
    const { items, hidden } = composeItems(CAT, mine);
    expect(items.map((x) => x.name)).toEqual(["플래티넘 카르마의 가위"]);
    expect(hidden.map((x) => x.name)).toEqual(["원더베리"]);
    // 숨김 해제에 필요한 my_items 행 id 가 따라온다
    expect(hidden[0].userRowId).toBe(mine[0].id);
  });

  it("카탈로그가 비어도(오프라인) 내 아이템은 그대로 보인다", () => {
    const mine = canonicalizeMyItems([{ name: "내것", cash: 1000, origin: "user" }]);
    const { items } = composeItems([], mine); // 폴백 카탈로그가 깔린다
    expect(items.find((x) => x.name === "내것")).toBeTruthy();
  });

  it("운영자가 카탈로그 가격을 고쳐도 내 아이템은 건드려지지 않는다", () => {
    const mine = canonicalizeMyItems([{ name: "금손은손 헤어쿠폰", cash: 5500, origin: "user" }]);
    const after = composeItems([{ ...CAT[0], cash: 9999 }, CAT[1]], mine);
    expect(after.items.find((x) => x.name === "원더베리").cash).toBe(9999); // 카탈로그는 즉시 반영
    expect(after.items.find((x) => x.name === "금손은손 헤어쿠폰").cash).toBe(5500); // 내 것은 그대로
  });
});

describe("differsFromBase", () => {
  it("값이 같으면 false, 하나라도 다르면 true", () => {
    const base = CAT[0];
    expect(differsFromBase({ ...base }, base)).toBe(false);
    expect(differsFromBase({ ...base, cash: 1 }, base)).toBe(true);
    expect(differsFromBase({ ...base, mAllowed: true }, base)).toBe(true);
    expect(differsFromBase({ ...base, cat: "etc" }, base)).toBe(true);
    expect(differsFromBase({ ...base, icon: "x" }, base)).toBe(true);
    expect(differsFromBase({ ...base }, null)).toBe(false);
  });
});

describe("planItemMigration — 구 데이터의 기본값 복사본 정리", () => {
  it("카탈로그와 값까지 같은 옛 복사본은 지우고, 커스텀은 origin 을 찍어 살린다", () => {
    const mine = canonicalizeMyItems([
      { ...CAT[0] },                             // 옛 복사본(값까지 동일) → 삭제
      { ...CAT[1] },                             // 옛 복사본(값까지 동일) → 삭제
      { name: "금손은손 헤어쿠폰", cash: 5500 }, // 커스텀 → 살린다
    ]);
    const plan = planItemMigration(mine, CAT);
    expect(plan.changed).toBe(true);
    expect(plan.removeIds.length).toBe(2);
    expect(plan.stampIds.length).toBe(1);

    const stamped = applyItemStamps(mine, plan.stampIds);
    expect(stamped.find((r) => r.name === "금손은손 헤어쿠폰").origin).toBe("user");
  });

  it("origin:'user' 인 행은 카탈로그와 이름이 같아도 절대 지우지 않는다 — 수정본이 살아남는다", () => {
    // 이게 깨지면 '기본값 수정' 기능이 성립하지 않는다: 유저가 만든 수정본은 카탈로그와 같은 이름을 갖는 게 정상인데,
    // 이름만 보고 지우면 다음 로드에서 그 수정본이 사라진다.
    const mine = canonicalizeMyItems([{ name: "원더베리", cash: 5000, origin: "user" }]);
    const plan = planItemMigration(mine, CAT);
    expect(plan.removeIds).toEqual([]);
    expect(plan.changed).toBe(false);
  });

  it("숨김 행도 유저 소유라 지우지 않는다", () => {
    const mine = canonicalizeMyItems([{ name: "원더베리", hidden: true, origin: "user" }]);
    expect(planItemMigration(mine, CAT).removeIds).toEqual([]);
  });

  it("멱등: 한 번 돌린 뒤 다시 돌리면 아무것도 하지 않는다", () => {
    const mine = canonicalizeMyItems([
      { ...CAT[0] },                             // 값까지 같은 복사본
      { name: "금손은손 헤어쿠폰", cash: 5500 }, // 커스텀
    ]);
    const p1 = planItemMigration(mine, CAT);
    let next = applyItemStamps(mine, p1.stampIds).filter((r) => !p1.removeIds.includes(r.id));
    const p2 = planItemMigration(next, CAT);
    expect(p2.changed).toBe(false);
    expect(p2.removeIds).toEqual([]);
  });
});

describe("동기화 불변식 — 새 필드가 병합을 통과한다", () => {
  it("origin/hidden 은 합집합 병합에서 보존된다(새 병합 규칙 없이)", () => {
    const mine = canonicalizeMyItems([
      { name: "원더베리", hidden: true, origin: "user" },
      { name: "내것", cash: 100, origin: "user" },
    ]);
    const merged = mergeMyItems([], mine, {});
    expect(merged.find((r) => r.name === "원더베리").hidden).toBe(true);
    expect(merged.find((r) => r.name === "내것").origin).toBe("user");
  });

  it("마이그레이션 삭제는 표식을 남겨 다른 기기의 복사본까지 정리된다", () => {
    const stale = canonicalizeMyItems([{ ...CAT[0] }]); // 다른 기기에 남은 옛 복사본
    const mine = canonicalizeMyItems([{ ...CAT[0] }]);
    const del = deleteMyItem(mine, { deleted: {} }, mine[0].id, 5000);
    // 표식이 있으므로 다른 기기의 복사본도 병합에서 빠진다
    expect(mergeMyItems(stale, del.myItems, del.ledger.deleted)).toEqual([]);
  });

  it("정리 후에 만든 수정본은 그 삭제 표식을 이긴다(at 이 뒤라서)", () => {
    // 이게 깨지면 마이그레이션이 지운 이름으로는 영영 수정본을 만들 수 없다.
    const mine = canonicalizeMyItems([{ ...CAT[0] }]);
    const del = deleteMyItem(mine, { deleted: {} }, mine[0].id, 5000);
    const override = addMyItems([], del.ledger.deleted, [{ name: "원더베리", cash: 5000, origin: "user" }], 5000);
    const merged = mergeMyItems([], override, del.ledger.deleted);
    expect(merged.map((x) => x.name)).toEqual(["원더베리"]);
    expect(merged[0].cash).toBe(5000);
    expect(merged[0].origin).toBe("user");
  });
});

// ===== 실제 프로덕션 데이터로 재생 =====
// 오늘 force 사고 직후의 실제 상태를 그대로 재현한다:
//   my_items = 카탈로그 23종의 복사본 + 유저가 직접 넣은 2종 (모두 origin 없음)
// 마이그레이션이 복사본만 걷어내고 커스텀 2종은 살려야 한다.
describe("프로덕션 데이터 재생 — force 사고 이후 상태의 정리", () => {
  const CATALOG = DEFAULT_ITEMS;
  const CUSTOM = [
    { name: "금손은손 헤어쿠폰", cash: 5500, mAllowed: true, icon: "💇", cat: "beauty" },
    { name: "원더베리 11개", cash: 54000, mAllowed: false, icon: "🫐", cat: "pet" },
  ];

  it("기본 복사본 23종은 지우고 커스텀 2종만 내 아이템으로 남긴다", () => {
    const legacy = canonicalizeMyItems([...CATALOG, ...CUSTOM]); // origin 없음 = 구 데이터
    expect(legacy.length).toBe(CATALOG.length + 2);

    const plan = planItemMigration(legacy, CATALOG);
    expect(plan.removeIds.length).toBe(CATALOG.length);
    expect(plan.stampIds.length).toBe(2);

    // 삭제는 표식을 남기며 적용한다(다른 기기의 복사본까지 정리되도록)
    let items = applyItemStamps(legacy, plan.stampIds);
    let ledger = { deleted: {} };
    plan.removeIds.forEach((id) => {
      const r = deleteMyItem(items, ledger, id);
      items = r.myItems;
      ledger = r.ledger;
    });

    expect(items.map((x) => x.name).sort()).toEqual(["금손은손 헤어쿠폰", "원더베리 11개"]);
    expect(items.every((x) => x.origin === "user")).toBe(true);

    // 화면은 여전히 25종 — 23종은 카탈로그가, 2종은 내 아이템이 채운다
    const { items: shown } = composeItems(CATALOG, items);
    expect(shown.length).toBe(CATALOG.length + 2);
    expect(shown.filter((x) => x.source === "catalog").length).toBe(CATALOG.length);
    expect(shown.filter((x) => x.source === "user").length).toBe(2);
  });

  it("정리 후 운영자가 카탈로그 가격을 고쳐도 유저 화면에 즉시 반영된다(force 불필요)", () => {
    const legacy = canonicalizeMyItems([...CATALOG, ...CUSTOM]);
    const plan = planItemMigration(legacy, CATALOG);
    let items = applyItemStamps(legacy, plan.stampIds).filter((r) => !plan.removeIds.includes(r.id));

    // 운영자가 원더베리를 9,999원으로 바꿨다 (app_config 만 수정)
    const nextCatalog = CATALOG.map((c) => (c.name === "원더베리" ? { ...c, cash: 9999 } : c));
    const { items: shown } = composeItems(nextCatalog, items);
    expect(shown.find((x) => x.name === "원더베리").cash).toBe(9999);
    // 유저가 직접 넣은 것은 그대로다 — 이게 이번 구조 변경의 핵심이다
    expect(shown.find((x) => x.name === "원더베리 11개").cash).toBe(54000);
    expect(shown.find((x) => x.name === "금손은손 헤어쿠폰").cash).toBe(5500);
  });

  it("정리 후 유저가 기본 아이템을 수정하면 그 수정본은 다음 로드에서 살아남는다", () => {
    const legacy = canonicalizeMyItems([...CATALOG, ...CUSTOM]);
    const plan = planItemMigration(legacy, CATALOG);
    let items = applyItemStamps(legacy, plan.stampIds);
    let ledger = { deleted: {} };
    plan.removeIds.forEach((id) => {
      const r = deleteMyItem(items, ledger, id);
      items = r.myItems;
      ledger = r.ledger;
    });

    // 유저가 원더베리를 5,000원짜리 수정본으로 만든다(App.overrideCatalogItem 과 같은 경로)
    items = addMyItems(items, ledger.deleted, [{ name: "원더베리", cash: 5000, mAllowed: false, cat: "pet", origin: "user" }]);

    // ① 마이그레이션 삭제 표식을 이긴다(at 이 뒤라서)
    const merged = mergeMyItems([], items, ledger.deleted);
    expect(merged.find((x) => x.name === "원더베리")).toBeTruthy();

    // ② 다음 로드의 마이그레이션이 이 수정본을 지우지 않는다(origin:"user")
    const again = planItemMigration(merged, CATALOG);
    expect(again.removeIds).toEqual([]);

    // ③ 화면에서 카탈로그 원더베리를 가린다(중복 없이 하나만)
    const { items: shown } = composeItems(CATALOG, merged);
    const w = shown.filter((x) => x.name === "원더베리");
    expect(w.length).toBe(1);
    expect(w[0].cash).toBe(5000);
    expect(w[0].overrides).toBe(true);
  });
});

// ===== Codex 재검수에서 잡힌 것들 =====
describe("Codex — 마이그레이션이 유저의 옛 편집을 지우지 않는다", () => {
  it("구버전 UI 에서 기본 아이템을 고쳐 둔 행(origin 없음)은 지우지 않고 '수정됨'으로 살린다", () => {
    // 예전 UI 는 기본 아이템을 직접 편집할 수 있었다. 그렇게 값을 고친 행은 이름이 카탈로그와 같지만
    // **유저의 의도가 담긴 데이터**다. 이름만 보고 지우면 그 편집이 조용히 사라진다.
    const edited = canonicalizeMyItems([{ name: "원더베리", cash: 4321, mAllowed: false, icon: "🫐", cat: "pet" }]);
    const plan = planItemMigration(edited, CAT);
    expect(plan.removeIds).toEqual([]);        // 지우지 않는다
    expect(plan.stampIds.length).toBe(1);      // 살리고 origin 을 찍는다

    const kept = applyItemStamps(edited, plan.stampIds);
    const { items } = composeItems(CAT, kept);
    const w = items.find((x) => x.name === "원더베리");
    expect(w.source).toBe("user");
    expect(w.overrides).toBe(true);            // "수정됨" 배지 + 되돌리기 버튼이 붙는다
    expect(+w.cash).toBe(4321);
  });

  it("값까지 똑같은 순수 복사본만 지운다", () => {
    const pure = canonicalizeMyItems([{ ...CAT[0] }]); // 카탈로그와 완전히 동일
    expect(planItemMigration(pure, CAT).removeIds.length).toBe(1);
  });

  it("살린 '수정됨' 행은 되돌리기 한 번으로 카탈로그 값으로 복귀한다(삭제와 달리 되돌릴 수 있다)", () => {
    const edited = canonicalizeMyItems([{ name: "원더베리", cash: 4321, cat: "pet" }]);
    const plan = planItemMigration(edited, CAT);
    const kept = applyItemStamps(edited, plan.stampIds);
    // '되돌리기' = 그 my_items 행을 지운다 → 카탈로그 원본이 다시 보인다
    const del = deleteMyItem(kept, { deleted: {} }, kept[0].id);
    const { items } = composeItems(CAT, del.myItems);
    const w = items.find((x) => x.name === "원더베리");
    expect(w.source).toBe("catalog");
    expect(w.cash).toBe(5400);
  });
});

describe("Codex — malformed 카탈로그(빈 이름·중복 이름)", () => {
  it("빈 이름·공백 이름은 버린다 — React key 충돌과 엉뚱한 매칭을 막는다", () => {
    const out = validCatalog([{ name: "", cash: 1 }, { name: "   ", cash: 2 }, { name: "정상", cash: 3 }]);
    expect(out.map((x) => x.name)).toEqual(["정상"]);
  });

  it("중복 이름은 첫 번째만 결정적으로 남긴다", () => {
    const out = validCatalog([{ name: "A", cash: 1 }, { name: "A", cash: 2 }, { name: "B", cash: 3 }]);
    expect(out.map((x) => x.name)).toEqual(["A", "B"]);
    expect(out[0].cash).toBe(1);
  });

  it("이름 앞뒤 공백은 다듬는다 — my_items 와의 매칭이 어긋나지 않게", () => {
    expect(validCatalog([{ name: "  원더베리  ", cash: 1 }])[0].name).toBe("원더베리");
  });

  it("중복 이름이 있어도 composeItems 의 key 가 충돌하지 않는다", () => {
    const dup = [{ name: "A", cash: 1, cat: "etc" }, { name: "A", cash: 2, cat: "etc" }];
    const { items } = composeItems(dup, []);
    const keys = items.map((x) => x._k);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("Codex 2차 — 공백만 다른 옛 복사본도 정리된다", () => {
  it("이름 앞뒤 공백이 있는 복사본도 카탈로그와 매칭돼 지워진다(유령 '수정됨' 행이 남지 않는다)", () => {
    const legacy = canonicalizeMyItems([{ ...CAT[0], name: "  원더베리  " }]);
    const plan = planItemMigration(legacy, CAT);
    expect(plan.removeIds.length).toBe(1); // 살아남아 '수정됨'이 되면 안 된다
    expect(plan.stampIds).toEqual([]);
  });

  it("공백만 다른 내 아이템은 카탈로그를 가린다 — 같은 아이템이 두 줄로 보이지 않는다", () => {
    const mine = canonicalizeMyItems([{ name: " 원더베리 ", cash: 5000, origin: "user" }]);
    const { items } = composeItems(CAT, mine);
    expect(items.filter((x) => matchName(x.name) === "원더베리").length).toBe(1);
    expect(items.find((x) => matchName(x.name) === "원더베리").overrides).toBe(true);
  });
});
const matchName = (n) => String(n ?? "").trim();
