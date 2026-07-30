// Finds the Sorare game id for each of our Serie A matches that doesn't have
// one yet, by querying Sorare's games for the gameweek's date window and
// matching on home/away team names.
//
// Usage: npm run fetch:sorare-games

import { getSupabaseAdmin } from './lib/env.js'
import { sorareQuery, sleep, teamNamesMatch, SORARE_REQUEST_DELAY_MS } from './lib/sorareClient.js'

const SERIE_A_GAMES_QUERY = `
query SerieAGames($from: ISO8601DateTime!, $to: ISO8601DateTime!) {
  football {
    games(leagueSlug: "serie-a", startDate: $from, endDate: $to, first: 20) {
      nodes {
        id
        startDate
        status
        homeTeam { name }
        awayTeam { name }
        homeScore
        awayScore
      }
    }
  }
}
`

const DAY_MS = 24 * 60 * 60 * 1000

function dateWindowFor(startsAt) {
  const center = startsAt ? new Date(startsAt) : new Date()
  return {
    from: new Date(center.getTime() - DAY_MS).toISOString(),
    to: new Date(center.getTime() + 4 * DAY_MS).toISOString(),
  }
}

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: matches, error } = await supabase
    .from('matches')
    .select('*, gameweeks(starts_at)')
    .is('sorare_game_id', null)

  if (error) throw error

  if (matches.length === 0) {
    console.log('No matches are missing a sorare_game_id.')
    return
  }

  const byGameweek = new Map()
  matches.forEach((m) => {
    if (!byGameweek.has(m.gameweek_id)) byGameweek.set(m.gameweek_id, [])
    byGameweek.get(m.gameweek_id).push(m)
  })

  console.log(`Looking up Sorare games for ${byGameweek.size} gameweek(s), ${matches.length} match(es) total.`)

  let updated = 0
  let unmatched = 0

  for (const [gameweekId, gwMatches] of byGameweek) {
    const { from, to } = dateWindowFor(gwMatches[0].gameweeks?.starts_at)

    let nodes
    try {
      const data = await sorareQuery(SERIE_A_GAMES_QUERY, { from, to })
      nodes = data?.football?.games?.nodes ?? []
    } catch (err) {
      console.error(`[error] gameweek ${gameweekId}: ${err.message || err}`)
      await sleep(SORARE_REQUEST_DELAY_MS)
      continue
    }

    for (const match of gwMatches) {
      const node = nodes.find(
        (n) => teamNamesMatch(n.homeTeam?.name, match.home_team) && teamNamesMatch(n.awayTeam?.name, match.away_team)
      )

      if (!node) {
        console.warn(`[unmatched] GW${gameweekId}: ${match.home_team} vs ${match.away_team}`)
        unmatched += 1
        continue
      }

      const { error: updateError } = await supabase
        .from('matches')
        .update({ sorare_game_id: node.id })
        .eq('id', match.id)

      if (updateError) {
        console.error(`[error] updating match ${match.id}: ${updateError.message}`)
      } else {
        console.log(`[matched] ${match.home_team} vs ${match.away_team} -> ${node.id}`)
        updated += 1
      }
    }

    await sleep(SORARE_REQUEST_DELAY_MS)
  }

  console.log(`Done. Updated ${updated}, unmatched ${unmatched}.`)
}

main().catch((err) => {
  console.error('fetch-sorare-games failed:', err.message || err)
  process.exit(1)
})
