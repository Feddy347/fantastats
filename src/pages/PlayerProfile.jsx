import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import { calculateScore } from '../lib/scoreEngine'
import { fetchPlayerRecentSerieAGames } from '../lib/sorareStats'
import { buildTeamsByName, isPlayerEligible } from '../lib/categoryPool'
import { teamNamesMatch } from '../lib/teamNames'
import { BREAKDOWN_ICONS, BREAKDOWN_LABELS } from '../lib/breakdownIcons'
import ConfirmDialog from '../components/ConfirmDialog'
import { usePageTitle } from '../hooks/usePageTitle'
import './PlayerProfile.css'

function scoreClass(score) {
  if (score == null) return ''
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

function formatMatchDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

const AVERAGE_BARS = [
  ['Minuti', 'mins', 90],
  ['Gol', 'goals', 2],
  ['Assist', 'assists', 2],
  ['Passaggi riusciti', 'passes', 60],
  ['Tackle vinti', 'tackles', 6],
  ['Intercetti', 'interceptions', 6],
  ['Duelli vinti', 'duels', 10],
]

const TEAM_COLORS = {
  'Atalanta': { primary: '#1E71B8', secondary: '#000000' },
  'Bologna': { primary: '#1A2F48', secondary: '#A21C26' },
  'Cagliari': { primary: '#6D2C2C', secondary: '#1A2F48' },
  'Como': { primary: '#003DA5', secondary: '#FFFFFF' },
  'Cremonese': { primary: '#D32F2F', secondary: '#808080' },
  'Fiorentina': { primary: '#5B2C8A', secondary: '#FFFFFF' },
  'Frosinone': { primary: '#FFD700', secondary: '#003DA5' },
  'Genoa': { primary: '#9B1B30', secondary: '#003DA5' },
  'Hellas Verona': { primary: '#003DA5', secondary: '#FFD700' },
  'Inter': { primary: '#0068A8', secondary: '#000000' },
  'Juventus': { primary: '#000000', secondary: '#FFFFFF' },
  'Lazio': { primary: '#89CFF0', secondary: '#FFFFFF' },
  'Lecce': { primary: '#FFD700', secondary: '#D32F2F' },
  'Milan': { primary: '#D32F2F', secondary: '#000000' },
  'Monza': { primary: '#D32F2F', secondary: '#FFFFFF' },
  'Napoli': { primary: '#12A0D7', secondary: '#FFFFFF' },
  'Parma': { primary: '#FFD700', secondary: '#003DA5' },
  'Pisa': { primary: '#003DA5', secondary: '#000000' },
  'Roma': { primary: '#8B0000', secondary: '#FFD700' },
  'Sassuolo': { primary: '#00A651', secondary: '#000000' },
  'Torino': { primary: '#8B0000', secondary: '#FFFFFF' },
  'Udinese': { primary: '#000000', secondary: '#FFFFFF' },
  'Venezia': { primary: '#FF6600', secondary: '#004D26' },
}

const DEFAULT_TEAM_COLORS = { primary: '#16a34a', secondary: '#15803d' } // fallback: app's own green accent, for any team not in the map above

export default function PlayerProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile, refreshProfile } = useAuth()

  const [player, setPlayer] = useState(null)
  const [teams, setTeams] = useState([])
  const [categories, setCategories] = useState([])
  const [owned, setOwned] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [games, setGames] = useState([])
  const [gamesLoading, setGamesLoading] = useState(false)
  const [gamesError, setGamesError] = useState(null)

  const [buyOpen, setBuyOpen] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState(null)

  usePageTitle(player?.name || 'Giocatore')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      const [{ data: p, error: pErr }, { data: teamsData }, { data: cats }, { data: ownedRow }] = await Promise.all([
        supabase.from('players').select('*').eq('id', id).maybeSingle(),
        supabase.from('teams').select('*'),
        supabase.from('categories').select('*').eq('is_active', true).eq('is_event', false).order('id'),
        supabase.from('user_players').select('player_id').eq('user_id', user.id).eq('player_id', id).maybeSingle(),
      ])
      if (cancelled) return
      if (pErr || !p) {
        setError('Giocatore non trovato.')
        setLoading(false)
        return
      }
      setPlayer(p)
      setTeams(teamsData ?? [])
      setCategories(cats ?? [])
      setOwned(Boolean(ownedRow))
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [id, user.id])

  useEffect(() => {
    if (!player) return
    let cancelled = false

    async function loadGames() {
      setGamesLoading(true)
      setGamesError(null)

      const { data: mapping } = await supabase
        .from('sorare_player_mapping')
        .select('sorare_slug')
        .eq('player_id', player.id)
        .maybeSingle()

      if (cancelled) return
      if (!mapping?.sorare_slug) {
        setGames([])
        setGamesLoading(false)
        return
      }

      try {
        const recent = await fetchPlayerRecentSerieAGames(mapping.sorare_slug, 5)
        if (!cancelled) setGames(recent)
      } catch {
        if (!cancelled) setGamesError('Statistiche Sorare non disponibili al momento.')
      } finally {
        if (!cancelled) setGamesLoading(false)
      }
    }

    loadGames()
    return () => {
      cancelled = true
    }
  }, [player])

  const teamsByName = useMemo(() => buildTeamsByName(teams), [teams])
  const team = player ? teamsByName[player.team] : null

  // No lineup context here (this is a generic history view, not tied to a
  // specific formation), so the multiplier is computed against the
  // player's own primary role rather than a slot they were actually fielded in.
  const primaryRole = useMemo(() => (player?.role_fantastats ?? '').split(';')[0]?.trim() || null, [player])

  const gameScores = useMemo(
    () => games.map((g) => ({ ...g, score: calculateScore(g.stats, player?.role_fantastats, primaryRole) })),
    [games, player, primaryRole]
  )

  const averages = useMemo(() => {
    if (gameScores.length === 0) return null
    const n = gameScores.length
    const sum = (fn) => gameScores.reduce((acc, g) => acc + fn(g), 0)

    const playedGames = gameScores.filter((g) => g.stats.mins_played > 0)
    const nPer90 = playedGames.length
    const sumPer90 = (fn) =>
      playedGames.reduce((acc, g) => acc + (fn(g) / g.stats.mins_played) * 90, 0)
    const avgPer90 = (fn) => (nPer90 > 0 ? sumPer90(fn) / nPer90 : 0)

    return {
      mins: sum((g) => g.stats.mins_played) / n,
      goals: sum((g) => g.stats.goals) / n,
      assists: sum((g) => g.stats.goal_assist) / n,
      passes: avgPer90((g) => g.stats.accurate_pass),
      tackles: avgPer90((g) => g.stats.won_tackle),
      interceptions: avgPer90((g) => g.stats.interception_won),
      duels: avgPer90((g) => g.stats.duel_won),
      score: sum((g) => g.score.totalScore) / n,
    }
  }, [gameScores])

  async function confirmBuy() {
    setActionPending(true)
    setActionError(null)
    const { error: buyError } = await supabase.rpc('buy_player', { p_player_id: player.id })
    setActionPending(false)
    if (buyError) {
      setActionError(buyError.message.includes('Insufficient credits') ? 'Crediti insufficienti.' : 'Acquisto non riuscito.')
      return
    }
    setBuyOpen(false)
    setOwned(true)
    await refreshProfile()
  }

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error || !player) return <p className="error-text">{error ?? 'Giocatore non trovato.'}</p>

  const credits = profile?.credits ?? 0
  const colors = TEAM_COLORS[player.team] ?? DEFAULT_TEAM_COLORS

  return (
    <div className="player-profile-page page-fade">
      <button type="button" className="btn btn-secondary player-profile-back" onClick={() => navigate(-1)}>
        ← Indietro
      </button>

      <div
        className="player-profile-header card player-profile-header-gradient"
        style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)` }}
      >
        <div className="player-profile-heading">
          <h1>{player.name}</h1>
          <div className="player-profile-meta">
            <Link to={`/teams/${encodeURIComponent(player.team)}`} className="player-profile-team">
              {player.team}
            </Link>
            {player.nationality && <span className="nationality-tag">{player.nationality}</span>}
            {player.birth_year != null && <span>{new Date().getFullYear() - player.birth_year} anni</span>}
          </div>
        </div>

        <div className="player-profile-roles">
          <span className="role-tag" title="Ruolo Classic">
            C: {player.role_classic || '—'}
          </span>
          <span className="role-tag" title="Ruolo Mantra">
            M: {player.role_mantra || '—'}
          </span>
          <span className="role-tag" title="Ruolo Fantastats">
            F: {player.role_fantastats || '—'}
          </span>
        </div>

        <div className="summary-item">
          <span className="summary-label">Quotazione</span>
          <span className="summary-value">{player.price_current}</span>
        </div>

        {owned ? (
          <span className="success-text player-profile-owned">In rosa ✓</span>
        ) : (
          <button type="button" className="btn btn-primary btn-block" onClick={() => setBuyOpen(true)}>
            Acquista — {player.price_current} crediti
          </button>
        )}
      </div>

      <div className="card player-profile-section">
        <h2>Ultime partite</h2>
        {gamesLoading && <p className="status-text">Caricamento statistiche Sorare…</p>}
        {gamesError && <p className="error-text">{gamesError}</p>}
        {!gamesLoading && !gamesError && gameScores.length === 0 && (
          <p className="status-text">Nessuna statistica Sorare disponibile per questo giocatore.</p>
        )}

        {gameScores.length > 0 && (
          <ul className="player-games-list">
            {gameScores.map((g) => {
              const isHome = teamNamesMatch(g.homeTeam, player.team)
              const opponent = isHome ? g.awayTeam : g.homeTeam
              const entries = Object.entries(g.score.breakdown).filter(([, v]) => v !== 0)

              return (
                <li key={g.gameId} className="player-game-card">
                  <div className="player-game-header">
                    <span className="player-game-date">{formatMatchDate(g.date)}</span>
                    <span className="player-game-opponent">
                      {isHome ? 'vs' : '@'} {opponent}
                    </span>
                    <span className="player-game-result">
                      {g.homeScore}-{g.awayScore}
                    </span>
                    {g.live && <span className="live-dot" aria-label="In corso" />}
                    <span className={'player-game-score ' + scoreClass(g.score.totalScore)}>
                      {g.score.totalScore.toFixed(1)}
                    </span>
                  </div>

                  {entries.length > 0 && (
                    <ul className="breakdown-list">
                      {entries.map(([key, value]) => {
                        const iconDef = BREAKDOWN_ICONS[key]
                        const Icon = iconDef?.icon
                        return (
                          <li key={key}>
                            <span className="breakdown-label">
                              {Icon && <Icon size={14} color={iconDef.color} fill={iconDef.fill ?? 'none'} />}
                              {BREAKDOWN_LABELS[key] ?? key}
                            </span>
                            <span className={value > 0 ? 'positive' : 'negative'}>
                              {value > 0 ? `+${value}` : value}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {averages && (
        <div className="card player-profile-section">
          <h2>Statistiche medie per 90 minuti (ultime {gameScores.length} partite)</h2>
          <div className="player-averages">
            {AVERAGE_BARS.map(([label, key, max]) => (
              <div className="player-average-bar" key={key}>
                <span className="player-average-label">{label}</span>
                <div className="player-average-track">
                  <div
                    className="player-average-fill"
                    style={{ width: `${Math.min(100, (averages[key] / max) * 100)}%` }}
                  />
                </div>
                <span className="player-average-value">{averages[key].toFixed(1)}</span>
              </div>
            ))}
            <div className="player-average-total">
              <span className="summary-label">Punteggio Fantastats medio</span>
              <span className={'summary-value ' + scoreClass(averages.score)}>{averages.score.toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="card player-profile-section">
        <h2>Eleggibilità categorie</h2>
        <ul className="eligibility-list">
          {categories.map((c) => {
            const eligible = isPlayerEligible(player, team, c, teams.length)
            return (
              <li key={c.id} className={eligible ? 'eligible' : 'not-eligible'}>
                <span>{c.name}</span>
                <span aria-hidden="true">{eligible ? '✓' : '✗'}</span>
              </li>
            )
          })}
        </ul>
      </div>

      <ConfirmDialog
        open={buyOpen}
        title="Conferma acquisto"
        confirmLabel={actionPending ? 'Acquisto…' : 'Acquista'}
        confirmDisabled={actionPending || credits < player.price_current}
        onConfirm={confirmBuy}
        onCancel={() => {
          setBuyOpen(false)
          setActionError(null)
        }}
      >
        <span>
          {player.name} — <strong>{player.price_current} crediti</strong>
        </span>
        <span>Crediti residui dopo l'acquisto: {credits - player.price_current}</span>
        {credits < player.price_current && <span className="error-text">Crediti insufficienti.</span>}
        {actionError && <span className="error-text">{actionError}</span>}
      </ConfirmDialog>
    </div>
  )
}
