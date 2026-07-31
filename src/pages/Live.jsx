import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabaseClient'
import { useRealtimeScores } from '../hooks/useRealtimeScores'
import { getCurrentGameweek } from '../lib/gameweek'
import { abbreviatePlayerName } from '../lib/format'
import LiveLeagueTile from '../components/LiveLeagueTile'
import FlashValue from '../components/FlashValue'
import GlobalPlayerSearch from '../components/GlobalPlayerSearch'
import { usePageTitle } from '../hooks/usePageTitle'
import './Live.css'

function deriveTileTotals(tile) {
  const total_score = tile.players.reduce((sum, p) => sum + (p.score ?? 0), 0)
  const completed_count = tile.players.filter((p) => p.score != null && !p.is_live).length
  return { ...tile, total_score, completed_count }
}

function formatCountdown(ms) {
  if (ms <= 0) return 'Deadline superato'
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}g ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function scoreClass(score) {
  if (score == null) return ''
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

function LiveTile({ tile, onOpen }) {
  const isLiveNow = tile.players.some((p) => p.is_live)

  return (
    <button type="button" className={'live-tile card' + (isLiveNow ? ' live-now' : '')} onClick={onOpen}>
      <div className="live-tile-header">
        <h2>{tile.category_name}</h2>
        <span className="live-tile-rank">{tile.rank}°</span>
      </div>

      <FlashValue as="div" value={tile.total_score} className="live-tile-total">
        {tile.total_score.toFixed(1)}
      </FlashValue>

      <ul className="live-tile-players">
        {tile.players.map((p) => (
          <li key={p.player_id}>
            <span className="role-tag">{p.role}</span>
            <span className="live-tile-player-name">{abbreviatePlayerName(p.name)}</span>
            {p.is_live && <span className="live-dot" aria-label="In corso" />}
            <FlashValue value={p.score} className={'live-tile-score ' + scoreClass(p.score)}>
              {p.score != null ? p.score.toFixed(1) : '—'}
            </FlashValue>
          </li>
        ))}
      </ul>

      <div className="live-tile-progress">
        <div className="live-tile-progress-bar">
          <div
            className="live-tile-progress-fill"
            style={{ width: `${(tile.completed_count / Math.max(1, tile.total_count)) * 100}%` }}
          />
        </div>
        <span>
          {tile.completed_count}/{tile.total_count} completati
        </span>
      </div>
    </button>
  )
}

export default function Live() {
  usePageTitle('Live')
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [gameweek, setGameweek] = useState(null)
  const [tiles, setTiles] = useState([])
  const [categorySlugById, setCategorySlugById] = useState({})
  const [myLeagues, setMyLeagues] = useState([])
  const [lastCompleted, setLastCompleted] = useState(null)
  const [lastCompletedMatches, setLastCompletedMatches] = useState([])
  const [now, setNow] = useState(() => Date.now())

  const isLive = gameweek?.status === 'live'
  const scoresMap = useRealtimeScores(isLive ? gameweek.id : null)
  const debounceRef = useRef(null)

  async function fetchTiles(gw) {
    const { data, error } = await supabase.rpc('get_live_scores', {
      p_user_id: user.id,
      p_gameweek_id: gw.id,
    })
    if (error) {
      console.error(error)
      setTiles([])
      return
    }
    setTiles((data ?? []).map(deriveTileTotals))
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const gw = await getCurrentGameweek()
      if (cancelled) return
      setGameweek(gw)

      if (gw && gw.status === 'live') {
        await fetchTiles(gw)

        const [{ data: leagueLineups }, { data: categories }] = await Promise.all([
          supabase
            .from('league_lineups')
            .select('league_id, leagues(*)')
            .eq('user_id', user.id)
            .eq('gameweek_id', gw.id),
          supabase.from('categories').select('id, slug'),
        ])
        if (!cancelled) {
          setMyLeagues((leagueLineups ?? []).map((r) => r.leagues).filter(Boolean))
          const slugMap = {}
          ;(categories ?? []).forEach((c) => {
            slugMap[c.id] = c.slug
          })
          setCategorySlugById(slugMap)
        }
      } else {
        setTiles([])
        setMyLeagues([])
        const { data: completed } = await supabase
          .from('gameweeks')
          .select('*')
          .eq('status', 'completed')
          .order('number', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (cancelled) return
        setLastCompleted(completed ?? null)

        if (completed) {
          const { data: matches } = await supabase
            .from('matches')
            .select('*')
            .eq('gameweek_id', completed.id)
            .order('starts_at', { ascending: true })
          if (!cancelled) setLastCompletedMatches(matches ?? [])
        }
      }

      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  // Keep the deadline countdown fresh when there's no live match to watch.
  useEffect(() => {
    if (isLive) return
    const interval = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(interval)
  }, [isLive])

  // Instant per-tile patch from realtime (score/total/completed — all
  // derivable from the tile's own players), plus a debounced full refetch
  // to keep "rank" true, since ranking needs other users' rosters too.
  useEffect(() => {
    if (!isLive || Object.keys(scoresMap).length === 0) return

    function patchTiles() {
      setTiles((prev) =>
        prev.map((tile) => {
          let changed = false
          const players = tile.players.map((p) => {
            const update = scoresMap[p.player_id]
            if (!update) return p
            changed = true
            return { ...p, score: update.total_score, is_live: !update.is_final }
          })
          return changed ? deriveTileTotals({ ...tile, players }) : tile
        })
      )
    }

    patchTiles()

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (gameweek) fetchTiles(gameweek)
    }, 2500)

    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoresMap, isLive])

  if (loading) return <p className="status-text">Caricamento…</p>

  if (!isLive) {
    return (
      <div className="live-page">
        <h1>Live</h1>

        <GlobalPlayerSearch gameweekId={gameweek?.id} />

        <div className="live-empty card">
          <p className="status-text">Nessuna partita in corso</p>
          {gameweek && (
            <div className="live-next">
              <span>Prossima: Giornata {gameweek.number}</span>
              <span className="deadline-info">{formatCountdown(new Date(gameweek.deadline) - now)}</span>
            </div>
          )}
        </div>

        {lastCompleted && (
          <div className="card live-last-gw">
            <h2>Ultima giornata — GW{lastCompleted.number}</h2>
            {lastCompletedMatches.length === 0 ? (
              <p className="status-text">Nessun risultato disponibile.</p>
            ) : (
              <ul className="live-results">
                {lastCompletedMatches.map((m) => (
                  <li key={m.id}>
                    <span>{m.home_team}</span>
                    <span className="live-results-score">
                      {m.home_score ?? '-'} : {m.away_score ?? '-'}
                    </span>
                    <span>{m.away_team}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="live-page">
      <h1>Live — Giornata {gameweek.number}</h1>

      <GlobalPlayerSearch gameweekId={gameweek.id} />

      {tiles.length === 0 && myLeagues.length === 0 ? (
        <p className="status-text">Non hai formazioni schierate per questa giornata.</p>
      ) : (
        <div className="live-tiles">
          {tiles.map((tile) => (
            <LiveTile
              key={tile.category_id}
              tile={tile}
              onOpen={() => navigate(`/live/category/${categorySlugById[tile.category_id] ?? tile.category_id}`)}
            />
          ))}
          {myLeagues.map((league) => (
            <LiveLeagueTile
              key={league.id}
              league={league}
              gameweek={gameweek}
              userId={user.id}
              onOpen={() => navigate(`/live/league/${league.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
