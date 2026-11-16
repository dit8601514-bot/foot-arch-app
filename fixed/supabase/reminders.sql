-- AI Footarch 고정촬영판: 운동(중재) 알람 — 환자가 요일·시간을 정하면 그 시간에 푸시 알림(F2.8.0)
-- 실행: Supabase → SQL Editor에 붙여 넣고 Run (여러 번 실행해도 안전)

-- 1) 알람 설정: 한 사람 한 줄. days 0=일 1=월 … 6=토, times 'HH:MM'(최대 3개), tz 기기 시간대
create table if not exists public.reminders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  days int[] not null default '{1,3,5}',
  times text[] not null default '{20:00}',
  tz text not null default 'Asia/Seoul',
  last_sent jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.reminders enable row level security;
drop policy if exists "own reminders" on public.reminders;
create policy "own reminders" on public.reminders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "admin read reminders" on public.reminders;
create policy "admin read reminders" on public.reminders for select using (public.is_admin());
grant select, insert, update, delete on public.reminders to authenticated;

-- 2) 푸시 구독(기기마다 하나). 앱이 알림 허용을 받으면 저장
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sub jsonb not null,
  ua text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subs" on public.push_subscriptions;
create policy "own push subs" on public.push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- 3) 알림 발송 키(VAPID): 발송 함수가 처음 실행될 때 스스로 만들어 여기에 보관. 정책 없음 = 앱·관리자 누구도 못 읽음(서버 함수만)
create table if not exists public.push_config (
  id int primary key default 1,
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
