import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import LeagueGameweekPanel from './LeagueGameweekPanel'
import './LeagueCalendarTab.css'

export default function LeagueCalendarTab({ league, currentGameweekId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('league_calendar')
        .select('id, gameweek_id, cycle, is_return, gameweeks(number, starts_at, status)')
        .eq('league_id', league.id)
        .order('gameweek_id', { ascending: true })

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

  if (loading) return <p className="status-text">Caricamento…</p>
  if (rows.length === 0) return <p className="status-text">Il calendario non è ancora stato generato.</p>

  return (
    <ul className="league-calendar-list">
      {rows.map((row) => {
        const isCurrent = row.gameweek_id === currentGameweekId
        const isExpanded = expandedId === row.id
        return (
          <li key={row.id} className={'card league-calendar-row' + (isCurrent ? ' current' : '')}>
            <button
              type="button"
              className="league-calendar-header"
              onClick={() => setExpandedId(isExpanded ? null : row.id)}
            >
              <span>
                Giornata {row.gameweeks?.number}
                {row.is_return && ' (ritorno)'}
              </span>
              {isCurrent && <span className="badge-tag">In corso</span>}
            </button>
            {isExpanded && (
              <div className="league-calendar-body">
                <LeagueGameweekPanel league={league} calendarId={row.id} gameweekId={row.gameweek_id} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
