import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getLeagueModuleSystem } from '../lib/leagueModules'
import { getMatchByTeamMap, computeLeagueMemberScore } from '../lib/leagueScoring'
import PlayerBreakdownModal from './PlayerBreakdownModal'
import './Leaderboard.css'

// Full live standings for a league — computed fresh client-side (see
// leagueScoring.js), since league scores can't be reused from
// player_match_scores. Used by the /live/league/:leagueId page.
export default function LiveLeagueLeaderboard({ league, gameweek, currentUserId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [expandedUserId, setExpandedUserId] = useState(null)
  const [selectedPlayer, setSelectedPlayer] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const roleField = getLeagueModuleSystem(league).roleField

      const [{ data: members }, matchByTeam] = await Promise.all([
        supabase.from('league_members').select('user_id, team_name, profiles(username)').eq('league_id', league.id),
        getMatchByTeamMap(supabase, gameweek.id),
      ])

      if (cancelled) return

      const computed = []
      for (const m of members ?? []) {
        const result = await computeLeagueMemberScore(supabase, {
          leagueId: league.id,
          userId: m.user_id,
          gameweekId: gameweek.id,
          roleField,
          matchByTeam,
        })
        computed.push({
          userId: m.user_id,
          username: m.profiles?.username ?? m.team_name ?? '—',
          totalScore: result.total,
          players: result.players,
        })
      }

      if (cancelled) return

      computed.sort((a, b) => b.totalScore - a.totalScore)
      let rank = 0
      let prevScore = null
      computed.forEach((row, idx) => {
        if (prevScore === null || row.totalScore !== prevScore) rank = idx + 1
        prevScore = row.totalScore
        row.rank = rank
      })

      setRows(computed)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [league, gameweek.id])

  function toggleExpand(userId) {
    setExpandedUserId(expandedUserId === userId ? null : userId)
  }

  if (loading) return <p className="status-text">Caricamento classifica…</p>
  if (rows.length === 0) return <p className="status-text">Nessun iscritto.</p>

  return (
    <>
      <ul className="leaderboard">
        {rows.map((row) => (
          <li key={row.userId} className={'leaderboard-row card' + (row.userId === currentUserId ? ' own' : '')}>
            <button type="button" className="leaderboard-summary" onClick={() => toggleExpand(row.userId)}>
              <span className="leaderboard-rank">{row.rank}°</span>
              <span className="leaderboard-username">{row.username}</span>
              <span className="leaderboard-score">{row.totalScore.toFixed(1)}</span>
            </button>

            {expandedUserId === row.userId && (
              <ul className="leaderboard-detail">
                {row.players.map((p) => (
                  <li key={p.playerId}>
                    <button type="button" className="leaderboard-detail-player" onClick={() => setSelectedPlayer(p)}>
                      <span className="role-tag">{p.role}</span> {p.name}
                      <span className="leaderboard-detail-score">{p.score != null ? p.score.toFixed(1) : '—'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {selectedPlayer && (
        <PlayerBreakdownModal
          playerName={selectedPlayer.name}
          role={selectedPlayer.role}
          totalScore={selectedPlayer.score}
          breakdown={selectedPlayer.breakdown ?? {}}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </>
  )
}
