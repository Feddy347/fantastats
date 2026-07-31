// Maps our players to their Sorare slug by searching Sorare for each player
// by name, then filtering candidates to Serie A + a matching club.
// Unmatched players are logged so they can be mapped by hand later.
//
// Usage: npm run map:sorare-players

import { getSupabaseAdmin } from './lib/env.js'
import { sorareQuery, sleep, teamNamesMatch, SORARE_REQUEST_DELAY_MS } from './lib/sorareClient.js'

const SEARCH_PLAYER_QUERY = `
query SearchPlayer($query: String!) {
  searchPlayers(query: $query, pageSize: 5) {
    hits {
      slug
      displayName
      activeClub {
        name
        domesticLeague {
          slug
        }
      }
      position
    }
  }
}
`

function pickBestMatch(hits, player) {
  const candidates = (hits ?? []).filter(
    (h) => h.activeClub?.domesticLeague?.slug === 'serie-a' && teamNamesMatch(h.activeClub?.name, player.team)
  )
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // Multiple team-matched candidates: prefer the closest display name.
  const target = player.name.toLowerCase()
  candidates.sort((a, b) => {
    const aExact = a.displayName?.toLowerCase() === target ? 0 : 1
    const bExact = b.displayName?.toLowerCase() === target ? 0 : 1
    return aExact - bExact
  })
  return candidates[0]
}

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: players, error } = await supabase.from('players').select('id, name, team').order('name')
  if (error) throw error

  console.log(`Mapping ${players.length} players against Sorare...`)

  let matched = 0
  let unmatched = 0

  for (const player of players) {
    try {
      const data = await sorareQuery(SEARCH_PLAYER_QUERY, { query: player.name })
      const hits = data?.searchPlayers?.hits ?? []
      const best = pickBestMatch(hits, player)

      if (!best) {
        console.warn(`[unmatched] ${player.name} (${player.team})`)
        unmatched += 1
      } else {
        const { error: upsertError } = await supabase.from('sorare_player_mapping').upsert(
          {
            player_id: player.id,
            sorare_slug: best.slug,
            sorare_display_name: best.displayName,
            matched_at: new Date().toISOString(),
          },
          { onConflict: 'player_id' }
        )
        if (upsertError) throw upsertError
        matched += 1
      }
    } catch (err) {
      console.error(`[error] ${player.name}: ${err.message || err}`)
      unmatched += 1
    }

    await sleep(SORARE_REQUEST_DELAY_MS)
  }

  console.log(`Done. Matched ${matched}, unmatched ${unmatched}.`)
}

main().catch((err) => {
  console.error('map-sorare-players failed:', err.message || err)
  process.exit(1)
})
