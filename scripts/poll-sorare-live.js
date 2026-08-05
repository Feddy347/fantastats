// Polls Sorare for live/finished stats of every player currently fielded as
// a starter — in any category lineup or any league lineup — for the live
// gameweek, upserts player_match_stats, and recomputes player_match_scores
// for category starters (league scores are derived live, client-side, from
// player_match_stats — see src/lib/leagueScoring.js).
//
// Fetches stats PER PLAYER (anyPlayer(slug).anyGameStats), not per match.
// football.game(id).playerGameScores (what poll-sorare.js uses) was
// confirmed live to always return an empty list, even for real, finished,
// "scored: true" games. anyPlayer(slug).anyGameStats does return real data —
// but it isn't scoped to a competition: for a player who's also played
// internationally (e.g. a recent World Cup), the most recent entries can be
// national-team games, not Serie A. There's no server-side filter for this
// (confirmed live — the field only accepts `last`), so this over-fetches
// (GAME_LOOKBACK) and picks the first entry whose anyGame.competition.slug
// is Serie A's ("serie-a-it").
//
// Doesn't require a matches row to already exist for the fetched game (i.e.
// doesn't depend on fetch-sorare-games.js having run first): if a fielded
// player's latest Serie A game has no corresponding local `matches` row for
// this gameweek, one is created on the fly from Sorare's own game data. This
// is what makes "the live tiles always show a score, based on whatever the
// player's latest Sorare game actually is" work even when the gameweek's
// real fixtures were never fetched (or, as during preseason testing, the
// only matches row for the gameweek is a fake/simulated one — confirmed
// live: a gameweek marked 'live' with only a "Squadra Test A vs Squadra
// Test B" row meant every real player's real game came back "unmatched" and
// got skipped, hence every score staying 0).
//
// Meant to be run periodically (every 2-3 minutes) while a gameweek is live:
// `node scripts/poll-sorare-live.js`.

import { getSupabaseAdmin } from './lib/env.js'
import {
  sorareQuery,
  sleep,
  bareGameId,
  statsRowFromSorare,
  mapMatchStatus,
  teamNamesMatch,
  SORARE_REQUEST_DELAY_MS,
} from './lib/sorareClient.js'
import { calculateScore } from '../src/lib/scoreEngine.js'

const SERIE_A_SLUG = 'serie-a-it'

// How many of the player's most recent games (any competition) to fetch
// before filtering down to Serie A ones. Generous enough to skip past a
// national-team tournament without needing a second round-trip.
const GAME_LOOKBACK = 20

