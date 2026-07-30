// Fantastats scoring matrix. Pure function, no I/O — safe to import from the
// frontend (to render a breakdown) and from server-side scripts (to persist
// player_match_scores).
//
// Multiplier rule (×1.3, single-role players only, never for POR): it applies
// per-action to whichever phase (offense/defense) is OPPOSITE the slot the
// player is fielded in. The two milestone bonuses Sorare's raw stats can also
// swing a multiplier on ("4+ dribbling riusciti" and "3+ big chance create")
// are folded into bonusScore already multiplied when they land in the
// opposite phase; the other three milestones (clean sheet, pass accuracy)
// and every malus milestone stay neutral, matching how the design was
// confirmed: baseScore comes only from the raw 3.2-3.4 actions, bonusScore
// carries the (possibly multiplied) milestones, and totalScore is a plain
// sum of the three with no further multiplication.

const DEFENSE_SLOTS = ['DC', 'T', 'C']
const OFFENSE_SLOTS = ['ES', 'Tq', 'ATT']
const GK_SLOT = 'POR'

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function isMultiRole(playerRole) {
  return (playerRole ?? '').includes(';')
}

function slotPhase(slotRole) {
  if (slotRole === GK_SLOT) return 'gk'
  if (DEFENSE_SLOTS.includes(slotRole)) return 'defense'
  if (OFFENSE_SLOTS.includes(slotRole)) return 'offense'
  return null
}

