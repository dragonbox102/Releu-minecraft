create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'releu-backups',
  'releu-backups',
  false,
  52428800,
  array['application/zip']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.releu_cloud_accounts (
  id uuid primary key default gen_random_uuid(),
  restore_key_hash text not null unique,
  device_label text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_seen_at timestamptz
);

create table if not exists public.releu_cloud_backups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.releu_cloud_accounts(id) on delete cascade,
  server_id text not null,
  server_name text not null,
  backup_name text not null,
  object_path text not null unique,
  size_bytes bigint not null check (size_bytes >= 0),
  status text not null default 'pending' check (status in ('pending', 'ready', 'deleted', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists releu_cloud_backups_account_created_idx
  on public.releu_cloud_backups (account_id, created_at desc);

create or replace function public.set_releu_cloud_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_releu_cloud_backups_updated_at on public.releu_cloud_backups;
create trigger trg_releu_cloud_backups_updated_at
before update on public.releu_cloud_backups
for each row
execute function public.set_releu_cloud_updated_at();

alter table public.releu_cloud_accounts enable row level security;
alter table public.releu_cloud_backups enable row level security;

drop policy if exists "deny direct read releu_cloud_accounts" on public.releu_cloud_accounts;
create policy "deny direct read releu_cloud_accounts"
on public.releu_cloud_accounts
for select
to anon, authenticated
using (false);

drop policy if exists "deny direct write releu_cloud_accounts" on public.releu_cloud_accounts;
create policy "deny direct write releu_cloud_accounts"
on public.releu_cloud_accounts
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "deny direct read releu_cloud_backups" on public.releu_cloud_backups;
create policy "deny direct read releu_cloud_backups"
on public.releu_cloud_backups
for select
to anon, authenticated
using (false);

drop policy if exists "deny direct write releu_cloud_backups" on public.releu_cloud_backups;
create policy "deny direct write releu_cloud_backups"
on public.releu_cloud_backups
for all
to anon, authenticated
using (false)
with check (false);
