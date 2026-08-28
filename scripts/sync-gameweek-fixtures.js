// Syncs `matches` for one internal gameweek from `serie_a_fixtures` — the
// authoritative real Serie A calendar `update-serie-a-data.js` refreshes
// nightly from football-data.org — so `matches` always reflects one
// coherent, complete real matchday (every team appears exactly once)
// instead of the ad-hoc, per-player rows poll-sorare-live.js used to
// create on the fly (see AUDIT_REPORT.md §4.2: that produced a "GW1" match
// list where 5 teams each appeared twice, because two different fielded
// players' own most-recent-game data pointed at two different real
// gameweeks).
//
// `gameweeks.number` is assumed to line up 1:1 with `serie_a_fixtures.gameweek`
// (both track real Serie A matchday numbers 1-38 — see
// supabase/migrations/20260730000000_lineups.sql's seed and
// update-serie-a-data.js's header comment).
//
// Must run BEFORE fetch-sorare-games.js (which fills in sorare_game_id for
// matches rows that don't have one yet) and poll-sorare-live.js (which no
// longer creates matches itself — it only enriches whatever's already
// synced here, and skips players whose game doesn't match a synced
// fixture instead of fabricating one).
//
// Usage: node scripts/sync-gameweek-fixtures.js <gameweekNumber>

import { pathToFileURL } from 'node:url'
import { getSupabaseAdmin } from './lib/env.js'

// serie_a_fixtures.status only allows 'scheduled' | 'live' | 'finished'
// (supabase/migrations/20260902000000_serie_a_and_stats.sql); matches.status
// only allows 'upcoming' | 'live' | 'finished'
// (supabase/migrations/20260730000000_lineups.sql, via fetch-sorare-games.js's
// mapMatchStatus for the Sorare-status case) — same three states, just
// 'scheduled' vs 'upcoming' naming.
const STATUS_MAP = { scheduled: 'upcoming', live: 'live', finished: 'finished' }

export async function syncGameweekFixtures(supabase, gameweekNumber) {
  const { data: gameweek, error: gwError } = await supabase
    .from('gameweeks')
    .select('*')
    .eq('number', gameweekNumber)
    .maybeSingle()
  if (gwError) throw gwError
  if (!gameweek) throw new Error(`No gameweek with number ${gameweekNumber}`)

  const { data: fixtures, error: fixturesError } = await supabase
    .from('serie_a_fixtures')
    .select('*')
    .eq('gameweek', gameweekNumber)
  if (fixturesError) throw fixturesError

  if (fixtures.length === 0) {
    console.log(
      `No serie_a_fixtures rows for gameweek ${gameweekNumber} yet — run update-serie-a-data.js first (it needs to have seen this matchday from football-data.org).`
    )
    return { synced: 0, gameweekNumber }
  }

  const rows = fixtures.map((f) => ({
    gameweek_id: gameweek.id,
    home_team: f.home_team,
    away_team: f.away_team,
    home_score: f.home_score,
    away_score: f.away_score,
    status: STATUS_MAP[f.status] ?? 'upcoming',
    starts_at: f.match_date,
  }))

  const { error: upsertError } = await supabase
    .from('matches')
    .upsert(rows, { onConflict: 'gameweek_id,home_team,away_team' })
  if (upsertError) throw upsertError

  console.log(`Synced ${rows.length} match(es) for gameweek ${gameweekNumber} from serie_a_fixtures.`)
  return { synced: rows.length, gameweekNumber }
}

async function main() {
  const gameweekNumber = Number(process.argv[2])
  if (!Number.isInteger(gameweekNumber) || gameweekNumber < 1) {
    console.error('Usage: node scripts/sync-gameweek-fixtures.js <gameweekNumber>')
    process.exit(1)
  }
  return syncGameweekFixtures(getSupabaseAdmin(), gameweekNumber)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('sync-gameweek-fixtures failed:', err.message || err)
    process.exit(1)
  })
}
