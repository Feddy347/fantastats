// Polls Sorare for live-match player stats, upserts the raw numbers into
// player_match_stats, and computes/upserts player_match_scores for every
// starter fielded that gameweek.
//
// Manual for now: `node scripts/poll-sorare.js`. Becomes a scheduled Edge
// Function in Phase 5.

import { getSupabaseAdmin } from './lib/env.js'
import { sorareQuery, sleep, SORARE_REQUEST_DELAY_MS } from './lib/sorareClient.js'
import { calculateScore } from '../src/lib/scoreEngine.js'

const GAME_STATS_QUERY = `
query GameStats($gameId: ID!) {
  football {
    game(id: $gameId) {
      id
      status
      homeTeam { name }
      awayTeam { name }
      homeScore
      awayScore
      playerGameStats {
        player {
          slug
          displayName
        }
        minsPlayed
        goals
        attPenGoal
        goalAssist
        ontargetScoringAtt
        bigChanceCreated
        assistPenaltyWon
        attPenMiss
        accuratePass
        totalPass
        passAccuracy
        wonTackle
        totalTackle
        interceptionWon
        effectiveClearance
        duelWon
        clearanceOffLine
        lastManTackle
        saves
        penaltySave
        goalsConceded
        cleanSheet
        fouls
        yellowCard
        redCard
        ownGoals
        errorLeadToGoal
        errorLeadToShot
        penaltyConceded
        wonContest
        threeGoalsConceded
        gameStarted
        live
      }
    }
  }
}
`

function statsRowFromSorare(stat, playerId, matchId) {
  return {
    player_id: playerId,
    match_id: matchId,
    mins_played: stat.minsPlayed ?? 0,
    goals: stat.goals ?? 0,
    att_pen_goal: stat.attPenGoal ?? 0,
    goal_assist: stat.goalAssist ?? 0,
    ontarget_scoring_att: stat.ontargetScoringAtt ?? 0,
    big_chance_created: stat.bigChanceCreated ?? 0,
    assist_penalty_won: stat.assistPenaltyWon ?? 0,
    att_pen_miss: stat.attPenMiss ?? 0,
    accurate_pass: stat.accuratePass ?? 0,
    total_pass: stat.totalPass ?? 0,
    pass_accuracy: stat.passAccuracy ?? 0,
    won_tackle: stat.wonTackle ?? 0,
    total_tackle: stat.totalTackle ?? 0,
    interception_won: stat.interceptionWon ?? 0,
    effective_clearance: stat.effectiveClearance ?? 0,
    duel_won: stat.duelWon ?? 0,
    clearance_off_line: stat.clearanceOffLine ?? 0,
    last_man_tackle: stat.lastManTackle ?? 0,
    saves: stat.saves ?? 0,
    penalty_save: stat.penaltySave ?? 0,
    goals_conceded: stat.goalsConceded ?? 0,
    clean_sheet: Boolean(stat.cleanSheet),
    fouls: stat.fouls ?? 0,
    yellow_card: stat.yellowCard ?? 0,
    red_card: stat.redCard ?? 0,
    own_goals: stat.ownGoals ?? 0,
    error_lead_to_goal: stat.errorLeadToGoal ?? 0,
    error_lead_to_shot: stat.errorLeadToShot ?? 0,
    penalty_conceded: stat.penaltyConceded ?? 0,
    won_contest: stat.wonContest ?? 0,
    three_goals_conceded: Boolean(stat.threeGoalsConceded),
    game_started: Boolean(stat.gameStarted),
    is_live: Boolean(stat.live),
    updated_at: new Date().toISOString(),
  }
}

