-- Fix (AUDIT_REPORT.md §4.2): `matches` had no way to upsert idempotently
-- by (gameweek, home team, away team), because poll-sorare-live.js never
-- needed one — it created a new row per player's own game instead of
-- syncing a coherent gameweek fixture list. The new
-- scripts/sync-gameweek-fixtures.js needs this constraint to safely
-- upsert serie_a_fixtures rows into matches without duplicating a fixture
-- on repeated runs.

alter table public.matches
  add constraint matches_gameweek_id_home_team_away_team_key
  unique (gameweek_id, home_team, away_team);
