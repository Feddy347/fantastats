// Proxies the "player's recent Serie A games" query to Sorare's GraphQL API.
//
// Why this exists: Sorare's API sends no Access-Control-Allow-Origin header
// (confirmed live — an OPTIONS preflight and a real POST both come back
// without one), so a browser calling api.sorare.com directly is blocked by
// CORS. curl/Node aren't subject to CORS (it's a browser-only mechanism),
// which is why every server-side script and manual test worked fine while
// the client-side player profile page silently failed. This function runs
// server-side (Deno, on Supabase), so it can call Sorare directly and hands
// the browser a same-project response with CORS enabled for our own origin.
//
// Mirrors src/lib/sorareStats.js's query/mapping (kept in sync manually —
// see that file's header comment for why anyGameStats needs the
// competition-slug filter and the GAME_LOOKBACK over-fetch).

const SORARE_API_URL = 'https://api.sorare.com/graphql'
const SERIE_A_SLUG = 'serie-a-it'
const GAME_LOOKBACK = 20

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PLAYER_RECENT_GAMES_QUERY = `
query PlayerRecentGames($slug: String!, $last: Int!) {
  anyPlayer(slug: $slug) {
    anyGameStats(last: $last) {
      anyGame {
        id
        date
        competition { slug }
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

function statsFromEntry(entry: Record<string, unknown>) {
  const num = (key: string) => (entry[key] as number | null) ?? 0
  const bool = (key: string) => Boolean(entry[key])
  return {
    mins_played: num('minsPlayed'),
    goals: num('goals'),
    att_pen_goal: num('attPenGoal'),
    goal_assist: num('goalAssist'),
    ontarget_scoring_att: num('ontargetScoringAtt'),
    big_chance_created: num('bigChanceCreated'),
    assist_penalty_won: num('assistPenaltyWon'),
    att_pen_miss: num('attPenMiss'),
    accurate_pass: num('accuratePass'),
    total_pass: num('totalPass'),
    pass_accuracy: num('passAccuracy'),
    won_tackle: num('wonTackle'),
    total_tackle: num('totalTackle'),
    interception_won: num('interceptionWon'),
    effective_clearance: num('effectiveClearance'),
    duel_won: num('duelWon'),
    clearance_off_line: num('clearanceOffLine'),
    last_man_tackle: num('lastManTackle'),
    saves: num('saves'),
    penalty_save: num('penaltySave'),
    goals_conceded: num('goalsConceded'),
    clean_sheet: bool('cleanSheet'),
    fouls: num('fouls'),
    yellow_card: num('yellowCard'),
    red_card: num('redCard'),
    own_goals: num('ownGoals'),
    error_lead_to_goal: num('errorLeadToGoal'),
    error_lead_to_shot: num('errorLeadToShot'),
    penalty_conceded: num('penaltyConceded'),
    won_contest: num('wonContest'),
    three_goals_conceded: bool('threeGoalsConceded'),
    game_started: bool('gameStarted'),
    is_live: bool('live'),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { slug, count } = await req.json()
    if (!slug || typeof slug !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing "slug"' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const apiKey = Deno.env.get('SORARE_API_KEY')
    if (apiKey) headers.APIKEY = apiKey

    const sorareRes = await fetch(SORARE_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: PLAYER_RECENT_GAMES_QUERY,
        variables: { slug, last: GAME_LOOKBACK },
      }),
    })

    if (!sorareRes.ok) {
      return new Response(JSON.stringify({ error: `Sorare API HTTP ${sorareRes.status}` }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const json = await sorareRes.json()
    if (json.errors?.length) {
      return new Response(JSON.stringify({ error: json.errors.map((e: { message: string }) => e.message).join('; ') }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const entries: Array<Record<string, unknown>> = json.data?.anyPlayer?.anyGameStats ?? []
    const games = entries
      .filter((e) => (e.anyGame as { competition?: { slug?: string } })?.competition?.slug === SERIE_A_SLUG)
      .slice(0, count ?? 5)
      .map((entry) => {
        const game = entry.anyGame as {
          id: string
          date: string
          homeTeam?: { name?: string }
          awayTeam?: { name?: string }
          homeScore: number
          awayScore: number
        }
        return {
          gameId: game.id,
          date: game.date,
          homeTeam: game.homeTeam?.name,
          awayTeam: game.awayTeam?.name,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          live: Boolean(entry.live),
          stats: statsFromEntry(entry),
        }
      })

    return new Response(JSON.stringify({ games }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
