// Consolidates one gameweek for every active league: computes each
// member's total_score (with automatic substitutions, same rule as
// categories — see lineupResolver.js), updates matchups per the league's
// competition_format, and rebuilds league_standings from scratch.
//
// Scores are computed FRESH here (via resolveLineupScore/calculateScore)
// rather than reused from player_match_scores, because that table holds one
// row per player+match computed with whatever slot_role the CATEGORIES
// lineup used — a league lineup can field the same player in a different
// slot/module, which changes the scoring multiplier. So league scoring
// re-derives the number from raw player_match_stats every time
// (useStoredScores: false below).
//
// Idempotency: league_gameweek_scores is upserted by its unique
// (league_id, user_id, gameweek_id) key, so re-running this for a gameweek
// always overwrites that gameweek's row rather than adding another one.
// league_standings is never written to directly with a running total —
// it's fully recomputed by summing every league_gameweek_scores row for
// the league (see recomputeLeagueStandings). This makes the whole script
// safe to run any number of times for the same gameweek: played/won/
// drawn/lost/points/total_fantasy_score always reflect exactly the set of
// gameweeks actually consolidated, never double- or triple-counted.
//
// Usage: node scripts/consolidate-league-gameweek.js
// Usage: node scripts/consolidate-league-gameweek.js -- <gameweekNumber>

import { pathToFileURL } from 'node:url'
import { getSupabaseAdmin } from './lib/env.js'
import { resolveLineupScore } from './lib/lineupResolver.js'
import { getLeagueModuleSystem } from '../src/lib/leagueModules.js'

const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]

function resultPoints(myScore, otherScore) {
  if (myScore > otherScore) return 3
  if (myScore === otherScore) return 1
  return 0
}

// gameweekNumber is optional: pass it to target a specific gameweek
// regardless of its status; omit it to keep the original live-or-most-
// recently-completed lookup.
async function findTargetGameweek(supabase, gameweekNumber) {
  if (gameweekNumber) {
    const { data } = await supabase.from('gameweeks').select('*').eq('number', gameweekNumber).maybeSingle()
    return data ?? null
  }

  const { data: live } = await supabase
    .from('gameweeks')
    .select('*')
    .eq('status', 'live')
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (live) return live

  const { data: completed } = await supabase
    .from('gameweeks')
    .select('*')
    .eq('status', 'completed')
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return completed ?? null
}

function toStartersAndBench(lineupPlayers) {
  const starters = lineupPlayers
    .filter((lp) => lp.slot_type === 'starter')
    .map((lp) => ({ slotIndex: (lp.slot_position ?? 1) - 1, slotRole: lp.slot_role, playerId: lp.player_id }))
    .sort((a, b) => a.slotIndex - b.slotIndex)

  const bench = lineupPlayers
    .filter((lp) => lp.slot_type === 'bench')
    .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))
    .map((lp) => ({ playerId: lp.player_id }))

  return { starters, bench }
}

async function computeUserTotalScore(supabase, { userId, leagueId, gameweekId, roleField, modules, isReverse }) {
  const { data: lineup } = await supabase
    .from('league_lineups')
    .select('*, league_lineup_players(*)')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .eq('gameweek_id', gameweekId)
    .maybeSingle()

  if (!lineup) return 0

  const { starters, bench } = toStartersAndBench(lineup.league_lineup_players ?? [])
  if (starters.length === 0) return 0

  const resolved = await resolveLineupScore(supabase, {
    starters,
    bench,
    gameweekId,
    roleField,
    modules,
    useStoredScores: false,
    isReverse,
  })

  return resolved.totalScore
}

function rankByPointsThenScore(rows) {
  const sorted = [...rows].sort(
    (a, b) => b.points - a.points || b.total_fantasy_score - a.total_fantasy_score
  )
  let rank = 0
  let prevKey = null
  sorted.forEach((row, idx) => {
    const key = `${row.points}:${row.total_fantasy_score}`
    if (prevKey === null || key !== prevKey) rank = idx + 1
    prevKey = key
    row.rank = rank
  })
  return sorted
}

