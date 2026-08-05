// Finds the Sorare game id for each of our Serie A matches that doesn't have
// one yet, by querying Sorare's games for the gameweek's date window and
// matching on home/away team names.
//
// Sorare's football root has no league-wide "games in a date range" query —
// `football { games(...) }` doesn't exist (confirmed live: Sorare suggests
// `game`, singular, i.e. lookup by id). Games are only queryable per club via
// `club(slug).games(startDate, endDate)`, so club slugs are fetched once via
// `competition(slug: "serie-a-it").clubs` and matched to our team names with
// teamNamesMatch (Sorare's club names don't match ours exactly, e.g.
// "SSC Napoli" vs "Napoli"). Confirmed live against Sorare's API by using the
// first-party GraphQL Playground at api.sorare.com/graphql/playground, which
// (unlike the public API) allows schema introspection.
//
// Also: club.games.nodes.id comes back prefixed ("Game:<uuid>"), but
// football.game(id:) expects the bare uuid and 404s on the prefixed form —
// so the prefix is stripped before it's saved as sorare_game_id.
//
// Usage: npm run fetch:sorare-games

import { getSupabaseAdmin } from './lib/env.js'
import { sorareQuery, sleep, teamNamesMatch, bareGameId, SORARE_REQUEST_DELAY_MS } from './lib/sorareClient.js'

const SERIE_A_SLUG = 'serie-a-it'

const SERIE_A_CLUBS_QUERY = `
query SerieAClubs($slug: String!) {
  football {
    competition(slug: $slug) {
      clubs {
        nodes {
          slug
          name
        }
      }
    }
  }
}
`

const CLUB_GAMES_QUERY = `
query ClubGames($slug: String!, $from: ISO8601DateTime!, $to: ISO8601DateTime!) {
  football {
    club(slug: $slug) {
      games(startDate: $from, endDate: $to, first: 20) {
        nodes {
          id
          statusTyped
          homeTeam { name }
          awayTeam { name }
          homeScore
          awayScore
        }
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

  const clubsData = await sorareQuery(SERIE_A_CLUBS_QUERY, { slug: SERIE_A_SLUG })
  const clubs = clubsData?.football?.competition?.clubs?.nodes ?? []
  await sleep(SORARE_REQUEST_DELAY_MS)

  const clubSlugFor = (teamName) => clubs.find((c) => teamNamesMatch(c.name, teamName))?.slug ?? null

  console.log(`Looking up Sorare games for ${matches.length} match(es), one club query each.`)

  let updated = 0
  let unmatched = 0

  for (const match of matches) {
    const { from, to } = dateWindowFor(match.gameweeks?.starts_at)
    const homeSlug = clubSlugFor(match.home_team)

    if (!homeSlug) {
      console.warn(`[no club slug] ${match.home_team}`)
      unmatched += 1
      continue
    }

    let nodes
    try {
      const data = await sorareQuery(CLUB_GAMES_QUERY, { slug: homeSlug, from, to })
      nodes = data?.football?.club?.games?.nodes ?? []
    } catch (err) {
      console.error(`[error] ${match.home_team}: ${err.message || err}`)
      await sleep(SORARE_REQUEST_DELAY_MS)
      continue
    }

    const node = nodes.find((n) => teamNamesMatch(n.awayTeam?.name, match.away_team))

    if (!node) {
      console.warn(`[unmatched] ${match.home_team} vs ${match.away_team}`)
      unmatched += 1
    } else {
      const gameId = bareGameId(node.id)
      const { error: updateError } = await supabase.from('matches').update({ sorare_game_id: gameId }).eq('id', match.id)

      if (updateError) {
        console.error(`[error] updating match ${match.id}: ${updateError.message}`)
      } else {
        console.log(`[matched] ${match.home_team} vs ${match.away_team} -> ${gameId}`)
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
