// Seeds the `teams` and `players` tables from data/fantastats_giocatori_database.xlsx.
// Requires SUPABASE_SERVICE_ROLE_KEY (bypasses RLS) and VITE_SUPABASE_URL in the environment.
//
// Usage: npm run seed:players

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import XLSX from 'xlsx'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = path.join(__dirname, '..', 'data', 'fantastats_giocatori_database.xlsx')

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Missing env vars. Make sure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set (e.g. in .env).'
  )
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

function readPlayers() {
  const fileBuffer = readFileSync(XLSX_PATH)
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { defval: null })
}

function toTeamRows(players) {
  const names = [...new Set(players.map((p) => p.Squadra).filter(Boolean))].sort()
  return names.map((name) => ({ name }))
}

function toPlayerRows(players) {
  return players.map((p) => ({
    id: p.Id,
    name: p.Nome,
    team: p.Squadra,
    role_classic: p.Ruolo_Classic,
    role_mantra: p.Ruolo_Mantra,
    role_fantastats: p.Ruolo_Fantastats,
    price_current: p.Quot_Attuale,
    price_initial: p.Quot_Iniziale,
    fanta_value: p.FantaValore,
  }))
}

async function main() {
  const players = readPlayers()
  console.log(`Read ${players.length} players from xlsx.`)

  const teamRows = toTeamRows(players)
  const { error: teamsError } = await supabase.from('teams').upsert(teamRows, { onConflict: 'name' })
  if (teamsError) throw teamsError
  console.log(`Upserted ${teamRows.length} teams.`)

  const playerRows = toPlayerRows(players)
  const { error: playersError } = await supabase.from('players').upsert(playerRows, { onConflict: 'id' })
  if (playersError) throw playersError
  console.log(`Upserted ${playerRows.length} players.`)
}

main().catch((err) => {
  console.error('Seed failed:', err.message || err)
  process.exit(1)
})
