-- Fix (found while testing the §2.3/§2.4 idempotency fix, resolves the
-- unexplained "league 12 case" from audit-db-findings.md §8.3): for
-- direct_vote_sum leagues, league_points/league_standings.points is
-- assigned the raw fantasy score directly (consolidate-league-gameweek.js:
-- `points: isVoteSum ? homeScore : homeResult`), which is a fractional
-- number by design — "Somma voti" ranks members by the exact sum of their
-- score, unlike every other format where points are always whole numbers
-- (0/1/3 match points, F1 rank points, or summed royal-rumble results).
--
-- Both columns were declared `integer`, so writing a fractional score into
-- them always failed. The original code never checked the write's error
-- (`await supabase.from('league_standings').upsert(...)` with no
-- destructured error), so this failed silently on every consolidation run
-- — the actual root cause of "Lega Test - SWOS - Classic Scontri
-- SommaVoti" (the only direct_vote_sum league in the test data) never
-- getting its league_standings/league_gameweek_scores rows updated in any
-- prior run, while every other league (whose points are always integers)
-- succeeded.
--
-- Fix: widen the columns to `real` (matching total_fantasy_score) instead
-- of rounding the score before storing it — rounding would be a purely
-- cosmetic loss of precision for a format whose whole premise is ranking
-- by the exact score. league_points/points are integer-valued for every
-- other format, which fits `real` losslessly, so this is safe for all of
-- them too.

alter table public.league_gameweek_scores
  alter column league_points type real;

alter table public.league_standings
  alter column points type real;
