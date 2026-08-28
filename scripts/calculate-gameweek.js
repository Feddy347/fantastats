// CLI equivalent of api/calculate-gameweek.js (the admin "Calcola
// giornata" button), for running the pipeline locally when the Vercel
// Function times out — Sorare polling is rate-limited to one request per
// SORARE_REQUEST_DELAY_MS (~1.5s) per starter, which for a full slate of
// fielded players easily exceeds a serverless function's max duration.
// No such limit running locally.
//
// Runs the same 4 steps, in order, against an explicit gameweek number
// (rather than "whichever gameweek is currently live", which is what the
// button and the underlying scripts default to when run standalone):
//   1. sync-gameweek-fixtures.js -> matches reflects one coherent real
//                                    matchday from serie_a_fixtures
//   2. poll-sorare-live.js       -> real player stats + category scores
//   3. consolidate-gameweek.js   -> category standings/rewards, marks
//                                    the gameweek completed
//   4. consolidate-league-gameweek.js -> league standings/matchups
//
// All four are idempotent to re-running on the same gameweek: matches/
// standings/scores upsert by their natural composite key, and rewards are
// only ever adjusted by the delta needed to reach the correct amount (see
// consolidate-gameweek.js) — so re-running after a partial/timed-out
// attempt is safe and won't double-grant credits or players.
//
// Usage: node scripts/calculate-gameweek.js <gameweekNumber>
//   e.g. node scripts/calculate-gameweek.js 1

import { getSupabaseAdmin } from './lib/env.js'
import { syncGameweekFixtures } from './sync-gameweek-fixtures.js'
import { pollSorareLive } from './poll-sorare-live.js'
import { consolidateGameweek } from './consolidate-gameweek.js'
import { consolidateLeagueGameweek } from './consolidate-league-gameweek.js'

const gameweekNumber = Number(process.argv[2])

if (!Number.isInteger(gameweekNumber) || gameweekNumber < 1) {
  console.error('Usage: node scripts/calculate-gameweek.js <gameweekNumber>')
  process.exit(1)
}

async function main() {
  const supabase = getSupabaseAdmin()

  console.log(`=== Calcolo giornata ${gameweekNumber} ===`)

  console.log('\n--- 1/4 Sync fixture Serie A ---')
  const sync = await syncGameweekFixtures(supabase, gameweekNumber)
  console.log('Sync result:', sync)

  console.log('\n--- 2/4 Poll Sorare (stats + punteggi categorie) ---')
  const poll = await pollSorareLive(supabase, { gameweekNumber })
  console.log('Poll result:', poll)

  console.log('\n--- 3/4 Consolidamento categorie ---')
  const categories = await consolidateGameweek(supabase, { gameweekNumber })
  console.log('Categories result:', categories)

  console.log('\n--- 4/4 Consolidamento leghe ---')
  const leagues = await consolidateLeagueGameweek(supabase, { gameweekNumber })
  console.log('Leagues result:', leagues)

  console.log(`\n=== Giornata ${gameweekNumber} calcolata ===`)
}

main().catch((err) => {
  console.error('calculate-gameweek failed:', err.message || err)
  process.exit(1)
})
