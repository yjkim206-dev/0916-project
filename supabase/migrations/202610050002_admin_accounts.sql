create table if not exists public.admin_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_accounts enable row level security;
grant select, insert, update, delete on public.admin_accounts to service_role;
