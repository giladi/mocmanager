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

drop policy if exists mocs_select_own on public.mocs;
create policy mocs_select_own on public.mocs for select to authenticated using (auth.uid() = user_id);
drop policy if exists mocs_insert_own on public.mocs;
create policy mocs_insert_own on public.mocs for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists mocs_update_own on public.mocs;
create policy mocs_update_own on public.mocs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists mocs_delete_own on public.mocs;
create policy mocs_delete_own on public.mocs for delete to authenticated using (auth.uid() = user_id);

drop policy if exists parts_select_own on public.moc_parts;
create policy parts_select_own on public.moc_parts for select to authenticated using (
  exists (select 1 from public.mocs where public.mocs.id = public.moc_parts.moc_id and public.mocs.user_id = auth.uid())
);
drop policy if exists parts_insert_own on public.moc_parts;
create policy parts_insert_own on public.moc_parts for insert to authenticated with check (
  exists (select 1 from public.mocs where public.mocs.id = public.moc_parts.moc_id and public.mocs.user_id = auth.uid())
);
drop policy if exists parts_update_own on public.moc_parts;
create policy parts_update_own on public.moc_parts for update to authenticated using (
  exists (select 1 from public.mocs where public.mocs.id = public.moc_parts.moc_id and public.mocs.user_id = auth.uid())
) with check (
  exists (select 1 from public.mocs where public.mocs.id = public.moc_parts.moc_id and public.mocs.user_id = auth.uid())
);
drop policy if exists parts_delete_own on public.moc_parts;
create policy parts_delete_own on public.moc_parts for delete to authenticated using (
  exists (select 1 from public.mocs where public.mocs.id = public.moc_parts.moc_id and public.mocs.user_id = auth.uid())
);


create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  vendor text,
  order_date date,
  tracking_number text,
  notes text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  moc_part_id uuid not null references public.moc_parts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(order_id, moc_part_id)
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders for select to authenticated using (auth.uid() = user_id);
drop policy if exists orders_insert_own on public.orders;
create policy orders_insert_own on public.orders for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists orders_update_own on public.orders;
create policy orders_update_own on public.orders for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists orders_delete_own on public.orders;
create policy orders_delete_own on public.orders for delete to authenticated using (auth.uid() = user_id);

drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own on public.order_items
for select to authenticated using (
  exists (select 1 from public.orders where public.orders.id = public.order_items.order_id and public.orders.user_id = auth.uid())
);
drop policy if exists order_items_insert_own on public.order_items;
create policy order_items_insert_own on public.order_items
for insert to authenticated with check (
  exists (select 1 from public.orders where public.orders.id = public.order_items.order_id and public.orders.user_id = auth.uid())
);
drop policy if exists order_items_delete_own on public.order_items;
create policy order_items_delete_own on public.order_items
for delete to authenticated using (
  exists (select 1 from public.orders where public.orders.id = public.order_items.order_id and public.orders.user_id = auth.uid())
);


alter table public.order_items
  add column if not exists qty_ordered integer,
  add column if not exists qty_arrived integer not null default 0,
  add column if not exists line_status text not null default 'ordered',
  add column if not exists vendor_sku text,
  add column if not exists substitution_note text;

drop policy if exists order_items_update_own on public.order_items;
create policy order_items_update_own on public.order_items
for update to authenticated using (
  exists (
    select 1 from public.orders
    where public.orders.id = public.order_items.order_id
      and public.orders.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.orders
    where public.orders.id = public.order_items.order_id
      and public.orders.user_id = auth.uid()
  )
);


alter table public.mocs
  add column if not exists build_status text not null default 'planning',
  add column if not exists priority text not null default 'medium';


alter table public.moc_parts
  add column if not exists note text;


alter table public.moc_parts
  add column if not exists substitute_mode text not null default 'exact',
  add column if not exists substitute_note text;


create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  view_type text not null default 'dashboard',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.saved_views enable row level security;

drop policy if exists saved_views_select_own on public.saved_views;
create policy saved_views_select_own on public.saved_views
for select to authenticated using (auth.uid() = user_id);

drop policy if exists saved_views_insert_own on public.saved_views;
create policy saved_views_insert_own on public.saved_views
for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists saved_views_update_own on public.saved_views;
create policy saved_views_update_own on public.saved_views
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists saved_views_delete_own on public.saved_views;
create policy saved_views_delete_own on public.saved_views
for delete to authenticated using (auth.uid() = user_id);
