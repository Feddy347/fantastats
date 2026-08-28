// Deploys the GW1 formations from data/formations_gw1.json into every one
// of the 9 'Lega Test - SWOS%' test leagues, adapting each team's 11
// starters to that league's formation system (classic-11 / mantra-11 /
// fantastats-7).
//
// Reuses the app's own module definitions and role-matching helpers
// (src/lib/modules.js, mantraModules.js, classicModules.js,
// leagueModules.js) rather than reimplementing role logic — those are pure
// JS with no browser/Vite dependency, so they import fine under plain Node.
// What doesn't exist anywhere in the app is an auto-fill/best-fit algorithm
// (LeagueLineup.jsx is a manual drag-and-drop builder), so the module
// selection + slot assignment below (bipartite matching) is new, built on
// top of those reused primitives.
//
// Usage: node scripts/schier-formazioni-gw1.js

import fs from 'node:fs'
import { getSupabaseAdmin } from './lib/env.js'
import { MODULES as FANTASTATS_MODULES } from '../src/lib/modules.js'
import { MANTRA_MODULES } from '../src/lib/mantraModules.js'
import { CLASSIC_MODULES } from '../src/lib/classicModules.js'

// Plain-Node port of src/lib/leagueModules.js's playerFitsSlot/resolveSlotRole
// (that file itself can't be imported here — it uses extensionless relative
// imports, valid under Vite's bundler resolution but not plain Node ESM).
// Logic is copied verbatim, just inlined instead of re-exported.
function playerRolesFor(player, roleField) {
  const raw = player?.[roleField]
  if (!raw) return []
  return String(raw)
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean)
}

function playerFitsSlot(player, roleField, slotRoles) {
  const roles = playerRolesFor(player, roleField)
  return slotRoles.some((r) => roles.includes(r))
}

function resolveSlotRole(player, roleField, slotRoles) {
  const roles = playerRolesFor(player, roleField)
  return slotRoles.find((r) => roles.includes(r)) ?? slotRoles[0]
}

const DATA_PATH = 'data/formations_gw1.json'
const GAMEWEEK_NUMBER = 1

// Per spec: Mantra role -> Fantastats role. Applied to each of a player's
// (possibly several, ';'-separated) Mantra roles; the union of mapped
// roles is what they're eligible to play in the Fantastats-7 system.
const MANTRA_TO_FANTASTATS = {
  Por: 'POR',
  Dc: 'DC',
  B: 'DC',
  Dd: 'T',
  Ds: 'T',
  E: 'T',
  M: 'C',
  C: 'C',
  T: 'Tq',
  W: 'ES',
  A: 'ATT',
  Pc: 'ATT',
}

function deriveFantastatsRoles(mantraStr) {
  const roles = new Set()
  for (const tok of mantraStr.split(';').map((t) => t.trim()).filter(Boolean)) {
    const mapped = MANTRA_TO_FANTASTATS[tok]
    if (mapped) roles.add(mapped)
  }
  return [...roles]
}

// Wraps a formations_gw1.json player entry as a "player" shaped the way
// playerFitsSlot/resolveSlotRole (built for players table rows) expect.
function toFakePlayer(p) {
  return {
    player_id: p.player_id,
    name: p.name,
    role_classic: p.classic,
    role_mantra: p.mantra,
    role_fantastats: deriveFantastatsRoles(p.mantra).join(';'),
  }
}

// modules.js exports raw string slots (['POR','DC',...]); every other
// module list already uses {roles:[...]} objects. Normalize to match.
function fantastatsModuleSlots(module) {
  return module.slots.map((role) => ({ roles: [role] }))
}

// Kuhn's algorithm (maximum bipartite matching): adj[right] lists eligible
// left indices for that right-hand slot. Returns how many slots got matched
// and, for each slot, which left index (or -1 if none).
function maxBipartiteMatching(numLeft, numRight, adj) {
  const matchOfLeft = new Array(numLeft).fill(-1)

  function tryAssign(right, visited) {
    for (const left of adj[right]) {
      if (visited[left]) continue
      visited[left] = true
      if (matchOfLeft[left] === -1 || tryAssign(matchOfLeft[left], visited)) {
        matchOfLeft[left] = right
        return true
      }
    }
    return false
  }

  let matched = 0
  for (let right = 0; right < numRight; right++) {
    const visited = new Array(numLeft).fill(false)
    if (tryAssign(right, visited)) matched += 1
  }

  const matchRight = new Array(numRight).fill(-1)
  matchOfLeft.forEach((right, left) => {
    if (right !== -1) matchRight[right] = left
  })
  return { matched, matchRight }
}

