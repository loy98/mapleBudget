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
--   가장 이른 항목이 **이미 발효했다면** 그 이전 거래에도 적용된다(빈 구간 없음).
--   아직 발효하지 않은 규칙(미래 발효일)은 지금·과거에 소급되지 않는다 → 그 구간은 코드 기본값.
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

-- ============================================================
-- feedback · 문의 내역 열람 (상태 · 운영자 답변 · 첨부)
--
-- 로그인 유저가 자기가 보낸 문의의 처리 상태와 답변을 앱에서 볼 수 있게 한다.
-- 게스트 문의는 user_id 가 null 이라 열람 대상이 아니다(누구 것인지 증명할 방법이 없다).
--
-- 상태·답변은 **운영자만** 정한다: authenticated 에 UPDATE 권한을 주지 않고,
-- INSERT 시에는 아래 feedback_validate 트리거가 클라이언트가 보낸 값을 무시하고 덮어쓴다.
-- (권한이 없어도 트리거로 한 번 더 막는다 — 권한 설정이 흔들려도 상태가 위조되지 않는다.)
-- ============================================================

alter table public.feedback
  add column if not exists status      text        not null default 'received',
  add column if not exists reply       text,
  add column if not exists replied_at  timestamptz,
  -- 첨부 이미지의 storage 경로 배열: ["<user_id>/<uuid>.png", ...]. 파일 자체는 storage 에 있다.
  add column if not exists attachments jsonb       not null default '[]'::jsonb,
  add column if not exists updated_at  timestamptz not null default now();

-- received=접수됨 · in_progress=확인 중 · answered=답변 완료 · closed=종료
alter table public.feedback drop constraint if exists feedback_status_valid;
alter table public.feedback add  constraint feedback_status_valid
  check (status in ('received', 'in_progress', 'answered', 'closed'));

alter table public.feedback drop constraint if exists feedback_reply_len;
alter table public.feedback add  constraint feedback_reply_len
  check (reply is null or char_length(reply) <= 4000);

-- 형태만 여기서 막고(배열·개수), 경로의 소유자 검사는 트리거에서 한다(auth.uid() 는 check 에서 못 쓴다).
alter table public.feedback drop constraint if exists feedback_attachments_shape;
alter table public.feedback add  constraint feedback_attachments_shape
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5);

-- 본인 문의만 조회. anon 에는 SELECT 권한 자체가 없다(위쪽 revoke) → 게스트는 목록을 볼 수 없다.
grant select on public.feedback to authenticated;

drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own" on public.feedback
  for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT 정화 트리거.
--  ① 상태·답변은 클라이언트가 정하지 못한다(무조건 접수됨 · 답변 없음).
--  ② 첨부 경로는 반드시 **본인 폴더**(`<uid>/…`)여야 한다. 남의 경로를 적어 넣어도
--     storage RLS 가 읽기를 막지만, 남의 파일을 자기 문의에 매달아 두는 것 자체를 여기서 끊는다.
--  ③ 게스트(uid null)는 첨부할 수 없다 — 익명 업로드는 스토리지 남용의 문이 된다.
create or replace function public.feedback_validate()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_el  jsonb;
  v_p   text;
begin
  new.status      := 'received';
  new.reply       := null;
  new.replied_at  := null;
  new.updated_at  := now();
  if new.attachments is null then
    new.attachments := '[]'::jsonb;
  end if;
  if jsonb_typeof(new.attachments) <> 'array' or jsonb_array_length(new.attachments) > 5 then
    raise exception 'feedback_bad_attachment' using errcode = 'P0001';
  end if;
  if jsonb_array_length(new.attachments) > 0 then
    if v_uid is null then
      raise exception 'feedback_bad_attachment' using errcode = 'P0001';
    end if;
    for v_el in select * from jsonb_array_elements(new.attachments) loop
      if jsonb_typeof(v_el) <> 'string' then
        raise exception 'feedback_bad_attachment' using errcode = 'P0001';
      end if;
      v_p := v_el #>> '{}';
      -- 정확히 `<uid>/<파일명>` 한 단계. 상위 경로 탈출(`..`)과 남의 폴더를 모두 막는다.
      if v_p !~ ('^' || v_uid::text || '/[A-Za-z0-9._-]{1,120}$') then
        raise exception 'feedback_bad_attachment' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return new;
end $$;

-- 운영자 답변이 달리면 상태·시각을 자동으로 맞춘다(대시보드에서 reply 만 채우면 된다).
create or replace function public.feedback_touch_reply()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := now();
  if new.reply is distinct from old.reply and new.reply is not null then
    new.replied_at := now();
    -- 운영자가 상태를 직접 지정했다면 존중한다(예: 답변하며 바로 closed 로).
    if new.status = old.status then
      new.status := 'answered';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists feedback_validate_trg on public.feedback;
create trigger feedback_validate_trg
  before insert on public.feedback
  for each row execute function public.feedback_validate();

drop trigger if exists feedback_touch_reply_trg on public.feedback;
create trigger feedback_touch_reply_trg
  before update on public.feedback
  for each row execute function public.feedback_touch_reply();

-- ============================================================
-- feedback-attachments · 문의 첨부 이미지 (Storage, 비공개 버킷)
--
-- 경로 규약: `<user_id>/<uuid>.<ext>` — 첫 폴더가 소유자다. 정책은 전부 이 규약 위에 선다.
-- 비공개 버킷이라 URL 을 알아도 읽을 수 없다. 앱은 signed URL(단기)로 자기 첨부만 본다.
-- 영상은 받지 않는다(무료 1GB 를 몇 개로 채운다) — 이미지 5MB × 5장.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-attachments', 'feedback-attachments', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public             = false,
  file_size_limit    = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

