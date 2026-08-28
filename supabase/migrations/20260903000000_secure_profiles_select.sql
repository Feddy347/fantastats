-- Security fix (AUDIT_REPORT.md §7.1, CRITICAL): profiles was readable by
-- literally anyone, including fully unauthenticated requests, via
-- "using (true)". A raw anon-key request with no login returned
-- id/username/credits/team_name for every user in the app.
--
-- Fix: restrict SELECT to the `authenticated` role. Row visibility for
-- OTHER users' rows is intentionally kept (not narrowed to owner-only):
-- the app embeds `profiles(username)` for other members throughout the
-- codebase (leaderboards, league member lists, matchups, auctions — see
-- GameweekLeaderboard.jsx, LeagueGameweekPanel.jsx, LeagueStandingsTab.jsx,
-- LiveLeagueLeaderboard.jsx, SeasonStandings.jsx, AuctionAdmin.jsx,
-- AuctionLive.jsx, LeagueDetail.jsx), and confirmed by grep that `credits`
-- and `team_name` are NEVER read for another user anywhere in the app —
-- only the logged-in user's own `profile.credits`/`profile.team_name` are
-- ever displayed (via useAuth(), always scoped to auth.uid()).
--
-- Postgres RLS cannot mask a single column (credits) differently per
-- viewer within a row that's otherwise visible to that viewer — that would
-- require the app to query a separate view/RPC instead of the plain
-- `profiles(username)` embeds it uses today, which is a UI-layer change
-- out of scope for this fix. Restricting to `authenticated` closes the
-- critical "anyone on the internet, no account needed" exposure; the
-- residual "any logged-in user could still craft a raw request for
-- someone else's credits" risk requires that follow-up UI change to close
-- fully.

drop policy "profiles are publicly readable" on public.profiles;

create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);
