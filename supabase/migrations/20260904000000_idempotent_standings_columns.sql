-- Fix (AUDIT_REPORT.md §2.3/§2.4/§3.2, audit-db-findings.md §2/§3): the
-- consolidation scripts updated league_standings/category_season_standings
-- additively (existing + delta) with no check for "was this gameweek
-- already consolidated", so re-running consolidation for the same
-- gameweek (e.g. a Vercel timeout followed by a manual re-run) doubled or
-- tripled played/won/drawn/lost/points/total_score.
--
-- Fix direction: league_gameweek_scores and category_gameweek_scores are
-- already idempotent (upserted by a unique composite key, so a re-run
-- overwrites rather than duplicates a given gameweek's row). Add the
-- columns needed so each of those per-gameweek rows fully captures that
-- gameweek's result, then have league_standings/category_season_standings
-- become pure aggregates recomputed FROM those tables on every
-- consolidation run — SUM/COUNT over always-correct source rows is
-- idempotent no matter how many times it's rerun, unlike a running += .

alter table public.league_gameweek_scores
  add column if not exists won integer not null default 0,
  add column if not exists drawn integer not null default 0,
  add column if not exists lost integer not null default 0;

-- has_lineup distinguishes "enrolled and available this gameweek but had
-- no lineup" (counts toward gameweeks_available, breaks is_eligible, no
-- score contribution) from "played" (counts toward gameweeks_played and
-- total_score) — both of which category_season_standings currently tracks
-- via a running counter with no way to re-derive them from
-- category_gameweek_scores alone, since a row is written either way.
alter table public.category_gameweek_scores
  add column if not exists has_lineup boolean not null default true;
