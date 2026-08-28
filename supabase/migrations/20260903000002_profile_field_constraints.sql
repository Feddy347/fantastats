-- Security/data-integrity fix (AUDIT_REPORT.md §7.3, MEDIUM): profiles.username
-- and profiles.team_name had no server-side validation at all — an
-- authenticated user could set their own username to an HTML/script-shaped
-- string or a team_name thousands of characters long, with the database
-- accepting it silently. React escapes text content by default so this
-- isn't a working script-injection vector against the current frontend,
-- but nothing prevents a future dangerouslySetInnerHTML use, a different
-- client, or a direct API consumer from being affected, and an
-- unbounded-length value would visibly break layout anywhere it's shown
-- (drawer, leaderboards, league cards).
--
-- Limits chosen to fit real existing data (verified against all 10 current
-- profiles before writing this migration — see chat history) and the
-- signup form's existing client-side minLength hints (Register.jsx:
-- username minLength=3, team_name minLength=2):
--   - username: 3-30 chars, [[:alnum:]_.-] only (no spaces — used as a
--     handle/identifier, matches every existing username's shape).
--   - team_name: 3-40 chars, [[:alnum:]] + space + . & - (display name,
--     needs to allow multi-word names like "Schiaffield Wednesday" or
--     "I Leoni"). Nullable column — NULL remains allowed (not every user
--     sets a team name).
-- [[:alnum:]] is locale/encoding-aware under this database's UTF8
-- encoding, so accented letters (e.g. "Città") are still permitted.

alter table public.profiles
  add constraint profiles_username_shape check (
    char_length(username) between 3 and 30
    and username ~ '^[[:alnum:]_.-]+$'
  );

alter table public.profiles
  add constraint profiles_team_name_shape check (
    team_name is null
    or (
      char_length(team_name) between 3 and 40
      and team_name ~ '^[[:alnum:][:space:].&-]+$'
    )
  );
