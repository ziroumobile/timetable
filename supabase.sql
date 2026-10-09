-- 在 Supabase Dashboard > SQL Editor 貼上執行一次
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  semester text not null,
  name text not null,
  room text,
  credits numeric not null default 0,
  color text,
  -- [{ "day": 0-6 (0=一), "start": 節次index, "end": 節次index, "room": "選填" }]
  slots jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists courses_user_sem_idx on public.courses(user_id, semester);

alter table public.courses enable row level security;

create policy "own select" on public.courses for select using (auth.uid() = user_id);
create policy "own insert" on public.courses for insert with check (auth.uid() = user_id);
create policy "own update" on public.courses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own delete" on public.courses for delete using (auth.uid() = user_id);
