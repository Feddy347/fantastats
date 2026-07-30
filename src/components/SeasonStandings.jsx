import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './Leaderboard.css'

// Season standings only include users who haven't missed a single gameweek
// since they enrolled (is_eligible = true, maintained by consolidate-gameweek.js).
export default function SeasonStandings({ categoryId, currentUserId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('category_season_standings')
        .select('user_id, total_score, gameweeks_played, profiles(username)')
        .eq('category_id', categoryId)
        .eq('is_eligible', true)
        .order('total_score', { ascending: false })

      if (cancelled) return
      setRows(data ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [categoryId])

  if (loading) return <p className="status-text">Caricamento classifica stagionale…</p>
  if (rows.length === 0) return <p className="status-text">Nessuna classifica stagionale disponibile ancora.</p>

  return (
    <ul className="leaderboard">
      {rows.map((row, idx) => (
        <li key={row.user_id} className={'leaderboard-row card' + (row.user_id === currentUserId ? ' own' : '')}>
          <div className="leaderboard-summary">
            <span className="leaderboard-rank">{idx + 1}°</span>
            <span className="leaderboard-username">{row.profiles?.username ?? '—'}</span>
            <span className="leaderboard-score">{row.total_score.toFixed(1)}</span>
          </div>
          <div className="leaderboard-meta">
            <span>Media: {(row.total_score / Math.max(1, row.gameweeks_played)).toFixed(1)}</span>
            <span>{row.gameweeks_played} GW giocate</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
