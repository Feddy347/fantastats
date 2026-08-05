// Shared "compute a league member's live/final score" logic, used by both
// the Live page (client-side, via the anon key) and
// scripts/consolidate-league-gameweek.js (server-side, via the service
// role key) — same reasoning as that script's header comment: a league
// lineup can field a player in a different slot/module than any category
// lineup, so the score has to be re-derived from raw player_match_stats
// rather than reused from player_match_scores.

import { calculateScore } from './scoreEngine'

export async function getMatchByTeamMap(supabase, gameweekId) {
  const { data } = await supabase.from('matches').select('id, home_team, away_team').eq('gameweek_id', gameweekId)
  const map = new Map()
  ;(data ?? []).forEach((m) => {
    map.set(m.home_team, m.id)
    map.set(m.away_team, m.id)
  })
  return map
}

export async function computeLeagueMemberScore(
  supabase,
  { leagueId, userId, gameweekId, roleField, matchByTeam, isReverse = false }
) {
  const { data: lineup } = await supabase
    .from('league_lineups')
    .select('*, league_lineup_players(*)')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .eq('gameweek_id', gameweekId)
    .maybeSingle()

  const starters = (lineup?.league_lineup_players ?? [])
    .filter((lp) => lp.slot_type === 'starter')
    .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))

  if (starters.length === 0) return { total: 0, players: [] }

  const playerIds = starters.map((s) => s.player_id)
  const { data: players } = await supabase.from('players').select(`id, name, team, ${roleField}`).in('id', playerIds)
  const playerById = new Map((players ?? []).map((p) => [p.id, p]))

  let total = 0
  const rows = []

  for (const starter of starters) {
    const player = playerById.get(starter.player_id)
    if (!player) continue

    const matchId = matchByTeam.get(player.team)
    let score = null
    let isLive = false

    let breakdown = null

    if (matchId) {
      const { data: stats } = await supabase
        .from('player_match_stats')
        .select('*')
        .eq('match_id', matchId)
        .eq('player_id', starter.player_id)
        .maybeSingle()

      if (stats) {
        const result = calculateScore(stats, player[roleField], starter.slot_role, isReverse)
        score = result.totalScore
        breakdown = result.breakdown
        isLive = Boolean(stats.is_live)
        total += score
      }
    }

    rows.push({ playerId: starter.player_id, name: player.name, role: starter.slot_role, score, isLive, breakdown })
  }

  return { total, players: rows }
}
