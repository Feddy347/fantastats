-- Fantastats: custom leagues (Phase 6) — creation/join, rosters, lineups,
-- in-person auction, sealed bids. Standings/calendar are Phase 7 placeholders.

-- ============================================================
-- leagues
-- ============================================================
create table if not exists public.leagues (
  id serial primary key,
  name text not null,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  invite_code text unique not null,
  formation_type text not null default '7' check (formation_type in ('7', '11')),
  role_system text not null default 'fantastats' check (role_system in ('classic', 'mantra', 'fantastats')),
  competition_format text not null default 'royal_rumble_seria' check (competition_format in (
    'direct_serie_a', 'direct_vote_sum', 'royal_rumble_seria', 'royal_rumble_f1'
  )),
  market_type text not null default 'auction' check (market_type in ('auction', 'credits')),
  roster_size integer not null default 18 check (
    (formation_type = '7' and roster_size between 12 and 24)
    or (formation_type = '11' and roster_size between 20 and 32)
  ),
  starting_credits integer not null default 500,
  formation_deadline_minutes integer default 15,
  postponed_rule text default 'political_score' check (postponed_rule in ('political_score', 'zero')),
  political_score real default 6.0,
  status text not null default 'setup' check (status in ('setup', 'active', 'completed')),
  season_start_gameweek integer references public.gameweeks (id),
  -- The deadline of the currently-open sealed-bid session (repair market for
  -- auction leagues, or periodic re-market for either type). Nullable: no
  -- column dedicated to "sessions" exists, so this is the shared reference
  -- point every member's bid attaches to; the admin sets it when opening a
  -- round and it's cleared (or moved forward) when they open the next one.
  sealed_bid_deadline timestamptz,
  created_at timestamptz not null default now()
);

alter table public.leagues enable row level security;

create policy "leagues are publicly readable"
  on public.leagues for select
  using (true);

create policy "authenticated users can create a league they administer"
  on public.leagues for insert
  with check (auth.uid() = admin_id);

create policy "admin can update their league"
  on public.leagues for update
  using (auth.uid() = admin_id)
  with check (auth.uid() = admin_id);

create policy "admin can delete their league"
  on public.leagues for delete
  using (auth.uid() = admin_id);

-- ============================================================
-- league_members
-- ============================================================
create table if not exists public.league_members (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  team_name text,
  league_credits integer not null default 0,
  joined_at timestamptz not null default now(),
  unique (league_id, user_id)
);

alter table public.league_members enable row level security;

create policy "members can read their league's roster of members"
  on public.league_members for select
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = league_members.league_id and lm.user_id = auth.uid()
    )
  );

create policy "users can join a league that is still in setup"
  on public.league_members for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.leagues l where l.id = league_id and l.status = 'setup')
  );

create policy "admin or the member themselves can leave/remove"
  on public.league_members for delete
  using (
    auth.uid() = user_id
    or exists (select 1 from public.leagues l where l.id = league_id and l.admin_id = auth.uid())
  );

-- ============================================================
-- league_rosters: writes only via league_buy_player / league_sell_player /
-- auction_assign_player below (mirrors user_players in Phase 2).
-- ============================================================
create table if not exists public.league_rosters (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  player_id bigint not null references public.players (id) on delete cascade,
  purchase_price integer not null,
  acquired_at timestamptz not null default now(),
  unique (league_id, user_id, player_id)
);

alter table public.league_rosters enable row level security;

create policy "members can read their league's rosters"
  on public.league_rosters for select
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = league_rosters.league_id and lm.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.league_rosters from authenticated;

-- ============================================================
-- league_lineups / league_lineup_players
-- ============================================================
create table if not exists public.league_lineups (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  gameweek_id integer not null references public.gameweeks (id) on delete cascade,
  module text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, user_id, gameweek_id)
);

alter table public.league_lineups enable row level security;

create policy "members can read their league's lineups"
  on public.league_lineups for select
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = league_lineups.league_id and lm.user_id = auth.uid()
    )
  );

