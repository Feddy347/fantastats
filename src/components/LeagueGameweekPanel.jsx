import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { resolveLineupScore } from '../lib/lineupResolver'
import { getLeagueModuleSystem } from '../lib/leagueModules'
import LeagueFormationDetail from './LeagueFormationDetail'
import './Leaderboard.css'
import './LeagueGameweekPanel.css'

// Shared "what happened this gameweek" view for a league: direct-matchup
// formats show the head-to-head cards (each expandable to the two lineups),
// royal-rumble formats show that gameweek's ranking. Reused by both the
// Calendario tab (inline, per expanded gameweek) and the Classifica tab
// (when drilling into a specific gameweek).
export default function LeagueGameweekPanel({ league, calendarId, gameweekId }) {
  const [loading, setLoading] = useState(true)
  const [matchups, setMatchups] = useState([])
  const [gwScores, setGwScores] = useState([])
  const [members, setMembers] = useState([])
  const [expandedUserId, setExpandedUserId] = useState(null)
  const [formationsByUserId, setFormationsByUserId] = useState({})

  const isDirect = league.competition_format.startsWith('direct_')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)

      if (isDirect) {
        const { data } = await supabase
          .from('league_matchups')
          .select(
            'id, home_user_id, away_user_id, home_score, away_score, home_result, away_result, is_played,' +
              'home:profiles!league_matchups_home_user_id_fkey(username),' +
              'away:profiles!league_matchups_away_user_id_fkey(username)'
          )
          .eq('calendar_id', calendarId)

        if (!cancelled) setMatchups(data ?? [])
      } else {
        // Ranked list only exists once the gameweek's been consolidated
        // (Calcola giornata). Before that, league_gameweek_scores is empty
        // for the whole league — fall back to a plain, unranked member list
        // so formations are still visible pre-consolidation instead of
        // showing nothing for anyone.
        const [{ data: scores }, { data: memberRows }] = await Promise.all([
          supabase
            .from('league_gameweek_scores')
            .select('user_id, total_score, league_points, rank_in_gameweek, profiles(username)')
            .eq('league_id', league.id)
            .eq('gameweek_id', gameweekId)
            .order('rank_in_gameweek', { ascending: true }),
          supabase.from('league_members').select('user_id, profiles(username)').eq('league_id', league.id),
        ])

        if (!cancelled) {
          setGwScores(scores ?? [])
          setMembers(memberRows ?? [])
        }
      }

      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [calendarId, gameweekId, league.id, isDirect])

  // Builds the full "who actually played, what did they score, who was
  // subbed in for whom" picture for one member's GW lineup — not just
  // role+name. Scores are always computed fresh (never read from
  // player_match_scores): a league lineup can field a player in a
  // different slot/role than any category lineup, which changes the
  // scoring multiplier (see leagueScoring.js's header comment), and
  // resolveLineupScore also applies the same automatic role-for-role
  // substitution the final "Calcola giornata" consolidation uses, so this
  // view matches the real result instead of a simplified approximation.
  async function toggleFormation(userId) {
    if (expandedUserId === userId) {
      setExpandedUserId(null)
      return
    }
    setExpandedUserId(userId)
    if (formationsByUserId[userId]) return

    const { data: lineup } = await supabase
      .from('league_lineups')
      .select('module, league_lineup_players(player_id, slot_role, slot_position, slot_type)')
      .eq('league_id', league.id)
      .eq('user_id', userId)
      .eq('gameweek_id', gameweekId)
      .maybeSingle()

    if (!lineup) {
      setFormationsByUserId((prev) => ({ ...prev, [userId]: { moduleId: null, totalScore: 0, starters: [], bench: [] } }))
      return
    }

    const lineupPlayers = lineup.league_lineup_players ?? []
    const starterRows = lineupPlayers
      .filter((lp) => lp.slot_type === 'starter')
      .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))
    const benchRows = lineupPlayers
      .filter((lp) => lp.slot_type === 'bench')
      .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))

    const starters = starterRows.map((lp, idx) => ({ slotIndex: idx, slotRole: lp.slot_role, playerId: lp.player_id }))
    const bench = benchRows.map((lp) => ({ playerId: lp.player_id }))

    const moduleSystem = getLeagueModuleSystem(league)

    const [resolved, playersResult, benchStatsResult] = await Promise.all([
      resolveLineupScore(supabase, {
        starters,
        bench,
        gameweekId,
        roleField: moduleSystem.roleField,
        modules: moduleSystem.modules,
        useStoredScores: false,
        isReverse: league.is_reverse_scoring,
      }),
      supabase
        .from('players')
        .select('id, name')
        .in('id', lineupPlayers.map((lp) => lp.player_id)),
      bench.length > 0
        ? supabase
            .from('player_match_stats')
            .select('player_id, mins_played, matches!inner(gameweek_id)')
            .eq('matches.gameweek_id', gameweekId)
            .in('player_id', bench.map((b) => b.playerId))
        : Promise.resolve({ data: [] }),
    ])

    const nameByPlayerId = new Map((playersResult.data ?? []).map((p) => [p.id, p.name]))
    const contributionBySlot = new Map(resolved.contributions.map((c) => [c.slotIndex, c]))
    const usedAsSubIds = new Set(
      resolved.contributions.filter((c) => c.subApplied && c.playerId != null).map((c) => c.playerId)
    )
    const minsByPlayerId = new Map((benchStatsResult.data ?? []).map((s) => [s.player_id, s.mins_played]))

    const starterSlots = starters.map((s) => {
      const contribution = contributionBySlot.get(s.slotIndex)
      const subApplied = contribution?.subApplied ?? false
      const isEmpty = !contribution || contribution.playerId == null

      return {
        slotPosition: s.slotIndex + 1,
        slotRole: s.slotRole,
        originalPlayerId: s.playerId,
        originalPlayerName: nameByPlayerId.get(s.playerId) ?? '?',
        subApplied,
        isEmpty,
        effectivePlayerId: subApplied ? contribution.playerId : null,
        effectivePlayerName: subApplied ? (nameByPlayerId.get(contribution.playerId) ?? '?') : null,
        effectiveRole: subApplied ? contribution.role : null,
        score: contribution?.score ?? null,
        breakdown: contribution?.breakdown ?? null,
      }
    })

    const benchPlayers = bench.map((b, idx) => ({
      order: idx + 1,
      playerId: b.playerId,
      playerName: nameByPlayerId.get(b.playerId) ?? '?',
      usedAsSub: usedAsSubIds.has(b.playerId),
      played: (minsByPlayerId.get(b.playerId) ?? 0) > 0,
    }))

    setFormationsByUserId((prev) => ({
      ...prev,
      [userId]: { moduleId: lineup.module, totalScore: resolved.totalScore, starters: starterSlots, bench: benchPlayers },
    }))
  }

  if (loading) return <p className="status-text">Caricamento…</p>

  if (isDirect) {
    if (matchups.length === 0) return <p className="status-text">Nessuno scontro per questa giornata.</p>
    return (
      <ul className="gw-matchup-list">
        {matchups.map((m) => {
          const played = m.is_played
          const homeWon = played && m.home_result === 3
          const awayWon = played && m.away_result === 3
          return (
            <li key={m.id} className="gw-matchup card">
              <div className="gw-matchup-row">
                <button
                  type="button"
                  className={'gw-matchup-user' + (homeWon ? ' winner' : '')}
                  onClick={() => toggleFormation(m.home_user_id)}
                >
                  {m.home?.username ?? '—'}
                </button>
                <span className="gw-matchup-score">
                  {played ? `${m.home_score.toFixed(1)} - ${m.away_score.toFixed(1)}` : 'vs'}
                </span>
                <button
                  type="button"
                  className={'gw-matchup-user' + (awayWon ? ' winner' : '')}
                  onClick={() => toggleFormation(m.away_user_id)}
                >
                  {m.away?.username ?? '—'}
                </button>
              </div>

              {expandedUserId === m.home_user_id && (
                <LeagueFormationDetail formation={formationsByUserId[m.home_user_id]} isReverse={league.is_reverse_scoring} />
              )}
              {expandedUserId === m.away_user_id && (
                <LeagueFormationDetail formation={formationsByUserId[m.away_user_id]} isReverse={league.is_reverse_scoring} />
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  if (gwScores.length > 0) {
    return (
      <ul className="leaderboard">
        {gwScores.map((row) => (
          <li key={row.user_id} className="leaderboard-row card">
            <button type="button" className="leaderboard-summary" onClick={() => toggleFormation(row.user_id)}>
              <span className="leaderboard-rank">{row.rank_in_gameweek}°</span>
              <span className="leaderboard-username">{row.profiles?.username ?? '—'}</span>
              <span className="leaderboard-score">{row.total_score.toFixed(1)}</span>
              <span className="gw-league-points">+{row.league_points} pt</span>
            </button>
            {expandedUserId === row.user_id && (
              <LeagueFormationDetail formation={formationsByUserId[row.user_id]} isReverse={league.is_reverse_scoring} />
            )}
          </li>
        ))}
      </ul>
    )
  }

  // Not consolidated yet: no ranking/scores, but formations are already
  // saved — show them via the plain member list instead of nothing.
  if (members.length === 0) return <p className="status-text">Nessun punteggio disponibile per questa giornata.</p>

  return (
    <ul className="leaderboard">
      {members.map((m) => (
        <li key={m.user_id} className="leaderboard-row card">
          <button type="button" className="leaderboard-summary" onClick={() => toggleFormation(m.user_id)}>
            <span className="leaderboard-username">{m.profiles?.username ?? '—'}</span>
          </button>
          {expandedUserId === m.user_id && (
            <LeagueFormationDetail formation={formationsByUserId[m.user_id]} isReverse={league.is_reverse_scoring} />
          )}
        </li>
      ))}
    </ul>
  )
}
