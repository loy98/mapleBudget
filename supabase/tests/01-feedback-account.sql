-- 새 SQL(문의 상태·첨부·탈퇴 RPC)의 실측. 실패하면 psql 이 ON_ERROR_STOP 으로 멈춘다.
\set ON_ERROR_STOP on
\set U1 '11111111-1111-1111-1111-111111111111'
\set U2 '22222222-2222-2222-2222-222222222222'

-- 반복 실행할 수 있게 비우고 시작한다(같은 클러스터를 재사용한다).
delete from public.feedback;
delete from public.feedback_throttle;   -- 10분 창 카운터. 안 비우면 반복 실행이 레이트리밋에 걸린다.
delete from storage.objects;
delete from public.user_data;
delete from auth.users;

insert into auth.users (id, email) values (:'U1', 'u1@example.com'), (:'U2', 'u2@example.com');
insert into public.user_data (user_id) values (:'U1'), (:'U2');

-- 로그인 유저로 전환하는 도우미
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end $$;
create or replace function pg_temp.as_guest() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'anon', false);
end $$;
-- 실패해야 하는 문장을 실행한다. 성공해 버리면 그 자체가 결함이다.
-- ⚠ '❌' 를 exception 블록 **안에서** raise 하면 자기 핸들러가 그것마저 잡아 초록불이 된다(실제로 그랬다).
--   그래서 성공 여부를 플래그로 들고 나와 블록 밖에서 판정한다.
create or replace function pg_temp.must_fail(sql text, what text) returns void language plpgsql as $$
declare
  passed boolean := false;
  state  text;
begin
  begin
    execute sql;
    passed := true;
  exception when others then
    state := SQLSTATE;
  end;
  if passed then
    raise exception '❌ 막혔어야 하는데 통과했다: %', what;
  end if;
  raise notice '✅ 차단됨(%): %', state, what;
end $$;

-- ============ 1. 상태·답변 위조 차단 ============
select pg_temp.as_user(:'U1');
set role authenticated;
insert into public.feedback (message, category, status, reply)
  values ('상태를 위조해 본다', 'bug', 'answered', '내가 쓴 가짜 답변');
reset role;

do $$
declare r record;
begin
  select status, reply, replied_at into r from public.feedback order by id desc limit 1;
  if r.status <> 'received' or r.reply is not null or r.replied_at is not null then
    raise exception '❌ 클라이언트가 보낸 상태/답변이 살아남았다: %', r;
  end if;
  raise notice '✅ 상태·답변은 트리거가 덮어쓴다 (received / null)';
end $$;

-- ============ 2. 첨부 경로 검증 ============
select pg_temp.as_user(:'U1');
set role authenticated;
insert into public.feedback (message, attachments)
  values ('내 폴더 첨부', jsonb_build_array(:'U1' || '/a.png', :'U1' || '/b.jpg'));
reset role;
do $$ begin raise notice '✅ 본인 폴더 첨부는 통과'; end $$;

select pg_temp.as_user(:'U1');
set role authenticated;
select pg_temp.must_fail(
  format('insert into public.feedback (message, attachments) values (%L, %L::jsonb)',
         '남의 폴더', jsonb_build_array(:'U2' || '/steal.png')::text),
  '남의 폴더 경로를 첨부');
select pg_temp.must_fail(
  format('insert into public.feedback (message, attachments) values (%L, %L::jsonb)',
         '경로 탈출', jsonb_build_array(:'U1' || '/../' || :'U2' || '/x.png')::text),
  '상위 경로 탈출(..)');
select pg_temp.must_fail(
  format('insert into public.feedback (message, attachments) values (%L, %L::jsonb)',
         '문자열이 아님', jsonb_build_array(jsonb_build_object('p', 'x'))::text),
  '첨부 원소가 문자열이 아님');
select pg_temp.must_fail(
  format('insert into public.feedback (message, attachments) values (%L, %L::jsonb)',
         '6장', (select jsonb_agg(:'U1' || '/' || i || '.png') from generate_series(1, 6) i)::text),
  '첨부 6장(상한 5장)');
reset role;

