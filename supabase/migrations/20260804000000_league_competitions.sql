-- Fantastats: league competitions (Phase 7) — calendar, standings, both
-- direct-matchup and royal-rumble formats.

-- ============================================================
-- league_calendar
-- ============================================================
create table if not exists public.league_calendar (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  gameweek_id integer not null references public.gameweeks (id) on delete cascade,
  cycle integer not null,
  is_return boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.league_calendar enable row level security;

create policy "members can read their league's calendar"
  on public.league_calendar for select
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = league_calendar.league_id and lm.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.league_calendar from authenticated;

-- ============================================================
-- league_matchups
-- ============================================================
create table if not exists public.league_matchups (
  id serial primary key,
  calendar_id integer not null references public.league_calendar (id) on delete cascade,
  home_user_id uuid not null references public.profiles (id) on delete cascade,
  away_user_id uuid not null references public.profiles (id) on delete cascade,
  home_score real,
  away_score real,
  home_result integer,
  away_result integer,
  is_played boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.league_matchups enable row level security;

create policy "members can read their league's matchups"
  on public.league_matchups for select
  using (
    exists (
      select 1 from public.league_calendar lc
      join public.league_members lm on lm.league_id = lc.league_id and lm.user_id = auth.uid()
      where lc.id = calendar_id
    )
  );

revoke insert, update, delete on public.league_matchups from authenticated;

-- ============================================================
-- league_standings
-- ============================================================
create table if not exists public.league_standings (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  points integer not null default 0,
  played integer not null default 0,
  won integer not null default 0,
  drawn integer not null default 0,
  lost integer not null default 0,
  total_fantasy_score real not null default 0,
  rank integer,
  updated_at timestamptz not null default now(),
  unique (league_id, user_id)
);

alter table public.league_standings enable row level security;

create policy "members can read their league's standings"
  on public.league_standings for select
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = league_standings.league_id and lm.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.league_standings from authenticated;

-- ============================================================
-- league_gameweek_scores
-- ============================================================
create table if not exists public.league_gameweek_scores (
  id serial primary key,
  league_id integer not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  gameweek_id integer not null references public.gameweeks (id) on delete cascade,
  total_score real not null default 0,
  league_points integer not null default 0,
  rank_in_gameweek integer,
  is_final boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (league_id, user_id, gameweek_id)
);

alter table public.league_gameweek_scores enable row level security;

create policy "members can read their league's gameweek scores"
  on public.league_gameweek_scores for select
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = league_gameweek_scores.league_id and lm.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.league_gameweek_scores from authenticated;

-- ============================================================
-- generate_league_calendar: admin-triggered, once, when starting the season.
--
-- direct_* formats: standard round-robin via the circle method (participant
-- 0 fixed, the rest rotate one position each round; odd N gets a padded bye
-- who sits out whichever round they're paired with it). The return leg
-- reuses the exact same round-by-round pairings with home/away swapped.
--
-- royal_rumble_* formats: no fixture list needed (everyone is compared to
-- everyone every gameweek by the consolidation script), so this just
-- reserves one calendar row per available gameweek with no matchups.
-- ============================================================
create or replace function public.generate_league_calendar(p_league_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league record;
  v_start_number integer;
  v_members uuid[];
  n integer;
  padded uuid[];
  m integer;
  rounds_per_leg integer;
  available_gws integer;
  cycles integer;
  global_round_idx integer := 0;
  cyc integer;
  leg integer;
  r integer;
  i integer;
  gw_number integer;
  gw_id integer;
  calendar_row_id integer;
  home_id uuid;
  away_id uuid;
begin
  select * into v_league from public.leagues where id = p_league_id;
  if v_league is null then
    raise exception 'League not found';
  end if;
  if v_league.admin_id <> auth.uid() then
    raise exception 'Only the league admin can generate the calendar';
  end if;
  if exists (select 1 from public.league_calendar where league_id = p_league_id) then
    raise exception 'Calendar already generated for this league';
  end if;

  select number into v_start_number from public.gameweeks where id = v_league.season_start_gameweek;
  if v_start_number is null then
    raise exception 'League has no season_start_gameweek set';
  end if;

  -- Royal rumble: just reserve the remaining gameweeks, no fixtures.
  if v_league.competition_format like 'royal_rumble%' then
    for gw_number in v_start_number..38 loop
      select id into gw_id from public.gameweeks where number = gw_number;
      if gw_id is not null then
        insert into public.league_calendar (league_id, gameweek_id, cycle, is_return)
        values (p_league_id, gw_id, 1, false);
      end if;
    end loop;
    return;
  end if;

  select array_agg(user_id order by joined_at) into v_members
  from public.league_members where league_id = p_league_id;

  n := coalesce(array_length(v_members, 1), 0);
  if n < 2 then
    raise exception 'Not enough members to generate a calendar';
  end if;

  if n % 2 = 1 then
    padded := v_members || array[null::uuid];
  else
    padded := v_members;
  end if;
  m := array_length(padded, 1);
  rounds_per_leg := m - 1;

  available_gws := 38 - v_start_number + 1;
  cycles := floor(available_gws::numeric / (rounds_per_leg * 2));

  if cycles < 1 then
    raise exception 'Not enough remaining gameweeks to generate even one full andata+ritorno cycle';
  end if;

  for cyc in 1..cycles loop
    for leg in 0..1 loop -- 0 = andata, 1 = ritorno (same pairings, swapped home/away)
      declare
        rotating uuid[] := padded;
      begin
        for r in 1..rounds_per_leg loop
          gw_number := v_start_number + global_round_idx;

          select id into gw_id from public.gameweeks where number = gw_number;
          if gw_id is null then
            raise exception 'No gameweek found with number %', gw_number;
          end if;

          insert into public.league_calendar (league_id, gameweek_id, cycle, is_return)
          values (p_league_id, gw_id, cyc, leg = 1)
          returning id into calendar_row_id;

          for i in 1..(m / 2) loop
            if leg = 0 then
              home_id := rotating[i];
              away_id := rotating[m + 1 - i];
            else
              home_id := rotating[m + 1 - i];
              away_id := rotating[i];
            end if;

            if home_id is not null and away_id is not null then
              insert into public.league_matchups (calendar_id, home_user_id, away_user_id)
              values (calendar_row_id, home_id, away_id);
            end if;
          end loop;

          rotating := array[rotating[1], rotating[m]] || rotating[2:m - 1];
          global_round_idx := global_round_idx + 1;
        end loop;
      end;
    end loop;
  end loop;
end;
$$;

revoke execute on function public.generate_league_calendar(integer) from public;
grant execute on function public.generate_league_calendar(integer) to authenticated;
