-- Fantastats: fix infinite-recursion RLS bug on league_members' own SELECT
-- policy (Fase 8 Part B, B1).
--
-- The original policy (20260803000000_leagues.sql) did:
--   using (exists (select 1 from public.league_members lm where lm.league_id = league_members.league_id and lm.user_id = auth.uid()))
-- inside a policy ON league_members itself. Evaluating that subquery requires
-- re-applying the very same policy to determine whether the candidate row is
-- visible, which never resolves — Postgres reports "infinite recursion
-- detected in policy for relation league_members". Every query against
-- league_members (including the very insert-then-navigate flow after
-- creating a league) silently failed, so pages read back an empty member
-- list and showed "non fai parte di questa lega".
--
-- Fix mirrors the existing is_league_admin() pattern: membership checks go
-- through a SECURITY DEFINER function that bypasses RLS internally, so the
-- policy no longer needs to re-check itself.

create or replace function public.is_league_member(p_league_id integer, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = p_user_id
  );
$$;

revoke execute on function public.is_league_member(integer, uuid) from public;
grant execute on function public.is_league_member(integer, uuid) to authenticated;

drop policy if exists "members can read their league's roster of members" on public.league_members;
create policy "members can read their league's roster of members"
  on public.league_members for select
  using (public.is_league_member(league_id, auth.uid()));
