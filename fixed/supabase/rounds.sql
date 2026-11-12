-- AI Footarch 고정촬영판 — 측정 시트(회차 기록) 서버 설정
-- 실행 순서: setup_all.sql(처음 한 번) → 이 파일(rounds.sql). 여러 번 실행해도 안전하게 작성함.
-- 내용
--  1) 회원 프로필에 학년·성별 추가, 가입할 때 자동으로 채움
--  2) 회차 기록 표(rounds): 한 사람 × 회차(0=기본 측정, 1~4회차)마다 한 줄 — 측정날짜·RT(오른발, mm)·Y-balance
--  3) 관리자: 모든 회원의 프로필·회차 기록을 볼 수 있고, 회차 기록(Y-balance 등)을 고칠 수 있음
--     (회원가입 때 [필수] '담당 선생님(관리자)이 측정 시트에서 확인·관리' 동의를 받음)

-- 1) 프로필: 학년·성별
alter table public.profiles add column if not exists grade text;
alter table public.profiles add column if not exists gender text;
alter table public.profiles alter column phone drop not null;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, name, phone, grade, gender, consent_privacy_at, consent_sensitive_at, consent_research)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user-' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'grade',
    new.raw_user_meta_data->>'gender',
    coalesce((new.raw_user_meta_data->>'consent_privacy_at')::timestamptz, now()),
    coalesce((new.raw_user_meta_data->>'consent_sensitive_at')::timestamptz, now()),
    coalesce((new.raw_user_meta_data->>'consent_research')::boolean, false)
  );
  return new;
end $$;

-- 2) 회차 기록
create table if not exists public.rounds (
  user_id uuid not null references auth.users(id) on delete cascade,
  round smallint not null check (round between 0 and 4),   -- 0 기본 측정, 1~4 회차
  measured_at timestamptz,                                  -- 측정날짜
  rt_mm numeric(5,1),                                       -- RT: 오른발 앱 측정값(발배뼈 하강, mm)
  y_balance numeric(6,1),                                   -- Y-balance(오른발)
  exam_id text,                                             -- 앱 측정 기록 id
  updated_at timestamptz not null default now(),
  primary key (user_id, round)
);
alter table public.rounds enable row level security;

drop policy if exists "own rounds select" on public.rounds;
create policy "own rounds select" on public.rounds for select using (user_id = auth.uid());
drop policy if exists "own rounds insert" on public.rounds;
create policy "own rounds insert" on public.rounds for insert with check (user_id = auth.uid());
drop policy if exists "own rounds update" on public.rounds;
create policy "own rounds update" on public.rounds for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own rounds delete" on public.rounds;
create policy "own rounds delete" on public.rounds for delete using (user_id = auth.uid());

-- 3) 관리자: 모든 회원 프로필·회차 기록 보기, 회차 기록 고치기·지우기
drop policy if exists "admin read all profiles" on public.profiles;
create policy "admin read all profiles" on public.profiles for select using (public.is_admin());
drop policy if exists "admin read rounds" on public.rounds;
create policy "admin read rounds" on public.rounds for select using (public.is_admin());
drop policy if exists "admin insert rounds" on public.rounds;
create policy "admin insert rounds" on public.rounds for insert with check (public.is_admin());
drop policy if exists "admin update rounds" on public.rounds;
create policy "admin update rounds" on public.rounds for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete rounds" on public.rounds;
create policy "admin delete rounds" on public.rounds for delete using (public.is_admin());

-- 관리자가 학년·성별을 고칠 수 있게(회원이 잘못 고른 경우)
drop policy if exists "admin update profiles" on public.profiles;
create policy "admin update profiles" on public.profiles for update using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.rounds to authenticated;
