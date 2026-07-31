-- Fantastats: B8 — enrich-players.js now stores nationality as Sorare's
-- three-letter ISO code (country.threeLetterCode, e.g. "ITA"), not the
-- two-letter code count_eligible_players() was previously matching against.
-- Also defaults the Under 23 age gate to 2003 (matching the category's own
-- pool_config, kept here only as the function's fallback) now that
-- birth_year is actually populated.

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
        and p.birth_year >= coalesce((c.pool_config->>'min_birth_year')::int, 2003))
      or (c.pool_type = 'nationality'
        and p.nationality = 'ITA')
      or (c.pool_type = 'top_scorers')
    );
$$;