export function calculateScore(stats, playerRole, slotRole) {
  const s = stats ?? {}
  const phase = slotPhase(slotRole)
  const multiplierEligible = phase !== 'gk' && phase !== null && !isMultiRole(playerRole)
  const multiplier = multiplierEligible ? 1.3 : 1.0

  // An action from the phase opposite the player's slot gets the multiplier;
  // same-phase actions (and goalkeepers / unrecognized slots) pass through.
  function weighted(value, isOffenseAction) {
    if (!multiplierEligible) return value
    if (phase === 'defense' && isOffenseAction) return value * multiplier
    if (phase === 'offense' && !isOffenseAction) return value * multiplier
    return value
  }

  // 3.1 participation — neutral
  let participation = 0
  if ((s.mins_played ?? 0) > 0) participation += 2
  if ((s.mins_played ?? 0) >= 60) participation += 1

  // 3.2 offensive actions — weighted when the slot is defensive
  const goalsOpenPlay = Math.max(0, (s.goals ?? 0) - (s.att_pen_goal ?? 0))
  const goals = weighted(goalsOpenPlay * 6, true)
  const penaltyGoals = weighted((s.att_pen_goal ?? 0) * 4, true)
  const assists = weighted((s.goal_assist ?? 0) * 3, true)
  const shotsOnTarget = weighted((s.ontarget_scoring_att ?? 0) * 0.5, true)
  const bigChances = weighted((s.big_chance_created ?? 0) * 1.5, true)
  const penaltyWon = weighted((s.assist_penalty_won ?? 0) * 1.5, true)
  // penalty missed sits in the offensive section but is excluded from the
  // 3.9 multiplier list, so it stays neutral.
  const penaltyMissed = (s.att_pen_miss ?? 0) * -3

  // 3.3 build-up — neutral (not mentioned in 3.9)
  const passing = (s.accurate_pass ?? 0) * 0.03

  // 3.4 defensive actions — weighted when the slot is offensive
  const tackles = weighted((s.won_tackle ?? 0) * 0.4, false)
  const interceptions = weighted((s.interception_won ?? 0) * 0.4, false)
  const clearances = weighted((s.effective_clearance ?? 0) * 0.3, false)
  const duels = weighted((s.duel_won ?? 0) * 0.15, false)
  const lineClearance = weighted((s.clearance_off_line ?? 0) * 3, false)
  const lastManTackle = weighted((s.last_man_tackle ?? 0) * 3, false)

  // 3.5 goalkeeper — neutral
  const keeperSaves = (s.saves ?? 0) * 0.5
  const penaltySave = (s.penalty_save ?? 0) * 5
  const goalsConceded = (s.goals_conceded ?? 0) * -1

  // 3.6 discipline & errors — neutral. Kept as individually-named terms
  // (rather than one combined bucket) purely so the UI can show a distinct
  // icon per action; the math is unchanged.
  const foulsBase = (s.fouls ?? 0) * -0.2
  const yellowCardMalus = (s.yellow_card ?? 0) * -1
  let redCardMalus = 0
  if ((s.red_card ?? 0) >= 1) {
    redCardMalus = (s.yellow_card ?? 0) >= 2 ? -3 : -4
  }
  const ownGoalMalus = (s.own_goals ?? 0) * -4
  const errorLeadToGoalMalus = (s.error_lead_to_goal ?? 0) * -3
  const errorLeadToShotMalus = (s.error_lead_to_shot ?? 0) * -1
  const penaltyConcededMalus = (s.penalty_conceded ?? 0) * -2

  const discipline =
    foulsBase +
    yellowCardMalus +
    redCardMalus +
    ownGoalMalus +
    errorLeadToGoalMalus +
    errorLeadToShotMalus +
    penaltyConcededMalus

  const baseScore =
    participation +
    goals +
    penaltyGoals +
    assists +
    shotsOnTarget +
    bigChances +
    penaltyWon +
    penaltyMissed +
    passing +
    tackles +
    interceptions +
    clearances +
    duels +
    lineClearance +
    lastManTackle +
    keeperSaves +
    penaltySave +
    goalsConceded +
    discipline

  // 3.7 bonus milestones
  let cleanSheetBonus = 0
  if (s.clean_sheet && (s.mins_played ?? 0) >= 60) {
    if (slotRole === GK_SLOT) cleanSheetBonus = 4
    else if (DEFENSE_SLOTS.includes(slotRole)) cleanSheetBonus = 3
  }
  const passAccuracyBonus =
    (s.pass_accuracy ?? 0) >= 85 && (s.total_pass ?? 0) >= 30 ? 1.5 : 0
  // These two are explicitly called out in 3.9 as multiplier-eligible offensive actions.
  const dribbleBonus = weighted((s.won_contest ?? 0) >= 4 ? 2 : 0, true)
  const bigChanceBonus = weighted((s.big_chance_created ?? 0) >= 3 ? 2 : 0, true)

  const bonusScore = cleanSheetBonus + passAccuracyBonus + dribbleBonus + bigChanceBonus

  // 3.8 malus milestones — neutral (not mentioned in 3.9)
  const goalkeeperMalus = s.three_goals_conceded && slotRole === GK_SLOT ? -3 : 0
  const foulsMalus = (s.fouls ?? 0) >= 5 ? -1.5 : 0
  const noTacklesMalus = (s.won_tackle ?? 0) === 0 && (s.total_tackle ?? 0) >= 3 ? -1 : 0

  const malusScore = goalkeeperMalus + foulsMalus + noTacklesMalus

  const totalScore = baseScore + bonusScore + malusScore

  return {
    baseScore: round2(baseScore),
    multiplier,
    bonusScore: round2(bonusScore),
    malusScore: round2(malusScore),
    totalScore: round2(totalScore),
    breakdown: {
      participation: round2(participation),
      goals: round2(goals),
      penaltyGoals: round2(penaltyGoals),
      assists: round2(assists),
      shotsOnTarget: round2(shotsOnTarget),
      bigChances: round2(bigChances),
      penaltyWon: round2(penaltyWon),
      penaltyMissed: round2(penaltyMissed),
      passing: round2(passing),
      tackles: round2(tackles),
      interceptions: round2(interceptions),
      clearances: round2(clearances),
      duels: round2(duels),
      lineClearance: round2(lineClearance),
      lastManTackle: round2(lastManTackle),
      keeperSaves: round2(keeperSaves),
      penaltySave: round2(penaltySave),
      goalsConceded: round2(goalsConceded),
      fouls: round2(foulsBase),
      yellowCard: round2(yellowCardMalus),
      redCard: round2(redCardMalus),
      ownGoals: round2(ownGoalMalus),
      errorLeadToGoal: round2(errorLeadToGoalMalus),
      errorLeadToShot: round2(errorLeadToShotMalus),
      penaltyConceded: round2(penaltyConcededMalus),
      cleanSheetBonus: round2(cleanSheetBonus),
      passAccuracyBonus: round2(passAccuracyBonus),
      dribbleBonus: round2(dribbleBonus),
      bigChanceBonus: round2(bigChanceBonus),
      goalkeeperMalus: round2(goalkeeperMalus),
      foulsMalus: round2(foulsMalus),
      noTacklesMalus: round2(noTacklesMalus),
    },
  }
}
