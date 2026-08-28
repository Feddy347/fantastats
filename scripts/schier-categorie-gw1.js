// Deploys GW1 fantastats-7 lineups for the 10 test users across the 4 fixed-
// pool categories (7 Sorelle, Under 23, Italians do it better, Flop XI).
// Sorprese/Elite are skipped — they depend on Serie A standings, which in
// GW1 are still alphabetical (no real matches played yet).
//
// Reuses the app's 8 Fantastats modules (src/lib/modules.js) and each
// player's real players.role_fantastats column directly — unlike the league
// GW1 script (schier-formazioni-gw1.js), there's no Mantra-role mapping
// step here, since categories read the DB role column as-is.
//
// lineup_players enforces `unique (player_id, gameweek_id)` globally
// (supabase/migrations/20260730000000_lineups.sql) — a player can start in
// at most ONE category per gameweek, across every category including ones
// this script doesn't touch. So players are consumed category-by-category
// in the order given (7 Sorelle -> Under 23 -> Italians -> Flop XI) and
// excluded from later categories' pools once used; any pre-existing
// lineup_players rows for these users/gameweek (e.g. a manually-fielded
// Sorprese/Elite) are also read first and excluded the same way.
//
// Only starters are written (no bench) — the task only asks for the 7
// starters, and populating bench would burn through eligible players faster
// via the same exclusivity constraint, making later categories fail more
// often for no benefit.
//
// Usage: node scripts/schier-categorie-gw1.js

import { getSupabaseAdmin } from './lib/env.js'
import { MODULES as FANTASTATS_MODULES } from '../src/lib/modules.js'

const GAMEWEEK_NUMBER = 1
const CATEGORY_SLUGS_ORDERED = ['7-sorelle', 'under-23', 'italians-do-it-better', 'flop-xi']
const SEVEN_SORELLE_TEAMS = new Set(['Inter', 'Milan', 'Juventus', 'Roma', 'Lazio', 'Fiorentina', 'Parma'])

const ADMIN_ID = '77e2ac11-32cc-44d2-8d1f-2b78bb11ec69' // Hellas Madonna 7 Sorelle
const MEMBER_IDS = [
  'af83a8b9-fc91-4f5c-b820-e7fe2b9efd39', // schiaffield
  '03a80aa8-63c6-43a7-b630-47124d4cff1c', // falarsenal
  'f0145352-6101-4785-aa9a-59a4c38df247', // liverpollio
  'cf0d2bd4-2145-430a-99b3-2864bdb07118', // ostialiedholm
  '1bc25cc0-36ea-4a4c-aede-1fbc9c812b79', // ejaculazio
  '9a91ce74-610f-4b33-bbf3-72430868b523', // realcanil
  '84bf9437-4832-4922-af1d-003d4c6920e7', // rottenwreck
  '79504a26-debf-4a9b-8c0e-fe168551f3de', // parmigian
  'e9bd5267-3a70-44f2-8f0a-8d4b43982d90', // malencastro
]
const ALL_USER_IDS = [ADMIN_ID, ...MEMBER_IDS]

function playerRoles(p) {
  return (p.role_fantastats ?? '').split(';').map((r) => r.trim()).filter(Boolean)
}

function eligibleForCategory(slug, player) {
  switch (slug) {
    case '7-sorelle':
      return SEVEN_SORELLE_TEAMS.has(player.team)
    case 'under-23':
      return player.birth_year != null && player.birth_year >= 2003
    case 'italians-do-it-better':
      return player.nationality === 'ITA'
    case 'flop-xi':
      return true
    default:
      return false
  }
}

// Kuhn's algorithm (maximum bipartite matching), same as
// schier-formazioni-gw1.js: adj[right] lists eligible left indices.
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

// Tries the 8 modules in list order, returns the first with a perfect
// 6/6 outfield match. Unlike the league version, no degraded/forced fit —
// if nothing matches perfectly, the category is infeasible for this user.
function pickModule(outfieldPool) {
  for (const module of FANTASTATS_MODULES) {
    const outfieldSlots = module.slots.slice(1).map((role) => ({ roles: [role] }))
    const adj = outfieldSlots.map((slot) =>
      outfieldPool.map((_, i) => i).filter((i) => playerRoles(outfieldPool[i]).includes(slot.roles[0]))
    )
    const { matched, matchRight } = maxBipartiteMatching(outfieldPool.length, outfieldSlots.length, adj)
    if (matched === outfieldSlots.length) return { module, matchRight, outfieldSlots }
  }
  return null
}

