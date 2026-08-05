-- Fantastats: "Flop XI" reverse-scoring game mode. A league or category can
-- opt into inverted scoring (positive actions become negative and vice
-- versa; participation bonuses stay positive so benching everyone never
-- becomes the optimal play).
--
-- No schema change to player_match_scores: lineup_players already enforces
-- unique(player_id, gameweek_id), and save_lineup() rejects fielding the
-- same player in two categories the same gameweek ("Player already fielded
-- in another category this gameweek"). So a player's score for a gameweek
-- is never ambiguous between a normal and a reverse context — it just needs
-- to be computed with the right sign at write time, based on whichever
-- category actually fielded that player. Leagues never read/write this
-- table at all (they always recompute from player_match_stats), so they
-- have no conflict potential either.

alter table public.leagues add column if not exists is_reverse_scoring boolean not null default false;
alter table public.categories add column if not exists is_reverse_scoring boolean not null default false;

insert into public.categories (slug, name, description, pool_type, pool_config, is_event, is_reverse_scoring)
values (
  'flop-xi',
  'Flop XI',
  'Modalità al contrario: più falli, cartellini e errori fai, più punti guadagni!',
  'all',
  '{}',
  false,
  true
)
on conflict (slug) do nothing;

-- pool_type='all' means every Serie A player is eligible (no pool filter).
-- count_eligible_players() previously had no branch for it, which would
-- have counted 0 eligible players for Flop XI and made enrollment
-- impossible (the insert policy requires >= 7). Otherwise identical to the
-- version in 20260808000000_nationality_three_letter.sql.
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
      c.pool_type = 'all'
      or (c.pool_type = 'league_position_bottom'
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
