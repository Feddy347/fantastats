// Populates players.birth_year and players.nationality from Sorare.
//
// IMPORTANT: the brief didn't specify Sorare's exact field names for date of
// birth / nationality, and I have no way to verify Sorare's live schema from
// here. This extends the SAME search query already confirmed working in
// scripts/map-sorare-players.js (Phase 6) with two additional fields —
// dateOfBirth and country { code, name } — that are reasonable guesses, not
// confirmed. If Sorare rejects the query, the GraphQL error will name the
// bad field; adjust SEARCH_PLAYER_DETAILS_QUERY accordingly and re-run.
//
// Usage: npm run enrich:players

import { getSupabaseAdmin } from './lib/env.js'
import { sorareQuery, sleep, teamNamesMatch, SORARE_REQUEST_DELAY_MS } from './lib/sorareClient.js'

const SEARCH_PLAYER_DETAILS_QUERY = `
query SearchPlayerDetails($name: String!) {
  football {
    players(search: $name, first: 5) {
      nodes {
        slug
        displayName
        dateOfBirth
        country {
          code
          name
        }
        activeClub {
          name
          domesticLeague {
            slug
          }
        }
      }
    }
  }
}
`

function pickCandidate(nodes, player, knownSlug) {
  if (knownSlug) {
    const bySlug = (nodes ?? []).find((n) => n.slug === knownSlug)
    if (bySlug) return bySlug
  }

  const candidates = (nodes ?? []).filter(
    (n) => n.activeClub?.domesticLeague?.slug === 'serie-a' && teamNamesMatch(n.activeClub?.name, player.team)
  )
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  const target = player.name.toLowerCase()
  candidates.sort((a, b) => {
    const aExact = a.displayName?.toLowerCase() === target ? 0 : 1
    const bExact = b.displayName?.toLowerCase() === target ? 0 : 1
    return aExact - bExact
  })
  return candidates[0]
}

function birthYearFrom(dateOfBirth) {
  if (!dateOfBirth) return null
  const year = new Date(dateOfBirth).getFullYear()
  return Number.isFinite(year) ? year : null
}

async function main() {
  const supabase = getSupabaseAdmin()

  const [{ data: players, error }, { data: mappings }] = await Promise.all([
    supabase.from('players').select('id, name, team, birth_year, nationality').order('name'),
    supabase.from('sorare_player_mapping').select('player_id, sorare_slug'),
  ])
  if (error) throw error

  const slugByPlayerId = new Map((mappings ?? []).map((m) => [m.player_id, m.sorare_slug]))

  console.log(`Enriching ${players.length} players...`)

  let updated = 0
  let unmatched = 0
  let skipped = 0

  for (const player of players) {
    if (player.birth_year != null && player.nationality != null) {
      skipped += 1
      continue
    }

    try {
      const data = await sorareQuery(SEARCH_PLAYER_DETAILS_QUERY, { name: player.name })
      const nodes = data?.football?.players?.nodes ?? []
      const best = pickCandidate(nodes, player, slugByPlayerId.get(player.id))

      if (!best) {
        console.warn(`[unmatched] ${player.name} (${player.team})`)
        unmatched += 1
      } else {
        const { error: updateError } = await supabase
          .from('players')
          .update({
            birth_year: birthYearFrom(best.dateOfBirth),
            nationality: best.country?.code ?? null,
          })
          .eq('id', player.id)
        if (updateError) throw updateError
        updated += 1
      }
    } catch (err) {
      console.error(`[error] ${player.name}: ${err.message || err}`)
      unmatched += 1
    }

    await sleep(SORARE_REQUEST_DELAY_MS)
  }

  console.log(`Done. Updated ${updated}, unmatched ${unmatched}, already had data ${skipped}.`)
}

main().catch((err) => {
  console.error('enrich-players failed:', err.message || err)
  process.exit(1)
})
