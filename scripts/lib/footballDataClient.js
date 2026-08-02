// Minimal football-data.org v4 client: plain fetch, X-Auth-Token auth.
// Free tier is capped at 10 requests/minute; this job only makes a couple
// of calls per run so no throttling loop is needed, but 429s are still
// surfaced with a clear message rather than a raw parse error.

const FOOTBALL_DATA_API_URL = 'https://api.football-data.org/v4'

export async function footballDataGet(path) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY
  if (!apiKey) {
    throw new Error('Missing FOOTBALL_DATA_API_KEY env var (get one at football-data.org and add it to .env).')
  }

  const res = await fetch(`${FOOTBALL_DATA_API_URL}${path}`, {
    headers: { 'X-Auth-Token': apiKey },
  })

  if (res.status === 429) {
    throw new Error('football-data.org rate limit hit (10 req/min on the free tier). Try again shortly.')
  }
  if (!res.ok) {
    throw new Error(`football-data.org API HTTP ${res.status}: ${await res.text()}`)
  }

  return res.json()
}

// serie_a_fixtures.status only allows 'scheduled' | 'live' | 'finished'
// (see migration 20260902000000_serie_a_and_stats.sql); football-data.org
// has finer-grained statuses (TIMED, POSTPONED, SUSPENDED, CANCELLED,
// AWARDED, ...) that all collapse to 'scheduled' here since the frontend
// only distinguishes finished/live from "not yet played".
export function mapMatchStatus(status) {
  if (status === 'FINISHED') return 'finished'
  if (status === 'IN_PLAY' || status === 'PAUSED') return 'live'
  return 'scheduled'
}
