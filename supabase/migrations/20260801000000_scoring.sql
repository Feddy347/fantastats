-- Fantastats: scoring engine tables (Phase 4)
-- matches, raw Sorare stats, calculated scores, and the Sorare player mapping.
-- All four tables are populated exclusively by server-side scripts using the
-- service role key, so client writes are revoked entirely.

-- ============================================================
-- matches
-- ============================================================
create table if not exists public.matches (
  id serial primary key,
  gameweek_id integer not null references public.gameweeks (id) on delete cascade,
  home_team text not null,
  away_team text not null,
  home_score integer,
  away_score integer,
  status text not null default 'upcoming' check (status in ('upcoming', 'live', 'finished')),
  sorare_game_id text,
  starts_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.matches enable row level security;

create policy "matches are publicly readable"
  on public.matches for select
  using (true);

revoke insert, update, delete on public.matches from authenticated;

-- ============================================================
-- player_match_stats: raw per-match Sorare stats for a player
-- ============================================================
create table if not exists public.player_match_stats (
  id serial primary key,
  player_id bigint not null references public.players (id) on delete cascade,
  match_id integer not null references public.matches (id) on delete cascade,
  mins_played integer not null default 0,
  goals integer not null default 0,
  att_pen_goal integer not null default 0,
  goal_assist integer not null default 0,
  ontarget_scoring_att integer not null default 0,
  big_chance_created integer not null default 0,
  assist_penalty_won integer not null default 0,
  att_pen_miss integer not null default 0,
  accurate_pass integer not null default 0,
  total_pass integer not null default 0,
  pass_accuracy real not null default 0,
  won_tackle integer not null default 0,
  total_tackle integer not null default 0,
  interception_won integer not null default 0,
  effective_clearance integer not null default 0,
  duel_won integer not null default 0,
  clearance_off_line integer not null default 0,
  last_man_tackle integer not null default 0,
  saves integer not null default 0,
  penalty_save integer not null default 0,
  goals_conceded integer not null default 0,
  clean_sheet boolean not null default false,
  fouls integer not null default 0,
  yellow_card integer not null default 0,
  red_card integer not null default 0,
  own_goals integer not null default 0,
  error_lead_to_goal integer not null default 0,
  error_lead_to_shot integer not null default 0,
  penalty_conceded integer not null default 0,
  won_contest integer not null default 0,
  three_goals_conceded boolean not null default false,
  game_started boolean not null default false,
  is_live boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (player_id, match_id)
);

alter table public.player_match_stats enable row level security;

create policy "player match stats are publicly readable"
  on public.player_match_stats for select
  using (true);

revoke insert, update, delete on public.player_match_stats from authenticated;

-- ============================================================
-- player_match_scores: calculated score per player per match
-- ============================================================
create table if not exists public.player_match_scores (
  id serial primary key,
  player_id bigint not null references public.players (id) on delete cascade,
  match_id integer not null references public.matches (id) on delete cascade,
  gameweek_id integer not null references public.gameweeks (id) on delete cascade,
  base_score real not null default 0,
  multiplier real not null default 1.0,
  bonus_score real not null default 0,
  malus_score real not null default 0,
  total_score real not null default 0,
  score_breakdown jsonb,
  is_final boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (player_id, match_id)
);

alter table public.player_match_scores enable row level security;

create policy "player match scores are publicly readable"
  on public.player_match_scores for select
  using (true);

revoke insert, update, delete on public.player_match_scores from authenticated;

-- ============================================================
-- sorare_player_mapping
-- ============================================================
create table if not exists public.sorare_player_mapping (
  id serial primary key,
  player_id bigint not null references public.players (id) on delete cascade unique,
  sorare_slug text not null,
  sorare_display_name text,
  matched_at timestamptz not null default now()
);

alter table public.sorare_player_mapping enable row level security;

create policy "sorare player mapping is publicly readable"
  on public.sorare_player_mapping for select
  using (true);

revoke insert, update, delete on public.sorare_player_mapping from authenticated;
