// Consolidates a finished gameweek: computes each enrolled user's final
// score per category (with automatic substitutions), ranks them, updates
// the season standings, hands out rewards, and marks the gameweek completed.
//
// Usage: node scripts/consolidate-gameweek.js

import { getSupabaseAdmin } from './lib/env.js'
import { resolveLineupScore } from './lib/lineupResolver.js'
import { isPlayerEligible } from '../src/lib/categoryPool.js'
import { getLeagueModuleSystem } from '../src/lib/leagueModules.js'

// Categories are always the Fantastats (7-a-side) system; reuse
// getLeagueModuleSystem's normalization ({slots: [{roles:[role]}]}) so
// resolveLineupScore's module-validity check works off one consistent shape.
const FANTASTATS_MODULES = getLeagueModuleSystem({ formation_type: '7' }).modules

const REWARD_TIERS = [
  { minRank: 1, maxRank: 1, credits: 100, player: true },
  { minRank: 2, maxRank: 2, credits: 75 },
  { minRank: 3, maxRank: 3, credits: 50 },
  { minRank: 4, maxRank: 5, credits: 25 },
  { minRank: 6, maxRank: 10, credits: 10 },
]

function rewardForRank(rank) {
  return REWARD_TIERS.find((t) => rank >= t.minRank && rank <= t.maxRank) ?? null
}

async function findTargetGameweek(supabase) {
  const { data: live } = await supabase
    .from('gameweeks')
    .select('*')
    .eq('status', 'live')
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (live) return live

  const { data: completed } = await supabase
    .from('gameweeks')
    .select('*')
    .eq('status', 'completed')
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return completed ?? null
}

async function pickRandomRewardPlayer(supabase, category, userId) {
  const [{ data: players }, { data: teams }, { data: roster }] = await Promise.all([
    supabase.from('players').select('*'),
    supabase.from('teams').select('*'),
    supabase.from('user_players').select('player_id').eq('user_id', userId),
  ])

  const teamsByName = {}
  ;(teams ?? []).forEach((t) => {
    teamsByName[t.name] = t
  })
  const ownedIds = new Set((roster ?? []).map((r) => r.player_id))
  const totalTeams = (teams ?? []).length

  const pool = (players ?? []).filter(
    (p) => !ownedIds.has(p.id) && isPlayerEligible(p, teamsByName[p.team], category, totalTeams)
  )
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)].id
}

function toStartersAndBench(lineupPlayers) {
  const starters = lineupPlayers
    .filter((lp) => lp.slot_type === 'starter')
    .map((lp) => ({ slotIndex: (lp.slot_position ?? 1) - 1, slotRole: lp.slot_role, playerId: lp.player_id }))
    .sort((a, b) => a.slotIndex - b.slotIndex)

  const bench = lineupPlayers
    .filter((lp) => lp.slot_type === 'bench')
    .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))
    .map((lp) => ({ playerId: lp.player_id }))

  return { starters, bench }
}

