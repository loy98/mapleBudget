-- 자주 쓰는 아이템 기본 목록 갱신 + 1회 강제 배포 (2026-07-14, 23종)
-- Supabase 대시보드 → SQL Editor 에서 실행 (service role 필요).
--
-- 배경: defaultItems 는 '저장 이력 없는 새 게스트'에게만 적용된다. 기존 사용자에게도 반영하려면
--       config.force 배열에 "defaultItems" 를 넣어야 한다.
--
-- ⚠️ force 는 1회성 플래그가 아니다 — **페이지를 열 때마다 매번** 적용된다.
--    force 에 "defaultItems" 가 들어 있는 동안에는 누구도 자기 아이템 목록을 편집할 수 없다
--    (새로고침하면 이 목록으로 되돌아간다). 반드시 STEP 2 까지 실행할 것.
--
-- 이번 변경: 45개 묶음(99,000) · 플래티넘 애플 · 믹스 염색/렌즈 · 생명의 물 · 서큘레이터 · 확성기 추가.
--            골드 애플은 제외. 랜덤박스류(원더베리/루나/로얄스타일/플래티넘애플)는 마일리지 불가.

-- ===== STEP 1: 목록 갱신 + 강제 적용 켜기 =====
update app_config
set config = config
  || jsonb_build_object(
       'defaultItems', '[
         {"name":"플래티넘 카르마의 가위","cash":5900,"mAllowed":true,"icon":"✂️","cat":"karma"},
         {"name":"프리미엄 헤어 쿠폰","cash":5500,"mAllowed":true,"icon":"💇","cat":"beauty"},
         {"name":"프리미엄 성형 쿠폰","cash":3500,"mAllowed":true,"icon":"💄","cat":"beauty"},
         {"name":"로얄 헤어 쿠폰","cash":5500,"mAllowed":true,"icon":"💇","cat":"beauty"},
         {"name":"로얄 성형외과 쿠폰","cash":3500,"mAllowed":true,"icon":"💄","cat":"beauty"},
         {"name":"체인지 로얄 헤어 쿠폰","cash":5500,"mAllowed":true,"icon":"💇","cat":"beauty"},
         {"name":"체인지 로얄 성형외과 쿠폰","cash":3500,"mAllowed":true,"icon":"💄","cat":"beauty"},
         {"name":"컬러링 프리즘","cash":5900,"mAllowed":true,"icon":"🎨","cat":"beauty"},
         {"name":"커스텀 믹스 염색 쿠폰","cash":48000,"mAllowed":true,"icon":"🎨","cat":"beauty"},
         {"name":"밸런스 믹스 염색 쿠폰","cash":24000,"mAllowed":true,"icon":"🎨","cat":"beauty"},
         {"name":"커스텀 믹스 컬러렌즈","cash":24000,"mAllowed":true,"icon":"👁️","cat":"beauty"},
         {"name":"밸런스 믹스 컬러렌즈","cash":12000,"mAllowed":true,"icon":"👁️","cat":"beauty"},
         {"name":"원더베리","cash":5400,"mAllowed":false,"icon":"🫐","cat":"pet"},
         {"name":"루나 크리스탈","cash":3900,"mAllowed":false,"icon":"🌙","cat":"pet"},
         {"name":"프리미엄 생명의 물","cash":1800,"mAllowed":true,"icon":"💧","cat":"pet"},
         {"name":"로얄 스타일 쿠폰","cash":2200,"mAllowed":false,"icon":"🎀","cat":"style"},
         {"name":"로얄 스타일 쿠폰 10개","cash":22000,"mAllowed":false,"icon":"🎀","cat":"style"},
         {"name":"로얄 스타일 쿠폰 20개","cash":44000,"mAllowed":false,"icon":"🎀","cat":"style"},
         {"name":"로얄 스타일 쿠폰 45개","cash":99000,"mAllowed":false,"icon":"🎀","cat":"style"},
         {"name":"플래티넘 애플","cash":3500,"mAllowed":false,"icon":"🍎","cat":"style"},
         {"name":"플래티넘 애플 33개","cash":99000,"mAllowed":false,"icon":"🍎","cat":"style"},
         {"name":"미라클 서큘레이터","cash":1900,"mAllowed":true,"icon":"🔄","cat":"etc"},
         {"name":"확성기","cash":990,"mAllowed":true,"icon":"📢","cat":"etc"}
       ]'::jsonb,
       'force', '["mesoRate","giftRatio","marketRatio","defaultItems"]'::jsonb
     ),
    updated_at = now()
where id = 1
returning jsonb_array_length(config->'defaultItems') as item_count, config->'force' as force;


-- ===== STEP 2: 앱을 한 번 열어 반영을 확인한 뒤 — 강제 적용 끄기 =====
-- 이걸 실행하지 않으면 앞으로 아무도 '자주 쓰는 아이템' 목록을 편집할 수 없다.
--
-- update app_config
-- set config = jsonb_set(config, '{force}', '["mesoRate","giftRatio","marketRatio"]'::jsonb),
--     updated_at = now()
-- where id = 1
-- returning config->'force' as force, jsonb_array_length(config->'defaultItems') as item_count;
