// Automatically advances gameweeks.status (upcoming -> live -> completed)
// and keeps upcoming gameweeks' starts_at/deadline in sync with the real
// Serie A calendar (serie_a_fixtures, refreshed nightly by
// update-serie-a-data.js) — see AUDIT_REPORT.md §9.1: without this,
// nothing ever moves gameweeks forward, so the "current" gameweek for
// lineup-setting purposes can get stuck indefinitely on one whose deadline
// has long passed, while the countdown (NextMatchCountdown.jsx) shows a
// stale/wrong time.
//
// Two responsibilities, run in this order every time:
//
// 1. Date sync (upcoming gameweeks only): starts_at is set to the
//    earliest serie_a_fixtures.match_date for that gameweek's number,
//    deadline to starts_at minus 15 minutes (same convention as the
//    original seed in 20260730000000_lineups.sql). Never touches 'live'
//    or 'completed' gameweeks — one already in progress or finished keeps
//    whatever deadline it was actually judged against.
//
// 2. Status advancement, walking gameweeks in ascending number order,
//    skipping any already 'completed':
//      upcoming -> live   : as soon as any of that gameweek's fixtures
//                            has status 'live'/'finished', or its
//                            match_date has passed. Stops here — at most
//                            one gameweek is ever 'live' at a time.
//      live -> completed  : only once EVERY fixture for that gameweek is
//                            'finished'. Otherwise stays 'live' and stops
//                            (later gameweeks aren't evaluated this run).
//    If a gameweek goes straight from upcoming to fully-finished within a
//    single run (the job missed a few days), it's marked 'completed'
//    directly and the loop keeps going — the next gameweek might need to
//    advance too in the same run.
//
// Postponements: a postponed fixture just stays 'scheduled' in
// serie_a_fixtures until it's replayed (football-data.org's TIMED/
// POSTPONED/SUSPENDED/CANCELLED/AWARDED statuses all collapse to
// 'scheduled' — see footballDataClient.js's mapMatchStatus). The
// "completed only once every fixture is finished" rule handles this by
// construction: an affected gameweek simply stays 'live' longer, no
// special-casing needed.
//
// Known limitation: a match awarded/forfeited (AWARDED/CANCELLED) never
// becomes 'finished' in our data, so a gameweek with one would never
// auto-complete — needs a manual status override via the SQL Editor. To
// make that rare case visible instead of silently stuck, any gameweek
// still 'live' more than LIVE_STALL_WARNING_DAYS after its starts_at logs
// a GitHub Actions warning annotation (shows up in the workflow run UI,
// not just buried in the log text).
//
// Deliberately does NOT trigger scoring/consolidation/rewards — advancing
// status here only makes a gameweek reachable as "current"; running
// calculate-gameweek.js against it stays a deliberate admin action (the
// "Calcola giornata" button, or the CLI script).
//
// Usage: node scripts/advance-gameweeks.js

import { pathToFileURL } from 'node:url'
import { getSupabaseAdmin } from './lib/env.js'

const DEADLINE_OFFSET_MINUTES = 15
const LIVE_STALL_WARNING_DAYS = 5

async function syncUpcomingDates(supabase) {
  const { data: upcoming, error } = await supabase.from('gameweeks').select('*').eq('status', 'upcoming')
  if (error) throw error

  let updated = 0
  for (const gw of upcoming ?? []) {
    const { data: fixtures, error: fixturesError } = await supabase
      .from('serie_a_fixtures')
      .select('match_date')
      .eq('gameweek', gw.number)
      .not('match_date', 'is', null)
      .order('match_date', { ascending: true })
      .limit(1)
    if (fixturesError) throw fixturesError
    if (!fixtures || fixtures.length === 0) continue

    const startsAt = fixtures[0].match_date
    if (startsAt === gw.starts_at) continue

    const deadline = new Date(new Date(startsAt).getTime() - DEADLINE_OFFSET_MINUTES * 60000).toISOString()
    const { error: updateError } = await supabase.from('gameweeks').update({ starts_at: startsAt, deadline }).eq('id', gw.id)
    if (updateError) throw updateError
    updated += 1
    console.log(`  synced dates for gameweek ${gw.number}: starts_at=${startsAt}`)
  }
  return updated
}

async function fixturesFor(supabase, gwNumber) {
  const { data, error } = await supabase.from('serie_a_fixtures').select('status, match_date').eq('gameweek', gwNumber)
  if (error) throw error
  return data ?? []
}

async function setStatus(supabase, gw, status) {
  const { error } = await supabase.from('gameweeks').update({ status }).eq('id', gw.id)
  if (error) throw error
  console.log(`  gameweek ${gw.number}: ${gw.status} -> ${status}`)
}

export async function advanceGameweeks(supabase) {
  console.log('Syncing upcoming gameweeks dates from serie_a_fixtures...')
  const datesSynced = await syncUpcomingDates(supabase)
  console.log(`  ${datesSynced} gameweek(s) date-synced.`)

  const { data: gameweeks, error } = await supabase
    .from('gameweeks')
    .select('*')
    .neq('status', 'completed')
    .order('number', { ascending: true })
  if (error) throw error

  const transitions = []
  const now = Date.now()

  for (const gw of gameweeks ?? []) {
    const fixtures = await fixturesFor(supabase, gw.number)
    if (fixtures.length === 0) {
      console.log(`  gameweek ${gw.number}: no serie_a_fixtures rows yet, stopping here.`)
      break
    }

    const allFinished = fixtures.every((f) => f.status === 'finished')
    const anyStarted = fixtures.some(
      (f) => f.status === 'live' || f.status === 'finished' || (f.match_date && new Date(f.match_date).getTime() <= now)
    )

    if (gw.status === 'upcoming') {
      if (allFinished) {
        await setStatus(supabase, gw, 'completed')
        transitions.push(`${gw.number}: upcoming->completed`)
        continue // a later gameweek might need to advance too in this run
      }
      if (anyStarted) {
        await setStatus(supabase, gw, 'live')
        transitions.push(`${gw.number}: upcoming->live`)
      }
      break // at most one gameweek goes live/stays pending per run
    }

    if (gw.status === 'live') {
      if (allFinished) {
        await setStatus(supabase, gw, 'completed')
        transitions.push(`${gw.number}: live->completed`)
        continue
      }

      if (gw.starts_at) {
        const daysLive = (now - new Date(gw.starts_at).getTime()) / (24 * 60 * 60 * 1000)
        if (daysLive > LIVE_STALL_WARNING_DAYS) {
          console.log(
            `::warning::Gameweek ${gw.number} has been 'live' for ${daysLive.toFixed(1)} days without every fixture finishing — check for a forfeited/cancelled match (AWARDED/CANCELLED collapse to 'scheduled' in our data and never auto-complete) and consider a manual status override via the SQL Editor.`
          )
        }
      }
      break // still genuinely in progress, don't evaluate later gameweeks
    }
  }

  console.log(transitions.length > 0 ? `Transitions: ${transitions.join(', ')}` : 'No status transitions.')
  return { datesSynced, transitions }
}

async function main() {
  return advanceGameweeks(getSupabaseAdmin())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('advance-gameweeks failed:', err.message || err)
    process.exit(1)
  })
}