// Finds the module (from `modules`, tried in list order) whose outfield
// slots (everything after the GK slot) best matches `fakeOutfield` via
// bipartite matching. Stops early on a perfect match; otherwise keeps the
// first module reaching the highest match count seen.
function pickBestModule(modules, fakeOutfield, roleField) {
  let best = null
  for (const module of modules) {
    const outfieldSlots = module.slots.slice(1)
    const adj = outfieldSlots.map((slot) =>
      fakeOutfield.map((_, i) => i).filter((i) => playerFitsSlot(fakeOutfield[i], roleField, slot.roles))
    )
    const { matched, matchRight } = maxBipartiteMatching(fakeOutfield.length, outfieldSlots.length, adj)
    if (!best || matched > best.matched) {
      best = { module, matched, matchRight, outfieldSlots }
      if (matched === outfieldSlots.length) break
    }
  }
  return best
}

function deriveClassicModule(starters, jsonModuleId, warnings) {
  const counts = { D: 0, C: 0, A: 0 }
  for (const p of starters) if (p.classic !== 'P') counts[p.classic] += 1

  function countsMatch(mod) {
    const c = { D: 0, C: 0, A: 0 }
    for (const slot of mod.slots) {
      const role = slot.roles[0]
      if (role !== 'P') c[role] += 1
    }
    return c.D === counts.D && c.C === counts.C && c.A === counts.A
  }

  const jsonModule = CLASSIC_MODULES.find((m) => m.id === jsonModuleId)
  if (jsonModule && countsMatch(jsonModule)) return jsonModule

  const derived = CLASSIC_MODULES.find(countsMatch)
  if (!derived) throw new Error(`No classic module matches D=${counts.D} C=${counts.C} A=${counts.A}`)
  warnings.push(
    `JSON module "${jsonModuleId}" doesn't match actual starter role counts (D${counts.D} C${counts.C} A${counts.A}) — using derived "${derived.id}" instead`
  )
  return derived
}

function assignClassicStarters(starters, module) {
  const byRole = { P: [], D: [], C: [], A: [] }
  starters.forEach((p) => byRole[p.classic].push(p))

  return module.slots.map((slot, idx) => {
    const role = slot.roles[0]
    const player = byRole[role].shift()
    if (!player) throw new Error(`Not enough ${role} players for module ${module.id}`)
    return { player_id: player.player_id, slot_role: role, slot_position: idx + 1 }
  })
}

function findGoalkeeper(starters) {
  const gk = starters.find((p) => p.classic === 'P')
  if (!gk) throw new Error('No P (goalkeeper) starter found')
  return gk
}

function assignMantraStarters(starters, warnings) {
  const gk = findGoalkeeper(starters)
  const fakeOutfield = starters.filter((p) => p.classic !== 'P').map(toFakePlayer)

  const best = pickBestModule(MANTRA_MODULES, fakeOutfield, 'role_mantra')
  if (best.matched < best.outfieldSlots.length) {
    warnings.push(
      `no exact Mantra module fit for these 11 titolari — best fit "${best.module.id}" matches ${best.matched}/${best.outfieldSlots.length} outfield slots`
    )
  }

  const usedIdx = new Set(best.matchRight.filter((i) => i !== -1))
  const leftover = fakeOutfield.map((_, i) => i).filter((i) => !usedIdx.has(i))

  const rows = [{ player_id: gk.player_id, slot_role: 'Por', slot_position: 1 }]
  best.outfieldSlots.forEach((slot, i) => {
    let playerIdx = best.matchRight[i]
    let slotRole
    if (playerIdx === -1) {
      playerIdx = leftover.shift()
      slotRole = slot.roles[0]
      warnings.push(`slot ${i + 2} (${slot.roles.join('/')}) had no eligible player left — force-assigned ${fakeOutfield[playerIdx].name}`)
    } else {
      slotRole = resolveSlotRole(fakeOutfield[playerIdx], 'role_mantra', slot.roles)
    }
    rows.push({ player_id: fakeOutfield[playerIdx].player_id, slot_role: slotRole, slot_position: i + 2 })
  })

  return { moduleId: best.module.id, rows }
}

function assignFantastatsStarters(starters, warnings) {
  const gk = findGoalkeeper(starters)
  const fakeOutfield = starters.filter((p) => p.classic !== 'P').map(toFakePlayer)

  const normalizedModules = FANTASTATS_MODULES.map((m) => ({ id: m.id, slots: fantastatsModuleSlots(m) }))
  const best = pickBestModule(normalizedModules, fakeOutfield, 'role_fantastats')
  if (best.matched < best.outfieldSlots.length) {
    warnings.push(
      `no exact Fantastats module fit from these 10 movement players — best fit "${best.module.id}" matches ${best.matched}/6`
    )
  }

  const usedIdx = new Set()
  const rows = [{ player_id: gk.player_id, slot_role: 'POR', slot_position: 1 }]
  const leftover = fakeOutfield.map((_, i) => i).filter((i) => !new Set(best.matchRight.filter((i2) => i2 !== -1)).has(i))

  best.outfieldSlots.forEach((slot, i) => {
    let playerIdx = best.matchRight[i]
    if (playerIdx === -1) {
      playerIdx = leftover.shift()
      warnings.push(`slot ${i + 2} (${slot.roles[0]}) had no eligible player left — force-assigned ${fakeOutfield[playerIdx].name}`)
    }
    usedIdx.add(playerIdx)
    rows.push({ player_id: fakeOutfield[playerIdx].player_id, slot_role: slot.roles[0], slot_position: i + 2 })
  })

  const benchLeftoverIds = fakeOutfield.filter((_, i) => !usedIdx.has(i)).map((p) => p.player_id)
  return { moduleId: best.module.id, rows, benchLeftoverIds }
}

