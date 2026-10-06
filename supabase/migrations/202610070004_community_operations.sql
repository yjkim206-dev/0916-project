create table public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  content text not null check (char_length(content) between 1 and 5000),
  is_published boolean not null default true,
  author_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 160),
  content text not null check (char_length(content) between 1 and 5000),
  answer text,
  answered_by uuid references auth.users(id) on delete set null,
  answered_at timestamptz,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 100),
  detail text not null default '' check (char_length(detail) <= 3000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

alter table public.notices enable row level security;
alter table public.inquiries enable row level security;
alter table public.reports enable row level security;
grant select, insert, update, delete on public.notices, public.inquiries, public.reports to service_role;

create index notices_published_created_at_idx on public.notices (is_published, created_at desc);
create index inquiries_user_created_at_idx on public.inquiries (user_id, created_at desc);
create index reports_status_created_at_idx on public.reports (status, created_at desc);
