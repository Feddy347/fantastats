// Inserts a fake live match plus fake stats for a handful of real players
// (goalkeeper, single-role defender, single-role attacker, multi-role
// player), runs them through calculateScore(), and persists the result —
// so the scoring engine + DB writes can be sanity-checked without waiting
// for a real Serie A match to kick off.
//
// The match is tagged with sorare_game_id = 'simulated-test' so it's easy
// to find and delete afterwards:
//   delete from player_match_scores where match_id in (select id from matches where sorare_game_id = 'simulated-test');
//   delete from player_match_stats where match_id in (select id from matches where sorare_game_id = 'simulated-test');
//   delete from matches where sorare_game_id = 'simulated-test';
//
// Usage: npm run simulate:match
// Pass --reverse to run every scenario through Flop XI (reverse-scoring)
// math instead, to sanity-check that path end-to-end without a real
// Flop XI lineup.

import { getSupabaseAdmin, getCurrentGameweekAdmin } from './lib/env.js'
import { calculateScore } from '../src/lib/scoreEngine.js'

const BASE_STATS = {
  mins_played: 0,
  goals: 0,
  att_pen_goal: 0,
  goal_assist: 0,
  ontarget_scoring_att: 0,
  big_chance_created: 0,
  assist_penalty_won: 0,
  att_pen_miss: 0,
  accurate_pass: 0,
  total_pass: 0,
  pass_accuracy: 0,
  won_tackle: 0,
  total_tackle: 0,
  interception_won: 0,
  effective_clearance: 0,
  duel_won: 0,
  clearance_off_line: 0,
  last_man_tackle: 0,
  saves: 0,
  penalty_save: 0,
  goals_conceded: 0,
  clean_sheet: false,
  fouls: 0,
  yellow_card: 0,
  red_card: 0,
  own_goals: 0,
  error_lead_to_goal: 0,
  error_lead_to_shot: 0,
  penalty_conceded: 0,
  won_contest: 0,
  three_goals_conceded: false,
  game_started: true,
  is_live: false,
}

const SCENARIOS = [
  {
    key: 'por',
    filter: { role_fantastats: 'POR' },
    slotRole: 'POR',
    stats: {
      mins_played: 90,
      accurate_pass: 20,
      total_pass: 25,
      pass_accuracy: 80,
      effective_clearance: 1,
      saves: 4,
      penalty_save: 1,
      clean_sheet: true,
    },
  },
  {
    key: 'dc',
    filter: { role_fantastats: 'DC' },
    slotRole: 'DC',
    stats: {
      mins_played: 90,
      goals: 1,
      ontarget_scoring_att: 1,
      accurate_pass: 40,
      total_pass: 50,
      pass_accuracy: 80,
      won_tackle: 3,
      total_tackle: 4,
      interception_won: 2,
      effective_clearance: 5,
      duel_won: 6,
      fouls: 1,
      clean_sheet: true,
    },
  },
  {
    key: 'att',
    filter: { role_fantastats: 'ATT' },
    slotRole: 'ATT',
    stats: {
      mins_played: 85,
      goals: 2,
      att_pen_goal: 1,
      goal_assist: 1,
      ontarget_scoring_att: 4,
      big_chance_created: 3,
      assist_penalty_won: 1,
      accurate_pass: 15,
      total_pass: 20,
      pass_accuracy: 75,
      duel_won: 2,
      fouls: 1,
      won_contest: 5,
    },
  },
  {
    key: 'multi-role',
    filter: { role_fantastats: { like: '%;%' } },
    // Uses the player's first listed role as the slot they're fielded in.
    stats: {
      mins_played: 90,
      goals: 1,
      ontarget_scoring_att: 2,
      accurate_pass: 30,
      total_pass: 35,
      pass_accuracy: 85,
      won_tackle: 2,
      total_tackle: 3,
      interception_won: 1,
      effective_clearance: 1,
      duel_won: 1,
      yellow_card: 1,
    },
  },
]

async function findScenarioPlayer(supabase, scenario) {
  let query = supabase.from('players').select('id, name, team, role_fantastats').limit(1)
  if (scenario.filter.role_fantastats?.like) {
    query = query.like('role_fantastats', scenario.filter.role_fantastats.like)
  } else {
    query = query.eq('role_fantastats', scenario.filter.role_fantastats)
  }
  const { data, error } = await query
  if (error) throw error
  return data?.[0] ?? null
}

async function main() {
  const supabase = getSupabaseAdmin()
  const isReverse = process.argv.includes('--reverse')

  const gameweek = await getCurrentGameweekAdmin(supabase)
  if (!gameweek) throw new Error('No current gameweek found (seed the gameweeks table first).')

  const { data: match, error: matchError } = await supabase
    .from('matches')
    .insert({
      gameweek_id: gameweek.id,
      home_team: 'Squadra Test A',
      away_team: 'Squadra Test B',
      home_score: 2,
      away_score: 1,
      status: 'live',
      sorare_game_id: 'simulated-test',
      starts_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (matchError) throw matchError

  console.log(`Created simulated match #${match.id} for gameweek ${gameweek.number}.`)

  const results = []

  for (const scenario of SCENARIOS) {
    const player = await findScenarioPlayer(supabase, scenario)
    if (!player) {
      console.warn(`[skip] no player found for scenario "${scenario.key}"`)
      continue
    }

    const slotRole = scenario.slotRole ?? (player.role_fantastats ?? '').split(';')[0].trim()
    const statsRow = { ...BASE_STATS, ...scenario.stats, player_id: player.id, match_id: match.id }

    const { error: statsError } = await supabase
      .from('player_match_stats')
      .upsert(statsRow, { onConflict: 'player_id,match_id' })
    if (statsError) throw statsError

    const score = calculateScore(statsRow, player.role_fantastats, slotRole, isReverse)

    const { error: scoreError } = await supabase.from('player_match_scores').upsert(
      {
        player_id: player.id,
        match_id: match.id,
        gameweek_id: gameweek.id,
        base_score: score.baseScore,
        multiplier: score.multiplier,
        bonus_score: score.bonusScore,
        malus_score: score.malusScore,
        total_score: score.totalScore,
        score_breakdown: score.breakdown,
        is_final: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'player_id,match_id' }
    )
    if (scoreError) throw scoreError

    results.push({
      scenario: scenario.key,
      player: `${player.name} (${player.team})`,
      role: player.role_fantastats,
      slot: slotRole,
      multiplier: score.multiplier,
      base: score.baseScore,
      bonus: score.bonusScore,
      malus: score.malusScore,
      total: score.totalScore,
    })
  }

  console.table(results)
  if (isReverse) console.log('(Flop XI / reverse-scoring mode)')
  console.log(
    `\nSimulated match #${match.id} inserted. Delete it (and its stats/scores) with:\n` +
      `  delete from player_match_scores where match_id = ${match.id};\n` +
      `  delete from player_match_stats where match_id = ${match.id};\n` +
      `  delete from matches where id = ${match.id};`
  )
}

main().catch((err) => {
  console.error('simulate-match failed:', err.message || err)
  process.exit(1)
})
