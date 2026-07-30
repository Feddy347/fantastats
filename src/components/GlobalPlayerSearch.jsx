import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { calculateScore } from '../lib/scoreEngine'
import PlayerBreakdownModal from './PlayerBreakdownModal'
import './GlobalPlayerSearch.css'

const MATCH_STATUS_LABELS = { upcoming: 'Non iniziata', live: 'In corso', finished: 'Finita' }

// Searches every Serie A player (not just the ones the user has fielded)
// and computes a live score straight from player_match_stats — reusing
// player_match_scores wouldn't work here since that table only has rows
// for players someone actually started in a category lineup this GW.
// The player's own primary role stands in for "slot role" (no lineup
// context to derive one from), so the ×1.3 multiplier won't apply here;
// good enough for "how is this player doing," not meant to match exactly
// what they'd score in a specific fielded lineup.
export default function GlobalPlayerSearch({ gameweekId }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState(null)

  async function handleSearch(e) {
    e.preventDefault()
    const q = query.trim()
    setSearched(true)
    if (q.length < 2) {
      setResults([])
      return
    }

    setLoading(true)

    const { data: players } = await supabase.from('players').select('*').ilike('name', `%${q}%`).limit(20)

    if (!gameweekId || !players || players.length === 0) {
      setResults((players ?? []).map((p) => ({ ...p, score: null, matchStatus: 'upcoming' })))
      setLoading(false)
      return
    }

    const { data: matches } = await supabase
      .from('matches')
      .select('id, home_team, away_team, status')
      .eq('gameweek_id', gameweekId)

    const matchByTeam = new Map()
    ;(matches ?? []).forEach((m) => {
      matchByTeam.set(m.home_team, m)
      matchByTeam.set(m.away_team, m)
    })

    const enriched = await Promise.all(
      players.map(async (p) => {
        const match = matchByTeam.get(p.team)
        if (!match) return { ...p, score: null, matchStatus: 'upcoming' }

        const { data: stats } = await supabase
          .from('player_match_stats')
          .select('*')
          .eq('match_id', match.id)
          .eq('player_id', p.id)
          .maybeSingle()

        if (!stats) return { ...p, score: null, breakdown: null, matchStatus: match.status }

        const primaryRole = (p.role_fantastats ?? '').split(';')[0].trim() || null
        const result = calculateScore(stats, p.role_fantastats, primaryRole)
        return { ...p, score: result.totalScore, breakdown: result.breakdown, matchStatus: match.status }
      })
    )

    setResults(enriched)
    setLoading(false)
  }

  return (
    <div className="global-search card">
      <form onSubmit={handleSearch} className="global-search-form">
        <input
          type="search"
          placeholder="Cerca un giocatore di Serie A…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary" disabled={loading}>
          {loading ? 'Cerco…' : 'Cerca'}
        </button>
      </form>

      {searched && !loading && results.length === 0 && <p className="status-text">Nessun giocatore trovato.</p>}

      {results.length > 0 && (
        <ul className="player-rows">
          {results.map((p) => (
            <li key={p.id} className="player-row card global-search-result">
              <button type="button" className="global-search-result-btn" onClick={() => setSelectedPlayer(p)}>
                <div className="player-main">
                  <span className="player-name">{p.name}</span>
                  <span className="player-team">{p.team}</span>
                </div>
                <div className="player-roles">
                  <span className="role-tag">{p.role_fantastats}</span>
                </div>
                <div className="player-meta">
                  <span>{MATCH_STATUS_LABELS[p.matchStatus] ?? p.matchStatus}</span>
                  <strong>{p.score != null ? p.score.toFixed(1) : '—'}</strong>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedPlayer && (
        <PlayerBreakdownModal
          playerName={selectedPlayer.name}
          role={selectedPlayer.role_fantastats}
          totalScore={selectedPlayer.score}
          breakdown={selectedPlayer.breakdown ?? {}}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  )
}
