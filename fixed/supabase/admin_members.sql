-- AI Footarch 고정촬영판 · 관리자 회원 관리(중복 가입 정리용 회원 탈퇴)
-- Supabase 대시보드 › SQL Editor에 붙여 넣고 Run (한 번만, 다시 실행해도 안전)
-- 원칙
--  · 관리자 여부는 서버(is_admin)가 판단한다. 관리자가 아니면 아무것도 못 한다.
--  · 관리자 계정(자기 자신 포함)은 앱에서 지울 수 없다(SQL Editor에서만).
--  · 회원을 지우면 그 사람의 프로필·검사·회차·임상 NDT·알람이 함께 지워진다(on delete cascade). 되돌릴 수 없다.

-- 1) 회원 목록(연구 동의와 관계없이 전체): 중복 찾기에 필요한 정보와 기록 수만
create or replace function public.admin_members() returns table (
  id uuid, username text, name text, phone text, created_at timestamptz, last_sign_in_at timestamptz,
  consent_research boolean, is_admin boolean, exams bigint, rounds bigint, refs bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  return query
  select p.id, p.username::text, p.name::text, p.phone::text, p.created_at, u.last_sign_in_at,
         coalesce(p.consent_research, false),
         exists (select 1 from public.admins a where a.user_id = p.id),
         (select count(*) from public.exams e where e.user_id = p.id),
         (select count(*) from public.rounds r where r.user_id = p.id),
         (select count(*) from public.reference_ndt n where n.user_id = p.id)
  from public.profiles p left join auth.users u on u.id = p.id
  order by p.created_at;
end $$;
revoke all on function public.admin_members() from public, anon;
grant execute on function public.admin_members() to authenticated;

-- 2) 회원 탈퇴(관리자가 실행)
create or replace function public.admin_delete_user(uid uuid) returns json
language plpgsql security definer set search_path = public as $$
declare n_exams bigint; n_rounds bigint; n_refs bigint; uname text;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  if uid = auth.uid() then raise exception '자기 계정은 지울 수 없습니다.'; end if;
  if exists (select 1 from public.admins where user_id = uid) then raise exception '관리자 계정은 앱에서 지울 수 없습니다.'; end if;
  if not exists (select 1 from auth.users where id = uid) then raise exception '이미 없는 회원입니다.'; end if;
  select username into uname from public.profiles where id = uid;
  select count(*) into n_exams from public.exams where user_id = uid;
  select count(*) into n_rounds from public.rounds where user_id = uid;
  select count(*) into n_refs from public.reference_ndt where user_id = uid;
  delete from auth.users where id = uid; -- 프로필·검사·회차·임상 NDT·알람은 cascade로 함께 삭제
  return json_build_object('username', uname, 'exams', n_exams, 'rounds', n_rounds, 'refs', n_refs);
end $$;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
