import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { usePageTitle } from '../hooks/usePageTitle'
import './Categories.css'
import './Statistiche.css'

const STAT_CATEGORIES = [
  { key: 'goals', label: 'Gol' },
  { key: 'assists', label: 'Assist' },
  { key: 'saves', label: 'Parate' },
  { key: 'tackles', label: 'Tackle' },
  { key: 'interceptions', label: 'Intercetti' },
  { key: 'clean_sheets', label: 'Clean Sheet' },
]

export default function Statistiche() {
  usePageTitle('Statistiche')

  const [stats, setStats] = useState([])
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedStat, setSelectedStat] = useState(STAT_CATEGORIES[0].key)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const [{ data: statsData, error: statsError }, { data: playersData, error: playersError }] =
        await Promise.all([
          supabase.rpc('get_player_stat_totals'),
          supabase.from('players').select('id, name, team, role_fantastats'),
        ])

      if (cancelled) return

      if (statsError || playersError) {
        setError('Impossibile caricare le statistiche.')
        setLoading(false)
        return
      }

      setStats(statsData ?? [])
      setPlayers(playersData ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const playersById = useMemo(() => {
    const map = {}
    players.forEach((p) => {
      map[p.id] = p
    })
    return map
  }, [players])

  const merged = useMemo(
    () =>
      stats
        .map((row) => {
          const player = playersById[row.player_id]
          if (!player) return null
          return {
            player,
            matches_played: Number(row.matches_played),
            goals: Number(row.goals),
            assists: Number(row.assists),
            saves: Number(row.saves),
            tackles: Number(row.tackles),
            interceptions: Number(row.interceptions),
            clean_sheets: Number(row.clean_sheets),
          }
        })
        .filter(Boolean),
    [stats, playersById]
  )

  const rankedList = useMemo(() => {
    return merged
      .filter((row) => row[selectedStat] > 0)
      .slice()
      .sort((a, b) => {
        if (b[selectedStat] !== a[selectedStat]) return b[selectedStat] - a[selectedStat]
        return a.matches_played - b.matches_played
      })
      .slice(0, 20)
  }, [merged, selectedStat])

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  return (
    <div className="statistiche-page page-fade">
      <h1>Statistiche</h1>

      <div className="category-tabs stat-tabs">
        {STAT_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            className={'category-tab' + (selectedStat === cat.key ? ' active' : '')}
            onClick={() => setSelectedStat(cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {stats.length === 0 ? (
        <p className="status-text">
          Nessuna statistica disponibile ancora — verranno popolate durante la stagione.
        </p>
      ) : rankedList.length === 0 ? (
        <p className="status-text">Nessun giocatore con questa statistica.</p>
      ) : (
        <ol className="stat-list">
          {rankedList.map((row, index) => (
            <li key={row.player.id} className="stat-row card">
              <span className="stat-rank">{index + 1}</span>
              <div className="stat-row-main">
                <Link to={`/players/${row.player.id}`} className="stat-name">
                  {row.player.name}
                </Link>
                <div className="stat-row-meta">
                  <Link to={`/teams/${encodeURIComponent(row.player.team)}`} className="stat-team">
                    {row.player.team}
                  </Link>
                  <span className="role-tag">{row.player.role_fantastats}</span>
                </div>
              </div>
              <div className="stat-row-value">
                <span className="stat-value">{row[selectedStat]}</span>
                <span className="stat-matches">{row.matches_played} presenze</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
