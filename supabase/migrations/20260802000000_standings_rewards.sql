-- Fantastats: standings, rewards, live-scores aggregation (Phase 5)

-- ============================================================
-- category_gameweek_scores
-- ============================================================
create table if not exists public.category_gameweek_scores (
  id serial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id integer not null references public.categories (id) on delete cascade,
  gameweek_id integer not null references public.gameweeks (id) on delete cascade,
  total_score real not null default 0,
  rank integer,
  is_final boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, gameweek_id)
);

alter table public.category_gameweek_scores enable row level security;

create policy "gameweek scores are publicly readable"
  on public.category_gameweek_scores for select
  using (true);

revoke insert, update, delete on public.category_gameweek_scores from authenticated;

-- ============================================================
-- category_season_standings
-- ============================================================
create table if not exists public.category_season_standings (
  id serial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id integer not null references public.categories (id) on delete cascade,
  total_score real not null default 0,
  gameweeks_played integer not null default 0,
  gameweeks_available integer not null default 0,
  is_eligible boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, category_id)
);

alter table public.category_season_standings enable row level security;

create policy "season standings are publicly readable"
  on public.category_season_standings for select
  using (true);

revoke insert, update, delete on public.category_season_standings from authenticated;

-- ============================================================
-- rewards
-- ============================================================
create table if not exists public.rewards (
  id serial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id integer not null references public.categories (id) on delete cascade,
  gameweek_id integer not null references public.gameweeks (id) on delete cascade,
  reward_type text not null check (reward_type in ('credits', 'player')),
  reward_value integer,
  claimed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.rewards enable row level security;

create policy "users can read their own rewards"
  on public.rewards for select
  using (auth.uid() = user_id);

-- Rewards are only ever inserted by consolidate-gameweek.js (service role,
-- bypasses RLS). Clients may only flip their own reward to claimed.
revoke insert, update, delete on public.rewards from authenticated;
grant update (claimed) on public.rewards to authenticated;

create policy "users can claim their own rewards"
  on public.rewards for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- get_live_scores: this user's fielded categories for a gameweek, each
-- with the live total, live rank among that category's enrollees, and
-- the per-player breakdown needed to render a Live tile.
-- ============================================================
create or replace function public.get_live_scores(p_user_id uuid, p_gameweek_id integer)
returns jsonb
language sql
stable
as $$
  with my_categories as (
    select distinct l.category_id
    from public.lineups l
    where l.user_id = p_user_id and l.gameweek_id = p_gameweek_id
  ),
  totals as (
    select
      e.category_id,
      e.user_id,
      coalesce(sum(pms.total_score), 0)::real as total_score
    from public.user_category_enrollments e
    join my_categories mc on mc.category_id = e.category_id
    left join public.lineups l
      on l.user_id = e.user_id and l.category_id = e.category_id and l.gameweek_id = p_gameweek_id
    left join public.lineup_players lp
      on lp.lineup_id = l.id and lp.slot_type = 'starter'
    left join public.player_match_scores pms
      on pms.player_id = lp.player_id and pms.gameweek_id = p_gameweek_id
    group by e.category_id, e.user_id
  ),
  ranked as (
    select
      category_id,
      user_id,
      total_score,
      rank() over (partition by category_id order by total_score desc) as rank
    from totals
  ),
  my_players as (
    select
      l.category_id,
      lp.player_id,
      p.name,
      lp.slot_role as role,
      lp.slot_position,
      pms.total_score as score,
      coalesce(pmst.is_live, false) as is_live,
      coalesce(pms.is_final, false) as is_done
    from public.lineups l
    join public.lineup_players lp on lp.lineup_id = l.id and lp.slot_type = 'starter'
    join public.players p on p.id = lp.player_id
    left join public.player_match_scores pms
      on pms.player_id = lp.player_id and pms.gameweek_id = p_gameweek_id
    left join public.player_match_stats pmst
      on pmst.player_id = lp.player_id and pmst.match_id = pms.match_id
    where l.user_id = p_user_id and l.gameweek_id = p_gameweek_id
  ),
  player_agg as (
    select
      category_id,
      jsonb_agg(
        jsonb_build_object(
          'player_id', player_id,
          'name', name,
          'role', role,
          'score', score,
          'is_live', is_live
        )
        order by slot_position
      ) as players,
      count(*) filter (where is_done) as completed_count,
      count(*) as total_count
    from my_players
    group by category_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'category_id', mc.category_id,
        'category_name', c.name,
        'total_score', coalesce(r.total_score, 0),
        'rank', coalesce(r.rank, 1),
        'players', coalesce(pa.players, '[]'::jsonb),
        'completed_count', coalesce(pa.completed_count, 0),
        'total_count', coalesce(pa.total_count, 0)
      )
      order by c.id
    ),
    '[]'::jsonb
  )
  from my_categories mc
  join public.categories c on c.id = mc.category_id
  left join ranked r on r.category_id = mc.category_id and r.user_id = p_user_id
  left join player_agg pa on pa.category_id = mc.category_id;
$$;

revoke execute on function public.get_live_scores(uuid, integer) from public;
grant execute on function public.get_live_scores(uuid, integer) to authenticated;

-- ============================================================
-- Realtime: the Live page subscribes to player_match_scores changes.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'player_match_scores'
  ) then
    alter publication supabase_realtime add table public.player_match_scores;
  end if;
end $$;
