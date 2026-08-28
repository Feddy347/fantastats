// Consolidates a finished gameweek: computes each enrolled user's final
// score per category (with automatic substitutions), ranks them, rebuilds
// the season standings, hands out rewards once stats are final, and marks
// the gameweek completed.
//
// Idempotency: category_gameweek_scores is upserted by its unique
// (user_id, category_id, gameweek_id) key, so re-running this for a
// gameweek always overwrites that gameweek's row. category_season_standings
// is never nudged by a delta — it's fully recomputed by summing every
// category_gameweek_scores row for the category (see
// recomputeCategorySeasonStandings), so gameweeks_played/gameweeks_available/
// total_score always reflect exactly the gameweeks actually consolidated,
// no matter how many times this runs.
//
// Rewards are the one side effect that isn't naturally idempotent (they
// hand out credits and a free player, not just numbers in a standings
// row), so they get two extra safeguards instead of the old "skip if any
// reward already exists for this gameweek" guard:
//   1. They're only granted once every fielded starter's score for the
//      gameweek is final (player_match_scores.is_final = true) — granting
//      from a still-in-progress, likely-all-tied-at-zero snapshot is
//      exactly what caused every 7-sorelle/under-23/flop-xi participant to
//      get the rank-1 tier the first time this ran.
//   2. The grant step is now re-runnable: it reverses whatever reward it
//      previously granted for that (category, gameweek) — refunding the
//      credits, removing the bonus player — before granting the correct
//      one from the current (final) ranking. So if it's ever re-run after
//      having already granted rewards from bad data, it self-corrects
//      instead of leaving the wrong grant in place forever.
//
// Usage: node scripts/consolidate-gameweek.js
// Usage: node scripts/consolidate-gameweek.js -- <gameweekNumber>

import { pathToFileURL } from 'node:url'
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

// gameweekNumber is optional: pass it to target a specific gameweek
// regardless of its status; omit it to keep the original live-or-most-
// recently-completed lookup.
async function findTargetGameweek(supabase, gameweekNumber) {
  if (gameweekNumber) {
    const { data } = await supabase.from('gameweeks').select('*').eq('number', gameweekNumber).maybeSingle()
    return data ?? null
  }

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

// Rebuilds category_season_standings for one category entirely from
// category_gameweek_scores (summed across every gameweek consolidated so
// far), instead of nudging existing totals by a delta.
async function recomputeCategorySeasonStandings(supabase, categoryId) {
  const { data: gwScores, error } = await supabase
    .from('category_gameweek_scores')
    .select('user_id, total_score, has_lineup')
    .eq('category_id', categoryId)
  if (error) throw error

  const aggByUser = new Map()
  for (const row of gwScores ?? []) {
    const agg = aggByUser.get(row.user_id) ?? {
      total_score: 0,
      gameweeks_played: 0,
      gameweeks_available: 0,
      is_eligible: true,
    }
    agg.gameweeks_available += 1
    if (row.has_lineup) {
      agg.gameweeks_played += 1
      agg.total_score += row.total_score ?? 0
    } else {
      agg.is_eligible = false
    }
    aggByUser.set(row.user_id, agg)
  }

  const rows = [...aggByUser.entries()].map(([user_id, agg]) => ({
    user_id,
    category_id: categoryId,
    ...agg,
    updated_at: new Date().toISOString(),
  }))

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('category_season_standings')
      .upsert(rows, { onConflict: 'user_id,category_id' })
    if (upsertError) throw upsertError
  }
}

