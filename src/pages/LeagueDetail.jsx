import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import { getCurrentGameweek, isLineupLocked, formatDeadline } from '../lib/gameweek'
import { getLeagueModuleSystem, getLeagueModule, playerRolesFor } from '../lib/leagueModules'
import ConfirmDialog from '../components/ConfirmDialog'
import LeagueCalendarTab from '../components/LeagueCalendarTab'
import LeagueStandingsTab from '../components/LeagueStandingsTab'
import { usePageTitle } from '../hooks/usePageTitle'
import './Categories.css'
import './CategoryDetail.css'
import './LeagueDetail.css'

const STATUS_LABELS = { setup: 'In allestimento', active: 'In corso', completed: 'Conclusa' }
const COMPETITION_LABELS = {
  direct_serie_a: 'Scontri diretti + Serie A (3-1-0)',
  direct_vote_sum: 'Scontri diretti + Somma voti',
  royal_rumble_seria: 'Royal rumble + Serie A (3-1-0 vs tutti)',
  royal_rumble_f1: 'Royal rumble + Formula 1 (punti posizione)',
}
const ROLE_ORDER = ['POR', 'Por', 'P', 'DC', 'Dc', 'D', 'T', 'Dd', 'Ds', 'C', 'M', 'ES', 'E', 'W', 'Tq', 'T', 'B', 'ATT', 'A', 'Pc']

