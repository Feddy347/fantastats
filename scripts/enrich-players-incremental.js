// Incremental variant of enrich-players.js: enriches ONLY players missing
// birth_year, nationality, or a sorare_player_mapping row (e.g. the new
// players added by an incremental listone update), instead of re-matching
// the entire players table. Same club-roster matching logic as
// enrich-players.js — see that file's header comment for why per-club
// roster fetch + local surname matching replaced per-player search.
//
// Usage: node scripts/enrich-players-incremental.js

import fs from 'node:fs'
import { getSupabaseAdmin } from './lib/env.js'
import { sorareQuery, sleep } from './lib/sorareClient.js'

const REQUEST_DELAY_MS = 2000
const REPORT_PATH = 'data/enrichment_report_new.csv'
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

// See enrich-players.js for why these letters need explicit mapping under
// NFD accent-stripping.
const LETTER_MAP = {
  ø: 'o', ð: 'd', þ: 'th', ł: 'l', ı: 'i', æ: 'ae', œ: 'oe',
}

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

// See enrich-players.js for the "Martinez Jo." / "Ederson D.S." rationale.
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

// Players needing enrichment: missing birth_year, missing nationality, or
// no row in sorare_player_mapping yet. sorare_player_mapping has no direct
// FK-based "missing" filter via PostgREST, so mapped ids are fetched
// separately and subtracted client-side.
async function fetchPlayersNeedingEnrichment(supabase) {
  const { data: incomplete, error: incompleteError } = await supabase
    .from('players')
    .select('id, name, team, role_classic')
    .or('birth_year.is.null,nationality.is.null')
  if (incompleteError) throw incompleteError

  const { data: mapped, error: mappedError } = await supabase.from('sorare_player_mapping').select('player_id')
  if (mappedError) throw mappedError
  const mappedIds = new Set(mapped.map((m) => m.player_id))

  const { data: all, error: allError } = await supabase.from('players').select('id, name, team, role_classic')
  if (allError) throw allError
  const unmapped = all.filter((p) => !mappedIds.has(p.id))

  const byId = new Map()
  for (const p of [...incomplete, ...unmapped]) byId.set(p.id, p)
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function main() {
  const supabase = getSupabaseAdmin()

  const players = await fetchPlayersNeedingEnrichment(supabase)
  console.log(`Found ${players.length} players needing enrichment (missing birth_year, nationality, or sorare mapping).`)

  if (players.length === 0) {
    console.log('Nothing to do.')
    return
  }

  console.log('\nFetching current squads for all 20 clubs from Sorare...')
  const rosterByTeam = await fetchRosters()

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

  console.log(`\nDone. Updated ${updated}, ambiguous ${ambiguousCount}, unmatched ${unmatchedCount} (of ${players.length} needing enrichment).`)
  console.log(`Ambiguous/unmatched report written to ${REPORT_PATH}`)
}

main().catch((err) => {
  console.error('enrich-players-incremental failed:', err.message || err)
  process.exit(1)
})