-- ============ 3. 게스트는 첨부 불가, 본문 문의는 가능 ============
select pg_temp.as_guest();
set role anon;
select pg_temp.must_fail(
  format('insert into public.feedback (message, attachments) values (%L, %L::jsonb)',
         '게스트 첨부', jsonb_build_array('anon/x.png')::text),
  '게스트(anon) 첨부');
insert into public.feedback (message) values ('게스트 문의는 된다');
reset role;
do $$ begin raise notice '✅ 게스트: 첨부는 막고 문의는 받는다'; end $$;

-- ============ 4. 열람 범위 (RLS) ============
select pg_temp.as_user(:'U2');
set role authenticated;
insert into public.feedback (message) values ('U2 의 문의');
do $$
declare n_own int; n_all int;
begin
  select count(*) into n_own from public.feedback;             -- RLS 적용 → 본인 것만
  if n_own <> 1 then raise exception '❌ U2 가 % 건을 본다 (본인 1건이어야 함)', n_own; end if;
  raise notice '✅ 본인 문의만 조회된다 (U2: 1건)';
end $$;
reset role;

select pg_temp.as_guest();
set role anon;
select pg_temp.must_fail('select count(*) from public.feedback', '게스트(anon)의 문의 조회');
reset role;

-- ============ 5. 운영자 답변 → 상태·시각 자동 ============
update public.feedback set reply = '확인했습니다. 다음 배포에 반영할게요.'
 where message = 'U2 의 문의';
do $$
declare r record;
begin
  select status, replied_at into r from public.feedback where message = 'U2 의 문의';
  if r.status <> 'answered' or r.replied_at is null then
    raise exception '❌ 답변 후 상태가 안 맞다: %', r;
  end if;
  raise notice '✅ reply 를 채우면 answered + replied_at 자동';
end $$;

-- 운영자가 상태를 직접 정하면 존중한다(답변하며 바로 종료)
update public.feedback set reply = '재답변', status = 'closed' where message = 'U2 의 문의';
do $$
declare s text;
begin
  select status into s from public.feedback where message = 'U2 의 문의';
  if s <> 'closed' then raise exception '❌ 운영자가 지정한 상태를 덮어썼다: %', s; end if;
  raise notice '✅ 운영자가 지정한 상태는 유지된다';
end $$;

-- ============ 6. 첨부 업로드 정책 (storage) ============
select pg_temp.as_user(:'U1');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('feedback-attachments', :'U1' || '/ok.png');
select pg_temp.must_fail(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)',
         'feedback-attachments', :'U2' || '/steal.png'),
  '남의 폴더에 업로드');
-- Codex 지적: 첫 폴더만 보면 규약 밖 객체를 Storage API 로 직접 올릴 수 있다.
select pg_temp.must_fail(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)',
         'feedback-attachments', :'U1' || '/deep/nested.png'),
  '규약 밖 경로(하위 폴더) 업로드');
select pg_temp.must_fail(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)',
         'feedback-attachments', :'U1' || '/한글 이름.png'),
  '규약 밖 파일명(공백·한글) 업로드');
reset role;
do $$ begin raise notice '✅ 업로드는 자기 폴더 + 규약 경로에만'; end $$;

-- 전송 실패 정리 · 탈퇴 파기를 위해 자기 파일은 지울 수 있어야 한다(Codex 지적).
select pg_temp.as_user(:'U2');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('feedback-attachments', :'U2' || '/mine.png');
-- ⚠ RLS 는 DELETE 를 예외로 막지 않는다. 대상 행이 **보이지 않아 0행이 지워질 뿐**이다.
--   그래서 여기서는 must_fail 이 아니라 '몇 행이 지워졌는가'를 본다(처음에 must_fail 로 썼다가 헛다리를 짚었다).
do $$
declare n int;
begin
  delete from storage.objects where name = '11111111-1111-1111-1111-111111111111/ok.png';
  get diagnostics n = row_count;
  if n <> 0 then raise exception '❌ 남의 파일을 지웠다 (%행)', n; end if;

  delete from storage.objects where name = current_setting('request.jwt.claim.sub') || '/mine.png';
  get diagnostics n = row_count;
  if n <> 1 then raise exception '❌ 자기 파일을 지우지 못했다 (고아 파일 정리·탈퇴 파기가 막힌다)'; end if;
  raise notice '✅ 자기 파일은 지울 수 있고, 남의 파일은 못 지운다(0행)';
