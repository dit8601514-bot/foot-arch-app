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
