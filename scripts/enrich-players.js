// Populates players.birth_year and players.nationality from Sorare, and
// backfills sorare_player_mapping for any player matched here that doesn't
// already have one.
//
// The 2026/27 listone (data/fantastats_giocatori_2627.csv) uses Fantacalcio's
// abbreviated surnames ("Dia", "David", "Martinez Jo."), not full names. That
// broke the previous approach of this script, which searched Sorare's
// root-level searchPlayers(query: player.name) per player: searchPlayers is a
// global, all-sports fuzzy search with no football/league weighting, so for a
// short or common surname the real player is often nowhere in even a
// pageSize:25 result set (confirmed live: searching "David" alone never
// surfaces Juventus's Jonathan David; appending the team name to the query,
// e.g. "David Juventus", doesn't help either — Sorare mostly ignores it).
//
// Fixed by flipping the direction of the lookup: instead of searching per
// player, fetch each of the 20 Serie A clubs' CURRENT squads in one query
// each via football.club(slug).activePlayers (confirmed live: this returns
// only the active roster, ~25-40 entries including the coach, no pagination
// needed — unlike football.club(slug).players, which returns the club's
// entire multi-decade historical roster instead), then match every listone
// player against their own team's roster locally by surname. This turns 493
// noisy global searches into 20 clean per-club fetches plus offline matching.
//
// Surname matching: the listone's trailing "X." tokens (e.g. "Jo." in
// "Martinez Jo.") are Fantacalcio's way of disambiguating same-surname
// players, not part of the surname — they're stripped before matching.
// A listone name matches a Sorare squad member if the stripped surname is a
// substring of that member's lastName or displayName (accent-insensitive).
// Zero matches -> unmatched; more than one -> ambiguous (never guessed, to
// avoid silently mismapping same-surname teammates like two "Esposito"s).
//
// birth_year = 2026 - age: activePlayers exposes age but not birthDate.
// nationality is Sorare's three-letter ISO code (country.threeLetterCode),
// uppercased — Sorare returns it lowercase ("ita"), but the pool filters
// compare against "ITA" (see supabase/migrations/20260808000000_*).
//
// Usage: node scripts/enrich-players.js

import fs from 'node:fs'
import { getSupabaseAdmin } from './lib/env.js'
import { sorareQuery, sleep } from './lib/sorareClient.js'

const REQUEST_DELAY_MS = 2000
const REPORT_PATH = 'data/enrichment_report.csv'
const CURRENT_SEASON_YEAR = 2026

const CLUBS = [
  { slug: 'atalanta-ciserano', team: 'Atalanta' },
  { slug: 'bologna-bologna', team: 'Bologna' },
  { slug: 'cagliari-cagliari', team: 'Cagliari' },
  { slug: 'como-como', team: 'Como' },
  { slug: 'fiorentina-firenze', team: 'Fiorentina' },
  { slug: 'frosinone-frosinone', team: 'Frosinone' },
  { slug: 'genoa-genova', team: 'Genoa' },
  { slug: 'internazionale-milano', team: 'Inter' },
  { slug: 'juventus-torino', team: 'Juventus' },
  { slug: 'lazio-formello', team: 'Lazio' },
  { slug: 'lecce-lecce', team: 'Lecce' },
  { slug: 'milan-milano', team: 'Milan' },
  { slug: 'monza-monza', team: 'Monza' },
  { slug: 'napoli-castel-volturno', team: 'Napoli' },
  { slug: 'parma-parma', team: 'Parma' },
  { slug: 'roma-roma', team: 'Roma' },
  { slug: 'sassuolo-sassuolo', team: 'Sassuolo' },
  { slug: 'torino-torino', team: 'Torino' },
  { slug: 'udinese-udine', team: 'Udinese' },
  { slug: 'venezia-mestre', team: 'Venezia' },
]

const CLUB_ACTIVE_PLAYERS_QUERY = `
query ClubActivePlayers($slug: String!) {
  football {
    club(slug: $slug) {
      activePlayers {
        nodes {
          slug
          displayName
          firstName
          lastName
          age
          country {
            threeLetterCode
          }
          position
        }
      }
    }
  }
}
`

// Letters that don't decompose into base+combining-accent under NFD, so a
// plain accent-strip leaves them untouched (confirmed live: this is exactly
// why "Hojlund"/"Ostigard"/"Sorensen" missed Sorare's Højlund/Østigård/
// Sørensen, and "Yildiz"/"Ziolkowski" missed Yıldız/Ziółkowski).
const LETTER_MAP = {
  ø: 'o', ð: 'd', þ: 'th', ł: 'l', ı: 'i', æ: 'ae', œ: 'oe',
}

