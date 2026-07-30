import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import LeagueGameweekPanel from './LeagueGameweekPanel'
import './ConfirmDialog.css'
import './PlayerPickerModal.css'
import './CreateLeagueModal.css'
import './LeagueStandingsTab.css'

export default function LeagueStandingsTab({ league, currentUserId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [openGameweek, setOpenGameweek] = useState(null) // { id, gameweek_id, number }

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('league_standings')
        .select('*, profiles(username)')
        .eq('league_id', league.id)
        .order('rank', { ascending: true, nullsFirst: false })

      if (!cancelled) {
        setRows(data ?? [])
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [league.id])

  async function openLatestGameweek() {
    const { data } = await supabase
      .from('league_calendar')
      .select('id, gameweek_id, gameweeks(number)')
      .eq('league_id', league.id)
      .order('gameweek_id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) setOpenGameweek(data)
  }

  if (loading) return <p className="status-text">Caricamento…</p>
  if (rows.length === 0) return <p className="status-text">Nessuna classifica disponibile ancora.</p>

  const format = league.competition_format
  const showWDL = format !== 'royal_rumble_f1'
  const showPoints = format !== 'direct_vote_sum'

  return (
    <>
      <button type="button" className="btn btn-secondary btn-block" onClick={openLatestGameweek}>
        Vedi ultima giornata
      </button>

      <div className="standings-table-wrap">
        <table className="standings-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Squadra</th>
              <th>G</th>
              {showWDL && (
                <>
                  <th>V</th>
                  <th>P</th>
                  <th>S</th>
                </>
              )}
              {showPoints && <th>{format === 'royal_rumble_f1' ? 'Punti F1' : 'Punti'}</th>}
              <th>Totale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.user_id === currentUserId ? 'own-row' : ''}>
                <td>{row.rank ?? '—'}</td>
                <td>{row.profiles?.username ?? '—'}</td>
                <td>{row.played}</td>
                {showWDL && (
                  <>
                    <td>{row.won}</td>
                    <td>{row.drawn}</td>
                    <td>{row.lost}</td>
                  </>
                )}
                {showPoints && <td>{row.points}</td>}
                <td>{row.total_fantasy_score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openGameweek && (
        <div className="confirm-backdrop" onClick={() => setOpenGameweek(null)}>
          <div className="create-league-panel card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="picker-header">
              <h2>Giornata {openGameweek.gameweeks?.number}</h2>
              <button type="button" className="picker-close" onClick={() => setOpenGameweek(null)} aria-label="Chiudi">
                ×
              </button>
            </div>
            <LeagueGameweekPanel league={league} calendarId={openGameweek.id} gameweekId={openGameweek.gameweek_id} />
          </div>
        </div>
      )}
    </>
  )
}
