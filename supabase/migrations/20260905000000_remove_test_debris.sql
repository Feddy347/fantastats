-- Data cleanup (AUDIT_REPORT.md §4.1, §8.5): leftover test/dev debris that
-- was visible to real users in production.
--
-- Confirmed via query before writing this migration (see chat history):
--   - matches.id=1 ("Squadra Test A vs Squadra Test B", sorare_game_id
--     'simulated-test', status='live') has zero player_match_stats and
--     zero player_match_scores rows — nothing depends on it, safe to
--     delete outright. It was showing up in the Live page's "Ultima
--     giornata" results list alongside the 13 real GW1 matches.
--   - lineups.id=1 (category "Elite", admin user, gameweek 1) has zero
--     lineup_players rows — an empty shell that was never reachable
--     through the normal save_lineup() flow (which requires exactly 7
--     starters) and was never consolidated (the admin isn't enrolled in
--     Elite, so consolidateCategory() never iterates it).
--   - Swept teams, players, and every other lineups/league_lineups row for
--     similar debris (test-shaped names, other 0-player lineup shells):
--     none found. These two rows were the only ones.

delete from public.matches where id = 1;
delete from public.lineups where id = 1;