// Straight apostrophe, right/left single quotation marks, backtick: Sorare
// and the listone disagree on which one shows up in names like N'Dicka /
// N'Dri (confirmed live: Sorare's roster has "N’Dri", the listone has
// "N'Dri") — stripped entirely rather than normalized to one form, since
// either side could use any of them.
const APOSTROPHES = /['‘’`]/g

function normalize(str) {
  let s = (str ?? '').toLowerCase()
  for (const [from, to] of Object.entries(LETTER_MAP)) {
    s = s.split(from).join(to)
  }
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(APOSTROPHES, '')
}

// Splits a listone name into its surname (for the roster substring match)
// and the trailing disambiguating initials Fantacalcio appends when two
// teammates share a surname — e.g. "Martinez Jo." -> Inter has both Lautaro
// and Josep Martínez, "Jo." picks the goalkeeper. Initials can be multiple
// letters ("Jo.") and/or chained without a space between them ("Ederson
// D.S." -> "D.S."), so the trailing token is "one-or-more dotted groups"
// glued onto a single leading run of whitespace, not "whitespace before
// every group" (which fails to match "D.S." since there's no space between
// "D." and "S.").
function splitListoneName(listoneName) {
  const match = listoneName.match(/\s+((?:[A-Za-zÀ-ÿ]{1,3}\.)+)$/)
  if (!match) return { surname: listoneName.trim(), initials: '' }
  return {
    surname: listoneName.slice(0, match.index).trim(),
    initials: match[1].replace(/\./g, '').toLowerCase(),
  }
}

const POSITION_BY_ROLE = { P: 'Goalkeeper', D: 'Defender', C: 'Midfielder', A: 'Forward' }

function findCandidates(roster, listoneName) {
  const key = normalize(splitListoneName(listoneName).surname)
  if (!key) return []
  return roster.filter((p) => normalize(p.lastName).includes(key) || normalize(p.displayName).includes(key))
}

// When the surname alone matches more than one teammate, narrow using (1)
// the listone's disambiguating initials against each candidate's first
// name, then (2) the listone's role (P/D/C/A) against Sorare's position —
// whichever narrows to exactly one wins. Neither guessing further nor
// falling back silently: if both still leave more than one, it stays
// ambiguous and goes to the report.
function disambiguate(candidates, listoneName, roleClassic) {
  if (candidates.length <= 1) return candidates

  const { initials } = splitListoneName(listoneName)
  if (initials) {
    const byInitials = candidates.filter((c) => normalize(c.firstName).startsWith(normalize(initials)))
    if (byInitials.length === 1) return byInitials
    if (byInitials.length > 1) candidates = byInitials
  }

  const position = POSITION_BY_ROLE[roleClassic]
  if (position) {
    const byPosition = candidates.filter((c) => c.position === position)
    if (byPosition.length === 1) return byPosition
  }

  return candidates
}

function csvEscape(value) {
  const str = value == null ? '' : String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

async function fetchRosters() {
  const rosterByTeam = new Map()

  for (const club of CLUBS) {
    const data = await sorareQuery(CLUB_ACTIVE_PLAYERS_QUERY, { slug: club.slug })
    const nodes = (data?.football?.club?.activePlayers?.nodes ?? []).filter((p) => p.position !== 'Coach')
    rosterByTeam.set(club.team, nodes)
    console.log(`[roster] ${club.team}: ${nodes.length} players`)
    await sleep(REQUEST_DELAY_MS)
  }

  return rosterByTeam
}

async function main() {
  const supabase = getSupabaseAdmin()

  console.log('Fetching current squads for all 20 clubs from Sorare...')
  const rosterByTeam = await fetchRosters()

  const { data: players, error } = await supabase.from('players').select('id, name, team, role_classic').order('name')
  if (error) throw error

  console.log(`\nMatching ${players.length} players locally against fetched squads...`)

  let updated = 0
  let unmatchedCount = 0
  let ambiguousCount = 0
  const reportRows = [['player_id', 'player_name', 'player_team', 'status', 'candidates']]

  for (const player of players) {
    const roster = rosterByTeam.get(player.team) ?? []
    const candidates = disambiguate(findCandidates(roster, player.name), player.name, player.role_classic)

    if (candidates.length === 0) {
      console.warn(`[unmatched] ${player.name} (${player.team})`)
      unmatchedCount += 1
      reportRows.push([player.id, player.name, player.team, 'unmatched', ''])
      continue
    }

    if (candidates.length > 1) {
      const names = candidates.map((c) => c.displayName).join(' | ')
      console.warn(`[ambiguous] ${player.name} (${player.team}) -> candidates: ${names}`)
      ambiguousCount += 1
      reportRows.push([player.id, player.name, player.team, 'ambiguous', names])
      continue
    }

    const best = candidates[0]
    const { error: updateError } = await supabase
      .from('players')
      .update({
        birth_year: best.age != null ? CURRENT_SEASON_YEAR - best.age : null,
        nationality: best.country?.threeLetterCode?.toUpperCase() ?? null,
      })
      .eq('id', player.id)
    if (updateError) throw updateError

    const { error: mappingError } = await supabase
      .from('sorare_player_mapping')
      .upsert(
        { player_id: player.id, sorare_slug: best.slug, sorare_display_name: best.displayName, matched_at: new Date().toISOString() },
        { onConflict: 'player_id' }
      )
    if (mappingError) console.error(`[mapping error] ${player.name}: ${mappingError.message}`)

    updated += 1
  }

  fs.writeFileSync(REPORT_PATH, reportRows.map((row) => row.map(csvEscape).join(',')).join('\n') + '\n', 'utf8')

  console.log(`\nDone. Updated ${updated}, ambiguous ${ambiguousCount}, unmatched ${unmatchedCount} (of ${players.length} total).`)
  console.log(`Unmatched/ambiguous report written to ${REPORT_PATH}`)
}

main().catch((err) => {
  console.error('enrich-players failed:', err.message || err)
  process.exit(1)
})
