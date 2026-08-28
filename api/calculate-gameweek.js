// Vercel serverless function backing the admin-only "Calcola giornata"
// button (src/components/Drawer.jsx). Runs server-side with the service
// role key — this can never be called from the client directly, since that
// key must never reach the browser.
//
// Runs the same 4-step pipeline the CLI scripts already implement, in
// process (not as child processes: a Vercel function's filesystem only
// contains this file's own import graph, not the whole scripts/ folder):
//   1. sync-gameweek-fixtures.js -> matches reflects one coherent real
//      matchday from serie_a_fixtures
//   2. poll-sorare-live.js  -> fetch real player stats, write
//      player_match_stats + player_match_scores for category starters
//   3. consolidate-gameweek.js -> per-category final scores (with auto
//      substitutions), standings, rewards; marks the gameweek completed
//   4. consolidate-league-gameweek.js -> per-league final scores (with
//      auto substitutions), matchups/standings
//
// The target gameweek (live, or the most recently completed one if none
// is live) is resolved once up front and its number passed explicitly to
// every step, rather than each step independently re-resolving "current" —
// so all four always agree on the same gameweek even if its status
// changes mid-run.
//
// Authorization: verifies the caller's Supabase session resolves to the
// single admin user id — the Drawer button is also UI-hidden for everyone
// else, but the endpoint itself must not trust that.

import { getSupabaseAdmin } from '../scripts/lib/env.js'
import { syncGameweekFixtures } from '../scripts/sync-gameweek-fixtures.js'
import { pollSorareLive } from '../scripts/poll-sorare-live.js'
import { consolidateGameweek } from '../scripts/consolidate-gameweek.js'
import { consolidateLeagueGameweek } from '../scripts/consolidate-league-gameweek.js'

async function findTargetGameweekNumber(supabase) {
  const { data: live } = await supabase
    .from('gameweeks')
    .select('number')
    .eq('status', 'live')
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (live) return live.number

  const { data: completed } = await supabase
    .from('gameweeks')
    .select('number')
    .eq('status', 'completed')
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return completed?.number ?? null
}

const ADMIN_USER_ID = '77e2ac11-32cc-44d2-8d1f-2b78bb11ec69'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' })
    return
  }

  const supabase = getSupabaseAdmin()

  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user || userData.user.id !== ADMIN_USER_ID) {
    res.status(403).json({ error: 'Not authorized' })
    return
  }

  try {
    const gameweekNumber = await findTargetGameweekNumber(supabase)
    if (!gameweekNumber) {
      res.status(200).json({ ok: false, error: 'No live or completed gameweek found' })
      return
    }

    const sync = await syncGameweekFixtures(supabase, gameweekNumber)
    const poll = await pollSorareLive(supabase, { gameweekNumber })
    const categories = await consolidateGameweek(supabase, { gameweekNumber })
    const leagues = await consolidateLeagueGameweek(supabase, { gameweekNumber })

    res.status(200).json({ ok: true, sync, poll, categories, leagues })
  } catch (err) {
    console.error('calculate-gameweek failed:', err)
    res.status(500).json({ ok: false, error: err.message || String(err) })
  }
}
