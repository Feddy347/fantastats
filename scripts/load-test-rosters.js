// Loads test rosters from data/rosters_data.json into user_players, for
// manual/local testing of team pages, market, etc. against realistic
// squads. Re-runnable: clears any existing user_players rows for the
// involved users first, so a re-run replaces rather than duplicates
// (user_players also has a unique (user_id, player_id) constraint, which
// would otherwise reject a second insert of the same pair).
//
// Usage: node scripts/load-test-rosters.js

import fs from 'node:fs'
import { getSupabaseAdmin } from './lib/env.js'

const DATA_PATH = 'data/rosters_data.json'

async function main() {
  const supabase = getSupabaseAdmin()
  const { team_to_uid: teamToUid, rosters } = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))

  const teams = Object.keys(teamToUid)
  const userIds = teams.map((team) => teamToUid[team])

  console.log(`Clearing existing user_players for ${userIds.length} users...`)
  const { error: deleteError } = await supabase.from('user_players').delete().in('user_id', userIds)
  if (deleteError) throw deleteError

  for (const team of teams) {
    const userId = teamToUid[team]
    const roster = rosters[team] ?? []

    if (roster.length === 0) {
      console.warn(`[skip] ${team}: no roster entries`)
      continue
    }

    const rows = roster.map((p) => ({
      user_id: userId,
      player_id: p.player_id,
      purchase_price: p.cost,
      purchased_at: new Date().toISOString(),
    }))

    const { error: insertError } = await supabase.from('user_players').insert(rows)
    if (insertError) throw new Error(`${team} (${userId}): ${insertError.message}`)

    console.log(`[loaded] ${team} (${userId}): ${rows.length} players`)
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('load-test-rosters failed:', err.message || err)
  process.exit(1)
})
