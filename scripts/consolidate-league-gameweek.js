// Consolidates one gameweek for every active league: computes each
// member's total_score (with automatic substitutions, same rule as
// categories — see lineupResolver.js), updates matchups/standings per the
// league's competition_format, and recomputes rank.
//
// Scores are computed FRESH here (via resolveLineupScore/calculateScore)
// rather than reused from player_match_scores, because that table holds one
// row per player+match computed with whatever slot_role the CATEGORIES
// lineup used — a league lineup can field the same player in a different
// slot/module, which changes the scoring multiplier. So league scoring
// re-derives the number from raw player_match_stats every time
// (useStoredScores: false below).
//
// Usage: node scripts/consolidate-league-gameweek.js

import { getSupabaseAdmin } from './lib/env.js'
import { resolveLineupScore } from './lib/lineupResolver.js'
import { getLeagueModuleSystem } from '../src/lib/leagueModules.js'

const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]

function resultPoints(myScore, otherScore) {
  if (myScore > otherScore) return 3
  if (myScore === otherScore) return 1
  return 0
}

async function findTargetGameweek(supabase) {
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

async function upsertStanding(supabase, leagueId, userId, delta) {
  const { data: existing } = await supabase
    .from('league_standings')
    .select('*')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle()

  const next = {
    league_id: leagueId,
    user_id: userId,
    points: (existing?.points ?? 0) + (delta.points ?? 0),
    played: (existing?.played ?? 0) + 1,
    won: (existing?.won ?? 0) + (delta.won ?? 0),
    drawn: (existing?.drawn ?? 0) + (delta.drawn ?? 0),
    lost: (existing?.lost ?? 0) + (delta.lost ?? 0),
    total_fantasy_score: (existing?.total_fantasy_score ?? 0) + (delta.totalScore ?? 0),
    updated_at: new Date().toISOString(),
  }

  await supabase.from('league_standings').upsert(next, { onConflict: 'league_id,user_id' })
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

  const leaguePointsByUser = new Map()

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

        await supabase
          .from('league_matchups')
          .update({
            home_score: homeScore,
            away_score: awayScore,
            home_result: homeResult,
            away_result: awayResult,
            is_played: true,
          })
          .eq('id', matchup.id)

        const isVoteSum = league.competition_format === 'direct_vote_sum'

        await upsertStanding(supabase, league.id, matchup.home_user_id, {
          points: isVoteSum ? homeScore : homeResult,
          won: homeResult === 3 ? 1 : 0,
          drawn: homeResult === 1 ? 1 : 0,
          lost: homeResult === 0 ? 1 : 0,
          totalScore: homeScore,
        })
        await upsertStanding(supabase, league.id, matchup.away_user_id, {
          points: isVoteSum ? awayScore : awayResult,
          won: awayResult === 3 ? 1 : 0,
          drawn: awayResult === 1 ? 1 : 0,
          lost: awayResult === 0 ? 1 : 0,
          totalScore: awayScore,
        })

        leaguePointsByUser.set(matchup.home_user_id, isVoteSum ? homeScore : homeResult)
        leaguePointsByUser.set(matchup.away_user_id, isVoteSum ? awayScore : awayResult)
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
      await upsertStanding(supabase, league.id, userId, { points, won, drawn, lost, totalScore: totalsByUser.get(userId) })
    }
  } else if (league.competition_format === 'royal_rumble_f1') {
    for (const row of rankedThisGw) {
      const f1Points = F1_POINTS[row.rank - 1] ?? 0
      leaguePointsByUser.set(row.user_id, f1Points)
      await upsertStanding(supabase, league.id, row.user_id, {
        points: f1Points,
        totalScore: totalsByUser.get(row.user_id),
      })
    }
  }

  const gwScoreRows = [...totalsByUser.entries()].map(([user_id, total_score]) => ({
    league_id: league.id,
    user_id,
    gameweek_id: gameweek.id,
    total_score,
    league_points: leaguePointsByUser.get(user_id) ?? 0,
    rank_in_gameweek: rankInGwByUser.get(user_id) ?? null,
    is_final: true,
    updated_at: new Date().toISOString(),
  }))

  if (gwScoreRows.length > 0) {
    await supabase.from('league_gameweek_scores').upsert(gwScoreRows, { onConflict: 'league_id,user_id,gameweek_id' })
  }

  const { data: standings } = await supabase.from('league_standings').select('*').eq('league_id', league.id)
  const ranked = rankByPointsThenScore(standings ?? [])
  for (const row of ranked) {
    await supabase.from('league_standings').update({ rank: row.rank }).eq('id', row.id)
  }
}

async function main() {
  const supabase = getSupabaseAdmin()

  const gameweek = await findTargetGameweek(supabase)
  if (!gameweek) {
    console.log('No live or completed gameweek found to consolidate.')
    return
  }
  console.log(`Consolidating leagues for gameweek ${gameweek.number} (id ${gameweek.id})...`)

  const { data: leagues, error } = await supabase.from('leagues').select('*').eq('status', 'active')
  if (error) throw error

  for (const league of leagues ?? []) {
    await consolidateLeague(supabase, league, gameweek)
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error('consolidate-league-gameweek failed:', err.message || err)
  process.exit(1)
})
