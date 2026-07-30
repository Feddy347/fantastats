-- Fantastats: B6 — birth_year/nationality now get populated by
-- scripts/enrich-players.js, so count_eligible_players() (the server-side
-- enrollment gate) needs to actually filter on them instead of the old
-- "age/nationality always eligible" stub — otherwise a user could enroll in
-- Under 23 / Italians do it better without 7 roster players that actually
-- qualify, even though the pool view (categoryPool.js) now correctly
-- filters them out.

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
      or (c.pool_type = 'age'
        and p.birth_year is not null
        and p.birth_year >= coalesce((c.pool_config->>'min_birth_year')::int, 0))
      or (c.pool_type = 'nationality'
        and p.nationality = coalesce(c.pool_config->>'nationality_code', 'IT'))
      or (c.pool_type = 'top_scorers')
    );
$$;