end $$;
reset role;

-- 남의 파일이 실제로 살아 있는지 확인(RLS 를 우회하는 postgres 로 본다)
do $$
declare n int;
begin
  select count(*) into n from storage.objects where name = '11111111-1111-1111-1111-111111111111/ok.png';
  if n <> 1 then raise exception '❌ 남의 파일이 사라졌다'; end if;
end $$;

-- 1시간 20개 상한
select pg_temp.as_user(:'U1');
set role authenticated;
do $$
declare i int;
begin
  for i in 1..19 loop
    insert into storage.objects (bucket_id, name)
      values ('feedback-attachments', current_setting('request.jwt.claim.sub') || '/f' || i || '.png');
  end loop;
end $$;
select pg_temp.must_fail(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)',
         'feedback-attachments', :'U1' || '/over.png'),
  '1시간 20개 초과 업로드');
reset role;

-- ============ 7. 계정 삭제 (delete_account) ============
select pg_temp.as_guest();
set role anon;
select pg_temp.must_fail('select public.delete_account()', '게스트의 계정 삭제 호출');
reset role;

select pg_temp.as_user(:'U1');
set role authenticated;
select public.delete_account();
reset role;

do $$
declare n int; r record;
begin
  select count(*) into n from auth.users where id = '11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception '❌ auth 계정이 남았다'; end if;

  select count(*) into n from public.user_data where user_id = '11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception '❌ 동기화 데이터가 남았다'; end if;

  -- 피드백: 내용은 남고 작성자·이메일만 사라진다
  select count(*) into n from public.feedback where message = '내 폴더 첨부';
  if n <> 1 then raise exception '❌ 피드백 내용이 사라졌다 (익명화만 해야 한다)'; end if;
  select user_id, email, attachments into r from public.feedback where message = '내 폴더 첨부';
  if r.user_id is not null or r.email is not null then
    raise exception '❌ 작성자/이메일이 남았다: %', r;
  end if;
  -- 첨부 경로에는 uid 가 박혀 있다 → 남기면 탈퇴한 사람의 문의를 uid 로 다시 꿸 수 있다(Codex 지적).
  if r.attachments <> '[]'::jsonb then
    raise exception '❌ 첨부 참조(uid 가 박힌 경로)가 남았다: %', r.attachments;
  end if;

  -- 첨부 객체의 소유자가 끊겼는지(= auth.users 삭제가 FK 로 막히지 않는지).
  -- 행 자체는 **남아야 한다** — 클라이언트가 RPC 성공 뒤 Storage API 로 실물 파일을 지운다.
  -- 여기서 행을 지우면 파일이 백엔드에 남는데 아무도 그 존재를 모른다.
  select count(*) into n from storage.objects
   where bucket_id = 'feedback-attachments' and owner = '11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception '❌ 탈퇴한 유저를 가리키는 소유자가 남았다'; end if;

  -- 고아 객체는 '찾을 수 있는 상태'여야 한다(운영자 청소 쿼리의 전제).
  select count(*) into n from storage.objects
   where bucket_id = 'feedback-attachments' and owner is null;
  if n = 0 then raise exception '❌ 첨부 객체 행이 사라졌다 — 실물 파일을 지울 방법이 없어진다'; end if;

  -- 남의 계정은 그대로다
  select count(*) into n from auth.users where id = '22222222-2222-2222-2222-222222222222';
  if n <> 1 then raise exception '❌ 다른 계정이 함께 지워졌다'; end if;
  select count(*) into n from public.user_data where user_id = '22222222-2222-2222-2222-222222222222';
  if n <> 1 then raise exception '❌ 다른 계정의 데이터가 지워졌다'; end if;

  raise notice '✅ 탈퇴: 계정·동기화 데이터 삭제 / 문의는 익명화 보존 / 남의 계정 무사';
end $$;

\echo '=== 모든 SQL 실측 통과 ==='
