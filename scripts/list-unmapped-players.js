// Lists every player in `players` that doesn't yet have a row in
// `sorare_player_mapping`, and writes them to a CSV so a human can look them
// up on Sorare and fill in `sorare_slug` (see import-disambiguated.js, which
// consumes that CSV back in).
//
// Pure local DB read + CSV write — no Sorare calls here, should run in well
// under a second.
//
// Usage: node scripts/list-unmapped-players.js

import fs from 'node:fs'
import path from 'node:path'
import { getSupabaseAdmin } from './lib/env.js'

const OUTPUT_PATH = 'data/unmapped_players.csv'

function csvEscape(value) {
  const str = value == null ? '' : String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCsvRow(fields) {
  return fields.map(csvEscape).join(',')
}

async function main() {
  const supabase = getSupabaseAdmin()

  const [{ data: players, error: playersError }, { data: mappings, error: mappingsError }] = await Promise.all([
    supabase.from('players').select('id, name, team, role_classic, role_mantra, role_fantastats').order('name'),
    supabase.from('sorare_player_mapping').select('player_id'),
  ])
  if (playersError) throw playersError
  if (mappingsError) throw mappingsError

  const mappedIds = new Set((mappings ?? []).map((m) => m.player_id))
  const unmapped = (players ?? []).filter((p) => !mappedIds.has(p.id))

  const dir = path.dirname(OUTPUT_PATH)
  fs.mkdirSync(dir, { recursive: true })

  const lines = [toCsvRow(['player_id', 'player_name', 'player_team', 'role_classic', 'role_mantra', 'role_fantastats'])]
  for (const p of unmapped) {
    lines.push(toCsvRow([p.id, p.name, p.team, p.role_classic, p.role_mantra, p.role_fantastats]))
  }
  fs.writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n', 'utf8')

  const total = players?.length ?? 0
  const percent = total > 0 ? ((unmapped.length / total) * 100).toFixed(1) : '0.0'
  console.log(`${unmapped.length} giocatori non mappati su ${total} totali (${percent}%)`)
  console.log(`Scritto in ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error('list-unmapped-players failed:', err.message || err)
  process.exit(1)
})
