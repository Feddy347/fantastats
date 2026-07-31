// Mirrors the eligibility rules enforced server-side in
// count_eligible_players() (supabase/migrations/20260808000000_nationality_three_letter.sql).
// This copy is for display/filtering only — the database function is the
// authoritative check for enrollment.

export function buildTeamsByName(teams) {
  const map = {}
  teams.forEach((t) => {
    map[t.name] = t
  })
  return map
}

export function isPlayerEligible(player, team, category, totalTeams) {
  const config = category.pool_config || {}

  switch (category.pool_type) {
    case 'league_position_bottom': {
      const bottomN = config.bottom_n ?? 0
      if (!team || team.league_position == null) return false
      return team.league_position > totalTeams - bottomN
    }
    case 'league_position_top': {
      const topN = config.top_n ?? 0
      if (!team || team.league_position == null) return false
      return team.league_position <= topN
    }
    case 'fixed_teams': {
      const teams = config.teams ?? []
      return teams.includes(player.team)
    }
    case 'age': {
      const minBirthYear = config.min_birth_year ?? 2003
      return player.birth_year != null && player.birth_year >= minBirthYear
    }
    case 'nationality': {
      return player.nationality === 'ITA'
    }
    case 'top_scorers':
      return true
    default:
      return false
  }
}

export function computePool(players, teamsByName, category, totalTeams) {
  return players.filter((p) => isPlayerEligible(p, teamsByName[p.team], category, totalTeams))
}

export function eligibleCategoriesForPlayer(player, teamsByName, categories, totalTeams) {
  return categories.filter((c) => isPlayerEligible(player, teamsByName[player.team], c, totalTeams))
}
