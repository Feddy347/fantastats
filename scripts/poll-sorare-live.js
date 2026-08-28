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
// Requires `matches` to already be synced for this gameweek — via
// scripts/sync-gameweek-fixtures.js, which seeds it from serie_a_fixtures
// (the real Serie A calendar) — rather than creating a `matches` row on
// the fly from whatever game a fielded player's own Sorare history
// happens to return. That used to be how this script worked, and it
// produced an incoherent "gameweek" fixture list: two different fielded
// players' most-recent-game data can point at two different real
// gameweeks (e.g. after a postponement, or simply because polling ran on
// different days), so `matches` for one internal gameweek ended up with
// the same team appearing in two different fixture rows (see
// AUDIT_REPORT.md §4.2). A player whose resolved game doesn't match any
// synced fixture is now skipped (see findSyncedMatch) rather than getting
// a fabricated match row — their score for this gameweek simply doesn't
// update until the underlying data issue (usually a stale `players.team`)
// is fixed, instead of silently corrupting the fixture list.
//
// Meant to be run periodically (every 2-3 minutes) while a gameweek is live:
// `node scripts/poll-sorare-live.js`.

import { pathToFileURL } from 'node:url'
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

// Exported so api/calculate-gameweek.js can run this in-process (as the
// admin-only "Calcola giornata" button) without shelling out to `node
// scripts/poll-sorare-live.js` — a Vercel function's filesystem doesn't
// include files outside its own import graph. The `main()` CLI entrypoint
// below is a thin wrapper that keeps `node scripts/poll-sorare-live.js`
// working unchanged.
// gameweekNumber is optional: pass it to poll a specific gameweek
// regardless of its status (e.g. a CLI run against a gameweek that's
// already flipped to 'completed'); omit it to keep the original
// "whichever gameweek is currently live" behavior the button/cron use.
export async function pollSorareLive(supabase, { gameweekNumber } = {}) {
  const { data: gameweek } = gameweekNumber
    ? await supabase.from('gameweeks').select('*').eq('number', gameweekNumber).maybeSingle()
    : await supabase.from('gameweeks').select('*').eq('status', 'live').maybeSingle()

  if (!gameweek) {
    console.log(gameweekNumber ? `Gameweek ${gameweekNumber} not found.` : 'No live gameweek right now.')
    return { polled: false, reason: gameweekNumber ? 'gameweek-not-found' : 'no-live-gameweek' }
  }

  const [{ data: categoryStarters }, { data: leagueStarters }, { data: mappings }, { data: categories }] =
    await Promise.all([
      supabase
        .from('lineup_players')
        .select('player_id, slot_role, lineups!inner(category_id)')
        .eq('slot_type', 'starter')
        .eq('gameweek_id', gameweek.id),
      supabase
        .from('league_lineup_players')
        .select('player_id, league_lineups!inner(gameweek_id)')
        .eq('slot_type', 'starter')
        .eq('league_lineups.gameweek_id', gameweek.id),
      supabase.from('sorare_player_mapping').select('player_id, sorare_slug'),
      supabase.from('categories').select('id, is_reverse_scoring'),
    ])

  const reverseByCategoryId = new Map((categories ?? []).map((c) => [c.id, c.is_reverse_scoring]))

  const slotRoleByPlayerId = new Map()
  const categoryIdByPlayerId = new Map()
  ;(categoryStarters ?? []).forEach((s) => {
    if (!slotRoleByPlayerId.has(s.player_id)) {
      slotRoleByPlayerId.set(s.player_id, s.slot_role)
      categoryIdByPlayerId.set(s.player_id, s.lineups.category_id)
    }
  })

  const playerIds = new Set([
    ...(categoryStarters ?? []).map((s) => s.player_id),
    ...(leagueStarters ?? []).map((s) => s.player_id),
  ])

  if (playerIds.size === 0) {
    console.log('No starters fielded (category or league) for this gameweek.')
    return { polled: false, reason: 'no-starters', gameweekNumber: gameweek.number }
  }

  const slugByPlayerId = new Map((mappings ?? []).map((m) => [m.player_id, m.sorare_slug]))

  const { data: rosterPlayers } = await supabase
    .from('players')
    .select('id, name, role_fantastats')
    .in('id', [...playerIds])
  const roleByPlayerId = new Map((rosterPlayers ?? []).map((p) => [p.id, p]))

  const [{ data: gwMatches }, { data: teams }] = await Promise.all([
    supabase.from('matches').select('id, sorare_game_id, home_team, away_team').eq('gameweek_id', gameweek.id),
    supabase.from('teams').select('name'),
  ])
  const matchIdBySorareId = new Map((gwMatches ?? []).filter((m) => m.sorare_game_id).map((m) => [m.sorare_game_id, m.id]))
  const matchIdByTeamPair = new Map((gwMatches ?? []).map((m) => [`${m.home_team}|${m.away_team}`, m.id]))

  // Sorare's club names ("AS Roma") never exactly match ours ("Roma") — see
  // src/lib/teamNames.js's header comment. Resolves to our own name when a
  // fuzzy match is found, otherwise falls back to Sorare's raw name (better
  // than nothing, e.g. for a club not in our `teams` table yet).
  function resolveTeamName(sorareName) {
    return (teams ?? []).find((t) => teamNamesMatch(t.name, sorareName))?.name ?? sorareName
  }

  // Looks up the pre-synced match for this gameweek (see
  // sync-gameweek-fixtures.js) by Sorare game id first, falling back to a
  // team-name match — and opportunistically backfills sorare_game_id onto
  // that row once resolved, same as fetch-sorare-games.js would. Returns
  // null (never creates a row) when no synced fixture corresponds; the
  // caller skips that player's stats for this run instead.
  async function findSyncedMatch(entry) {
    const gameId = bareGameId(entry.anyGame.id)
    const bySorareId = matchIdBySorareId.get(gameId)
    if (bySorareId) return bySorareId

    const home = resolveTeamName(entry.anyGame.homeTeam?.name)
    const away = resolveTeamName(entry.anyGame.awayTeam?.name)
    const matchId = matchIdByTeamPair.get(`${home}|${away}`)
    if (!matchId) return null

    const { error } = await supabase.from('matches').update({ sorare_game_id: gameId }).eq('id', matchId)
    if (error) console.error(`[error] backfilling sorare_game_id for match ${matchId}: ${error.message}`)
    matchIdBySorareId.set(gameId, matchId)
    return matchId
  }

  console.log(`Polling ${playerIds.size} starter(s) for GW${gameweek.number}...`)

  let statsUpdated = 0
  let scoresUpdated = 0
  let noMapping = 0
  let noSerieAGame = 0
  let noSyncedMatch = 0
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

      const matchId = await findSyncedMatch(entry)
      if (!matchId) {
        console.warn(
          `[no synced match] ${roleByPlayerId.get(playerId)?.name ?? slug} — ${entry.anyGame.homeTeam?.name} vs ${entry.anyGame.awayTeam?.name} isn't in this gameweek's synced fixtures (run sync-gameweek-fixtures.js, or check players.team)`
        )
        noSyncedMatch += 1
        await sleep(SORARE_REQUEST_DELAY_MS)
        continue
      }

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
        const isReverse = reverseByCategoryId.get(categoryIdByPlayerId.get(playerId)) ?? false
        const score = calculateScore(statsRow, role, slotRole, isReverse)
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
    `Done. Stats updated: ${statsUpdated}. Scores updated: ${scoresUpdated}. No mapping: ${noMapping}. No Serie A game found: ${noSerieAGame}. No synced match: ${noSyncedMatch}.`
  )

  return {
    polled: true,
    gameweekNumber: gameweek.number,
    startersConsidered: playerIds.size,
    statsUpdated,
    scoresUpdated,
    noMapping,
    noSerieAGame,
    noSyncedMatch,
  }
}

async function main() {
  return pollSorareLive(getSupabaseAdmin())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('poll-sorare-live failed:', err.message || err)
    process.exit(1)
  })
}