-- A league's formation deadline is starts_at minus the league's own
-- formation_deadline_minutes setting (not the global gameweeks.deadline,
-- which belongs to the categories system).
create policy "members can save their own lineup before the league deadline"
  on public.league_lineups for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.league_members lm
      join public.leagues l on l.id = lm.league_id
      join public.gameweeks g on g.id = gameweek_id
      where lm.league_id = league_id
        and lm.user_id = auth.uid()
        and (g.starts_at is null or now() < g.starts_at - make_interval(mins => coalesce(l.formation_deadline_minutes, 15)))
    )
  );

create policy "members can update their own lineup before the league deadline"
  on public.league_lineups for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.leagues l
      join public.gameweeks g on g.id = gameweek_id
      where l.id = league_id
        and (g.starts_at is null or now() < g.starts_at - make_interval(mins => coalesce(l.formation_deadline_minutes, 15)))
    )
  );

create table if not exists public.league_lineup_players (
  id serial primary key,
  lineup_id integer not null references public.league_lineups (id) on delete cascade,
  player_id bigint not null references public.players (id) on delete cascade,
  slot_type text not null check (slot_type in ('starter', 'bench')),
  slot_role text,
  slot_position integer,
  unique (lineup_id, player_id)
);

alter table public.league_lineup_players enable row level security;

create policy "members can read their league's lineup players"
  on public.league_lineup_players for select
  using (
    exists (
      select 1 from public.league_lineups ll
      join public.league_members lm on lm.league_id = ll.league_id and lm.user_id = auth.uid()
      where ll.id = lineup_id
    )
  );

create policy "users can write their own lineup players"
  on public.league_lineup_players for insert
  with check (exists (select 1 from public.league_lineups ll where ll.id = lineup_id and ll.user_id = auth.uid()));

create policy "users can delete their own lineup players"
  on public.league_lineup_players for delete
  using (exists (select 1 from public.league_lineups ll where ll.id = lineup_id and ll.user_id = auth.uid()));

-- ============================================================
-- auction_log: writes only via auction_assign_player below.
-- ============================================================
create table if not exists public.auction_log (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  player_id bigint not null references public.players (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  price integer not null,
  round integer,
  created_at timestamptz not null default now()
);

alter table public.auction_log enable row level security;

create policy "members can read their league's auction log"
  on public.auction_log for select
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = auction_log.league_id and lm.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.auction_log from authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'auction_log'
  ) then
    alter publication supabase_realtime add table public.auction_log;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'league_rosters'
  ) then
    alter publication supabase_realtime add table public.league_rosters;
  end if;
end $$;

-- ============================================================
-- sealed_bids
-- ============================================================
create table if not exists public.sealed_bids (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  player_id bigint not null references public.players (id) on delete cascade,
  bid_amount integer not null,
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'cancelled')),
  deadline timestamptz not null,
  created_at timestamptz not null default now(),
  unique (league_id, user_id, player_id, deadline)
);

alter table public.sealed_bids enable row level security;

-- Before the deadline you can only see your own bids (secrecy); once the
-- deadline passes everyone's bids for that session become visible.
create policy "own bids before deadline, everyone's after"
  on public.sealed_bids for select
  using (auth.uid() = user_id or now() >= deadline);

create policy "members can place their own sealed bid with enough credits"
  on public.sealed_bids for insert
  with check (
    auth.uid() = user_id
    and now() < deadline
    and exists (
      select 1 from public.league_members lm
      where lm.league_id = sealed_bids.league_id and lm.user_id = auth.uid() and lm.league_credits >= bid_amount
    )
  );

-- Resolution (win/lose/cancel) happens server-side in resolve-sealed-bids.js
-- with the service role key.
revoke update, delete on public.sealed_bids from authenticated;

