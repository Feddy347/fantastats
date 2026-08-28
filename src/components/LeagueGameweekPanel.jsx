import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
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

    const starters = (lineup?.league_lineup_players ?? [])
      .filter((lp) => lp.slot_type === 'starter')
      .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))

    const playerIds = starters.map((lp) => lp.player_id)
    const { data: players } =
      playerIds.length > 0 ? await supabase.from('players').select('id, name').in('id', playerIds) : { data: [] }

    const nameByPlayerId = {}
    ;(players ?? []).forEach((p) => {
      nameByPlayerId[p.id] = p.name
    })

    setFormationsByUserId((prev) => ({
      ...prev,
      [userId]: starters.map((lp) => ({ role: lp.slot_role, name: nameByPlayerId[lp.player_id] ?? '?' })),
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
                <ul className="leaderboard-detail">
                  {(formationsByUserId[m.home_user_id] ?? []).map((p, i) => (
                    <li key={i}>
                      <span className="role-tag">{p.role}</span> {p.name}
                    </li>
                  ))}
                </ul>
              )}
              {expandedUserId === m.away_user_id && (
                <ul className="leaderboard-detail">
                  {(formationsByUserId[m.away_user_id] ?? []).map((p, i) => (
                    <li key={i}>
                      <span className="role-tag">{p.role}</span> {p.name}
                    </li>
                  ))}
                </ul>
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
              <ul className="leaderboard-detail">
                {(formationsByUserId[row.user_id] ?? []).map((p, i) => (
                  <li key={i}>
                    <span className="role-tag">{p.role}</span> {p.name}
                  </li>
                ))}
              </ul>
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
            <ul className="leaderboard-detail">
              {(formationsByUserId[m.user_id] ?? []).length === 0 ? (
                <li className="status-text">Nessuna formazione schierata.</li>
              ) : (
                (formationsByUserId[m.user_id] ?? []).map((p, i) => (
                  <li key={i}>
                    <span className="role-tag">{p.role}</span> {p.name}
                  </li>
                ))
              )}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
