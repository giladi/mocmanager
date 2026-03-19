-- Run this in Supabase SQL Editor

create extension if not exists pgcrypto;

create table if not exists public.mocs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text,
  source_file_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.moc_parts (
  id uuid primary key default gen_random_uuid(),
  moc_id uuid not null references public.mocs(id) on delete cascade,
  part_number text not null,
  color text not null,
  required_qty integer not null check (required_qty > 0),
  have_qty integer not null default 0 check (have_qty >= 0),
  ordered boolean not null default false,
  arrived boolean not null default false,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.mocs enable row level security;
alter table public.moc_parts enable row level security;

drop policy if exists "Users can view their own mocs" on public.mocs;
create policy "Users can view their own mocs"
on public.mocs
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own mocs" on public.mocs;
create policy "Users can insert their own mocs"
on public.mocs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own mocs" on public.mocs;
create policy "Users can update their own mocs"
on public.mocs
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own mocs" on public.mocs;
create policy "Users can delete their own mocs"
on public.mocs
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can view their own moc parts" on public.moc_parts;
create policy "Users can view their own moc parts"
on public.moc_parts
for select
to authenticated
using (
  exists (
    select 1 from public.mocs
    where public.mocs.id = public.moc_parts.moc_id
      and public.mocs.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert their own moc parts" on public.moc_parts;
create policy "Users can insert their own moc parts"
on public.moc_parts
for insert
to authenticated
with check (
  exists (
    select 1 from public.mocs
    where public.mocs.id = public.moc_parts.moc_id
      and public.mocs.user_id = auth.uid()
  )
);

drop policy if exists "Users can update their own moc parts" on public.moc_parts;
create policy "Users can update their own moc parts"
on public.moc_parts
for update
to authenticated
using (
  exists (
    select 1 from public.mocs
    where public.mocs.id = public.moc_parts.moc_id
      and public.mocs.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.mocs
    where public.mocs.id = public.moc_parts.moc_id
      and public.mocs.user_id = auth.uid()
  )
);

drop policy if exists "Users can delete their own moc parts" on public.moc_parts;
create policy "Users can delete their own moc parts"
on public.moc_parts
for delete
to authenticated
using (
  exists (
    select 1 from public.mocs
    where public.mocs.id = public.moc_parts.moc_id
      and public.mocs.user_id = auth.uid()
  )
);

create index if not exists idx_mocs_user_id on public.mocs(user_id);
create index if not exists idx_moc_parts_moc_id on public.moc_parts(moc_id);
create index if not exists idx_moc_parts_part_color on public.moc_parts(part_number, color);
