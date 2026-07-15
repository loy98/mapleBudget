-- Supabase 환경 스텁: auth / storage / 역할. schema.sql 을 그대로 적용할 수 있게 최소한만 흉내낸다.
create schema if not exists auth;
create schema if not exists storage;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

grant usage on schema public, auth, storage to anon, authenticated;

create table auth.users (
  id    uuid primary key,
  email text
);

-- JWT 클레임을 세션 설정으로 흉내낸다(PostgREST 가 하는 일).
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid references auth.users(id) on delete set null,
  owner_id   text,
  created_at timestamptz not null default now()
);

-- 파일명을 뺀 경로 조각들. Supabase 의 storage.foldername 과 같은 계약.
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;

-- 업로드 주체를 owner 에 채우는 것은 storage 서버의 몫이다(스텁에서는 트리거로 흉내).
create or replace function storage.set_owner() returns trigger language plpgsql as $$
begin
  if new.owner is null then new.owner := auth.uid(); end if;
  return new;
end $$;
create trigger objects_set_owner before insert on storage.objects
  for each row execute function storage.set_owner();
