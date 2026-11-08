-- AI Footarch 고정촬영판 서버 설정 (한 번에 실행용)
-- 새 Supabase 프로젝트 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
-- 내용: supabase/schema.sql + admin.sql + content.sql 을 순서대로 합친 것(새 프로젝트에서 한 번만 실행)


-- ════════════ schema.sql ════════════
-- AI Footarch 서버 스키마 (Supabase SQL Editor에서 한 번 실행)
-- 원칙: 사용자는 자기 데이터만 읽고 쓴다(행 수준 보안, RLS). 촬영 사진은 서버에 저장하지 않는다.

-- 1) 회원 프로필: 가입 시 auth.users의 메타데이터에서 자동 생성
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text not null,
  phone text,
  consent_privacy_at timestamptz not null,      -- [필수] 개인정보 수집·이용 동의 시각
  consent_sensitive_at timestamptz not null,    -- [필수] 민감정보(건강 관련) 처리 동의 시각
  consent_research boolean not null default false, -- [선택] 가명 처리 후 연구 활용 동의
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, name, phone, consent_privacy_at, consent_sensitive_at, consent_research)
  values (
    new.id,
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'phone',
    (new.raw_user_meta_data->>'consent_privacy_at')::timestamptz,
    (new.raw_user_meta_data->>'consent_sensitive_at')::timestamptz,
    coalesce((new.raw_user_meta_data->>'consent_research')::boolean, false)
  );
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- 2) 측정 기록(검사 1건 = 1행, 앱의 기록 객체를 data에 그대로 저장)
create table if not exists public.exams (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  foot text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists exams_user_created on public.exams (user_id, created_at desc);

-- 3) 운동 수행 기록
create table if not exists public.exercise_logs (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  foot text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists logs_user_created on public.exercise_logs (user_id, created_at desc);

-- 4) 행 수준 보안: 본인 행만
alter table public.profiles enable row level security;
alter table public.exams enable row level security;
alter table public.exercise_logs enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select using (id = auth.uid());
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

do $$ declare t text; begin
  foreach t in array array['exams', 'exercise_logs'] loop
    execute format('drop policy if exists "own rows select" on public.%I', t);
    execute format('create policy "own rows select" on public.%I for select using (user_id = auth.uid())', t);
    execute format('drop policy if exists "own rows insert" on public.%I', t);
    execute format('create policy "own rows insert" on public.%I for insert with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('create policy "own rows update" on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own rows delete" on public.%I', t);
    execute format('create policy "own rows delete" on public.%I for delete using (user_id = auth.uid())', t);
  end loop;
end $$;

-- 5) 회원 탈퇴: 본인 계정 삭제(연결된 프로필·기록은 on delete cascade로 함께 삭제)
create or replace function public.delete_user() returns void
language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;


-- ════════════ admin.sql ════════════
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


-- ════════════ content.sql ════════════
-- AI Footarch 운동(중재) 영상 콘텐츠 (admin.sql 다음에 SQL Editor에서 한 번 실행)
-- · 관리자만 운동·영상을 올리고 고칠 수 있다(권한은 서버의 is_admin()이 판단).
-- · 공개(published)된 운동은 로그인하지 않은 사용자 앱도 읽을 수 있다(영상은 공개 저장소).

-- 1) 운동 콘텐츠 표
create table if not exists public.exercise_content (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  purpose text not null default '',
  posture text not null default '',
  steps jsonb not null default '[]'::jsonb,
  cautions jsonb not null default '[]'::jsonb,
  reps text not null default '', sets text not null default '', hold_sec text not null default '', per_week text not null default '',
  source text not null default '',
  categories text[] not null default '{}',          -- 연결할 분류: normal / mild / moderate / severe
  video_path text,                                   -- 저장소(exercise-videos)에 올린 파일 경로
  video_url text,                                    -- 또는 영상 주소(mp4 주소·유튜브)
  sort int not null default 100,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.exercise_content enable row level security;
drop policy if exists "content read" on public.exercise_content;
create policy "content read" on public.exercise_content for select using (published or public.is_admin());
drop policy if exists "content admin insert" on public.exercise_content;
create policy "content admin insert" on public.exercise_content for insert to authenticated with check (public.is_admin());
drop policy if exists "content admin update" on public.exercise_content;
create policy "content admin update" on public.exercise_content for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "content admin delete" on public.exercise_content;
create policy "content admin delete" on public.exercise_content for delete to authenticated using (public.is_admin());
grant select on public.exercise_content to anon, authenticated;
grant insert, update, delete on public.exercise_content to authenticated;

-- 2) 영상 저장소(공개 읽기, 관리자만 올리기·지우기). 파일 하나 최대 50 MB(무료 요금제 한도)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos', 'exercise-videos', true, 52428800, array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "exercise videos read" on storage.objects;
create policy "exercise videos read" on storage.objects for select using (bucket_id = 'exercise-videos');
drop policy if exists "exercise videos admin insert" on storage.objects;
create policy "exercise videos admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'exercise-videos' and public.is_admin());
drop policy if exists "exercise videos admin update" on storage.objects;
create policy "exercise videos admin update" on storage.objects for update to authenticated using (bucket_id = 'exercise-videos' and public.is_admin());
drop policy if exists "exercise videos admin delete" on storage.objects;
create policy "exercise videos admin delete" on storage.objects for delete to authenticated using (bucket_id = 'exercise-videos' and public.is_admin());

