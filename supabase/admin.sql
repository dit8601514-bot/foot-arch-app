-- AI Footarch 관리자 서버 (schema.sql 다음에 SQL Editor에서 한 번 실행)
-- 원칙
--  · 관리자 권한은 서버(데이터베이스)가 판단한다. 앱 화면을 고쳐도 권한이 생기지 않는다.
--  · 관리자는 [선택] 연구 활용에 동의한 사용자의 기록만 본다. 동의하지 않은 사용자는 통계(인원·건수)에만 포함된다.
--  · 관리자 앱(/admin)과 사용자 앱(/)은 주소·로그인 정보(세션)가 분리되어 있고, 사용자 앱에는 관리자 기능 코드가 없다.

-- 1) 관리자 명단
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins for select using (user_id = auth.uid());
-- (관리자 추가·삭제는 SQL Editor에서만: 앱으로는 불가)

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated;

-- 연구 동의 여부(관리자 열람 범위 판단용)
create or replace function public.research_ok(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select consent_research from public.profiles where id = uid), false);
$$;

-- 2) 관리자 열람 정책: 연구 동의자만(읽기 전용)
drop policy if exists "admin read research profiles" on public.profiles;
create policy "admin read research profiles" on public.profiles for select using (public.is_admin() and consent_research);
drop policy if exists "admin read research exams" on public.exams;
create policy "admin read research exams" on public.exams for select using (public.is_admin() and public.research_ok(user_id));
drop policy if exists "admin read research logs" on public.exercise_logs;
create policy "admin read research logs" on public.exercise_logs for select using (public.is_admin() and public.research_ok(user_id));

-- 3) 임상 NDT 기준값: 전문가가 자로 잰 실제 발배뼈 하강(mm). AI 오차 보정 학습의 정답.
create table if not exists public.reference_ndt (
  exam_id text primary key references public.exams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  clinical_mm numeric not null check (clinical_mm >= -5 and clinical_mm <= 40),
  measured_by text,                 -- 측정자(이니셜 등)
  measured_at timestamptz,          -- 임상 측정 시각(앱 측정과 같은 날 권장)
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.reference_ndt enable row level security;
drop policy if exists "admin manage reference" on public.reference_ndt;
create policy "admin manage reference" on public.reference_ndt for all
  using (public.is_admin() and public.research_ok(user_id))
  with check (public.is_admin() and public.research_ok(user_id)
              and exists (select 1 from public.exams x where x.id = reference_ndt.exam_id and x.user_id = reference_ndt.user_id));
drop policy if exists "user read own reference" on public.reference_ndt;
create policy "user read own reference" on public.reference_ndt for select using (user_id = auth.uid());

-- 4) AI 오차 보정 모델: 관리자가 학습·배포, 배포된(active) 모델만 사용자 앱이 내려받는다
create table if not exists public.calibration_models (
  id text primary key,
  version integer not null,
  data jsonb not null,              -- 모델 계수·특징·교차검증 성능
  active boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists one_active_model on public.calibration_models (active) where active;
alter table public.calibration_models enable row level security;
drop policy if exists "anyone read active model" on public.calibration_models;
create policy "anyone read active model" on public.calibration_models for select using (active or public.is_admin());
drop policy if exists "admin write models" on public.calibration_models;
create policy "admin write models" on public.calibration_models for insert with check (public.is_admin());
drop policy if exists "admin update models" on public.calibration_models;
create policy "admin update models" on public.calibration_models for update using (public.is_admin()) with check (public.is_admin());

-- 배포: 하나만 활성화(기존 활성 모델은 자동으로 내림)
create or replace function public.activate_model(model_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  update public.calibration_models set active = false where active and id <> model_id;
  update public.calibration_models set active = true where id = model_id;
end $$;
create or replace function public.deactivate_models() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  update public.calibration_models set active = false where active;
end $$;
grant execute on function public.activate_model(text) to authenticated;
grant execute on function public.deactivate_models() to authenticated;

-- 5) 전체 통계(동의하지 않은 사용자도 인원·건수로만 포함)
create or replace function public.admin_stats() returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  select json_build_object(
    'users', (select count(*) from public.profiles),
    'research_users', (select count(*) from public.profiles where consent_research),
    'exams', (select count(*) from public.exams),
    'research_exams', (select count(*) from public.exams e join public.profiles p on p.id = e.user_id where p.consent_research),
    'references', (select count(*) from public.reference_ndt),
    'exercise_logs', (select count(*) from public.exercise_logs)
  ) into r;
  return r;
end $$;
grant execute on function public.admin_stats() to authenticated;

-- 첫 관리자 지정(관리자 계정으로 쓸 아이디로 사용자 앱에서 먼저 가입한 뒤 실행):
--   insert into public.admins (user_id)
--   select id from auth.users where email = '관리자아이디@users.footarch.app';
