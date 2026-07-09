-- ============================================================
-- mapleBudget · 다인용 동기화 스키마 (Supabase SQL Editor에 붙여넣고 Run)
-- 사용자당 1행에 앱 데이터(JSONB)를 저장하고, RLS로 본인 행만 접근 허용.
-- ============================================================

create table if not exists public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  calc       jsonb        not null default '{}'::jsonb,
  my_items   jsonb        not null default '[]'::jsonb,
  -- deleted = 삭제 표식(tombstone) { "<항목 id>": <삭제시각 ms> }. 삭제를 다른 기기로 전파한다.
  -- 구버전 행에는 이 키가 없다 → 클라이언트 normalizeLedger 가 빈 객체로 채운다(마이그레이션 불필요).
  ledger     jsonb        not null default '{"buys":[],"sells":[],"cashes":[],"spends":[],"deleted":{}}'::jsonb,
  updated_at timestamptz  not null default now()
);

-- authenticated 역할에 테이블 권한 부여 (RLS와 별개로 역할 GRANT가 있어야 API 접근 가능)
grant select, insert, update, delete on public.user_data to authenticated;

-- 행 단위 접근 통제 (보안 핵심): 로그인한 본인 행만 읽기/쓰기 가능
alter table public.user_data enable row level security;

drop policy if exists "own_data" on public.user_data;
create policy "own_data" on public.user_data
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at 자동 갱신. search_path 를 고정해 스키마 하이재킹 여지를 없앤다(Supabase linter 권장).
create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch
  before update on public.user_data
  for each row execute function public.touch_updated_at();

-- ============================================================
-- app_config · 앱 공용 설정(시세성 기본값) 1행
-- 누구나 읽기(anon 포함), 쓰기 정책 없음 → 클라이언트는 수정 불가.
-- 값 변경은 대시보드(service role, RLS 우회)로만. src/lib/cloud.js fetchAppConfig 가 읽음.
-- ============================================================

create table if not exists public.app_config (
  id         int primary key default 1,
  config     jsonb        not null,
  updated_at timestamptz  not null default now(),
  constraint app_config_singleton check (id = 1)
);

-- 공개 읽기: anon + authenticated 에 SELECT 권한 (RLS와 별개로 GRANT 필요)
grant select on public.app_config to anon, authenticated;

alter table public.app_config enable row level security;

-- 누구나 읽기만. INSERT/UPDATE/DELETE 정책을 두지 않아 클라이언트 쓰기는 전부 거부됨.
drop policy if exists "app_config_read_all" on public.app_config;
create policy "app_config_read_all" on public.app_config
  for select
  using (true);

drop trigger if exists app_config_touch on public.app_config;
create trigger app_config_touch
  before update on public.app_config
  for each row execute function public.touch_updated_at();

-- 초기 시드(원하는 값으로 수정). 시세성 기본값 + 충전 프리셋 + 기본 아이템 + 게임 규칙.
-- force: 모든 유저에게 강제 반영할 키 배열(예: ["mesoRate"]). 비우면 강제 안 함.
--
-- rules: 넥슨이 정하는 규칙(사용자가 편집하지 않음) → force 와 무관하게 항상 모든 유저에게 적용.
--   feeMvp/feeBase = 경매장 수수료(%), mileageAccrual = 마일리지 적립률(0~1),
--   mileageRate    = 아이템 가격 중 마일리지로 결제 가능한 비율(%). 100 미만이어야 한다.
--   tiers = MVP 등급별 13주 누적 기준액(오름차순 필수 — 깨지면 클라이언트가 통째로 무시하고 폴백).
--   클라이언트 src/lib/constants.js resolveRules 가 항목별로 검증한다.
--
-- ★ 규칙이 바뀌면 값을 '고치지 말고' 발효일 이력으로 바꿀 것. 값을 고치면 과거 거래까지 소급해서 변한다.
--   rules 는 객체(단일 규칙) 또는 발효일 오름차순 배열을 모두 받는다:
--     "rules": [
--       {"effectiveFrom":"2000-01-01", "feeMvp":5, "feeBase":8, "mileageRate":40, ...},
--       {"effectiveFrom":"2026-03-01", "feeMvp":3, "feeBase":5, "mileageRate":30, ...}
--     ]
--   거래는 그 날짜에 유효한 규칙으로 계산된다(src/lib/constants.js rulesAt).
--   가장 이른 항목은 자동으로 EPOCH 로 내려가므로 그 이전 거래도 규칙을 갖는다.
--   각 항목은 독립적으로 검증되며 누락 키는 코드 기본값으로 채워진다.
insert into public.app_config (id, config) values (1, '{
  "mesoRate": 3000, "giftRatio": 8000, "marketRatio": 7500, "force": [],
  "rules": {
    "feeMvp": 3, "feeBase": 5, "mileageAccrual": 0.05, "mileageRate": 30,
    "tiers": [
      {"name":"브론즈","amt":150000},
      {"name":"실버","amt":300000},
      {"name":"골드","amt":600000},
      {"name":"다이아","amt":900000},
      {"name":"레드","amt":1500000},
      {"name":"블랙","amt":3000000}
    ]
  },
  "chargeMethods": [
    {"name":"정가 (할인 없음)","rate":0,"limit":0},
    {"name":"컬쳐랜드 상품권","rate":7,"limit":200000},
    {"name":"도서문화상품권","rate":7,"limit":200000},
    {"name":"넥슨카드 (할인몰)","rate":5.6,"limit":0},
    {"name":"넥슨 현대카드","rate":10,"limit":0},
    {"name":"직접 입력","rate":0,"limit":0}
  ],
  "defaultItems": [
    {"name":"로얄 스타일 쿠폰 10개","cash":22000,"mAllowed":false,"icon":"🎀"},
    {"name":"로얄 스타일 쿠폰 20개","cash":44000,"mAllowed":false,"icon":"🎀"},
    {"name":"원더베리","cash":3900,"mAllowed":true,"icon":"🫐"},
    {"name":"플래티넘 카르마의 가위","cash":5900,"mAllowed":true,"icon":"✂️"},
    {"name":"프리미엄 헤어 쿠폰","cash":5500,"mAllowed":true,"icon":"💇"},
    {"name":"프리미엄 성형 쿠폰","cash":5500,"mAllowed":true,"icon":"💄"},
    {"name":"뷰티 쿠폰","cash":4900,"mAllowed":true,"icon":"💅"}
  ]
}'::jsonb) on conflict (id) do nothing;

