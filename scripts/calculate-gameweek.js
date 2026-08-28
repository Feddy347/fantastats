// CLI equivalent of api/calculate-gameweek.js (the admin "Calcola
// giornata" button), for running the pipeline locally when the Vercel
// Function times out — Sorare polling is rate-limited to one request per
// SORARE_REQUEST_DELAY_MS (~1.5s) per starter, which for a full slate of
// fielded players easily exceeds a serverless function's max duration.
// No such limit running locally.
//
// Runs the same 3 steps, in order, against an explicit gameweek number
// (rather than "whichever gameweek is currently live", which is what the
// button and the underlying scripts default to when run standalone):
//   1. poll-sorare-live.js       -> real player stats + category scores
//   2. consolidate-gameweek.js   -> category standings/rewards, marks
//                                    the gameweek completed
//   3. consolidate-league-gameweek.js -> league standings/matchups
//
// All three are idempotent to re-running on the same gameweek: standings/
// scores upsert by (user,category|league,gameweek), and rewards are
// skipped entirely if that category/gameweek was already rewarded (see
// consolidate-gameweek.js) — so re-running after a partial/timed-out
// attempt is safe and won't double-grant credits or players.
//
// Usage: node scripts/calculate-gameweek.js <gameweekNumber>
//   e.g. node scripts/calculate-gameweek.js 1

import { getSupabaseAdmin } from './lib/env.js'
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

  console.log('\n--- 1/3 Poll Sorare (stats + punteggi categorie) ---')
  const poll = await pollSorareLive(supabase, { gameweekNumber })
  console.log('Poll result:', poll)

  console.log('\n--- 2/3 Consolidamento categorie ---')
  const categories = await consolidateGameweek(supabase, { gameweekNumber })
  console.log('Categories result:', categories)

  console.log('\n--- 3/3 Consolidamento leghe ---')
  const leagues = await consolidateLeagueGameweek(supabase, { gameweekNumber })
  console.log('Leagues result:', leagues)

  console.log(`\n=== Giornata ${gameweekNumber} calcolata ===`)
}

main().catch((err) => {
  console.error('calculate-gameweek failed:', err.message || err)
  process.exit(1)
})