// True only once every player fielded as a STARTER in any lineup for this
// category+gameweek has a final score. No fielded starters at all counts
// as final (nothing to wait for). A starter that never gets a score row
// (no Sorare mapping, no matching game found — both logged as warnings by
// poll-sorare-live.js) would block this forever; accepted as a known
// limitation rather than guessed around, since distinguishing "still
// polling" from "will never resolve" isn't reliably possible from this
// data alone.
async function isGameweekScoringFinal(supabase, categoryId, gameweekId) {
  const { data: lineups, error } = await supabase
    .from('lineups')
    .select('id, lineup_players(player_id, slot_type)')
    .eq('category_id', categoryId)
    .eq('gameweek_id', gameweekId)
  if (error) throw error

  const starterIds = new Set()
  for (const lineup of lineups ?? []) {
    for (const lp of lineup.lineup_players ?? []) {
      if (lp.slot_type === 'starter') starterIds.add(lp.player_id)
    }
  }
  if (starterIds.size === 0) return true

  const { data: scores, error: scoresError } = await supabase
    .from('player_match_scores')
    .select('player_id, is_final')
    .eq('gameweek_id', gameweekId)
    .in('player_id', [...starterIds])
  if (scoresError) throw scoresError

  const finalIds = new Set((scores ?? []).filter((s) => s.is_final).map((s) => s.player_id))
  return [...starterIds].every((id) => finalIds.has(id))
}

// Reconciles rewards for this (category, gameweek) against `rankedRows`,
// touching only what actually needs to change instead of blindly
// reversing everything and regranting from scratch. That distinction
// matters for the bonus-player reward specifically: pickRandomRewardPlayer
// picks a random eligible player every time it's called, so a naive
// "always reverse then regrant" would silently swap a user's already-
// correct bonus player for a different random one on every re-run, even
// when their rank hasn't changed — not truly idempotent in effect, just
// in the final numbers. Here, a user's credits are only adjusted (by the
// delta) if the tier's credit amount actually differs from what they
// already have on record, and a bonus player is only granted or revoked
// if whether-a-player-is-owed flips — an unchanged tier leaves both alone.
//
// Exported (rather than kept module-private) so a one-off manual
// intervention can call it directly for a category/gameweek stuck behind
// isGameweekScoringFinal() for a reason confirmed to never resolve on its
// own — e.g. a fielded player mapped to a real Sorare athlete who doesn't
// actually play in Serie A (wrong `players.team` in the listone), so
// poll-sorare-live.js will never find a Serie A game for them and their
// score can never become final. Reach for this only after confirming
// that's really the situation (not just "hasn't been polled yet") —
// normal consolidation should always go through consolidateCategory()'s
// finality check.
export async function reconcileRewards(supabase, category, gameweek, rankedRows) {
  const { data: existingRewards, error } = await supabase
    .from('rewards')
    .select('*')
    .eq('category_id', category.id)
    .eq('gameweek_id', gameweek.id)
  if (error) throw error

  const existingByUser = new Map()
  for (const r of existingRewards ?? []) {
    const entry = existingByUser.get(r.user_id) ?? {}
    entry[r.reward_type] = r
    existingByUser.set(r.user_id, entry)
  }

  const desiredByUser = new Map()
  for (const row of rankedRows) {
    const tier = rewardForRank(row.rank)
    if (tier) desiredByUser.set(row.user_id, tier)
  }

  // Rank order first (nicer log output), then any user who had a reward
  // before but no longer ranks for one at all (shouldn't normally happen,
  // but would otherwise leave a stale reward unreversed).
  const orderedUserIds = [
    ...rankedRows.map((r) => r.user_id),
    ...[...existingByUser.keys()].filter((id) => !desiredByUser.has(id)),
  ]

  for (const userId of orderedUserIds) {
    const existing = existingByUser.get(userId) ?? {}
    const desired = desiredByUser.get(userId) ?? null
    const existingCredits = existing.credits?.reward_value ?? 0
    const desiredCredits = desired?.credits ?? 0
    const hadPlayer = Boolean(existing.player)
    const needsPlayer = Boolean(desired?.player)

    if (existingCredits !== desiredCredits) {
      const delta = desiredCredits - existingCredits
      const { data: profile } = await supabase.from('profiles').select('credits').eq('id', userId).single()
      await supabase
        .from('profiles')
        .update({ credits: Math.max(0, (profile?.credits ?? 0) + delta) })
        .eq('id', userId)

      if (existing.credits) await supabase.from('rewards').delete().eq('id', existing.credits.id)
      if (desiredCredits > 0) {
        await supabase.from('rewards').insert({
          user_id: userId,
          category_id: category.id,
          gameweek_id: gameweek.id,
          reward_type: 'credits',
          reward_value: desiredCredits,
          claimed: false,
        })
      }
    }

    if (hadPlayer && !needsPlayer) {
      await supabase.from('user_players').delete().eq('user_id', userId).eq('player_id', existing.player.reward_value)
      await supabase.from('rewards').delete().eq('id', existing.player.id)
    } else if (!hadPlayer && needsPlayer) {
      const playerId = await pickRandomRewardPlayer(supabase, category, userId)
      if (playerId) {
        await supabase.from('user_players').insert({ user_id: userId, player_id: playerId, purchase_price: 0 })
        await supabase.from('rewards').insert({
          user_id: userId,
          category_id: category.id,
          gameweek_id: gameweek.id,
          reward_type: 'player',
          reward_value: playerId,
          claimed: false,
        })
      } else {
        console.warn(`    [warning] no reward player available for user ${userId} in ${category.name}`)
      }
    }

    if (desired) {
      const unchanged = existingCredits === desiredCredits && hadPlayer === needsPlayer
      console.log(
        `    user ${userId}: ${desiredCredits} credits${needsPlayer ? ' + player' : ''}${unchanged ? ' (unchanged)' : ' (updated)'}`
      )
    } else if (existing.credits || existing.player) {
      console.log(`    user ${userId}: no longer reward-eligible — reversed`)
    }
  }
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
        isReverse: category.is_reverse_scoring,
      })
      totalScore = resolved.totalScore
    }

    results.push({ userId: enrollment.user_id, totalScore, hasLineup })
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
      has_lineup: r.hasLineup,
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

  await recomputeCategorySeasonStandings(supabase, category.id)

  const scoringFinal = await isGameweekScoringFinal(supabase, category.id, gameweek.id)
  if (!scoringFinal) {
    console.log(`    scores not final yet for this gameweek — skipping rewards (will grant once stats settle)`)
    return
  }

  // Only rank-eligible rows (those with a lineup) should ever receive a
  // reward — a user with no lineup still gets a category_gameweek_scores
  // row (has_lineup: false) but ranked strictly worse than anyone who did
  // play would be misleading to reward.
  await reconcileRewards(
    supabase,
    category,
    gameweek,
    rows.filter((r) => r.has_lineup)
  )
}