-- ============================================================
-- feedback · 사용자 피드백(건의/버그/기타). 누구나(게스트 포함) INSERT만 가능.
-- 읽기 정책 없음 → RLS가 조회를 막음(클라이언트 조회 불가). 확인은 대시보드(service role, RLS 우회).
-- user_id 는 컬럼 default auth.uid() 로 서버가 채움 → 클라이언트가 위조 못 함(게스트는 null).
-- src/lib/cloud.js submitFeedback 가 INSERT 한다.
-- ============================================================

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid default auth.uid() references auth.users(id) on delete set null,
  email      text,
  category   text,
  message    text not null,
  user_agent text,
  constraint feedback_message_len  check (char_length(message)  between 1 and 4000),
  constraint feedback_email_len    check (email    is null or char_length(email)    <= 200),
  constraint feedback_category_len check (category is null or char_length(category) <= 40)
);

-- 최소권한: 기본 권한을 모두 회수한 뒤 INSERT만 부여.
-- (Supabase는 public 스키마 새 테이블에 anon/authenticated로 SELECT/UPDATE/DELETE 등을 기본 부여하는
--  경우가 있어, 명시적으로 revoke 하여 조회·수정·삭제를 GRANT 레벨에서도 차단 — RLS와 함께 이중 방어.)
revoke all on public.feedback from anon, authenticated;
grant insert on public.feedback to anon, authenticated;

alter table public.feedback enable row level security;

-- 누구나 제출 가능. 단 역할별로 user_id 를 고정:
--  · 게스트(anon)  → user_id 는 반드시 null
--  · 로그인(authenticated) → user_id 는 반드시 본인(auth.uid())
-- 클라이언트는 user_id 를 보내지 않고 DB default(auth.uid())가 채우므로 정상 경로는 항상 통과하고,
-- 타인 사칭(다른 uid)도, 로그인 유저의 게스트 위장(user_id=null 강제 주입)도 모두 차단된다.
drop policy if exists "feedback_insert_anyone" on public.feedback;
create policy "feedback_insert_anyone" on public.feedback
  for insert
  to anon, authenticated
  with check (
    (auth.role() = 'anon' and user_id is null)
    or
    (auth.role() = 'authenticated' and user_id = auth.uid())
  );

-- ============================================================
-- feedback 남용 방지 (rate limit)
-- RLS는 "누가 쓸 수 있나"만 통제하고 "얼마나 자주"는 통제하지 않는다. anon INSERT가 열려 있으므로
-- 스크립트로 4KB 행을 무제한 밀어넣어 DB를 채우고 요금을 유발할 수 있다 → BEFORE INSERT 트리거로 제한.
--
-- 버킷 키: 로그인=user_id, 게스트=클라이언트 IP의 솔트 해시.
--   IP 원문은 저장하지 않는다(개인정보 최소 수집). 해시만 짧게 보관하고 1시간 뒤 청소한다.
--   IP는 PostgREST가 노출하는 request.headers 에서 읽는다(커넥션 풀러 뒤라 inet_client_addr() 는 무의미).
--   헤더가 없으면(직접 호출 등) 식별 불가 → 공용 버킷으로 묶어 보수적으로 제한한다.
-- ============================================================

