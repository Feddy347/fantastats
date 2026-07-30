-- Fantastats: gameweeks + lineups (Phase 3)

-- ============================================================
-- gameweeks
-- ============================================================
create table if not exists public.gameweeks (
  id serial primary key,
  number integer unique not null,
  starts_at timestamptz,
  deadline timestamptz,
  status text not null default 'upcoming' check (status in ('upcoming', 'live', 'completed')),
  created_at timestamptz not null default now()
);

alter table public.gameweeks enable row level security;

create policy "gameweeks are publicly readable"
  on public.gameweeks for select
  using (true);

-- No client writes: gameweek status/dates are managed from the SQL editor / a future admin job.
revoke insert, update, delete on public.gameweeks from authenticated;

insert into public.gameweeks (number, starts_at, deadline, status)
select
  n,
  '2025-08-17'::timestamptz + (n - 1) * interval '7 days',
  '2025-08-17'::timestamptz + (n - 1) * interval '7 days' - interval '15 minutes',
  'upcoming'
from generate_series(1, 38) as n
on conflict (number) do nothing;

-- ============================================================
-- lineups
-- ============================================================
create table if not exists public.lineups (
  id serial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id integer not null references public.categories (id) on delete cascade,
  gameweek_id integer not null references public.gameweeks (id) on delete cascade,
  module text not null check (module in (
    'DC+DC+C|ES+Tq+ATT',
    'DC+DC+C|ES+ES+ATT',
    'DC+DC+C|ES+ATT+ATT',
    'DC+DC+C|Tq+ATT+ATT',
    'DC+T+C|ES+Tq+ATT',
    'DC+T+C|ES+ES+ATT',
    'DC+T+C|ES+ATT+ATT',
    'T+T+C|ES+Tq+ATT'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, gameweek_id)
);

alter table public.lineups enable row level security;

create policy "users can read their own lineups"
  on public.lineups for select
  using (auth.uid() = user_id);

-- No direct writes: everything goes through save_lineup(), which validates
-- ownership, the deadline and cross-category exclusivity atomically.
revoke insert, update, delete on public.lineups from authenticated;

-- ============================================================
-- lineup_players
-- gameweek_id is denormalized from lineups so we can enforce "one
-- category per player per gameweek" with a plain UNIQUE constraint
-- (a unique index can't reference another table's column).
-- ============================================================
create table if not exists public.lineup_players (
  id serial primary key,
  lineup_id integer not null references public.lineups (id) on delete cascade,
  player_id bigint not null references public.players (id) on delete cascade,
  gameweek_id integer not null references public.gameweeks (id) on delete cascade,
  slot_type text not null check (slot_type in ('starter', 'bench')),
  slot_role text,
  slot_position integer,
  unique (lineup_id, player_id),
  unique (player_id, gameweek_id)
);

alter table public.lineup_players enable row level security;

create policy "users can read their own lineup players"
  on public.lineup_players for select
  using (
    exists (
      select 1 from public.lineups l
      where l.id = lineup_id and l.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.lineup_players from authenticated;

-- ============================================================
-- save_lineup: atomic validate + upsert of a full lineup
-- (7 starters + bench with substitution order).
--
-- p_players shape: jsonb array of
--   { "player_id": bigint, "slot_type": "starter"|"bench",
--     "slot_role": text|null, "slot_position": integer|null }
-- ============================================================
create or replace function public.save_lineup(
  p_category_id integer,
  p_gameweek_id integer,
  p_module text,
  p_players jsonb
)
returns public.lineups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_gw public.gameweeks;
  v_lineup public.lineups;
  v_starter_count integer;
  v_total_count integer;
  v_distinct_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_gw from public.gameweeks where id = p_gameweek_id;
  if v_gw is null then
    raise exception 'Gameweek not found';
  end if;
  if v_gw.status <> 'upcoming' or (v_gw.deadline is not null and now() >= v_gw.deadline) then
    raise exception 'Deadline passed';
  end if;

  if not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'Category not found';
  end if;

  select count(*) into v_total_count from jsonb_array_elements(p_players);

  select count(*) into v_starter_count
  from jsonb_array_elements(p_players) e
  where e ->> 'slot_type' = 'starter';

  if v_starter_count <> 7 then
    raise exception 'Lineup must have exactly 7 starters';
  end if;

  select count(distinct (e ->> 'player_id')) into v_distinct_count
  from jsonb_array_elements(p_players) e;

  if v_distinct_count <> v_total_count then
    raise exception 'Duplicate player in lineup';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_players) e
    where not exists (
      select 1 from public.user_players up
      where up.user_id = v_user_id and up.player_id = (e ->> 'player_id')::bigint
    )
  ) then
    raise exception 'Player not in roster';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_players) e
    join public.lineup_players lp on lp.player_id = (e ->> 'player_id')::bigint and lp.gameweek_id = p_gameweek_id
    join public.lineups l on l.id = lp.lineup_id
    where not (l.user_id = v_user_id and l.category_id = p_category_id)
  ) then
    raise exception 'Player already fielded in another category this gameweek';
  end if;

  insert into public.lineups (user_id, category_id, gameweek_id, module, updated_at)
  values (v_user_id, p_category_id, p_gameweek_id, p_module, now())
  on conflict (user_id, category_id, gameweek_id)
  do update set module = excluded.module, updated_at = now()
  returning * into v_lineup;

  delete from public.lineup_players where lineup_id = v_lineup.id;

  insert into public.lineup_players (lineup_id, player_id, gameweek_id, slot_type, slot_role, slot_position)
  select
    v_lineup.id,
    (e ->> 'player_id')::bigint,
    p_gameweek_id,
    e ->> 'slot_type',
    e ->> 'slot_role',
    nullif(e ->> 'slot_position', '')::integer
  from jsonb_array_elements(p_players) e;

  return v_lineup;
end;
$$;

revoke execute on function public.save_lineup(integer, integer, text, jsonb) from public;
grant execute on function public.save_lineup(integer, integer, text, jsonb) to authenticated;
