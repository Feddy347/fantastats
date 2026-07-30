-- Fantastats: categories, market, roster (Phase 2)

-- ============================================================
-- players: new columns (populated later)
-- ============================================================
alter table public.players add column if not exists birth_year integer;
alter table public.players add column if not exists nationality text;

-- ============================================================
-- profiles: starting credits
-- ============================================================
alter table public.profiles alter column credits set default 500;

-- ============================================================
-- categories
-- ============================================================
create table if not exists public.categories (
  id serial primary key,
  slug text unique not null,
  name text not null,
  description text,
  pool_type text,
  pool_config jsonb,
  is_event boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

create policy "categories are publicly readable"
  on public.categories for select
  using (true);

insert into public.categories (slug, name, description, pool_type, pool_config, is_event) values
('sorprese', 'Sorprese', 'Solo giocatori delle ultime 10 in classifica', 'league_position_bottom', '{"bottom_n": 10}', false),
('elite', 'Elite', 'Solo giocatori delle prime 10 in classifica', 'league_position_top', '{"top_n": 10}', false),
('7-sorelle', '7 Sorelle', 'Solo giocatori di Inter, Milan, Juventus, Roma, Lazio, Fiorentina e Parma', 'fixed_teams', '{"teams": ["Inter","Milan","Juventus","Roma","Lazio","Fiorentina","Parma"]}', false),
('top-performers', 'Top Performers', 'Solo giocatori con punteggio medio top nelle ultime 5 giornate', 'top_scorers', '{"min_avg_last_5": 7}', false),
('under-23', 'Under 23', 'Solo giocatori nati dal 2003 in poi', 'age', '{"min_birth_year": 2003}', false),
('italians-do-it-better', 'Italians do it better', 'Almeno 9 italiani in rosa e 4 in campo', 'nationality', '{"min_italian_roster": 9, "min_italian_lineup": 4}', false)
on conflict (slug) do nothing;

-- ============================================================
-- user_players: the user's shared roster
-- ============================================================
create table if not exists public.user_players (
  id serial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  player_id bigint not null references public.players (id) on delete cascade,
  purchase_price integer not null,
  purchased_at timestamptz not null default now(),
  unique (user_id, player_id)
);

alter table public.user_players enable row level security;

create policy "users can read their own roster"
  on public.user_players for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies: roster changes only happen through
-- the buy_player / sell_player functions below, which run as the table
-- owner and enforce credits + ownership checks atomically.
revoke insert, update, delete on public.user_players from authenticated;

-- ============================================================
-- user_category_enrollments
-- ============================================================
create table if not exists public.user_category_enrollments (
  id serial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id integer not null references public.categories (id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique (user_id, category_id)
);

alter table public.user_category_enrollments enable row level security;

create policy "users can read their own enrollments"
  on public.user_category_enrollments for select
  using (auth.uid() = user_id);

create policy "users can delete their own enrollments"
  on public.user_category_enrollments for delete
  using (auth.uid() = user_id);

-- ============================================================
-- player_prices (scaffold for the future pricing algorithm)
-- ============================================================
create table if not exists public.player_prices (
  id serial primary key,
  player_id bigint not null references public.players (id) on delete cascade,
  price integer not null,
  gameweek integer not null,
  calculated_at timestamptz not null default now(),
  unique (player_id, gameweek)
);

alter table public.player_prices enable row level security;

create policy "player prices are publicly readable"
  on public.player_prices for select
  using (true);

-- ============================================================
-- profiles: credits can only change through server-side functions
-- ============================================================
revoke update on public.profiles from authenticated;
grant update (username, display_name) on public.profiles to authenticated;

-- ============================================================
-- count_eligible_players: how many of a user's roster players
-- qualify for a given category's pool. Used both by the enrollment
-- RLS check below and reusable for future server-side checks.
-- ============================================================
create or replace function public.count_eligible_players(p_user_id uuid, p_category_id integer)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.user_players up
  join public.players p on p.id = up.player_id
  join public.teams t on t.name = p.team
  cross join public.categories c
  where up.user_id = p_user_id
    and c.id = p_category_id
    and (
      (c.pool_type = 'league_position_bottom'
        and t.league_position is not null
        and t.league_position > ((select count(*) from public.teams) - coalesce((c.pool_config->>'bottom_n')::int, 0)))
      or (c.pool_type = 'league_position_top'
        and t.league_position is not null
        and t.league_position <= coalesce((c.pool_config->>'top_n')::int, 0))
      or (c.pool_type = 'fixed_teams'
        and p.team in (select jsonb_array_elements_text(c.pool_config->'teams')))
      or (c.pool_type in ('top_scorers', 'age', 'nationality'))
    );
$$;

revoke execute on function public.count_eligible_players(uuid, integer) from public;
grant execute on function public.count_eligible_players(uuid, integer) to authenticated;

-- Enrollment is only allowed once the user has >= 7 eligible players.
create policy "users can enroll themselves if eligible"
  on public.user_category_enrollments for insert
  with check (
    auth.uid() = user_id
    and public.count_eligible_players(user_id, category_id) >= 7
  );

-- ============================================================
-- get_category_participant_counts: aggregate-only read across all
-- users' enrollments (bypasses the per-user RLS above by design,
-- exposes counts only, never individual rows).
-- ============================================================
create or replace function public.get_category_participant_counts()
returns table(category_id integer, participant_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select category_id, count(*) as participant_count
  from public.user_category_enrollments
  group by category_id;
$$;

revoke execute on function public.get_category_participant_counts() from public;
grant execute on function public.get_category_participant_counts() to authenticated;

-- ============================================================
-- buy_player: atomic credit check + deduction + roster insert
-- ============================================================
create or replace function public.buy_player(p_player_id bigint)
returns public.user_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_price integer;
  v_credits integer;
  v_row public.user_players;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select price_current into v_price from public.players where id = p_player_id;
  if v_price is null then
    raise exception 'Player not found';
  end if;

  if exists (select 1 from public.user_players where user_id = v_user_id and player_id = p_player_id) then
    raise exception 'Player already owned';
  end if;

  select credits into v_credits from public.profiles where id = v_user_id for update;
  if v_credits is null or v_credits < v_price then
    raise exception 'Insufficient credits';
  end if;

  update public.profiles set credits = credits - v_price where id = v_user_id;

  insert into public.user_players (user_id, player_id, purchase_price)
  values (v_user_id, p_player_id, v_price)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.buy_player(bigint) from public;
grant execute on function public.buy_player(bigint) to authenticated;

-- ============================================================
-- sell_player: atomic ownership check + roster delete + refund
-- ============================================================
create or replace function public.sell_player(p_player_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_price integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (select 1 from public.user_players where user_id = v_user_id and player_id = p_player_id) then
    raise exception 'Player not owned';
  end if;

  select price_current into v_price from public.players where id = p_player_id;

  delete from public.user_players where user_id = v_user_id and player_id = p_player_id;

  update public.profiles set credits = credits + coalesce(v_price, 0) where id = v_user_id;
end;
$$;

revoke execute on function public.sell_player(bigint) from public;
grant execute on function public.sell_player(bigint) to authenticated;