create table if not exists public.feedback_throttle (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  cnt          int         not null default 0
);

-- 클라이언트는 이 테이블을 읽지도 쓰지도 못한다. 트리거(security definer)만 접근.
revoke all on public.feedback_throttle from anon, authenticated;
alter table public.feedback_throttle enable row level security;
-- 정책을 두지 않음 → 어떤 클라이언트 역할로도 접근 불가.

-- search_path 에 public 을 넣지 않는다. security definer 함수가 public 을 먼저 뒤지면,
-- public 에 now()/md5() 를 셰도잉하는 객체를 심을 수 있는 롤이 definer 권한을 탈취할 수 있다.
-- 테이블은 전부 public. 으로 명시 수식한다.
create or replace function public.feedback_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  -- 출처당 허용 건수(10분 창). 사람이 연달아 보낼 만한 양보다 넉넉하고 스크립트에는 좁다.
  c_limit        constant int      := 5;
  -- 익명 전체 상한. 아래 v_ip 는 클라이언트가 위조할 수 있는 헤더에서 오므로,
  -- 출처별 제한만으로는 '요청마다 다른 XFF' 로 우회된다. 위조 불가능한 전역 버킷을 백스톱으로 둔다.
  -- (트레이드오프: 공격자가 이 상한을 소진시키면 익명 피드백이 일시 차단된다.
  --  DB 가 4KB 행으로 무한히 채워지는 것보다 그쪽이 낫다는 판단. 로그인 유저는 영향 없다.)
  c_anon_limit   constant int      := 100;
  c_window       constant interval := interval '10 minutes';
  v_hdrs json;
  v_ip   text;
  v_xff  text;
  v_key  text;
  v_cnt  int;
  v_anon int;
begin
  if auth.uid() is not null then
    -- 로그인 요청은 JWT 로 확정된 uid 로 버킷팅 → 위조 불가.
    v_key := 'u:' || auth.uid()::text;
  else
    begin
      v_hdrs := current_setting('request.headers', true)::json;
    exception when others then
      v_hdrs := null;
    end;
    -- x-forwarded-for 는 신뢰 프록시가 '뒤에 덧붙인다'. 클라이언트가 심은 값은 앞쪽에 남으므로
    -- 반드시 마지막 항목을 읽어야 한다(첫 항목을 읽으면 공격자가 매 요청 새 버킷을 만들어 우회).
    v_xff := coalesce(v_hdrs ->> 'x-forwarded-for', '');
    v_ip := nullif(btrim(coalesce(
      nullif(btrim(v_hdrs ->> 'cf-connecting-ip'), ''),
      split_part(v_xff, ',', greatest(1, array_length(string_to_array(v_xff, ','), 1)))
    )), '');
    if v_ip is null then
      v_key := 'anon:unknown';
    else
      -- 솔트 해시만 저장 → 테이블이 유출돼도 IP 원문이 드러나지 않는다.
      v_key := 'ip:' || md5(v_ip || ':mvp-feedback-throttle-v1');
    end if;

    -- 위조 불가능한 전역 익명 버킷. 헤더를 어떻게 조작해도 이 카운터는 피할 수 없다.
    insert into public.feedback_throttle as g (bucket, window_start, cnt)
    values ('anon:__all__', now(), 1)
    on conflict (bucket) do update set
      cnt          = case when g.window_start < now() - c_window then 1     else g.cnt + 1 end,
      window_start = case when g.window_start < now() - c_window then now() else g.window_start end
    returning g.cnt into v_anon;

    if v_anon > c_anon_limit then
      raise exception 'feedback_rate_limited' using errcode = 'P0001';
    end if;
  end if;

  delete from public.feedback_throttle where window_start < now() - interval '1 hour';

  insert into public.feedback_throttle as t (bucket, window_start, cnt)
  values (v_key, now(), 1)
  on conflict (bucket) do update set
    cnt          = case when t.window_start < now() - c_window then 1     else t.cnt + 1 end,
    window_start = case when t.window_start < now() - c_window then now() else t.window_start end
  returning t.cnt into v_cnt;

  if v_cnt > c_limit then
    -- 클라이언트(cloud.js submitFeedback)가 이 토큰으로 안내 문구를 고른다. 문구를 바꾸면 거기도 함께 고칠 것.
    raise exception 'feedback_rate_limited' using errcode = 'P0001';
  end if;

  return new;
end $$;

revoke all on function public.feedback_rate_limit() from public, anon, authenticated;

drop trigger if exists feedback_rate_limit_trg on public.feedback;
create trigger feedback_rate_limit_trg
  before insert on public.feedback
  for each row execute function public.feedback_rate_limit();
