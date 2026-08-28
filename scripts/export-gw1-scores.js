// Exports every GW1 score stored in `player_match_scores` to a CSV for
// manual inspection/audit (AUDIT_REPORT.md §2.2).
//
// player_match_scores only ever holds ONE row per (player_id, match_id) —
// poll-sorare-live.js upserts on that conflict target and only computes a
// score for a player when they're a STARTER in at least one category
// lineup for the gameweek (see that file's header comment: league scores
// are derived live/client-side from player_match_stats, never stored here,
// and category bench players never get a score computed at all). So this
// export is already naturally deduplicated by construction — there is no
// separate "league score" or "bench score" to merge in from this table.
//
// Each stored row's total_score already has the category's is_reverse_scoring
// baked in at computation time (scoreEngine flips every breakdown term's
// sign except participation — see src/lib/scoreEngine.js), but the table
// itself doesn't record which category produced it. To label each row we
// look up, for GW1, every category-starter placement of that player and
// flag the row `flop_xi = true` if any of those placements was in a
// reverse-scoring category. In the practically-universal case where a
// player is only ever fielded in one scoring context per gameweek this is
// exact; a player fielded as a starter in both a normal AND a reverse
// category in the same gameweek (possible, not seen in current data) would
// be flagged true with a `mixed_context` note instead of silently guessing.
//
// Usage: node scripts/export-gw1-scores.js

import fs from 'node:fs'
import path from 'node:path'
import { getSupabaseAdmin } from './lib/env.js'
import { BREAKDOWN_LABELS } from '../src/lib/breakdownIcons.js'

const OUTPUT_PATH = 'data/gw1_scores.csv'
const GAMEWEEK_NUMBER = 1

const BREAKDOWN_KEYS = Object.keys(BREAKDOWN_LABELS)

function csvEscape(value) {
  const str = value == null ? '' : String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCsvRow(fields) {
  return fields.map(csvEscape).join(',')
}

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: gameweek, error: gwError } = await supabase
    .from('gameweeks')
    .select('id, number')
    .eq('number', GAMEWEEK_NUMBER)
    .maybeSingle()
  if (gwError) throw gwError
  if (!gameweek) throw new Error(`Gameweek ${GAMEWEEK_NUMBER} not found`)

  const { data: scores, error: scoresError } = await supabase
    .from('player_match_scores')
    .select('player_id, match_id, base_score, multiplier, bonus_score, malus_score, total_score, score_breakdown, is_final')
    .eq('gameweek_id', gameweek.id)
  if (scoresError) throw scoresError

  if (!scores || scores.length === 0) {
    console.log(`Nessun punteggio trovato in player_match_scores per GW${GAMEWEEK_NUMBER}.`)
    return
  }

  const playerIds = [...new Set(scores.map((s) => s.player_id))]

  const [{ data: players, error: playersError }, { data: statsRows, error: statsError }, { data: starterRows, error: starterError }] =
    await Promise.all([
      supabase.from('players').select('id, name, team, role_fantastats').in('id', playerIds),
      supabase
        .from('player_match_stats')
        .select('player_id, match_id, mins_played, matches!inner(gameweek_id)')
        .eq('matches.gameweek_id', gameweek.id),
      supabase
        .from('lineup_players')
        .select('player_id, lineups!inner(category_id, categories(name, is_reverse_scoring))')
        .eq('slot_type', 'starter')
        .eq('gameweek_id', gameweek.id),
    ])
  if (playersError) throw playersError
  if (statsError) throw statsError
  if (starterError) throw starterError

  const playerById = new Map((players ?? []).map((p) => [p.id, p]))
  const minsByPlayerMatch = new Map((statsRows ?? []).map((s) => [`${s.player_id}|${s.match_id}`, s.mins_played]))

  const reverseFlagsByPlayerId = new Map()
  for (const row of starterRows ?? []) {
    const isReverse = row.lineups?.categories?.is_reverse_scoring ?? false
    const existing = reverseFlagsByPlayerId.get(row.player_id)
    if (existing === undefined) {
      reverseFlagsByPlayerId.set(row.player_id, new Set([isReverse]))
    } else {
      existing.add(isReverse)
    }
  }

  function scoringContext(playerId) {
    const flags = reverseFlagsByPlayerId.get(playerId)
    if (!flags || flags.size === 0) return { flopXi: false, mixedContext: false }
    if (flags.size > 1) return { flopXi: true, mixedContext: true }
    return { flopXi: flags.has(true), mixedContext: false }
  }

  const rows = scores.map((s) => {
    const player = playerById.get(s.player_id)
    const mins = minsByPlayerMatch.get(`${s.player_id}|${s.match_id}`)
    const { flopXi, mixedContext } = scoringContext(s.player_id)
    const breakdown = s.score_breakdown ?? {}

    return {
      player_id: s.player_id,
      player_name: player?.name ?? '?',
      team: player?.team ?? '?',
      role: player?.role_fantastats ?? '?',
      mins_played: mins ?? '',
      total_score: s.total_score,
      base_score: s.base_score,
      multiplier: s.multiplier,
      bonus_score: s.bonus_score,
      malus_score: s.malus_score,
      is_final: s.is_final,
      flop_xi: flopXi,
      mixed_context: mixedContext,
      breakdown,
    }
  })

  rows.sort((a, b) => b.total_score - a.total_score)

  const dir = path.dirname(OUTPUT_PATH)
  fs.mkdirSync(dir, { recursive: true })

  const headers = [
    'player_id',
    'player_name',
    'team',
    'role',
    'mins_played',
    'total_score',
    'base_score',
    'multiplier',
    'bonus_score',
    'malus_score',
    'is_final',
    'flop_xi',
    'mixed_context',
    ...BREAKDOWN_KEYS.map((key) => `breakdown_${key}`),
  ]

  const lines = [toCsvRow(headers)]
  for (const r of rows) {
    lines.push(
      toCsvRow([
        r.player_id,
        r.player_name,
        r.team,
        r.role,
        r.mins_played,
        r.total_score,
        r.base_score,
        r.multiplier,
        r.bonus_score,
        r.malus_score,
        r.is_final,
        r.flop_xi,
        r.mixed_context,
        ...BREAKDOWN_KEYS.map((key) => r.breakdown[key] ?? 0),
      ])
    )
  }
  fs.writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n', 'utf8')

  const flopCount = rows.filter((r) => r.flop_xi).length
  const mixedCount = rows.filter((r) => r.mixed_context).length
  console.log(`${rows.length} punteggi GW${GAMEWEEK_NUMBER} esportati in ${OUTPUT_PATH}`)
  console.log(`  di cui ${flopCount} con contesto Flop XI (invertito)${mixedCount > 0 ? `, ${mixedCount} con contesto misto (verificare manualmente)` : ''}`)
}

main().catch((err) => {
  console.error('export-gw1-scores failed:', err.message || err)
  process.exit(1)
})
