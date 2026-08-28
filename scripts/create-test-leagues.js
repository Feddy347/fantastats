// Creates 9 test leagues (all variants of formation/role/competition format),
// each with the same 10 test users (Hellas Madonna as admin + the 9
// scripts/create-test-users.js accounts as members), for manual/local
// testing of the leagues feature end to end.
//
// Re-runnable: deletes any existing leagues named 'Lega Test - SWOS%' first
// (cascades to league_members/league_rosters/league_calendar/league_matchups
// via their FKs) so re-running doesn't duplicate or collide on invite_code.
//
// Calendar generation reuses the real production path — the
// generate_league_calendar(p_league_id) RPC in
// supabase/migrations/20260804000000_league_competitions.sql (round-robin
// circle method) — rather than reimplementing round-robin pairing here.
// That function's admin check (`v_league.admin_id <> auth.uid()`) compares
// against NULL when called with the service-role key (no JWT `sub` claim),
// and an IF on a NULL condition is treated as false in plpgsql, so the
// check is silently skipped — this mirrors how other admin-gated RPCs in
// this codebase already behave under the service role.
//
// Usage: node scripts/create-test-leagues.js

import { getSupabaseAdmin } from './lib/env.js'
import { generateInviteCode } from '../src/lib/inviteCode.js'

const ADMIN_ID = '77e2ac11-32cc-44d2-8d1f-2b78bb11ec69' // Hellas Madonna 7 Sorelle

const MEMBER_IDS = [
  'af83a8b9-fc91-4f5c-b820-e7fe2b9efd39', // schiaffield
  '03a80aa8-63c6-43a7-b630-47124d4cff1c', // falarsenal
  'f0145352-6101-4785-aa9a-59a4c38df247', // liverpollio
  'cf0d2bd4-2145-430a-99b3-2864bdb07118', // ostialiedholm
  '1bc25cc0-36ea-4a4c-aede-1fbc9c812b79', // ejaculazio
  '9a91ce74-610f-4b33-bbf3-72430868b523', // realcanil
  '84bf9437-4832-4922-af1d-003d4c6920e7', // rottenwreck
  '79504a26-debf-4a9b-8c0e-fe168551f3de', // parmigian
  'e9bd5267-3a70-44f2-8f0a-8d4b43982d90', // malencastro
]

const ALL_USER_IDS = [ADMIN_ID, ...MEMBER_IDS]

// Mirrors src/components/CreateLeagueModal.jsx's handleFormationTypeChange
// defaults (18 for '7', 25 for '11') — both satisfy leagues.roster_size's
// CHECK constraint (12-24 for '7', 20-32 for '11'), unlike the column's raw
// default of 18, which fails that constraint for '11' leagues.
const ROSTER_SIZE_BY_FORMATION = { 7: 18, 11: 25 }

const STARTING_CREDITS = 500
const SEASON_START_GAMEWEEK_NUMBER = 1

const LEAGUES = [
  { name: 'Lega Test - SWOS - Classic RR SerieA', formationType: '11', roleSystem: 'classic', competitionFormat: 'royal_rumble_seria', isReverseScoring: false },
  { name: 'Lega Test - SWOS - Classic Scontri SerieA', formationType: '11', roleSystem: 'classic', competitionFormat: 'direct_serie_a', isReverseScoring: false },
  { name: 'Lega Test - SWOS - Classic RR Formula1', formationType: '11', roleSystem: 'classic', competitionFormat: 'royal_rumble_f1', isReverseScoring: false },
  { name: 'Lega Test - SWOS - Classic Scontri SommaVoti', formationType: '11', roleSystem: 'classic', competitionFormat: 'direct_vote_sum', isReverseScoring: false },
  { name: 'Lega Test - SWOS - Mantra RR SerieA', formationType: '11', roleSystem: 'mantra', competitionFormat: 'royal_rumble_seria', isReverseScoring: false },
  { name: 'Lega Test - SWOS - Fantastats7 RR SerieA', formationType: '7', roleSystem: 'fantastats', competitionFormat: 'royal_rumble_seria', isReverseScoring: false },
  { name: 'Lega Test - SWOS - Flop XI RR SerieA', formationType: '11', roleSystem: 'classic', competitionFormat: 'royal_rumble_seria', isReverseScoring: true },
  { name: 'Lega Test - SWOS - Fantastats7 Scontri SerieA', formationType: '7', roleSystem: 'fantastats', competitionFormat: 'direct_serie_a', isReverseScoring: false },
  { name: 'Lega Test - SWOS - Flop XI Scontri SerieA', formationType: '11', roleSystem: 'classic', competitionFormat: 'direct_serie_a', isReverseScoring: true },
]