function dedupeBench(entries) {
  const seen = new Set()
  const out = []
  for (const e of entries) {
    if (seen.has(e.player_id)) continue
    seen.add(e.player_id)
    out.push(e)
  }
  return out
}

async function main() {
  const supabase = getSupabaseAdmin()
  const { team_to_uid: teamToUid, formations } = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'))
  const teams = Object.keys(teamToUid)

  const { data: gw1, error: gwError } = await supabase.from('gameweeks').select('id').eq('number', GAMEWEEK_NUMBER).single()
  if (gwError) throw gwError
  const gameweekId = gw1.id

  const { data: leagues, error: leaguesError } = await supabase
    .from('leagues')
    .select('id, name, formation_type, role_system')
    .like('name', 'Lega Test - SWOS%')
  if (leaguesError) throw leaguesError
  if (leagues.length === 0) throw new Error('No test leagues found — run scripts/create-test-leagues.js first')

  console.log(`Clearing existing GW${GAMEWEEK_NUMBER} lineups for ${leagues.length} test leagues...`)
  const { error: clearError } = await supabase
    .from('league_lineups')
    .delete()
    .in('league_id', leagues.map((l) => l.id))
    .eq('gameweek_id', gameweekId)
  if (clearError) throw clearError

  for (const league of leagues) {
    const format = league.formation_type === '7' ? 'fantastats' : league.role_system === 'mantra' ? 'mantra' : 'classic'
    console.log(`\n=== ${league.name} (${format}) ===`)

    for (const team of teams) {
      const userId = teamToUid[team]
      const formation = formations[team]
      const warnings = []

      let moduleId
      let starterRows
      let benchLeftoverIds = []

      if (format === 'classic') {
        const module = deriveClassicModule(formation.starters, formation.module, warnings)
        moduleId = module.id
        starterRows = assignClassicStarters(formation.starters, module)
      } else if (format === 'mantra') {
        const result = assignMantraStarters(formation.starters, warnings)
        moduleId = result.moduleId
        starterRows = result.rows
      } else {
        const result = assignFantastatsStarters(formation.starters, warnings)
        moduleId = result.moduleId
        starterRows = result.rows
        benchLeftoverIds = result.benchLeftoverIds
      }

      const starterIds = new Set(starterRows.map((r) => r.player_id))
      const benchEntries = dedupeBench(
        [...benchLeftoverIds.map((id) => ({ player_id: id })), ...formation.bench.map((p) => ({ player_id: p.player_id }))].filter(
          (e) => !starterIds.has(e.player_id)
        )
      )

      const { data: lineupRow, error: lineupError } = await supabase
        .from('league_lineups')
        .insert({ league_id: league.id, user_id: userId, gameweek_id: gameweekId, module: moduleId })
        .select('id')
        .single()
      if (lineupError) throw new Error(`${league.name} / ${team}: league_lineups insert failed: ${lineupError.message}`)

      const rows = [
        ...starterRows.map((r) => ({
          lineup_id: lineupRow.id,
          player_id: r.player_id,
          slot_type: 'starter',
          slot_role: r.slot_role,
          slot_position: r.slot_position,
        })),
        ...benchEntries.map((e, idx) => ({
          lineup_id: lineupRow.id,
          player_id: e.player_id,
          slot_type: 'bench',
          slot_role: null,
          slot_position: idx + 1,
        })),
      ]
      const { error: rowsError } = await supabase.from('league_lineup_players').insert(rows)
      if (rowsError) throw new Error(`${league.name} / ${team}: league_lineup_players insert failed: ${rowsError.message}`)

      const expectedStarters = format === 'fantastats' ? 7 : 11
      const ok = starterRows.length === expectedStarters
      for (const w of warnings) console.warn(`  [warn] ${team}: ${w}`)
      console.log(`  ${team}: module=${moduleId} starters=${starterRows.length}/${expectedStarters} ${ok ? 'OK' : 'MISMATCH'}`)
    }
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('schier-formazioni-gw1 failed:', err.message || err)
  process.exit(1)
})
