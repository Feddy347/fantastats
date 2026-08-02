// Updates serie_a_standings and serie_a_fixtures from football-data.org
// (competition code "SA"). Chosen over aggregating Sorare's own per-club
// game data because football-data.org returns the real matchday number on
// every fixture directly, instead of having to derive giornate by chunking
// fixtures 10-at-a-time by date.
//
// After updating standings, also syncs teams.league_position from it (Part
// 3.4.4), which is what makes the Elite / Sorprese category pools work.
//
// Usage: node scripts/update-serie-a-data.js
// Requires FOOTBALL_DATA_API_KEY in .env (free tier: 10 req/min, plenty for
// the 2 calls this script makes).

import { getSupabaseAdmin } from './lib/env.js'
import { footballDataGet, mapMatchStatus } from './lib/footballDataClient.js'
import { normalizeTeamName, teamNamesMatch } from '../src/lib/teamNames.js'

const COMPETITION_CODE = 'SA'

// football-data.org club names ("AC Milan", "FC Internazionale Milano")
// never exactly match our own team names ("Milan", "Inter"), so they're
// resolved via teamNamesMatch's fuzzy substring check. That check alone is
// ambiguous though — "FC Internazionale Milano" also matches "Milan" (the
// "milano" ⊃ "milan" substring), which would otherwise let two different
// clubs both resolve to our one "Milan" row. Building the whole map in a
// single pass — exact matches claimed first, fuzzy matches only against
// whatever's left — avoids that: once "AC Milan" claims "Milan" via an
// exact match, "Milan" is off the table by the time "FC Internazionale
// Milano" is looked at, so it correctly falls through to fuzzily claiming
// "Inter" instead.
//
// Built once from the standings table (one row per club) and reused for
// fixtures, rather than re-resolving per fixture row.
function buildTeamMap(ourTeams, apiNames) {
  const available = new Set(ourTeams.map((t) => t.name))
  const map = new Map()
  const unmatched = []

  for (const apiName of apiNames) {
    const exact = [...available].find((name) => normalizeTeamName(name) === normalizeTeamName(apiName))
    if (exact) {
      map.set(apiName, exact)
      available.delete(exact)
    }
  }

  for (const apiName of apiNames) {
    if (map.has(apiName)) continue
    const fuzzy = [...available].find((name) => teamNamesMatch(name, apiName))
    if (fuzzy) {
      map.set(apiName, fuzzy)
      available.delete(fuzzy)
    } else {
      unmatched.push(apiName)
    }
  }

  return { map, unmatched }
}

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: ourTeams } = await supabase.from('teams').select('name')
  const teams = ourTeams ?? []

  console.log('Fetching Serie A standings from football-data.org...')
  const standingsData = await footballDataGet(`/competitions/${COMPETITION_CODE}/standings`)
  const table = standingsData.standings?.find((s) => s.type === 'TOTAL')?.table ?? []
  if (table.length === 0) throw new Error('No Serie A standings returned by football-data.org.')

  const { map: teamMap, unmatched } = buildTeamMap(
    teams,
    table.map((row) => row.team?.name)
  )

  if (unmatched.length > 0) {
    console.warn(
      `[warn] ${unmatched.length} team(s) from football-data.org not found in our teams table, skipped: ${unmatched.join(', ')} — likely a real Serie A promotion/relegation our teams table hasn't caught up with.`
    )
  }

  const standingsRows = table
    .filter((row) => teamMap.has(row.team?.name))
    .map((row) => ({
      team: teamMap.get(row.team.name),
      position: row.position,
      played: row.playedGames,
      won: row.won,
      drawn: row.draw,
      lost: row.lost,
      goals_for: row.goalsFor,
      goals_against: row.goalsAgainst,
      goal_difference: row.goalDifference,
      points: row.points,
      updated_at: new Date().toISOString(),
    }))

  const { error: standingsError } = await supabase.from('serie_a_standings').upsert(standingsRows, { onConflict: 'team' })
  if (standingsError) console.error(`[error] upserting standings: ${standingsError.message}`)
  else console.log(`Upserted standings for ${standingsRows.length} teams.`)

  console.log('Fetching Serie A calendar from football-data.org...')
  const matchesData = await footballDataGet(`/competitions/${COMPETITION_CODE}/matches`)
  const matches = matchesData.matches ?? []
  if (matches.length === 0) throw new Error('No Serie A matches returned by football-data.org.')

  const fixtureRows = []
  let skippedFixtures = 0
  for (const m of matches) {
    const homeTeam = teamMap.get(m.homeTeam?.name)
    const awayTeam = teamMap.get(m.awayTeam?.name)
    if (!homeTeam || !awayTeam) {
      skippedFixtures += 1
      continue
    }
    fixtureRows.push({
      gameweek: m.matchday,
      home_team: homeTeam,
      away_team: awayTeam,
      home_score: m.score?.fullTime?.home ?? null,
      away_score: m.score?.fullTime?.away ?? null,
      match_date: m.utcDate,
      status: mapMatchStatus(m.status),
      updated_at: new Date().toISOString(),
    })
  }
  if (skippedFixtures > 0) {
    console.warn(`[warn] skipped ${skippedFixtures} fixture(s) involving a team not in our teams table.`)
  }

  const { error: fixturesError } = await supabase
    .from('serie_a_fixtures')
    .upsert(fixtureRows, { onConflict: 'gameweek,home_team,away_team' })
  if (fixturesError) console.error(`[error] upserting fixtures: ${fixturesError.message}`)
  else console.log(`Upserted ${fixtureRows.length} fixtures across ${matches.at(-1)?.matchday ?? 0} giornate.`)

  // --- Sync teams.league_position (3.4.4) ---
  let synced = 0
  for (const row of standingsRows) {
    const { error } = await supabase.from('teams').update({ league_position: row.position }).eq('name', row.team)
    if (error) console.error(`[error] syncing league_position for ${row.team}: ${error.message}`)
    else synced += 1
  }
  console.log(`Synced league_position for ${synced}/${standingsRows.length} teams.`)
}

main().catch((err) => {
  console.error('update-serie-a-data failed:', err.message || err)
  process.exit(1)
})
