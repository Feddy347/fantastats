// Fuzzy club-name matching, shared between the frontend and the Node
// scripts (scripts/lib/sorareClient.js re-exports these). Needed because
// Sorare's club names ("AS Roma", "SSC Napoli", "FC Internazionale Milano")
// never exactly match our own team names ("Roma", "Napoli", "Inter").

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
