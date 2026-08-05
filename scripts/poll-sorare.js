// Polls Sorare for live-match player stats, upserts the raw numbers into
// player_match_stats, and computes/upserts player_match_scores for every
// starter fielded that gameweek.
//
// SUPERSEDED by scripts/poll-sorare-live.js: this script fetches stats
// per-match via football.game(id).playerGameScores, which — confirmed live
// against Sorare's API — returns an empty list for every real, finished,
// "scored: true" game tried, regardless of API key. poll-sorare-live.js
// fetches per-player instead (anyPlayer(slug).anyGameStats), which does
// return real data. Kept here for reference; prefer the new script.
//
// Manual for now: `node scripts/poll-sorare.js`. Becomes a scheduled Edge
// Function in Phase 5.

import { getSupabaseAdmin } from './lib/env.js'
import { sorareQuery, sleep, SORARE_REQUEST_DELAY_MS, statsRowFromSorare, mapMatchStatus } from './lib/sorareClient.js'
import { calculateScore } from '../src/lib/scoreEngine.js'

// Game.playerGameStats doesn't exist (confirmed live). Stats live under
// playerGameScores, which is typed as an interface (PlayerGameScoreInterface);
// the actual per-stat fields sit under anyPlayerGameStats, itself an interface
// (AnyPlayerGameStatsInterface) resolved by football games as the concrete
// type PlayerGameStats. Game.status doesn't exist either — it's statusTyped
// (enum GameStatus: scheduled/playing/played/postponed/suspended/cancelled).
// Confirmed live via Sorare's first-party GraphQL Playground
// (api.sorare.com/graphql/playground), which allows introspection unlike the
// public API.
const GAME_STATS_QUERY = `
query GameStats($gameId: ID!) {
  football {
    game(id: $gameId) {
      id
      statusTyped
      homeTeam { name }
      awayTeam { name }
      homeScore
      awayScore
      playerGameScores {
        anyPlayer {
          slug
          displayName
        }
        anyPlayerGameStats {
          ... on PlayerGameStats {
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
  }
}
`

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

    const newStatus = mapMatchStatus(game.statusTyped)
    await supabase
      .from('matches')
      .update({ home_score: game.homeScore, away_score: game.awayScore, status: newStatus })
      .eq('id', match.id)

    const statsRowByPlayerId = new Map()
    for (const entry of game.playerGameScores ?? []) {
      const playerId = playerIdBySlug.get(entry.anyPlayer?.slug)
      if (!playerId) {
        console.warn(`[unmapped] ${entry.anyPlayer?.displayName} (${entry.anyPlayer?.slug})`)
        unmappedCount += 1
        continue
      }
      const row = statsRowFromSorare(entry.anyPlayerGameStats ?? {}, playerId, match.id)
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