// Rebuilds league_standings for one league entirely from
// league_gameweek_scores (summed across every gameweek consolidated so
// far), instead of nudging existing totals by a delta. Safe to call after
// every consolidation run, for any number of runs, on the same gameweek.
async function recomputeLeagueStandings(supabase, leagueId) {
  const { data: gwScores, error } = await supabase
    .from('league_gameweek_scores')
    .select('user_id, total_score, league_points, won, drawn, lost')
    .eq('league_id', leagueId)
  if (error) throw error

  const aggByUser = new Map()
  for (const row of gwScores ?? []) {
    const agg = aggByUser.get(row.user_id) ?? {
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      points: 0,
      total_fantasy_score: 0,
    }
    agg.played += 1
    agg.won += row.won ?? 0
    agg.drawn += row.drawn ?? 0
    agg.lost += row.lost ?? 0
    agg.points += row.league_points ?? 0
    agg.total_fantasy_score += row.total_score ?? 0
    aggByUser.set(row.user_id, agg)
  }

  const rows = [...aggByUser.entries()].map(([user_id, agg]) => ({
    league_id: leagueId,
    user_id,
    ...agg,
    updated_at: new Date().toISOString(),
  }))

  const ranked = rankByPointsThenScore(rows)
  if (ranked.length > 0) {
    const { error: upsertError } = await supabase
      .from('league_standings')
      .upsert(ranked, { onConflict: 'league_id,user_id' })
    if (upsertError) throw upsertError
  }
}