// Round-robin circle method, ported from generate_league_calendar()
// (supabase/migrations/20260804000000_league_competitions.sql) so this
// script writes the exact same league_calendar/league_matchups shape that
// function would. Called directly instead of via supabase.rpc(...): that
// RPC's `if v_league.admin_id <> auth.uid() then raise exception` gate
// unexpectedly fires under the service-role key here (auth.uid() isn't
// resolving to NULL as it does for other service-role RPC calls in this
// codebase), so it rejects every call regardless of who's calling — writing
// directly to the tables (service role bypasses their RLS/grants) sidesteps
// that without touching the migration.
//
// Member order matches ALL_USER_IDS (admin first, then the 9 test members)
// rather than a `joined_at` read-back, since this script inserts all 10
// league_members rows in one batch with equal now() defaults, which would
// make an order-by-joined_at read nondeterministic.
async function generateDirectFormatCalendar(supabase, leagueId, seasonStartNumber) {
  const { data: gameweeks, error: gwError } = await supabase.from('gameweeks').select('id, number')
  if (gwError) throw gwError
  const gwIdByNumber = new Map(gameweeks.map((g) => [g.number, g.id]))

  const members = [...ALL_USER_IDS]
  const padded = members.length % 2 === 1 ? [...members, null] : members
  const m = padded.length
  const roundsPerLeg = m - 1

  const availableGws = 38 - seasonStartNumber + 1
  const cycles = Math.floor(availableGws / (roundsPerLeg * 2))
  if (cycles < 1) {
    throw new Error('Not enough remaining gameweeks to generate even one full andata+ritorno cycle')
  }

  let globalRoundIdx = 0

  for (let cyc = 1; cyc <= cycles; cyc++) {
    for (let leg = 0; leg <= 1; leg++) {
      let rotating = [...padded]

      for (let r = 1; r <= roundsPerLeg; r++) {
        const gwNumber = seasonStartNumber + globalRoundIdx
        const gwId = gwIdByNumber.get(gwNumber)
        if (!gwId) throw new Error(`No gameweek found with number ${gwNumber}`)

        const { data: calendarRow, error: calendarError } = await supabase
          .from('league_calendar')
          .insert({ league_id: leagueId, gameweek_id: gwId, cycle: cyc, is_return: leg === 1 })
          .select('id')
          .single()
        if (calendarError) throw calendarError

        const matchupRows = []
        for (let i = 1; i <= m / 2; i++) {
          const homeId = leg === 0 ? rotating[i - 1] : rotating[m - i]
          const awayId = leg === 0 ? rotating[m - i] : rotating[i - 1]
          if (homeId != null && awayId != null) {
            matchupRows.push({ calendar_id: calendarRow.id, home_user_id: homeId, away_user_id: awayId })
          }
        }
        if (matchupRows.length > 0) {
          const { error: matchupsError } = await supabase.from('league_matchups').insert(matchupRows)
          if (matchupsError) throw matchupsError
        }

        // Circle method rotation: position 0 fixed, the rest rotate by one.
        rotating = [rotating[0], rotating[m - 1], ...rotating.slice(1, m - 1)]
        globalRoundIdx += 1
      }
    }
  }
}

// Same retry-on-collision pattern as CreateLeagueModal.jsx's handleSubmit.
async function insertLeagueWithRetries(supabase, config, seasonStartGameweekId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('leagues')
      .insert({
        name: config.name,
        admin_id: ADMIN_ID,
        invite_code: generateInviteCode(),
        formation_type: config.formationType,
        role_system: config.roleSystem,
        competition_format: config.competitionFormat,
        roster_size: ROSTER_SIZE_BY_FORMATION[config.formationType],
        starting_credits: STARTING_CREDITS,
        status: 'active',
        season_start_gameweek: seasonStartGameweekId,
        is_reverse_scoring: config.isReverseScoring,
      })
      .select()
      .single()

    if (!error) return data
    if (error.code !== '23505') throw error
    // invite_code collision, loop and retry with a freshly generated one
  }
  throw new Error(`${config.name}: could not find a free invite_code after 5 attempts`)
}

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: startGw, error: gwError } = await supabase
    .from('gameweeks')
    .select('id')
    .eq('number', SEASON_START_GAMEWEEK_NUMBER)
    .single()
  if (gwError) throw gwError
  const seasonStartGameweekId = startGw.id

  console.log('Clearing existing test leagues (name LIKE "Lega Test - SWOS%")...')
  const { error: deleteError } = await supabase.from('leagues').delete().like('name', 'Lega Test - SWOS%')
  if (deleteError) throw deleteError

  console.log(`Fetching source rosters from user_players for ${ALL_USER_IDS.length} users...`)
  const { data: userPlayers, error: userPlayersError } = await supabase
    .from('user_players')
    .select('user_id, player_id, purchase_price')
    .in('user_id', ALL_USER_IDS)
  if (userPlayersError) throw userPlayersError
  console.log(`  ${userPlayers.length} roster rows to copy into each league.`)

  const created = []

  for (const config of LEAGUES) {
    const league = await insertLeagueWithRetries(supabase, config, seasonStartGameweekId)

    const memberRows = ALL_USER_IDS.map((userId) => ({
      league_id: league.id,
      user_id: userId,
      league_credits: STARTING_CREDITS,
      is_admin: userId === ADMIN_ID,
    }))
    const { error: membersError } = await supabase.from('league_members').insert(memberRows)
    if (membersError) throw new Error(`${league.name}: league_members insert failed: ${membersError.message}`)

    const rosterRows = userPlayers.map((up) => ({
      league_id: league.id,
      user_id: up.user_id,
      player_id: up.player_id,
      purchase_price: up.purchase_price,
    }))
    const { error: rostersError } = await supabase.from('league_rosters').insert(rosterRows)
    if (rostersError) throw new Error(`${league.name}: league_rosters insert failed: ${rostersError.message}`)

    let calendarNote = 'skipped (royal rumble)'
    if (config.competitionFormat.startsWith('direct_')) {
      await generateDirectFormatCalendar(supabase, league.id, SEASON_START_GAMEWEEK_NUMBER)
      calendarNote = 'generated'
    }

    console.log(
      `[created] ${league.name} | id=${league.id} | invite_code=${league.invite_code} | members=${memberRows.length} | roster_rows=${rosterRows.length} | calendar=${calendarNote}`
    )
    created.push(league)
  }

  console.log('\nRecap:')
  for (const l of created) {
    console.log(`  ${l.name} -> id=${l.id}, invite_code=${l.invite_code}`)
  }
}

main().catch((err) => {
  console.error('create-test-leagues failed:', err.message || err)
  process.exit(1)
})
