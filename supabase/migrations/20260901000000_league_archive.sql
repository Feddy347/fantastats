-- Fantastats: soft-delete for leagues. "Elimina lega" (admin only, from the
-- league's Impostazioni tab) sets status = 'archived' instead of deleting
-- the row, so history/stats stay in the DB. Archived leagues are filtered
-- out client-side everywhere a user's own leagues are listed.

alter table public.leagues drop constraint leagues_status_check;

alter table public.leagues
  add constraint leagues_status_check check (status in ('setup', 'active', 'completed', 'archived'));
