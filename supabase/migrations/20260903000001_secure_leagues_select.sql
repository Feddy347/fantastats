-- Security fix (AUDIT_REPORT.md §7.2, CRITICAL): leagues was readable by
-- literally anyone, including fully unauthenticated requests, via
-- "using (true)" — exposing invite_code (meant to be a shared secret for
-- joining) for every league to anyone who queries the table directly.
--
-- Fix: restrict SELECT to a league's admin and members only.
--
-- Confirmed safe by grep across src/: every direct `.from('leagues')`
-- select in the app (LeagueDetail.jsx, AuctionAdmin.jsx, AuctionLive.jsx,
-- LeagueLineup.jsx, LeagueMarket.jsx, LiveLeagueDetail.jsx,
-- LeaguesList.jsx's loadLeagues()) only ever runs on a page reached after
-- the user is already a member, or is driven by the user's own
-- league_members rows. The one non-member flow — previewing a league by
-- invite code before joining (LeaguesList.jsx's handleSearchCode) — goes
-- through get_league_preview(), a security-definer RPC that bypasses RLS
-- entirely and is unaffected by this change. By the time handleJoin()
-- inserts the new league_members row and navigates to the league page,
-- membership already exists, so the direct `leagues` select on arrival
-- passes this policy.

drop policy "leagues are publicly readable" on public.leagues;

create policy "leagues are readable by their admin and members"
  on public.leagues for select
  to authenticated
  using (
    auth.uid() = admin_id
    or exists (
      select 1 from public.league_members lm
      where lm.league_id = leagues.id and lm.user_id = auth.uid()
    )
  );
