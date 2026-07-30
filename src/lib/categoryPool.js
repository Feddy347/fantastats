// Mirrors the eligibility rules enforced server-side in
// count_eligible_players() (supabase/migrations/20260729010000_categories_market.sql).
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
    case 'top_scorers':
    case 'age':
    case 'nationality':
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
