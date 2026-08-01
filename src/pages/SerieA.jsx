import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { usePageTitle } from '../hooks/usePageTitle'
import './SerieA.css'

const MIN_GAMEWEEK = 1
const MAX_GAMEWEEK = 38

function formatMatchDate(iso) {
  return new Date(iso).toLocaleDateString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatGoalDifference(gd) {
  if (gd == null) return '—'
  return gd > 0 ? `+${gd}` : `${gd}`
}

function rowZoneClass(position, total) {
  if (total <= 0) return ''
  if (position > total - 3) return 'zone-relegation'
  if (position <= 4) return 'zone-champions'
  if (position <= 6) return 'zone-europa'
  return ''
}

export default function SerieA() {
  usePageTitle('Serie A')

  const [tab, setTab] = useState('classifica')

  const [standings, setStandings] = useState([])
  const [standingsLoading, setStandingsLoading] = useState(true)
  const [standingsError, setStandingsError] = useState(null)

  const [gameweek, setGameweek] = useState(MIN_GAMEWEEK)
  const [fixtures, setFixtures] = useState([])
  const [fixturesLoading, setFixturesLoading] = useState(true)
  const [fixturesError, setFixturesError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setStandingsLoading(true)
      setStandingsError(null)

      const { data, error } = await supabase
        .from('serie_a_standings')
        .select('*')
        .order('position', { ascending: true })

      if (cancelled) return

      if (error) {
        setStandingsError('Impossibile caricare la classifica.')
        setStandingsLoading(false)
        return
      }

      setStandings(data ?? [])
      setStandingsLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setFixturesLoading(true)
      setFixturesError(null)

      const { data, error } = await supabase
        .from('serie_a_fixtures')
        .select('*')
        .eq('gameweek', gameweek)
        .order('match_date', { ascending: true })

      if (cancelled) return

      if (error) {
        setFixturesError('Impossibile caricare il calendario.')
        setFixturesLoading(false)
        return
      }

      setFixtures(data ?? [])
      setFixturesLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [gameweek])

  const totalStandings = standings.length

  return (
    <div className="serie-a-page">
      <h1>Serie A</h1>

      <div className="serie-a-tabs">
        <button
          type="button"
          className={'serie-a-tab' + (tab === 'classifica' ? ' active' : '')}
          onClick={() => setTab('classifica')}
        >
          Classifica
        </button>
        <button
          type="button"
          className={'serie-a-tab' + (tab === 'calendario' ? ' active' : '')}
          onClick={() => setTab('calendario')}
        >
          Calendario
        </button>
      </div>

      {tab === 'classifica' && (
        <section className="card serie-a-section">
          {standingsLoading && <p className="status-text">Caricamento…</p>}
          {!standingsLoading && standingsError && <p className="error-text">{standingsError}</p>}
          {!standingsLoading && !standingsError && totalStandings === 0 && (
            <p className="status-text">Classifica non ancora disponibile.</p>
          )}

          {!standingsLoading && !standingsError && totalStandings > 0 && (
            <div className="serie-a-table-wrap">
              <table className="serie-a-table">
                <thead>
                  <tr>
                    <th>Pos</th>
                    <th>Squadra</th>
                    <th>G</th>
                    <th>V</th>
                    <th>P</th>
                    <th>S</th>
                    <th>GF</th>
                    <th>GS</th>
                    <th>DR</th>
                    <th>Punti</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row) => (
                    <tr key={row.id} className={rowZoneClass(row.position, totalStandings)}>
                      <td>{row.position}</td>
                      <td>
                        <Link to={`/teams/${encodeURIComponent(row.team)}`}>{row.team}</Link>
                      </td>
                      <td>{row.played}</td>
                      <td>{row.won}</td>
                      <td>{row.drawn}</td>
                      <td>{row.lost}</td>
                      <td>{row.goals_for}</td>
                      <td>{row.goals_against}</td>
                      <td>{formatGoalDifference(row.goal_difference)}</td>
                      <td className="serie-a-points">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'calendario' && (
        <section className="card serie-a-section">
          <div className="serie-a-gameweek-selector">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={gameweek <= MIN_GAMEWEEK}
              onClick={() => setGameweek((g) => Math.max(MIN_GAMEWEEK, g - 1))}
            >
              ‹
            </button>
            <span className="serie-a-gameweek-label">Giornata {gameweek}</span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={gameweek >= MAX_GAMEWEEK}
              onClick={() => setGameweek((g) => Math.min(MAX_GAMEWEEK, g + 1))}
            >
              ›
            </button>
          </div>

          {fixturesLoading && <p className="status-text">Caricamento…</p>}
          {!fixturesLoading && fixturesError && <p className="error-text">{fixturesError}</p>}
          {!fixturesLoading && !fixturesError && fixtures.length === 0 && (
            <p className="status-text">Nessuna partita per questa giornata.</p>
          )}

          {!fixturesLoading && !fixturesError && fixtures.length > 0 && (
            <ul className="serie-a-fixtures">
              {fixtures.map((fixture) => {
                const isFinished =
                  fixture.status === 'finished' || (fixture.home_score != null && fixture.away_score != null)

                return (
                  <li key={fixture.id} className="serie-a-fixture-row">
                    <div className="serie-a-fixture-teams">
                      <Link to={`/teams/${encodeURIComponent(fixture.home_team)}`}>{fixture.home_team}</Link>
                      <span className="serie-a-fixture-sep">—</span>
                      <Link to={`/teams/${encodeURIComponent(fixture.away_team)}`}>{fixture.away_team}</Link>
                    </div>
                    <div className="serie-a-fixture-info">
                      {isFinished ? (
                        <span className="serie-a-fixture-score">
                          {fixture.home_score} - {fixture.away_score}
                        </span>
                      ) : (
                        <span className="serie-a-fixture-date">
                          {fixture.match_date ? formatMatchDate(fixture.match_date) : 'Data da definire'}
                        </span>
                      )}
                      {fixture.status === 'live' && <span className="live-dot" aria-label="In corso" />}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