const PLAYER_GAME_STATS_QUERY = `
query PlayerGameStats($slug: String!, $last: Int!) {
  anyPlayer(slug: $slug) {
    anyGameStats(last: $last) {
      anyGame {
        id
        date
        competition { slug }
        statusTyped
        homeTeam { name }
        awayTeam { name }
        homeScore
        awayScore
      }
      ... on PlayerGameStats {
        live
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
      }
    }
  }
}
`

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: gameweek } = await supabase.from('gameweeks').select('*').eq('status', 'live').maybeSingle()
  if (!gameweek) {
    console.log('No live gameweek right now.')
    return
  }

  const [{ data: categoryStarters }, { data: leagueStarters }, { data: mappings }] = await Promise.all([
    supabase
      .from('lineup_players')
      .select('player_id, slot_role')
      .eq('slot_type', 'starter')
      .eq('gameweek_id', gameweek.id),
    supabase
      .from('league_lineup_players')
      .select('player_id, league_lineups!inner(gameweek_id)')
      .eq('slot_type', 'starter')
      .eq('league_lineups.gameweek_id', gameweek.id),
    supabase.from('sorare_player_mapping').select('player_id, sorare_slug'),
  ])

  const slotRoleByPlayerId = new Map()
  ;(categoryStarters ?? []).forEach((s) => {
    if (!slotRoleByPlayerId.has(s.player_id)) slotRoleByPlayerId.set(s.player_id, s.slot_role)
  })

  const playerIds = new Set([
    ...(categoryStarters ?? []).map((s) => s.player_id),
    ...(leagueStarters ?? []).map((s) => s.player_id),
  ])

  if (playerIds.size === 0) {
    console.log('No starters fielded (category or league) for this gameweek.')
    return
  }

  const slugByPlayerId = new Map((mappings ?? []).map((m) => [m.player_id, m.sorare_slug]))

  const { data: rosterPlayers } = await supabase
    .from('players')
    .select('id, name, role_fantastats')
    .in('id', [...playerIds])
  const roleByPlayerId = new Map((rosterPlayers ?? []).map((p) => [p.id, p]))

  const [{ data: gwMatches }, { data: teams }] = await Promise.all([
    supabase.from('matches').select('id, sorare_game_id').eq('gameweek_id', gameweek.id).not('sorare_game_id', 'is', null),
    supabase.from('teams').select('name'),
  ])
  const matchIdBySorareId = new Map((gwMatches ?? []).map((m) => [m.sorare_game_id, m.id]))

  // Sorare's club names ("AS Roma") never exactly match ours ("Roma") — see
  // src/lib/teamNames.js's header comment. Resolves to our own name when a
  // fuzzy match is found, otherwise falls back to Sorare's raw name (better
  // than nothing, e.g. for a club not in our `teams` table yet).
  function resolveTeamName(sorareName) {
    return (teams ?? []).find((t) => teamNamesMatch(t.name, sorareName))?.name ?? sorareName
  }

  async function findOrCreateMatch(entry) {
    const gameId = bareGameId(entry.anyGame.id)
    const existing = matchIdBySorareId.get(gameId)
    if (existing) return existing

    const { data: created, error } = await supabase
      .from('matches')
      .insert({
        gameweek_id: gameweek.id,
        home_team: resolveTeamName(entry.anyGame.homeTeam?.name),
        away_team: resolveTeamName(entry.anyGame.awayTeam?.name),
        home_score: entry.anyGame.homeScore,
        away_score: entry.anyGame.awayScore,
        status: mapMatchStatus(entry.anyGame.statusTyped),
        sorare_game_id: gameId,
        starts_at: entry.anyGame.date,
      })
      .select('id')
      .single()

    if (error) throw new Error(`creating match for game ${gameId}: ${error.message}`)

    matchIdBySorareId.set(gameId, created.id)
    return created.id
  }

  console.log(`Polling ${playerIds.size} starter(s) for GW${gameweek.number}...`)

  let statsUpdated = 0
  let scoresUpdated = 0
  let noMapping = 0
  let noSerieAGame = 0
  const matchUpdates = new Map()

  for (const playerId of playerIds) {
    const slug = slugByPlayerId.get(playerId)
    if (!slug) {
      console.warn(`[no mapping] player ${playerId} (${roleByPlayerId.get(playerId)?.name ?? '?'})`)
      noMapping += 1
      await sleep(SORARE_REQUEST_DELAY_MS)
      continue
    }

    try {
      const data = await sorareQuery(PLAYER_GAME_STATS_QUERY, { slug, last: GAME_LOOKBACK })
      const entries = data?.anyPlayer?.anyGameStats ?? []
      const entry = entries.find((e) => e.anyGame?.competition?.slug === SERIE_A_SLUG)

      if (!entry) {
        console.warn(`[no recent serie-a game] ${roleByPlayerId.get(playerId)?.name ?? slug}`)
        noSerieAGame += 1
        await sleep(SORARE_REQUEST_DELAY_MS)
        continue
      }

      const matchId = await findOrCreateMatch(entry)

      const statsRow = statsRowFromSorare(entry, playerId, matchId)
      const { error: statsError } = await supabase
        .from('player_match_stats')
        .upsert(statsRow, { onConflict: 'player_id,match_id' })
      if (statsError) {
        console.error(`[error] upserting stats for player ${playerId}: ${statsError.message}`)
      } else {
        statsUpdated += 1
      }

      matchUpdates.set(matchId, {
        home_score: entry.anyGame.homeScore,
        away_score: entry.anyGame.awayScore,
        status: mapMatchStatus(entry.anyGame.statusTyped),
      })

      const slotRole = slotRoleByPlayerId.get(playerId)
      if (slotRole !== undefined) {
        const role = roleByPlayerId.get(playerId)?.role_fantastats
        const score = calculateScore(statsRow, role, slotRole)
        const { error: scoreError } = await supabase.from('player_match_scores').upsert(
          {
            player_id: playerId,
            match_id: matchId,
            gameweek_id: gameweek.id,
            base_score: score.baseScore,
            multiplier: score.multiplier,
            bonus_score: score.bonusScore,
            malus_score: score.malusScore,
            total_score: score.totalScore,
            score_breakdown: score.breakdown,
            is_final: !entry.live,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'player_id,match_id' }
        )
        if (scoreError) {
          console.error(`[error] upserting score for player ${playerId}: ${scoreError.message}`)
        } else {
          scoresUpdated += 1
        }
      }
    } catch (err) {
      console.error(`[error] player ${playerId} (${slug}): ${err.message || err}`)
    }

    await sleep(SORARE_REQUEST_DELAY_MS)
  }

  for (const [matchId, update] of matchUpdates) {
    const { error } = await supabase.from('matches').update(update).eq('id', matchId)
    if (error) console.error(`[error] updating match ${matchId}: ${error.message}`)
  }

  console.log(
    `Done. Stats updated: ${statsUpdated}. Scores updated: ${scoresUpdated}. No mapping: ${noMapping}. No Serie A game found: ${noSerieAGame}.`
  )
}

main().catch((err) => {
  console.error('poll-sorare-live failed:', err.message || err)
  process.exit(1)
})
