// Reads back a CSV of `player_id,sorare_slug` (produced by a human filling in
// the gaps from list-unmapped-players.js's output — or any CSV with the same
// two columns) and, for every row with a non-empty slug, upserts
// sorare_player_mapping and backfills players.birth_year / players.nationality
// from Sorare.
//
// Rows with a blank sorare_slug mean "still unresolved" and are skipped.
// A slug that Sorare doesn't recognize (typo) is also skipped — and no
// mapping is written for it either, since a wrong mapping is worse than no
// mapping; the bad slug is logged so it can be fixed and the CSV re-run.
//
// Usage: node scripts/import-disambiguated.js [path/to/file.csv]
// Defaults to data/disambiguated_players.csv.

import fs from 'node:fs'
import path from 'node:path'
import { getSupabaseAdmin } from './lib/env.js'
import { sorareQuery, sleep } from './lib/sorareClient.js'

const REQUEST_DELAY_MS = 2000
const CSV_PATH = process.argv[2] ?? 'data/disambiguated_players.csv'

const PLAYER_BY_SLUG_QUERY = `
query PlayerBySlug($slug: String!) {
  anyPlayer(slug: $slug) {
    displayName
    birthDate
    country { threeLetterCode }
  }
}
`

function birthYearFrom(birthDate) {
  if (!birthDate) return null
  const year = new Date(birthDate).getFullYear()
  return Number.isFinite(year) ? year : null
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []

  const rows = []
  // Skip the header row.
  for (const line of lines.slice(1)) {
    const [playerIdRaw, sorareSlugRaw] = line.split(',')
    rows.push({
      player_id: playerIdRaw?.trim() ?? '',
      sorare_slug: sorareSlugRaw?.trim() ?? '',
    })
  }
  return rows
}

async function main() {
  const resolvedPath = path.resolve(CSV_PATH)

  if (!fs.existsSync(resolvedPath)) {
    console.error(`File non trovato: ${resolvedPath}`)
    process.exit(1)
  }

  const supabase = getSupabaseAdmin()
  const rows = parseCsv(fs.readFileSync(resolvedPath, 'utf8'))

  console.log(`Elaborazione di ${rows.length} righe da ${resolvedPath}...`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    if (!row.sorare_slug) {
      skipped += 1
      continue
    }

    try {
      const data = await sorareQuery(PLAYER_BY_SLUG_QUERY, { slug: row.sorare_slug })
      const player = data?.anyPlayer

      if (!player) {
        console.warn(`[slug non valido] player_id ${row.player_id}: slug "${row.sorare_slug}" non trovato su Sorare`)
        failed += 1
      } else {
        const { error: mappingError } = await supabase.from('sorare_player_mapping').upsert(
          {
            player_id: row.player_id,
            sorare_slug: row.sorare_slug,
            sorare_display_name: player.displayName,
            matched_at: new Date().toISOString(),
          },
          { onConflict: 'player_id' }
        )
        if (mappingError) throw mappingError

        const { error: updateError } = await supabase
          .from('players')
          .update({
            birth_year: birthYearFrom(player.birthDate),
            nationality: player.country?.threeLetterCode?.toUpperCase() ?? null,
          })
          .eq('id', row.player_id)
        if (updateError) throw updateError

        updated += 1
      }
    } catch (err) {
      console.error(`[errore] player_id ${row.player_id} (slug "${row.sorare_slug}"): ${err.message || err}`)
      failed += 1
    }

    await sleep(REQUEST_DELAY_MS)
  }

  console.log(`Fatto. Aggiornati ${updated}, saltati (slug vuoto) ${skipped}, falliti ${failed}, totale righe ${rows.length}.`)
}

main().catch((err) => {
  console.error('import-disambiguated failed:', err.message || err)
  process.exit(1)
})