async function consolidateLeague(supabase, league, gameweek) {
  const moduleSystem = getLeagueModuleSystem(league)

  const { data: members } = await supabase.from('league_members').select('user_id').eq('league_id', league.id)
  if (!members || members.length === 0) return

  console.log(`  ${league.name}: ${members.length} members, format ${league.competition_format}`)

  const totalsByUser = new Map()
  for (const m of members) {
    const total = await computeUserTotalScore(supabase, {
      userId: m.user_id,
      leagueId: league.id,
      gameweekId: gameweek.id,
      roleField: moduleSystem.roleField,
      modules: moduleSystem.modules,
      isReverse: league.is_reverse_scoring,
    })
    totalsByUser.set(m.user_id, total)
  }

  const rankedThisGw = rankByPointsThenScore(
    [...totalsByUser.entries()].map(([user_id, total_fantasy_score]) => ({
      user_id,
      points: total_fantasy_score,
      total_fantasy_score,
    }))
  )
  const rankInGwByUser = new Map(rankedThisGw.map((r) => [r.user_id, r.rank]))

  // Per-user result for THIS gameweek only — written into
  // league_gameweek_scores below, then summed across all gameweeks by
  // recomputeLeagueStandings. Not written to league_standings directly.
  const leaguePointsByUser = new Map()
  const wonByUser = new Map()
  const drawnByUser = new Map()
  const lostByUser = new Map()

  if (league.competition_format.startsWith('direct_')) {
    const { data: calendarRow } = await supabase
      .from('league_calendar')
      .select('id')
      .eq('league_id', league.id)
      .eq('gameweek_id', gameweek.id)
      .maybeSingle()

    if (calendarRow) {
      const { data: matchups } = await supabase.from('league_matchups').select('*').eq('calendar_id', calendarRow.id)

      for (const matchup of matchups ?? []) {
        const homeScore = totalsByUser.get(matchup.home_user_id) ?? 0
        const awayScore = totalsByUser.get(matchup.away_user_id) ?? 0
        const homeResult = resultPoints(homeScore, awayScore)
        const awayResult = resultPoints(awayScore, homeScore)

        const { error: matchupError } = await supabase
          .from('league_matchups')
          .update({
            home_score: homeScore,
            away_score: awayScore,
            home_result: homeResult,
            away_result: awayResult,
            is_played: true,
          })
          .eq('id', matchup.id)
        if (matchupError) throw new Error(`league_matchups update failed for matchup ${matchup.id}: ${matchupError.message}`)

        const isVoteSum = league.competition_format === 'direct_vote_sum'

        leaguePointsByUser.set(matchup.home_user_id, isVoteSum ? homeScore : homeResult)
        leaguePointsByUser.set(matchup.away_user_id, isVoteSum ? awayScore : awayResult)
        wonByUser.set(matchup.home_user_id, homeResult === 3 ? 1 : 0)
        drawnByUser.set(matchup.home_user_id, homeResult === 1 ? 1 : 0)
        lostByUser.set(matchup.home_user_id, homeResult === 0 ? 1 : 0)
        wonByUser.set(matchup.away_user_id, awayResult === 3 ? 1 : 0)
        drawnByUser.set(matchup.away_user_id, awayResult === 1 ? 1 : 0)
        lostByUser.set(matchup.away_user_id, awayResult === 0 ? 1 : 0)
      }
    } else {
      console.warn(`    [warning] no calendar row for gameweek ${gameweek.number} — was the calendar generated?`)
    }
  } else if (league.competition_format === 'royal_rumble_seria') {
    const userIds = [...totalsByUser.keys()]
    for (const userId of userIds) {
      let points = 0
      let won = 0
      let drawn = 0
      let lost = 0
      for (const otherId of userIds) {
        if (otherId === userId) continue
        const result = resultPoints(totalsByUser.get(userId), totalsByUser.get(otherId))
        points += result
        if (result === 3) won += 1
        else if (result === 1) drawn += 1
        else lost += 1
      }
      leaguePointsByUser.set(userId, points)
      wonByUser.set(userId, won)
      drawnByUser.set(userId, drawn)
      lostByUser.set(userId, lost)
    }
  } else if (league.competition_format === 'royal_rumble_f1') {
    // No win/drawn/lost concept for F1 — points come purely from rank.
    for (const row of rankedThisGw) {
      const f1Points = F1_POINTS[row.rank - 1] ?? 0
      leaguePointsByUser.set(row.user_id, f1Points)
    }
  }

  const gwScoreRows = [...totalsByUser.entries()].map(([user_id, total_score]) => ({
    league_id: league.id,
    user_id,
    gameweek_id: gameweek.id,
    total_score,
    league_points: leaguePointsByUser.get(user_id) ?? 0,
    won: wonByUser.get(user_id) ?? 0,
    drawn: drawnByUser.get(user_id) ?? 0,
    lost: lostByUser.get(user_id) ?? 0,
    rank_in_gameweek: rankInGwByUser.get(user_id) ?? null,
    is_final: true,
    updated_at: new Date().toISOString(),
  }))

  if (gwScoreRows.length > 0) {
    const { error: gwScoreError } = await supabase
      .from('league_gameweek_scores')
      .upsert(gwScoreRows, { onConflict: 'league_id,user_id,gameweek_id' })
    if (gwScoreError) throw new Error(`league_gameweek_scores upsert failed for league ${league.id}: ${gwScoreError.message}`)
  }

  await recomputeLeagueStandings(supabase, league.id)
}

// Exported so api/calculate-gameweek.js can call this in-process (admin-only
// "Calcola giornata" button). The CLI entrypoint below wraps it unchanged.
export async function consolidateLeagueGameweek(supabase, { gameweekNumber } = {}) {
  const gameweek = await findTargetGameweek(supabase, gameweekNumber)
  if (!gameweek) {
    console.log('No live or completed gameweek found to consolidate.')
    return { consolidated: false, reason: 'no-target-gameweek' }
  }
  console.log(`Consolidating leagues for gameweek ${gameweek.number} (id ${gameweek.id})...`)

  const { data: leagues, error } = await supabase.from('leagues').select('*').eq('status', 'active')
  if (error) throw error

  for (const league of leagues ?? []) {
    await consolidateLeague(supabase, league, gameweek)
  }

  console.log('Done.')
  return { consolidated: true, gameweekNumber: gameweek.number, leaguesConsolidated: (leagues ?? []).length }
}

async function main() {
  const gameweekNumber = process.argv[2] ? Number(process.argv[2]) : undefined
  return consolidateLeagueGameweek(getSupabaseAdmin(), { gameweekNumber })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('consolidate-league-gameweek failed:', err.message || err)
    process.exit(1)
  })
}
