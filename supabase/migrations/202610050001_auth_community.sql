create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);
create table public.posts (
  id uuid primary key default gen_random_uuid(), category text not null default '자유', title text not null,
  content text not null, author_id uuid not null references public.profiles(id) on delete cascade,
  views integer not null default 0, likes integer not null default 0, dislikes integer not null default 0,
  hidden boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.comments (
  id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade, content text not null,
  hidden boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.post_views (post_id uuid references public.posts(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, created_at timestamptz default now(), primary key(post_id,user_id));
create table public.post_reactions (post_id uuid references public.posts(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, reaction text not null check(reaction in ('like','dislike')), primary key(post_id,user_id));
alter table public.profiles enable row level security; alter table public.posts enable row level security; alter table public.comments enable row level security;
create policy "profiles readable" on public.profiles for select using (true);
create policy "profiles own update" on public.profiles for update using (auth.uid()=id);
create policy "posts readable" on public.posts for select using (not hidden or auth.uid()=author_id);
create policy "posts insert" on public.posts for insert with check (auth.uid()=author_id);
create policy "posts own update" on public.posts for update using (auth.uid()=author_id);
create policy "posts own delete" on public.posts for delete using (auth.uid()=author_id);
create policy "comments readable" on public.comments for select using (not hidden or auth.uid()=author_id);
create policy "comments insert" on public.comments for insert with check (auth.uid()=author_id);
create policy "comments own update" on public.comments for update using (auth.uid()=author_id);
create policy "comments own delete" on public.comments for delete using (auth.uid()=author_id);
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles(id,name) values(new.id,coalesce(new.raw_user_meta_data->>'name',split_part(new.email,'@',1))); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
