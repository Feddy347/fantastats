-- Fantastats: Phase 8 Part B fixes — team name on profiles, home
-- preference, multi-admin leagues.

-- ============================================================
-- profiles: team_name + default_home
-- ============================================================
alter table public.profiles add column if not exists team_name text;
alter table public.profiles add column if not exists default_home text not null default 'categories'
  check (default_home in ('categories', 'leagues'));

-- handle_new_user (from Phase 1) now also carries team_name from signup metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, team_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'username',
      lower(split_part(new.email, '@', 1)) || '_' || substr(new.id::text, 1, 8)
    ),
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'team_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- team_name/default_home are self-service, same as username/display_name (Phase 2).
revoke update on public.profiles from authenticated;
grant update (username, display_name, team_name, default_home) on public.profiles to authenticated;

-- ============================================================
-- league_members: multi-admin support
-- ============================================================
alter table public.league_members add column if not exists is_admin boolean not null default false;

-- is_league_admin: true for the original creator (leagues.admin_id) or any
-- member promoted to admin. security definer so it can be safely called
-- from RLS policies on leagues/league_members without recursive RLS.
create or replace function public.is_league_admin(p_league_id integer, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.leagues l where l.id = p_league_id and l.admin_id = p_user_id
  ) or exists (
    select 1 from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = p_user_id and lm.is_admin
  );
$$;

revoke execute on function public.is_league_admin(integer, uuid) from public;
grant execute on function public.is_league_admin(integer, uuid) to authenticated;