export default function LeagueDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [league, setLeague] = useState(null)
  usePageTitle(league?.name ?? 'Lega')
  const [members, setMembers] = useState([])
  const [roster, setRoster] = useState([])
  const [gameweek, setGameweek] = useState(null)
  const [lineup, setLineup] = useState(null)
  const [rosterCounts, setRosterCounts] = useState({})
  const [tab, setTab] = useState('lineup')
  const [removeTarget, setRemoveTarget] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [starting, setStarting] = useState(false)

  async function loadAll() {
    setLoading(true)
    setError(null)

    const { data: leagueData, error: leagueError } = await supabase
      .from('leagues')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (leagueError || !leagueData) {
      setError('Lega non trovata.')
      setLoading(false)
      return
    }

    const gw = await getCurrentGameweek()

    const [membersRes, rosterRes, allRosterRes, lineupRes] = await Promise.all([
      supabase.from('league_members').select('*, profiles(username)').eq('league_id', id),
      supabase.from('league_rosters').select('*, players(*)').eq('league_id', id).eq('user_id', user.id),
      supabase.from('league_rosters').select('user_id').eq('league_id', id),
      gw
        ? supabase
            .from('league_lineups')
            .select('*, league_lineup_players(*, players(name, team))')
            .eq('league_id', id)
            .eq('user_id', user.id)
            .eq('gameweek_id', gw.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    setLeague(leagueData)
    setMembers(membersRes.data ?? [])
    setRoster(rosterRes.data ?? [])
    setGameweek(gw)
    setLineup(lineupRes.data ?? null)

    const counts = {}
    ;(allRosterRes.data ?? []).forEach((r) => {
      counts[r.user_id] = (counts[r.user_id] ?? 0) + 1
    })
    setRosterCounts(counts)

    setLoading(false)
  }

  useEffect(() => {
    async function run() {
      await loadAll()
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user.id])

  const myMembership = members.find((m) => m.user_id === user.id)
  const isAdmin = Boolean(myMembership?.is_admin) || league?.admin_id === user.id
  const isMember = Boolean(myMembership)
  const locked = isLineupLocked(gameweek)

  const moduleSystem = useMemo(() => (league ? getLeagueModuleSystem(league) : null), [league])

  const rosterGroups = useMemo(() => {
    if (!moduleSystem) return []
    const byRole = {}
    roster.forEach((r) => {
      const primary = playerRolesFor(r.players, moduleSystem.roleField)[0] ?? 'Altro'
      if (!byRole[primary]) byRole[primary] = []
      byRole[primary].push(r)
    })
    const ordered = [...ROLE_ORDER.filter((r) => byRole[r]), ...Object.keys(byRole).filter((r) => !ROLE_ORDER.includes(r))]
    return ordered.map((role) => ({ role, rows: byRole[role] }))
  }, [roster, moduleSystem])

  const allRostersComplete = league && members.length > 0 && members.every((m) => (rosterCounts[m.user_id] ?? 0) >= league.roster_size)
  const canStartAuction = isAdmin && league?.status === 'setup' && league?.market_type === 'auction' && members.length >= 6
  const canStartSeason = isAdmin && league?.status === 'setup' && members.length >= 6 && allRostersComplete

  async function handleRemoveMember() {
    if (!removeTarget) return
    setActionError(null)
    const { error: removeError } = await supabase
      .from('league_members')
      .delete()
      .eq('league_id', id)
      .eq('user_id', removeTarget.user_id)

    setRemoveTarget(null)
    if (removeError) {
      setActionError('Impossibile rimuovere il partecipante.')
      return
    }
    await loadAll()
  }

  async function handlePromote(member) {
    setActionError(null)
    const { error: promoteError } = await supabase.rpc('set_league_admin', {
      p_league_id: Number(id),
      p_target_user_id: member.user_id,
      p_is_admin: !member.is_admin,
    })
    if (promoteError) {
      setActionError('Impossibile aggiornare i permessi di amministratore.')
      return
    }
    await loadAll()
  }

  async function handleStartSeason() {
    setStarting(true)
    setActionError(null)

    const { error: calendarError } = await supabase.rpc('generate_league_calendar', { p_league_id: Number(id) })
    if (calendarError) {
      setStarting(false)
      setActionError(
        calendarError.message.includes('Not enough remaining gameweeks')
          ? 'Non ci sono abbastanza giornate rimaste per generare il calendario.'
          : 'Impossibile generare il calendario.'
      )
      return
    }

    const { error: updateError } = await supabase.from('leagues').update({ status: 'active' }).eq('id', id)
    setStarting(false)
    if (updateError) {
      setActionError('Impossibile avviare la stagione.')
      return
    }
    await loadAll()
  }

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  if (!isMember) {
    return (
      <div className="category-detail">
        <Link to="/leagues" className="back-link">
          ‹ Leghe
        </Link>
        <p className="status-text">Non fai parte di questa lega.</p>
      </div>
    )
  }

  return (
    <div className="category-detail">
      <Link to="/leagues" className="back-link">
        ‹ Leghe
      </Link>

      <div className="category-detail-header card">
        <div className="category-card-header">
          <h1>{league.name}</h1>
          {isAdmin && <span className="badge-tag">Admin</span>}
        </div>
        <div className="category-stats">
          <span>{members.length} partecipanti</span>
          <span>{STATUS_LABELS[league.status]}</span>
          <span>{myMembership.league_credits} crediti</span>
        </div>
      </div>

      <div className="category-tabs">
        {['lineup', 'classifica', 'calendario', 'rosa', 'impostazioni'].map((t) => (
          <button
            key={t}
            type="button"
            className={'category-tab' + (tab === t ? ' active' : '')}
            onClick={() => setTab(t)}
          >
            {{ lineup: 'Formazione', classifica: 'Classifica', calendario: 'Calendario', rosa: 'Rosa', impostazioni: 'Impostazioni' }[t]}
          </button>
        ))}
      </div>

      {tab === 'lineup' && (
        <div className="lineup-summary card">
          {!gameweek ? (
            <p className="status-text">Nessuna giornata disponibile.</p>
          ) : (
            <>
              <div className="category-card-header">
                <h2>Formazione — Giornata {gameweek.number}</h2>
              </div>
              {locked ? (
                <p className="error-text">Formazione bloccata — la giornata è in corso.</p>
              ) : (
                <span className="deadline-info">Deadline: {formatDeadline(gameweek)}</span>
              )}

              {lineup ? (
                <>
                  <p className="lineup-summary-module">{getLeagueModule(moduleSystem, lineup.module).label}</p>
                  <ul className="lineup-summary-players">
                    {(lineup.league_lineup_players ?? [])
                      .filter((lp) => lp.slot_type === 'starter')
                      .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))
                      .map((lp) => (
                        <li key={lp.id}>
                          <span className="role-tag">{lp.slot_role}</span> {lp.players?.name}
                        </li>
                      ))}
                  </ul>
                  {!locked && (
                    <Link to={`/leagues/${id}/lineup`} className="btn btn-secondary btn-block">
                      Modifica formazione
                    </Link>
                  )}
                </>
              ) : (
                !locked && (
                  <Link to={`/leagues/${id}/lineup`} className="btn btn-primary btn-block">
                    Schiera formazione
                  </Link>
                )
              )}
            </>
          )}
        </div>
      )}

      {tab === 'classifica' && (
        <section>
          <LeagueStandingsTab league={league} currentUserId={user.id} />
        </section>
      )}

      {tab === 'calendario' && (
        <section>
          <LeagueCalendarTab league={league} currentGameweekId={gameweek?.id} />
        </section>
      )}

      {tab === 'rosa' && (
        <section>
          <div className="roster-header">
            <h2>
              Rosa ({roster.length}/{league.roster_size})
            </h2>
            <span className="summary-value">{myMembership.league_credits} crediti</span>
          </div>

          <Link to={`/leagues/${id}/market`} className="btn btn-primary btn-block">
            {league.market_type === 'credits' ? 'Vai al mercato' : 'Mercato di riparazione (busta chiusa)'}
          </Link>

          {roster.length === 0 ? (
            <p className="status-text">Nessun giocatore in rosa.</p>
          ) : (
            rosterGroups.map((group) => (
              <div key={group.role} className="roster-group">
                <h3>
                  {group.role} <span className="roster-group-count">({group.rows.length})</span>
                </h3>
                <ul className="player-rows">
                  {group.rows.map((r) => (
                    <li key={r.id} className="player-row card">
                      <div className="player-main">
                        <span className="player-name">{r.players.name}</span>
                        <span className="player-team">{r.players.team}</span>
                      </div>
                      <div className="player-meta">
                        <span>
                          Acquisto: <strong>{r.purchase_price}</strong>
                        </span>
                        <span>
                          Attuale: <strong>{r.players.price_current}</strong>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}

      {tab === 'impostazioni' && (
        <section className="league-settings">
          <div className="card league-settings-card">
            <h2>Impostazioni</h2>
            <div className="settings-row">
              <span>Codice invito</span>
              <button
                type="button"
                className="invite-code-chip"
                onClick={() => navigator.clipboard?.writeText(league.invite_code)}
                title="Copia"
              >
                {league.invite_code}
              </button>
            </div>
            <div className="settings-row">
              <span>Formazione</span>
              <span>{league.formation_type}</span>
            </div>
            <div className="settings-row">
              <span>Sistema ruoli</span>
              <span>{league.role_system}</span>
            </div>
            <div className="settings-row">
              <span>Formato competizione</span>
              <span>{COMPETITION_LABELS[league.competition_format] ?? league.competition_format}</span>
            </div>
            <div className="settings-row">
              <span>Mercato</span>
              <span>{league.market_type === 'auction' ? 'Asta in presenza' : 'Crediti'}</span>
            </div>
            <div className="settings-row">
              <span>Dimensione rosa</span>
              <span>{league.roster_size}</span>
            </div>
            <div className="settings-row">
              <span>Crediti iniziali</span>
              <span>{league.starting_credits}</span>
            </div>
          </div>

          {isAdmin && (
            <div className="card league-settings-card">
              <h2>Gestione</h2>
              {actionError && <p className="error-text">{actionError}</p>}

              {members.length < 6 && (
                <p className="category-warning">Servono almeno 6 partecipanti per iniziare ({members.length}/6).</p>
              )}

              {canStartAuction && (
                <button type="button" className="btn btn-primary btn-block" onClick={() => navigate(`/leagues/${id}/auction`)}>
                  Avvia asta
                </button>
              )}

              {league.status === 'setup' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  disabled={!canStartSeason || starting}
                  onClick={handleStartSeason}
                >
                  {starting ? 'Avvio…' : 'Avvia stagione'}
                </button>
              )}
              {league.status === 'setup' && !allRostersComplete && (
                <p className="category-warning">Non tutti i partecipanti hanno completato la rosa.</p>
              )}
            </div>
          )}

          <div className="card league-settings-card">
            <h2>Partecipanti</h2>
            <ul className="player-rows">
              {members.map((m) => (
                <li key={m.id} className="player-row card">
                  <div className="player-main">
                    <span className="player-name">
                      {m.profiles?.username ?? '—'}
                      {(m.is_admin || m.user_id === league.admin_id) && <span className="badge-tag"> Admin</span>}
                    </span>
                    <span className="player-team">{m.team_name}</span>
                  </div>
                  <div className="player-meta">
                    <span>
                      Rosa: <strong>{rosterCounts[m.user_id] ?? 0}</strong>/{league.roster_size}
                    </span>
                    <span>
                      Crediti: <strong>{m.league_credits}</strong>
                    </span>
                  </div>
                  {isAdmin && m.user_id !== user.id && (
                    <div className="player-actions">
                      {m.user_id !== league.admin_id && (
                        <button type="button" className="btn btn-secondary" onClick={() => handlePromote(m)}>
                          {m.is_admin ? 'Rimuovi admin' : 'Rendi admin'}
                        </button>
                      )}
                      {league.status === 'setup' && (
                        <button type="button" className="btn btn-secondary" onClick={() => setRemoveTarget(m)}>
                          Rimuovi
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Rimuovere partecipante?"
        confirmLabel="Rimuovi"
        onConfirm={handleRemoveMember}
        onCancel={() => setRemoveTarget(null)}
      >
        {removeTarget && <span>{removeTarget.profiles?.username} verrà rimosso dalla lega.</span>}
      </ConfirmDialog>
    </div>
  )
}
