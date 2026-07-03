-- ============================================================
-- mapleBudget · 다인용 동기화 스키마 (Supabase SQL Editor에 붙여넣고 Run)
-- 사용자당 1행에 앱 데이터(JSONB)를 저장하고, RLS로 본인 행만 접근 허용.
-- ============================================================

create table if not exists public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  calc       jsonb        not null default '{}'::jsonb,
  my_items   jsonb        not null default '[]'::jsonb,
  ledger     jsonb        not null default '{"buys":[],"sells":[],"cashes":[],"spends":[]}'::jsonb,
  updated_at timestamptz  not null default now()
);

-- 행 단위 접근 통제 (보안 핵심): 로그인한 본인 행만 읽기/쓰기 가능
alter table public.user_data enable row level security;

drop policy if exists "own_data" on public.user_data;
create policy "own_data" on public.user_data
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch
  before update on public.user_data
  for each row execute function public.touch_updated_at();