-- set_league_admin: admin-only promotion/demotion of another member.
create or replace function public.set_league_admin(p_league_id integer, p_target_user_id uuid, p_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_league_admin(p_league_id, auth.uid()) then
    raise exception 'Only a league admin can change admin status';
  end if;

  if not exists (
    select 1 from public.league_members where league_id = p_league_id and user_id = p_target_user_id
  ) then
    raise exception 'Target user is not a member of this league';
  end if;

  update public.league_members
  set is_admin = p_is_admin
  where league_id = p_league_id and user_id = p_target_user_id;
end;
$$;

revoke execute on function public.set_league_admin(integer, uuid, boolean) from public;
grant execute on function public.set_league_admin(integer, uuid, boolean) to authenticated;

-- Replace the admin_id-only RLS checks with is_league_admin() so promoted
-- admins get the same rights as the original creator.
drop policy if exists "admin can update their league" on public.leagues;
create policy "admin can update their league"
  on public.leagues for update
  using (public.is_league_admin(id, auth.uid()))
  with check (public.is_league_admin(id, auth.uid()));

drop policy if exists "admin can delete their league" on public.leagues;
create policy "admin can delete their league"
  on public.leagues for delete
  using (public.is_league_admin(id, auth.uid()));

drop policy if exists "admin or the member themselves can leave/remove" on public.league_members;
create policy "admin or the member themselves can leave/remove"
  on public.league_members for delete
  using (auth.uid() = user_id or public.is_league_admin(league_id, auth.uid()));

-- auction_assign_player: accept any league admin, not just the creator.
create or replace function public.auction_assign_player(
  p_league_id integer,
  p_player_id bigint,
  p_buyer_id uuid,
  p_price integer,
  p_round integer default null
)
returns public.league_rosters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_credits integer;
  v_row public.league_rosters;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_league_admin(p_league_id, v_user_id) then
    raise exception 'Only the league admin can assign auction players';
  end if;

  if not exists (select 1 from public.league_members where league_id = p_league_id and user_id = p_buyer_id) then
    raise exception 'Buyer is not a member of this league';
  end if;

  if exists (select 1 from public.league_rosters where league_id = p_league_id and player_id = p_player_id) then
    raise exception 'Player already assigned in this league';
  end if;

  select league_credits into v_credits
  from public.league_members
  where league_id = p_league_id and user_id = p_buyer_id
  for update;

  if v_credits is null or v_credits < p_price then
    raise exception 'Buyer has insufficient credits';
  end if;

  update public.league_members
  set league_credits = league_credits - p_price
  where league_id = p_league_id and user_id = p_buyer_id;

  insert into public.league_rosters (league_id, user_id, player_id, purchase_price)
  values (p_league_id, p_buyer_id, p_player_id, p_price)
  returning * into v_row;

  insert into public.auction_log (league_id, player_id, buyer_id, price, round)
  values (p_league_id, p_player_id, p_buyer_id, p_price, p_round);

  return v_row;
end;
$$;

-- generate_league_calendar: accept any league admin, not just the creator.
create or replace function public.generate_league_calendar(p_league_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league record;
  v_start_number integer;
  v_members uuid[];
  n integer;
  padded uuid[];
  m integer;
  rounds_per_leg integer;
  available_gws integer;
  cycles integer;
  global_round_idx integer := 0;
  cyc integer;
  leg integer;
  r integer;
  i integer;
  gw_number integer;
  gw_id integer;
  calendar_row_id integer;
  home_id uuid;
  away_id uuid;
begin
  select * into v_league from public.leagues where id = p_league_id;
  if v_league is null then
    raise exception 'League not found';
  end if;
  if not public.is_league_admin(p_league_id, auth.uid()) then
    raise exception 'Only the league admin can generate the calendar';
  end if;
  if exists (select 1 from public.league_calendar where league_id = p_league_id) then
    raise exception 'Calendar already generated for this league';
  end if;

  select number into v_start_number from public.gameweeks where id = v_league.season_start_gameweek;
  if v_start_number is null then
    raise exception 'League has no season_start_gameweek set';
  end if;

  if v_league.competition_format like 'royal_rumble%' then
    for gw_number in v_start_number..38 loop
      select id into gw_id from public.gameweeks where number = gw_number;
      if gw_id is not null then
        insert into public.league_calendar (league_id, gameweek_id, cycle, is_return)
        values (p_league_id, gw_id, 1, false);
      end if;
    end loop;
    return;
  end if;

  select array_agg(user_id order by joined_at) into v_members
  from public.league_members where league_id = p_league_id;

  n := coalesce(array_length(v_members, 1), 0);
  if n < 2 then
    raise exception 'Not enough members to generate a calendar';
  end if;

  if n % 2 = 1 then
    padded := v_members || array[null::uuid];
  else
    padded := v_members;
  end if;
  m := array_length(padded, 1);
  rounds_per_leg := m - 1;

  available_gws := 38 - v_start_number + 1;
  cycles := floor(available_gws::numeric / (rounds_per_leg * 2));

  if cycles < 1 then
    raise exception 'Not enough remaining gameweeks to generate even one full andata+ritorno cycle';
  end if;

  for cyc in 1..cycles loop
    for leg in 0..1 loop
      declare
        rotating uuid[] := padded;
      begin
        for r in 1..rounds_per_leg loop
          gw_number := v_start_number + global_round_idx;

          select id into gw_id from public.gameweeks where number = gw_number;
          if gw_id is null then
            raise exception 'No gameweek found with number %', gw_number;
          end if;

          insert into public.league_calendar (league_id, gameweek_id, cycle, is_return)
          values (p_league_id, gw_id, cyc, leg = 1)
          returning id into calendar_row_id;

          for i in 1..(m / 2) loop
            if leg = 0 then
              home_id := rotating[i];
              away_id := rotating[m + 1 - i];
            else
              home_id := rotating[m + 1 - i];
              away_id := rotating[i];
            end if;

            if home_id is not null and away_id is not null then
              insert into public.league_matchups (calendar_id, home_user_id, away_user_id)
              values (calendar_row_id, home_id, away_id);
            end if;
          end loop;

          rotating := array[rotating[1], rotating[m]] || rotating[2:m - 1];
          global_round_idx := global_round_idx + 1;
        end loop;
      end;
    end loop;
  end loop;
end;
$$;
