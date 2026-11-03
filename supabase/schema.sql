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
