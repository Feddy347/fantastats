-- Fantastats: initial schema (players, profiles, teams) + RLS + auto-profile trigger

-- ============================================================
-- teams
-- ============================================================
create table if not exists public.teams (
  id serial primary key,
  name text unique not null,
  short_name text,
  league_position integer
);

alter table public.teams enable row level security;

create policy "teams are publicly readable"
  on public.teams for select
  using (true);

-- ============================================================
-- players
-- ============================================================
create table if not exists public.players (
  id bigint primary key,
  name text not null,
  team text not null,
  role_classic text,
  role_mantra text,
  role_fantastats text,
  price_current integer,
  price_initial integer,
  fanta_value integer,
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;

create policy "players are publicly readable"
  on public.players for select
  using (true);

-- ============================================================
-- profiles
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  display_name text,
  credits integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ============================================================
-- auto-create a profile row whenever a new auth user is created
-- (covers both email/password signup with a chosen username,
-- and Google OAuth which has no username metadata)
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'username',
      lower(split_part(new.email, '@', 1)) || '_' || substr(new.id::text, 1, 8)
    ),
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