function mapMatchStatus(sorareStatus) {
  return /fin|end/i.test(sorareStatus ?? '') ? 'finished' : 'live'
}

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: matches, error } = await supabase
    .from('matches')
    .select('*')
    .eq('status', 'live')
    .not('sorare_game_id', 'is', null)

  if (error) throw error

  if (matches.length === 0) {
    console.log('No live matches with a sorare_game_id to poll.')
    return
  }

  const { data: mappings, error: mappingError } = await supabase
    .from('sorare_player_mapping')
    .select('player_id, sorare_slug')
  if (mappingError) throw mappingError

  const playerIdBySlug = new Map(mappings.map((m) => [m.sorare_slug, m.player_id]))

  let statsUpdated = 0
  let scoresUpdated = 0
  let unmappedCount = 0

  for (const match of matches) {
    console.log(`Polling ${match.home_team} vs ${match.away_team} (game ${match.sorare_game_id})...`)

    let game
    try {
      const data = await sorareQuery(GAME_STATS_QUERY, { gameId: match.sorare_game_id })
      game = data?.football?.game
    } catch (err) {
      console.error(`[error] match ${match.id}: ${err.message || err}`)
      await sleep(SORARE_REQUEST_DELAY_MS)
      continue
    }

    if (!game) {
      console.warn(`[warning] no game data returned for match ${match.id}`)
      await sleep(SORARE_REQUEST_DELAY_MS)
      continue
    }

    const newStatus = mapMatchStatus(game.status)
    await supabase
      .from('matches')
      .update({ home_score: game.homeScore, away_score: game.awayScore, status: newStatus })
      .eq('id', match.id)

    const statsRowByPlayerId = new Map()
    for (const stat of game.playerGameStats ?? []) {
      const playerId = playerIdBySlug.get(stat.player?.slug)
      if (!playerId) {
        console.warn(`[unmapped] ${stat.player?.displayName} (${stat.player?.slug})`)
        unmappedCount += 1
        continue
      }
      const row = statsRowFromSorare(stat, playerId, match.id)
      statsRowByPlayerId.set(playerId, row)
    }

    if (statsRowByPlayerId.size > 0) {
      const { error: statsError } = await supabase
        .from('player_match_stats')
        .upsert([...statsRowByPlayerId.values()], { onConflict: 'player_id,match_id' })
      if (statsError) {
        console.error(`[error] upserting stats for match ${match.id}: ${statsError.message}`)
      } else {
        statsUpdated += statsRowByPlayerId.size
      }
    }

    const playerIds = [...statsRowByPlayerId.keys()]
    if (playerIds.length > 0) {
      const [{ data: lineupPlayers, error: lineupError }, { data: rosterPlayers, error: playersError }] =
        await Promise.all([
          supabase
            .from('lineup_players')
            .select('player_id, slot_role, lineups!inner(gameweek_id)')
            .eq('slot_type', 'starter')
            .eq('lineups.gameweek_id', match.gameweek_id)
            .in('player_id', playerIds),
          supabase.from('players').select('id, role_fantastats').in('id', playerIds),
        ])

      if (lineupError) console.error(`[error] fetching lineups: ${lineupError.message}`)
      if (playersError) console.error(`[error] fetching players: ${playersError.message}`)

      const roleByPlayerId = new Map((rosterPlayers ?? []).map((p) => [p.id, p.role_fantastats]))

      const scoreRows = (lineupPlayers ?? []).map((lp) => {
        const stats = statsRowByPlayerId.get(lp.player_id)
        const role = roleByPlayerId.get(lp.player_id)
        const score = calculateScore(stats, role, lp.slot_role)
        return {
          player_id: lp.player_id,
          match_id: match.id,
          gameweek_id: match.gameweek_id,
          base_score: score.baseScore,
          multiplier: score.multiplier,
          bonus_score: score.bonusScore,
          malus_score: score.malusScore,
          total_score: score.totalScore,
          score_breakdown: score.breakdown,
          is_final: newStatus === 'finished',
          updated_at: new Date().toISOString(),
        }
      })

      if (scoreRows.length > 0) {
        const { error: scoresError } = await supabase
          .from('player_match_scores')
          .upsert(scoreRows, { onConflict: 'player_id,match_id' })
        if (scoresError) {
          console.error(`[error] upserting scores for match ${match.id}: ${scoresError.message}`)
        } else {
          scoresUpdated += scoreRows.length
        }
      }
    }

    await sleep(SORARE_REQUEST_DELAY_MS)
  }

  console.log(
    `Done. Stats updated: ${statsUpdated}. Scores updated: ${scoresUpdated}. Unmapped players seen: ${unmappedCount}.`
  )
}

main().catch((err) => {
  console.error('poll-sorare failed:', err.message || err)
  process.exit(1)
})