-- ============================================================
-- get_league_preview: public lookup by invite code (name, admin, member
-- count, key settings) without exposing full league_members rows to
-- non-members.
-- ============================================================
create or replace function public.get_league_preview(p_invite_code text)
returns table (
  league_id integer,
  name text,
  admin_username text,
  member_count bigint,
  formation_type text,
  role_system text,
  market_type text,
  competition_format text,
  starting_credits integer,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.name,
    p.username,
    (select count(*) from public.league_members lm where lm.league_id = l.id),
    l.formation_type,
    l.role_system,
    l.market_type,
    l.competition_format,
    l.starting_credits,
    l.status
  from public.leagues l
  join public.profiles p on p.id = l.admin_id
  where l.invite_code = p_invite_code;
$$;

revoke execute on function public.get_league_preview(text) from public;
grant execute on function public.get_league_preview(text) to authenticated;

-- ============================================================
-- league_buy_player: atomic credit check + deduction + exclusive-ownership
-- roster insert (a player can only belong to one member per league).
-- ============================================================
create or replace function public.league_buy_player(p_league_id integer, p_player_id bigint)
returns public.league_rosters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_price integer;
  v_credits integer;
  v_row public.league_rosters;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (select 1 from public.league_members where league_id = p_league_id and user_id = v_user_id) then
    raise exception 'Not a member of this league';
  end if;

  if exists (select 1 from public.league_rosters where league_id = p_league_id and player_id = p_player_id) then
    raise exception 'Player already owned in this league';
  end if;

  select price_current into v_price from public.players where id = p_player_id;
  if v_price is null then
    raise exception 'Player not found';
  end if;

  select league_credits into v_credits
  from public.league_members
  where league_id = p_league_id and user_id = v_user_id
  for update;

  if v_credits is null or v_credits < v_price then
    raise exception 'Insufficient credits';
  end if;

  update public.league_members
  set league_credits = league_credits - v_price
  where league_id = p_league_id and user_id = v_user_id;

  insert into public.league_rosters (league_id, user_id, player_id, purchase_price)
  values (p_league_id, v_user_id, p_player_id, v_price)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.league_buy_player(integer, bigint) from public;
grant execute on function public.league_buy_player(integer, bigint) to authenticated;

-- ============================================================
-- league_sell_player: atomic ownership check + roster delete + refund
-- ============================================================
create or replace function public.league_sell_player(p_league_id integer, p_player_id bigint)
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

  if not exists (
    select 1 from public.league_rosters
    where league_id = p_league_id and user_id = v_user_id and player_id = p_player_id
  ) then
    raise exception 'Player not owned in this league';
  end if;

  select price_current into v_price from public.players where id = p_player_id;

  delete from public.league_rosters
  where league_id = p_league_id and user_id = v_user_id and player_id = p_player_id;

  update public.league_members
  set league_credits = league_credits + coalesce(v_price, 0)
  where league_id = p_league_id and user_id = v_user_id;
end;
$$;

revoke execute on function public.league_sell_player(integer, bigint) from public;
grant execute on function public.league_sell_player(integer, bigint) to authenticated;

-- ============================================================
-- auction_assign_player: admin-only assignment during the in-person auction
-- ============================================================
create or replace function public.auction_assign_player(
  p_league_id integer,
  p_player_id bigint,
  p_buyer_id uuid,
  p_price integer,
  p_round integer default null
)
returns public.league_rosters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_credits integer;
  v_row public.league_rosters;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (select 1 from public.leagues where id = p_league_id and admin_id = v_user_id) then
    raise exception 'Only the league admin can assign auction players';
  end if;

  if not exists (select 1 from public.league_members where league_id = p_league_id and user_id = p_buyer_id) then
    raise exception 'Buyer is not a member of this league';
  end if;

  if exists (select 1 from public.league_rosters where league_id = p_league_id and player_id = p_player_id) then
    raise exception 'Player already assigned in this league';
  end if;

  select league_credits into v_credits
  from public.league_members
  where league_id = p_league_id and user_id = p_buyer_id
  for update;

  if v_credits is null or v_credits < p_price then
    raise exception 'Buyer has insufficient credits';
  end if;

  update public.league_members
  set league_credits = league_credits - p_price
  where league_id = p_league_id and user_id = p_buyer_id;

  insert into public.league_rosters (league_id, user_id, player_id, purchase_price)
  values (p_league_id, p_buyer_id, p_player_id, p_price)
  returning * into v_row;

  insert into public.auction_log (league_id, player_id, buyer_id, price, round)
  values (p_league_id, p_player_id, p_buyer_id, p_price, p_round);

  return v_row;
end;
$$;

revoke execute on function public.auction_assign_player(integer, bigint, uuid, integer, integer) from public;
grant execute on function public.auction_assign_player(integer, bigint, uuid, integer, integer) to authenticated;
