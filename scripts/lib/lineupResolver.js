// Resolves a lineup's final gameweek score, applying automatic substitutions
// for starters who didn't play. Confirmed rule (Phase 5, extended to
// leagues in Phase 8/B7):
//
//   1. Scan the bench in priority order for a player who covers the exact
//      same role as the empty slot AND actually played; first match wins.
//   2. If nobody of that role played, scan the WHOLE bench again from the
//      top (any role) for the first player who played, but only accept
//      them if swapping their role into that slot still forms one of the
//      role system's valid modules.
//   3. If no candidate satisfies #2 either, the slot is left empty and
//      contributes 0 — the team plays a man down.
//
// Module validity is checked as an overall role-multiset comparison (each
// module's slots' first-listed/primary role, sorted) rather than a strict
// per-position or per-line match. Verified this is exactly equivalent to a
// stricter per-line check for Fantastats' 8 modules and Classic's 7 (no two
// modules in either system share an overall multiset). Two Mantra module
// pairs (3-4-3/3-4-1-2, 4-3-3/4-1-4-1) do share a primary-role multiset,
// but that's harmless here: this check only answers "can these players
// line up in SOME recognized shape," not "which exact module," and the
// league's saved `module` field is never rewritten by a substitution.
//
// Used only by the consolidation scripts (categories and leagues): this is
// the FINAL score, computed once a gameweek is fully played out. The live
// views intentionally ignore substitutions.

import { calculateScore } from '../../src/lib/scoreEngine.js'

function lineKey(slots) {
  return slots
    .slice()
    .sort()
    .join(',')
}

function isValidModuleSlots(modules, trialRoles) {
  return modules.some((m) => lineKey(m.slots.map((s) => s.roles[0])) === lineKey(trialRoles))
}

function splitRoles(roleValue) {
  return (roleValue ?? '')
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean)
}

/**
 * @param {object} supabase - service-role client
 * @param {object} params
 * @param {Array<{slotIndex:number, slotRole:string, playerId:number}>} params.starters - one per module slot
 * @param {Array<{playerId:number}>} params.bench - in substitution-priority order
 * @param {number} params.gameweekId
 * @param {string} [params.roleField] - players column to read roles from (role_fantastats/role_mantra/role_classic)
 * @param {Array<{slots: Array<{roles: string[]}>}>} params.modules - the role system's module list, for validity checks
 * @param {boolean} [params.useStoredScores] - reuse player_match_scores for
 *   starters who played normally (categories only — league scores are never
 *   stored with the right slot_role context, see leagueScoring.js)
 * @returns {Promise<{totalScore:number, contributions:Array}>}
 */
export async function resolveLineupScore(
  supabase,
  { starters, bench, gameweekId, roleField = 'role_fantastats', modules, useStoredScores = true }
) {
  const allPlayerIds = [...new Set([...starters.map((s) => s.playerId), ...bench.map((b) => b.playerId)])]

  const [{ data: players }, scoresResult, { data: stats }] = await Promise.all([
    supabase.from('players').select(`id, ${roleField}`).in('id', allPlayerIds),
    useStoredScores
      ? supabase.from('player_match_scores').select('*').eq('gameweek_id', gameweekId).in('player_id', allPlayerIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from('player_match_stats')
      .select('*, matches!inner(gameweek_id)')
      .eq('matches.gameweek_id', gameweekId)
      .in('player_id', allPlayerIds),
  ])

  const roleById = new Map((players ?? []).map((p) => [p.id, p[roleField]]))
  const scoreById = new Map((scoresResult.data ?? []).map((s) => [s.player_id, s]))
  const statsById = new Map((stats ?? []).map((s) => [s.player_id, s]))

  function played(playerId) {
    return (statsById.get(playerId)?.mins_played ?? 0) > 0
  }

  const usedBenchIds = new Set()
  const currentSlots = starters
    .slice()
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((s) => s.slotRole)

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
            return isValidModuleSlots(modules, trial)
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
