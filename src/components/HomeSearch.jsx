import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import './HomeSearch.css'

const DEBOUNCE_MS = 300

// Local-only search (players + teams tables) for the home tabs — no Sorare
// call involved, so it's instant. Sorare-backed search (with a live score)
// lives separately in GlobalPlayerSearch, used on the Live page.
export default function HomeSearch() {
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = query.trim()

    const timeout = setTimeout(async () => {
      if (q.length < 2) {
        setPlayers([])
        setTeams([])
        setLoading(false)
        return
      }

      setLoading(true)
      const [{ data: playersData }, { data: teamsData }] = await Promise.all([
        supabase
          .from('players')
          .select('id, name, team, role_fantastats, price_current')
          .ilike('name', `%${q}%`)
          .order('name')
          .limit(5),
        supabase.from('teams').select('id, name, league_position').ilike('name', `%${q}%`).order('name').limit(3),
      ])
      setPlayers(playersData ?? [])
      setTeams(teamsData ?? [])
      setLoading(false)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  }, [query])

  const trimmed = query.trim()
  const showResults = trimmed.length >= 2
  const hasResults = players.length > 0 || teams.length > 0

  return (
    <div className="home-search">
      <input
        type="search"
        placeholder="Cerca giocatori o squadre…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {showResults && (
        <div className="home-search-results card">
          {loading && <p className="status-text">Cerco…</p>}

          {!loading && !hasResults && <p className="status-text">Nessun risultato per "{trimmed}"</p>}

          {!loading && players.length > 0 && (
            <div className="home-search-group">
              <span className="home-search-group-label">Giocatori</span>
              <ul>
                {players.map((p) => (
                  <li key={p.id}>
                    <Link to={`/players/${p.id}`} className="home-search-result">
                      <span className="home-search-result-name">{p.name}</span>
                      <span className="home-search-result-meta">
                        {p.team} · {p.role_fantastats}
                      </span>
                      <span className="home-search-result-price">{p.price_current}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!loading && teams.length > 0 && (
            <div className="home-search-group">
              <span className="home-search-group-label">Squadre</span>
              <ul>
                {teams.map((t) => (
                  <li key={t.id}>
                    <Link to={`/teams/${encodeURIComponent(t.name)}`} className="home-search-result">
                      <span className="home-search-result-name">{t.name}</span>
                      <span className="home-search-result-meta">
                        {t.league_position != null ? `${t.league_position}°` : '—'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