function buildFantastats7(pool) {
  const gk = pool.find((p) => playerRoles(p).includes('POR'))
  if (!gk) return null

  const outfield = pool.filter((p) => p.player_id !== gk.player_id && !playerRoles(p).includes('POR'))
  const fit = pickModule(outfield)
  if (!fit) return null

  const starters = [{ player_id: gk.player_id, slot_role: 'POR', slot_position: 1 }]
  fit.outfieldSlots.forEach((slot, i) => {
    const player = outfield[fit.matchRight[i]]
    starters.push({ player_id: player.player_id, slot_role: slot.roles[0], slot_position: i + 2 })
  })
  return { moduleId: fit.module.id, starters }
}

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: gw1, error: gwError } = await supabase.from('gameweeks').select('id').eq('number', GAMEWEEK_NUMBER).single()
  if (gwError) throw gwError
  const gameweekId = gw1.id

  const { data: categories, error: categoriesError } = await supabase
    .from('categories')
    .select('id, slug')
    .in('slug', CATEGORY_SLUGS_ORDERED)
  if (categoriesError) throw categoriesError
  const categoryBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]))
  const categoryIds = categories.map((c) => c.id)

  const { data: profiles, error: profilesError } = await supabase.from('profiles').select('id, username').in('id', ALL_USER_IDS)
  if (profilesError) throw profilesError
  const usernameById = Object.fromEntries(profiles.map((p) => [p.id, p.username]))

  console.log(`Clearing existing GW${GAMEWEEK_NUMBER} lineups for these 4 categories / ${ALL_USER_IDS.length} users...`)
  const { error: clearError } = await supabase
    .from('lineups')
    .delete()
    .in('user_id', ALL_USER_IDS)
    .in('category_id', categoryIds)
    .eq('gameweek_id', gameweekId)
  if (clearError) throw clearError

  // Seed "already used this gameweek" from whatever's left (e.g. Sorprese/
  // Elite lineups this script doesn't touch), to respect the DB's global
  // unique(player_id, gameweek_id) before we start assigning.
  const { data: remainingLineups, error: remainingError } = await supabase
    .from('lineups')
    .select('id, user_id')
    .in('user_id', ALL_USER_IDS)
    .eq('gameweek_id', gameweekId)
  if (remainingError) throw remainingError

  const usedByUser = new Map(ALL_USER_IDS.map((id) => [id, new Set()]))
  if (remainingLineups.length > 0) {
    const lineupIdToUser = new Map(remainingLineups.map((l) => [l.id, l.user_id]))
    const { data: remainingPlayers, error: remainingPlayersError } = await supabase
      .from('lineup_players')
      .select('lineup_id, player_id')
      .in('lineup_id', remainingLineups.map((l) => l.id))
    if (remainingPlayersError) throw remainingPlayersError
    for (const row of remainingPlayers ?? []) {
      const uid = lineupIdToUser.get(row.lineup_id)
      if (uid) usedByUser.get(uid)?.add(row.player_id)
    }
  }

  const { data: rosterRows, error: rosterError } = await supabase
    .from('user_players')
    .select('user_id, player_id, players(id, team, role_fantastats, birth_year, nationality, name)')
    .in('user_id', ALL_USER_IDS)
  if (rosterError) throw rosterError

  const rosterByUser = new Map(ALL_USER_IDS.map((id) => [id, []]))
  for (const row of rosterRows) {
    rosterByUser.get(row.user_id)?.push({ player_id: row.player_id, ...row.players })
  }

  const summary = Object.fromEntries(CATEGORY_SLUGS_ORDERED.map((slug) => [slug, { fielded: [], skipped: [] }]))

  for (const userId of ALL_USER_IDS) {
    const username = usernameById[userId] ?? userId
    const usedIds = usedByUser.get(userId)
    const fullRoster = rosterByUser.get(userId) ?? []

    for (const slug of CATEGORY_SLUGS_ORDERED) {
      const category = categoryBySlug[slug]
      const pool = fullRoster.filter((p) => !usedIds.has(p.player_id) && eligibleForCategory(slug, p))
      const result = buildFantastats7(pool)

      if (!result) {
        summary[slug].skipped.push(username)
        console.log(`Utente ${username} — categoria ${slug}: saltata (giocatori insufficienti)`)
        continue
      }

      const { error: enrollError } = await supabase
        .from('user_category_enrollments')
        .upsert({ user_id: userId, category_id: category.id }, { onConflict: 'user_id,category_id', ignoreDuplicates: true })
      if (enrollError) throw new Error(`${username} / ${slug}: enrollment failed: ${enrollError.message}`)

      const { data: lineupRow, error: lineupError } = await supabase
        .from('lineups')
        .upsert(
          { user_id: userId, category_id: category.id, gameweek_id: gameweekId, module: result.moduleId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,category_id,gameweek_id' }
        )
        .select('id')
        .single()
      if (lineupError) throw new Error(`${username} / ${slug}: lineups upsert failed: ${lineupError.message}`)

      const { error: deleteError } = await supabase.from('lineup_players').delete().eq('lineup_id', lineupRow.id)
      if (deleteError) throw deleteError

      const rows = result.starters.map((s) => ({
        lineup_id: lineupRow.id,
        player_id: s.player_id,
        gameweek_id: gameweekId,
        slot_type: 'starter',
        slot_role: s.slot_role,
        slot_position: s.slot_position,
      }))
      const { error: insertError } = await supabase.from('lineup_players').insert(rows)
      if (insertError) throw new Error(`${username} / ${slug}: lineup_players insert failed: ${insertError.message}`)

      result.starters.forEach((s) => usedIds.add(s.player_id))
      summary[slug].fielded.push(username)
      console.log(`Utente ${username} — categoria ${slug}: schierata (modulo ${result.moduleId})`)
    }
  }

  console.log('\n=== Riepilogo ===')
  for (const slug of CATEGORY_SLUGS_ORDERED) {
    const { fielded, skipped } = summary[slug]
    console.log(`\n${slug}:`)
    console.log(`  Schierati (${fielded.length}): ${fielded.join(', ') || '—'}`)
    console.log(`  Saltati (${skipped.length}): ${skipped.join(', ') || '—'}`)
  }
}

main().catch((err) => {
  console.error('schier-categorie-gw1 failed:', err.message || err)
  process.exit(1)
})
