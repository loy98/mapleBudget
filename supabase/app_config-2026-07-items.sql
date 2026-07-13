-- 자주 쓰는 아이템 기본 목록 갱신 + 1회 강제 배포 (2026-07)
-- Supabase 대시보드 → SQL Editor 에서 실행 (service role 필요).
--
-- 배경: defaultItems 는 '저장 이력 없는 새 게스트'에게만 적용된다. 기존 사용자에게 반영하려면
--       config.force 배열에 "defaultItems" 를 넣어야 한다.
--
-- ⚠️ force 는 1회성 플래그가 아니다 — **페이지를 열 때마다 매번** 적용된다.
--    force 에 "defaultItems" 가 들어 있는 동안에는 누구도 자기 아이템 목록을 편집할 수 없다
--    (새로고침하면 이 목록으로 되돌아간다). 아래 STEP 2 를 반드시 실행할 것.

-- ===== STEP 1: 목록 갱신 + 강제 적용 켜기 =====
-- 주요 정정
--   원더베리        3,900 → 5,400, 마일리지 가능 → **불가** (공식 공지 sale/428)
--   프리미엄 성형   5,500 → 3,500                  (공식 공지 sale/398)
--   뷰티 쿠폰       제거 — 공식 상시판매 아이템으로 확인되지 않음
--   로얄스타일 20개 제거 — 판매 단위(1/10/25/45개)에 없음
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
         {"name":"원더베리","cash":5400,"mAllowed":false,"icon":"🫐","cat":"pet"},
         {"name":"루나 크리스탈","cash":3900,"mAllowed":false,"icon":"🌙","cat":"pet"},
         {"name":"로얄 스타일 쿠폰","cash":2200,"mAllowed":false,"icon":"🎀","cat":"style"},
         {"name":"로얄 스타일 쿠폰 10개","cash":22000,"mAllowed":false,"icon":"🎀","cat":"style"}
       ]'::jsonb,
       'force', '["mesoRate","giftRatio","marketRatio","defaultItems"]'::jsonb
     ),
    updated_at = now()
where id = 1;

-- 확인
select config->'force' as force, jsonb_array_length(config->'defaultItems') as item_count from app_config where id = 1;


-- ===== STEP 2: 앱을 한 번 열어 목록이 덮어써진 걸 확인한 뒤 — 강제 적용 끄기 =====
-- 이걸 실행하지 않으면 앞으로 아무도 '자주 쓰는 아이템' 목록을 편집할 수 없다.
--
-- update app_config
-- set config = jsonb_set(config, '{force}', '["mesoRate","giftRatio","marketRatio"]'::jsonb),
--     updated_at = now()
-- where id = 1;
