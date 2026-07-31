// Populates players.birth_year and players.nationality from Sorare, and
// backfills sorare_player_mapping for any player matched here that doesn't
// already have one.
//
// Uses Sorare's root-level searchPlayers query (NOT football { players }),
// which is what previously made this fail — that field doesn't exist in
// Sorare's schema:
//
//   query SearchPlayer($query: String!) {
//     searchPlayers(query: $query, pageSize: 5) {
//       hits { slug displayName birthDate age country { code threeLetterCode name } activeClub { name domesticLeague { slug } } position }
//     }
//   }
//
// birth_year comes from birthDate's year; nationality is the three-letter
// ISO code (country.threeLetterCode, e.g. "ITA") — the pool filters match on
// this three-letter form, not the two-letter country.code.
//
// Usage: node scripts/enrich-players.js

import { getSupabaseAdmin } from './lib/env.js'
import { sorareQuery, sleep, teamNamesMatch } from './lib/sorareClient.js'

// B8 asks for 1 request every 2 seconds specifically for this script.
const REQUEST_DELAY_MS = 2000

const SEARCH_PLAYER_QUERY = `
query SearchPlayer($query: String!) {
  searchPlayers(query: $query, pageSize: 5) {
    hits {
      slug
      displayName
      birthDate
      age
      country {
        code
        threeLetterCode
        name
      }
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

function pickCandidate(hits, player, knownSlug) {
  if (knownSlug) {
    const bySlug = (hits ?? []).find((h) => h.slug === knownSlug)
    if (bySlug) return bySlug
  }

  const candidates = (hits ?? []).filter(
    (h) => h.activeClub?.domesticLeague?.slug === 'serie-a' && teamNamesMatch(h.activeClub?.name, player.team)
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

function birthYearFrom(birthDate) {
  if (!birthDate) return null
  const year = new Date(birthDate).getFullYear()
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

  console.log(`Enriching ${players.length} players (this will take a while — ~2s per lookup)...`)

  let updated = 0
  let unmatched = 0
  let skipped = 0
  let mapped = 0

  for (const player of players) {
    if (player.birth_year != null && player.nationality != null) {
      skipped += 1
      continue
    }

    try {
      const data = await sorareQuery(SEARCH_PLAYER_QUERY, { query: player.name })
      const hits = data?.searchPlayers?.hits ?? []
      const best = pickCandidate(hits, player, slugByPlayerId.get(player.id))

      if (!best) {
        console.warn(`[unmatched] ${player.name} (${player.team})`)
        unmatched += 1
      } else {
        const { error: updateError } = await supabase
          .from('players')
          .update({
            birth_year: birthYearFrom(best.birthDate),
            nationality: best.country?.threeLetterCode ?? null,
          })
          .eq('id', player.id)
        if (updateError) throw updateError
        updated += 1

        if (!slugByPlayerId.has(player.id)) {
          const { error: mappingError } = await supabase
            .from('sorare_player_mapping')
            .insert({ player_id: player.id, sorare_slug: best.slug, sorare_display_name: best.displayName })
          if (mappingError) {
            console.error(`[mapping error] ${player.name}: ${mappingError.message}`)
          } else {
            slugByPlayerId.set(player.id, best.slug)
            mapped += 1
          }
        }
      }
    } catch (err) {
      console.error(`[error] ${player.name}: ${err.message || err}`)
      unmatched += 1
    }

    await sleep(REQUEST_DELAY_MS)
  }

  console.log(
    `Done. Updated ${updated} (${mapped} new mappings), unmatched ${unmatched}, already had data ${skipped}.`
  )
}

main().catch((err) => {
  console.error('enrich-players failed:', err.message || err)
  process.exit(1)
})
