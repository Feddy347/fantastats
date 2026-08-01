-- Fantastats: Serie A standings/fixtures cache (populated by
-- scripts/update-serie-a-data.js, which aggregates Sorare's own
-- club.games data — no external scraping) plus a stat-leaders RPC for the
-- new Statistiche section, aggregated from our own player_match_stats.

-- ============================================================
-- serie_a_standings
-- ============================================================
create table if not exists public.serie_a_standings (
  id serial primary key,
  team text not null unique,
  played integer not null default 0,
  won integer not null default 0,
  drawn integer not null default 0,
  lost integer not null default 0,
  goals_for integer not null default 0,
  goals_against integer not null default 0,
  goal_difference integer not null default 0,
  points integer not null default 0,
  position integer,
  updated_at timestamptz not null default now()
);

alter table public.serie_a_standings enable row level security;

create policy "serie_a_standings is publicly readable"
  on public.serie_a_standings for select
  using (true);

revoke insert, update, delete on public.serie_a_standings from authenticated;

-- ============================================================
-- serie_a_fixtures
-- ============================================================
create table if not exists public.serie_a_fixtures (
  id serial primary key,
  gameweek integer not null,
  home_team text not null,
  away_team text not null,
  home_score integer,
  away_score integer,
  match_date timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'finished')),
  updated_at timestamptz not null default now(),
  unique (gameweek, home_team, away_team)
);

alter table public.serie_a_fixtures enable row level security;

create policy "serie_a_fixtures is publicly readable"
  on public.serie_a_fixtures for select
  using (true);

revoke insert, update, delete on public.serie_a_fixtures from authenticated;

-- ============================================================
-- get_player_stat_totals: season totals per player, aggregated from our
-- own player_match_stats (only covers matches we've actually polled —
-- grows richer as more gameweeks are played). Powers the Statistiche
-- section's per-stat leaderboards; the frontend sorts/slices client-side
-- by whichever stat tab is selected.
-- ============================================================
create or replace function public.get_player_stat_totals()
returns table (
  player_id bigint,
  matches_played bigint,
  goals bigint,
  assists bigint,
  saves bigint,
  tackles bigint,
  interceptions bigint,
  clean_sheets bigint,
  yellow_cards bigint,
  red_cards bigint
)
language sql
stable
as $$
  select
    pms.player_id,
    count(*)::bigint as matches_played,
    coalesce(sum(pms.goals), 0)::bigint as goals,
    coalesce(sum(pms.goal_assist), 0)::bigint as assists,
    coalesce(sum(pms.saves), 0)::bigint as saves,
    coalesce(sum(pms.won_tackle), 0)::bigint as tackles,
    coalesce(sum(pms.interception_won), 0)::bigint as interceptions,
    coalesce(sum(case when pms.clean_sheet then 1 else 0 end), 0)::bigint as clean_sheets,
    coalesce(sum(pms.yellow_card), 0)::bigint as yellow_cards,
    coalesce(sum(pms.red_card), 0)::bigint as red_cards
  from public.player_match_stats pms
  group by pms.player_id;
$$;

revoke execute on function public.get_player_stat_totals() from public;
grant execute on function public.get_player_stat_totals() to authenticated;
