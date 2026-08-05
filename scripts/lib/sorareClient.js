// Minimal Sorare GraphQL client: plain fetch, no Apollo. Shared by the
// mapping/fetch-games/poll scripts so rate limiting and auth stay consistent.

export { normalizeTeamName, teamNamesMatch } from '../../src/lib/teamNames.js'

const SORARE_API_URL = 'https://api.sorare.com/graphql'

// Sorare rate-limits aggressively; stay well under 1 req/s.
export const SORARE_REQUEST_DELAY_MS = 1500

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sorareQuery(query, variables) {
  const headers = { 'Content-Type': 'application/json' }
  // Public search/read queries generally work unauthenticated. Sorare API
  // keys go in a plain `APIKEY` header, NOT `Authorization: Bearer` — that
  // was tried and Sorare rejects it outright ("Unauthorized: Not enough or
  // too many segments", a JWT-parsing error), which broke every call
  // (even otherwise-public ones) as soon as a key was set. An API key does
  // raise the query complexity budget (500 -> 30000) but does not improve
  // searchPlayers' own match relevance — confirmed by testing known-missing
  // players (e.g. "Bremer") both with and without the key.
  if (process.env.SORARE_API_KEY) {
    headers.APIKEY = process.env.SORARE_API_KEY
  }

  const res = await fetch(SORARE_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    throw new Error(`Sorare API HTTP ${res.status}: ${await res.text()}`)
  }

  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(`Sorare API error: ${json.errors.map((e) => e.message).join('; ')}`)
  }
  return json.data
}

// Game ids returned inside connections (e.g. club.games.nodes.id,
// anyGameStats.anyGame.id) come back prefixed ("Game:<uuid>"), but
// football.game(id:) expects the bare uuid and 404s on the prefixed form.
export function bareGameId(id) {
  return id.replace(/^Game:/, '')
}

// Shared by poll-sorare.js and poll-sorare-live.js: maps a Sorare
// PlayerGameStats object (any shape carrying these field names) onto
// player_match_stats columns. Sorare returns null for actions that didn't
// happen; player_match_stats stores 0/false instead.
export function statsRowFromSorare(stat, playerId, matchId) {
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

export function mapMatchStatus(sorareStatusTyped) {
  return sorareStatusTyped === 'played' ? 'finished' : 'live'
}