// Exported so api/calculate-gameweek.js can call this in-process (admin-only
// "Calcola giornata" button). The CLI entrypoint below wraps it unchanged.
export async function consolidateGameweek(supabase, { gameweekNumber } = {}) {
  const gameweek = await findTargetGameweek(supabase, gameweekNumber)
  if (!gameweek) {
    console.log('No live or completed gameweek found to consolidate.')
    return { consolidated: false, reason: 'no-target-gameweek' }
  }

  console.log(`Consolidating gameweek ${gameweek.number} (id ${gameweek.id})...`)

  const { data: categories, error } = await supabase.from('categories').select('*').eq('is_active', true)
  if (error) throw error

  for (const category of categories ?? []) {
    await consolidateCategory(supabase, category, gameweek)
  }

  await supabase.from('gameweeks').update({ status: 'completed' }).eq('id', gameweek.id)
  console.log(`Gameweek ${gameweek.number} consolidated and marked completed.`)

  return { consolidated: true, gameweekNumber: gameweek.number, categoriesConsolidated: (categories ?? []).length }
}

async function main() {
  const gameweekNumber = process.argv[2] ? Number(process.argv[2]) : undefined
  return consolidateGameweek(getSupabaseAdmin(), { gameweekNumber })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('consolidate-gameweek failed:', err.message || err)
    process.exit(1)
  })
}
