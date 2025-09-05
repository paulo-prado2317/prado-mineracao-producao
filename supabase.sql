
-- Rode este script no Supabase (SQL Editor)

create extension if not exists pgcrypto;

create table if not exists production_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date date not null,
  start text,
  "end" text,
  shift text,
  stage text check (stage in ('Britagem','Moagem')),
  equipment text,
  tonnage numeric not null,
  moisture numeric,
  operator text,
  notes text,
  hours numeric,
  tph numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table production_entries enable row level security;

create policy "own rows" on production_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function set_updated_at()
  returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists trg_set_updated_at on production_entries;
create trigger trg_set_updated_at before update on production_entries
  for each row execute procedure set_updated_at();