async function consolidateCategory(supabase, category, gameweek) {
  const { data: enrollments } = await supabase
    .from('user_category_enrollments')
    .select('user_id, enrolled_at')
    .eq('category_id', category.id)

  if (!enrollments || enrollments.length === 0) return

  console.log(`  ${category.name}: ${enrollments.length} enrolled`)

  const results = []

  for (const enrollment of enrollments) {
    // Skip gameweeks that happened before the user even enrolled — they
    // never had a chance to field a lineup for them.
    if (gameweek.deadline && new Date(enrollment.enrolled_at) > new Date(gameweek.deadline)) continue

    const { data: lineup } = await supabase
      .from('lineups')
      .select('*, lineup_players(*)')
      .eq('user_id', enrollment.user_id)
      .eq('category_id', category.id)
      .eq('gameweek_id', gameweek.id)
      .maybeSingle()

    let totalScore = 0
    const hasLineup = Boolean(lineup)

    if (lineup) {
      const { starters, bench } = toStartersAndBench(lineup.lineup_players ?? [])
      const resolved = await resolveLineupScore(supabase, {
        starters,
        bench,
        gameweekId: gameweek.id,
        roleField: 'role_fantastats',
        modules: FANTASTATS_MODULES,
      })
      totalScore = resolved.totalScore
    }

    results.push({ userId: enrollment.user_id, totalScore, hasLineup })

    const { data: standing } = await supabase
      .from('category_season_standings')
      .select('*')
      .eq('user_id', enrollment.user_id)
      .eq('category_id', category.id)
      .maybeSingle()

    const prevTotal = standing?.total_score ?? 0
    const prevPlayed = standing?.gameweeks_played ?? 0
    const prevAvailable = standing?.gameweeks_available ?? 0
    const prevEligible = standing?.is_eligible ?? true

    await supabase.from('category_season_standings').upsert(
      {
        user_id: enrollment.user_id,
        category_id: category.id,
        total_score: prevTotal + (hasLineup ? totalScore : 0),
        gameweeks_played: prevPlayed + (hasLineup ? 1 : 0),
        gameweeks_available: prevAvailable + 1,
        is_eligible: prevEligible && hasLineup,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,category_id' }
    )
  }

  // Competition ranking (ties share a rank, next rank skips accordingly).
  const sorted = [...results].sort((a, b) => b.totalScore - a.totalScore)
  let rank = 0
  let prevScore = null
  const rows = sorted.map((r, idx) => {
    if (prevScore === null || r.totalScore !== prevScore) rank = idx + 1
    prevScore = r.totalScore
    return {
      user_id: r.userId,
      category_id: category.id,
      gameweek_id: gameweek.id,
      total_score: r.totalScore,
      rank,
      is_final: true,
      updated_at: new Date().toISOString(),
    }
  })

  if (rows.length > 0) {
    const { error } = await supabase
      .from('category_gameweek_scores')
      .upsert(rows, { onConflict: 'user_id,category_id,gameweek_id' })
    if (error) console.error(`    [error] upserting scores: ${error.message}`)
  }

  for (const row of rows) {
    const tier = rewardForRank(row.rank)
    if (!tier) continue

    await supabase.from('rewards').insert({
      user_id: row.user_id,
      category_id: category.id,
      gameweek_id: gameweek.id,
      reward_type: 'credits',
      reward_value: tier.credits,
      claimed: false,
    })

    const { data: profile } = await supabase.from('profiles').select('credits').eq('id', row.user_id).single()
    await supabase
      .from('profiles')
      .update({ credits: (profile?.credits ?? 0) + tier.credits })
      .eq('id', row.user_id)

    if (tier.player) {
      const playerId = await pickRandomRewardPlayer(supabase, category, row.user_id)
      if (playerId) {
        await supabase.from('user_players').insert({ user_id: row.user_id, player_id: playerId, purchase_price: 0 })
        await supabase.from('rewards').insert({
          user_id: row.user_id,
          category_id: category.id,
          gameweek_id: gameweek.id,
          reward_type: 'player',
          reward_value: playerId,
          claimed: false,
        })
      } else {
        console.warn(`    [warning] no reward player available for user ${row.user_id} in ${category.name}`)
      }
    }

    console.log(`    #${row.rank} user ${row.user_id}: ${tier.credits} credits${tier.player ? ' + player' : ''}`)
  }
}

async function main() {
  const supabase = getSupabaseAdmin()

  const gameweek = await findTargetGameweek(supabase)
  if (!gameweek) {
    console.log('No live or completed gameweek found to consolidate.')
    return
  }

  console.log(`Consolidating gameweek ${gameweek.number} (id ${gameweek.id})...`)

  const { data: categories, error } = await supabase.from('categories').select('*').eq('is_active', true)
  if (error) throw error

  for (const category of categories ?? []) {
    await consolidateCategory(supabase, category, gameweek)
  }

  await supabase.from('gameweeks').update({ status: 'completed' }).eq('id', gameweek.id)
  console.log(`Gameweek ${gameweek.number} consolidated and marked completed.`)
}

main().catch((err) => {
  console.error('consolidate-gameweek failed:', err.message || err)
  process.exit(1)
})