-- 자기 폴더만 읽는다.
drop policy if exists "fb_attach_select_own" on storage.objects;
create policy "fb_attach_select_own" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 자기 폴더에, **경로 규약대로만** 올린다 + 업로드 상한.
--
-- 경로를 첫 폴더(uid)만 보고 통과시키면, Storage API 를 직접 호출해 `uid/깊은/경로/x.gif` 나
-- 규약 밖 이름을 얼마든지 올릴 수 있다. DB 트리거는 '문의에 매다는' 경로만 검사하므로
-- 스토리지에는 규약 밖 객체가 쌓인다(Codex 지적). 정책에서 같은 정규식을 강제한다 —
-- 이 정규식은 feedback_validate 트리거의 것과 **같아야 한다**(둘이 갈라지면 한쪽이 무의미해진다).
--
-- 상한(계정당 1시간 20개): 로그인만 하면 5MB 를 무한히 올릴 수 있고(매직링크로 계정은 쉽게 만든다)
-- 그건 스토리지 요금이 된다. 사람이 문의에 붙일 양(최대 5장)보다 넉넉하고 스크립트에는 좁다.
-- 트리거가 아니라 정책에 넣는 이유: storage.objects 는 관리형 스키마라 트리거 생성(테이블 소유권)이
-- 막힐 수 있다. 정책은 대시보드도 쓰는 정식 경로다. 세는 SELECT 는 위의 select 정책 덕에 본인 것만 보인다.
drop policy if exists "fb_attach_insert_own" on storage.objects;
create policy "fb_attach_insert_own" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'feedback-attachments'
    and name ~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]{1,120}$')
    and (
      select count(*)
        from storage.objects o
       where o.bucket_id = 'feedback-attachments'
         and o.owner = auth.uid()
         and o.created_at > now() - interval '1 hour'
    ) < 20
  );

-- 자기 파일은 지울 수 있다. 두 가지가 이 정책을 요구한다:
--  ① **전송 실패 정리** — 이미지를 올린 뒤 문의 INSERT 가 실패하면(레이트리밋·네트워크) 그 파일은
--     어디에도 매달리지 못한 쓰레기다. 지울 권한이 없으면 스토리지에 영원히 남는다(Codex 지적).
--  ② **탈퇴** — 방침이 약속한 '지체 없이 파기'를 지키려면 실제 파일이 사라져야 한다.
--     SQL 로 storage.objects 행만 지우면 API 에서는 안 보여도 **실물 파일은 백엔드에 남는다.**
--     그래서 클라이언트가 Storage API 로 지운 뒤 delete_account() 를 부른다(cloud.js).
--
-- 대가: 유저가 자기 문의의 첨부를 나중에 지울 수 있다(운영자가 증거를 잃을 수 있다).
-- 자기 데이터를 지울 권리가 그보다 무겁다고 봤다 — 어차피 새 문의 알림 메일은 이미 갔다.
drop policy if exists "fb_attach_delete_own" on storage.objects;
create policy "fb_attach_delete_own" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- delete_account · 회원 탈퇴 (앱의 '계정 삭제' 버튼이 호출)
--
-- 약관 제3조 4항("이용자는 언제든지 탈퇴를 요청할 수 있으며, 요청 시 서버에 보관된 데이터는
-- 지체 없이 삭제된다")을 앱 안에서 바로 이행한다.
--
-- security definer 인 이유: auth.users 삭제는 service role 권한이 필요한데, 그 키를 브라우저에
-- 둘 수는 없다. 대신 **자기 자신만** 지울 수 있는 함수를 두고(대상은 JWT 의 auth.uid() 뿐 —
-- 인자가 없으므로 남의 계정을 지정할 방법이 아예 없다) authenticated 에만 실행 권한을 준다.
--
-- 피드백은 **내용을 남기고 작성자만 익명화**한다(방침: 접수일로부터 1년 보관).
-- 회신 이메일은 함께 지운다 — 떠난 사람의 연락처를 붙들고 있을 이유가 없다.
-- ============================================================

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- 동기화 데이터. auth.users 삭제의 on delete cascade 로도 지워지지만, 의도를 코드에 남긴다.
  delete from public.user_data where user_id = v_uid;

  -- 문의 글: **내용(message)은 남기고** 작성자·회신 이메일·첨부 참조를 지운다.
  --
  -- 첨부 경로에는 uid 가 박혀 있다(`<uid>/…`). 그것까지 남기면 "작성자를 익명화했다"는 말이
  -- 절반만 참이 된다 — 탈퇴한 사람의 문의들을 uid 로 다시 한 줄에 꿸 수 있기 때문이다(Codex 지적).
  -- 실물 파일은 클라이언트가 Storage API 로 먼저 지운다(cloud.js deleteAccount).
  update public.feedback
     set user_id = null, email = null, attachments = '[]'::jsonb, updated_at = now()
   where user_id = v_uid;

  -- 클라이언트의 파일 삭제가 실패했더라도(오프라인 등) 참조는 위에서 끊겼다.
  -- 남은 객체 행은 여기서 지운다 — 그러면 API 로는 더 이상 닿지 않는다.
  -- (실물 파일이 백엔드에 남을 수 있다는 한계는 docs/setup-feedback-account.md 에 적어 뒀다.)
  delete from storage.objects
   where bucket_id = 'feedback-attachments' and owner = v_uid;

  delete from auth.users where id = v_uid;
end $$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
