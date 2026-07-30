// Minimal Sorare GraphQL client: plain fetch, no Apollo. Shared by the
// mapping/fetch-games/poll scripts so rate limiting and auth stay consistent.

const SORARE_API_URL = 'https://api.sorare.com/graphql'

// Sorare rate-limits aggressively; stay well under 1 req/s.
export const SORARE_REQUEST_DELAY_MS = 1500

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sorareQuery(query, variables) {
  const headers = { 'Content-Type': 'application/json' }
  // Public search/read queries generally work unauthenticated; set
  // SORARE_API_KEY in .env if Sorare starts requiring a bearer token for you.
  if (process.env.SORARE_API_KEY) {
    headers.Authorization = `Bearer ${process.env.SORARE_API_KEY}`
  }

  const res = await fetch(SORARE_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    throw new Error(`Sorare API HTTP ${res.status}: ${await res.text()}`)
  }

  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(`Sorare API error: ${json.errors.map((e) => e.message).join('; ')}`)
  }
  return json.data
}

const CLUB_FILLER_WORDS = [
  'ac', 'as', 'us', 'ssc', 'ssd', 'fc', 'calcio', 'football club', 'club', '1907', '1913', '1909', '1919',
]

export function normalizeTeamName(name) {
  if (!name) return ''
  let n = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  CLUB_FILLER_WORDS.forEach((w) => {
    n = n.replace(new RegExp(`\\b${w}\\b`, 'g'), '')
  })
  return n.replace(/\s+/g, ' ').trim()
}

export function teamNamesMatch(a, b) {
  const na = normalizeTeamName(a)
  const nb = normalizeTeamName(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}
