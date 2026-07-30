// Resolves a lineup's final gameweek score, applying automatic substitutions
// for starters who didn't play. Confirmed rule (Phase 5):
//
//   1. Scan the bench in priority order for a player who covers the exact
//      same role as the empty slot AND actually played; first match wins.
//   2. If nobody of that role played, scan the WHOLE bench again from the
//      top (any role) for the first player who played, but only accept
//      them if swapping their role into that slot still forms one of the
//      8 valid modules (checked against src/lib/modules.js).
//   3. If no candidate satisfies #2 either, the slot is left empty and
//      contributes 0 — the team plays a man down.
//
// Only used by consolidate-gameweek.js: this is the FINAL score, computed
// once a gameweek is fully played out. The live view intentionally ignores
// substitutions (see get_live_scores in the Phase 5 migration).

import { MODULES } from '../../src/lib/modules.js'
import { calculateScore } from '../../src/lib/scoreEngine.js'

const DEFENSE_IDX = [1, 2, 3]
const OFFENSE_IDX = [4, 5, 6]

function lineKey(slots, indices) {
  return indices
    .map((i) => slots[i])
    .sort()
    .join(',')
}

function isValidModuleSlots(slots) {
  const def = lineKey(slots, DEFENSE_IDX)
  const off = lineKey(slots, OFFENSE_IDX)
  return MODULES.some((m) => lineKey(m.slots, DEFENSE_IDX) === def && lineKey(m.slots, OFFENSE_IDX) === off)
}

function splitRoles(roleFantastats) {
  return (roleFantastats ?? '')
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean)
}

/**
 * @param {object} supabase - service-role client
 * @param {object} params
 * @param {Array<{slotIndex:number, slotRole:string, playerId:number}>} params.starters - length 7, one per module slot
 * @param {Array<{playerId:number}>} params.bench - in substitution-priority order
 * @param {number} params.gameweekId
 * @returns {Promise<{totalScore:number, contributions:Array}>}
 */
export async function resolveLineupScore(supabase, { starters, bench, gameweekId }) {
  const allPlayerIds = [...new Set([...starters.map((s) => s.playerId), ...bench.map((b) => b.playerId)])]

  const [{ data: players }, { data: scores }, { data: stats }] = await Promise.all([
    supabase.from('players').select('id, role_fantastats').in('id', allPlayerIds),
    supabase.from('player_match_scores').select('*').eq('gameweek_id', gameweekId).in('player_id', allPlayerIds),
    supabase
      .from('player_match_stats')
      .select('*, matches!inner(gameweek_id)')
      .eq('matches.gameweek_id', gameweekId)
      .in('player_id', allPlayerIds),
  ])

  const roleById = new Map((players ?? []).map((p) => [p.id, p.role_fantastats]))
  const scoreById = new Map((scores ?? []).map((s) => [s.player_id, s]))
  const statsById = new Map((stats ?? []).map((s) => [s.player_id, s]))

  function played(playerId) {
    return (statsById.get(playerId)?.mins_played ?? 0) > 0
  }

  const usedBenchIds = new Set()
  const currentSlots = starters.slice().sort((a, b) => a.slotIndex - b.slotIndex).map((s) => s.slotRole)

  let totalScore = 0
  const contributions = []

  for (const starter of starters) {
    let effectivePlayerId = starter.playerId
    let effectiveRole = starter.slotRole
    let subApplied = false
    let slotEmpty = false

    if (!played(starter.playerId)) {
      const sameRoleSub = bench.find(
        (b) =>
          !usedBenchIds.has(b.playerId) &&
          played(b.playerId) &&
          splitRoles(roleById.get(b.playerId)).includes(starter.slotRole)
      )

      if (sameRoleSub) {
        effectivePlayerId = sameRoleSub.playerId
        usedBenchIds.add(sameRoleSub.playerId)
        subApplied = true
      } else {
        let found = false
        for (const candidate of bench) {
          if (usedBenchIds.has(candidate.playerId) || !played(candidate.playerId)) continue

          const validRole = splitRoles(roleById.get(candidate.playerId)).find((r) => {
            const trial = [...currentSlots]
            trial[starter.slotIndex] = r
            return isValidModuleSlots(trial)
          })

          if (validRole) {
            effectivePlayerId = candidate.playerId
            effectiveRole = validRole
            usedBenchIds.add(candidate.playerId)
            currentSlots[starter.slotIndex] = validRole
            subApplied = true
            found = true
            break
          }
        }

        if (!found) {
          slotEmpty = true
        }
      }
    }

    if (slotEmpty) {
      contributions.push({ slotIndex: starter.slotIndex, playerId: null, score: 0, subApplied: false })
      continue
    }

    let slotScore
    if (!subApplied && scoreById.has(effectivePlayerId)) {
      slotScore = scoreById.get(effectivePlayerId).total_score
    } else {
      const statsRow = statsById.get(effectivePlayerId)
      slotScore = statsRow ? calculateScore(statsRow, roleById.get(effectivePlayerId), effectiveRole).totalScore : 0
    }

    totalScore += slotScore ?? 0
    contributions.push({ slotIndex: starter.slotIndex, playerId: effectivePlayerId, score: slotScore, subApplied })
  }

  return { totalScore, contributions }
}
