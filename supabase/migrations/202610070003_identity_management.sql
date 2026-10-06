-- Keep authentication, application accounts, public profiles, and administrator
-- grants separate while retaining a one-to-one relationship through auth.users.
create table if not exists public.user_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists display_name text;
alter table public.admin_accounts add column if not exists display_name text;

-- Backfill users that were created before user_accounts and display_name existed.
insert into public.profiles (id, name, display_name)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''), nullif(u.raw_user_meta_data ->> 'name', ''), split_part(coalesce(u.email, ''), '@', 1), '회원'),
  coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''), nullif(u.raw_user_meta_data ->> 'name', ''), split_part(coalesce(u.email, ''), '@', 1), '회원')
from auth.users u
on conflict (id) do update
set display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name);

update public.profiles
set display_name = coalesce(nullif(display_name, ''), nullif(name, ''), '회원')
where display_name is null or display_name = '';

insert into public.user_accounts (user_id, email, display_name, created_at, updated_at)
select p.id, u.email, p.display_name, coalesce(u.created_at, now()), now()
from public.profiles p
join auth.users u on u.id = p.id
on conflict (user_id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    updated_at = now();

-- An administrator grant is authoritative for the profile role and its label.
update public.profiles p
set role = 'admin'
from public.admin_accounts a
where a.user_id = p.id;

update public.admin_accounts a
set display_name = p.display_name
from public.profiles p
where p.id = a.user_id
  and (a.display_name is null or a.display_name = '');

alter table public.user_accounts enable row level security;
create policy "user accounts own read" on public.user_accounts for select using (auth.uid() = user_id);
create policy "user accounts own update" on public.user_accounts for update using (auth.uid() = user_id);
grant select, insert, update, delete on public.user_accounts to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_name text := coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1), '회원');
begin
  insert into public.profiles (id, name, display_name)
  values (new.id, account_name, account_name)
  on conflict (id) do update set display_name = excluded.display_name;

  insert into public.user_accounts (user_id, email, display_name)
  values (new.id, new.email, account_name)
  on conflict (user_id) do update
  set email = excluded.email, display_name = excluded.display_name, updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
