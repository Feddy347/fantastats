import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import { getCurrentGameweek, isLeagueLineupLocked, formatLeagueDeadline } from '../lib/gameweek'
import { getLeagueModuleSystem, getLeagueModule, playerFitsSlot, resolveSlotRole } from '../lib/leagueModules'
import ConfirmDialog from '../components/ConfirmDialog'
import PlayerPickerModal from '../components/PlayerPickerModal'
import { usePageTitle } from '../hooks/usePageTitle'
import './Lineup.css'

export default function LeagueLineup() {
  const { id } = useParams()
  const { user } = useAuth()
  usePageTitle('Formazione')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [league, setLeague] = useState(null)
  const [gameweek, setGameweek] = useState(null)
  const [isMember, setIsMember] = useState(false)
  const [roster, setRoster] = useState([])

  const [moduleId, setModuleId] = useState(null)
  const [slots, setSlots] = useState([])
  const [benchOrder, setBenchOrder] = useState([])
  const [pendingModuleId, setPendingModuleId] = useState(null)
  const [pickerSlot, setPickerSlot] = useState(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const moduleSystem = useMemo(() => (league ? getLeagueModuleSystem(league) : null), [league])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const { data: leagueData, error: leagueError } = await supabase
        .from('leagues')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (cancelled) return

      if (leagueError || !leagueData) {
        setError('Lega non trovata.')
        setLoading(false)
        return
      }

      const gw = await getCurrentGameweek()
      if (cancelled) return

      if (!gw) {
        setError('Nessuna giornata disponibile al momento.')
        setLoading(false)
        return
      }

      const system = getLeagueModuleSystem(leagueData)

      const [memberRes, rosterRes, lineupRes] = await Promise.all([
        supabase.from('league_members').select('id').eq('league_id', id).eq('user_id', user.id).maybeSingle(),
        supabase.from('league_rosters').select('*, players(*)').eq('league_id', id).eq('user_id', user.id),
        supabase
          .from('league_lineups')
          .select('*, league_lineup_players(*)')
          .eq('league_id', id)
          .eq('user_id', user.id)
          .eq('gameweek_id', gw.id)
          .maybeSingle(),
      ])

      if (cancelled) return

      setLeague(leagueData)
      setGameweek(gw)
      setIsMember(Boolean(memberRes.data))
      setRoster(rosterRes.data ?? [])

      const lineup = lineupRes.data
      const emptySlots = Array(system.starterCount).fill(null)

      if (lineup) {
        setModuleId(lineup.module)
        const starters = Array(system.starterCount).fill(null)
        const bench = []
        ;(lineup.league_lineup_players ?? [])
          .slice()
          .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))
          .forEach((lp) => {
            if (lp.slot_type === 'starter' && lp.slot_position >= 1 && lp.slot_position <= system.starterCount) {
              starters[lp.slot_position - 1] = lp.player_id
            } else if (lp.slot_type === 'bench') {
              bench.push(lp.player_id)
            }
          })
        setSlots(starters)
        setBenchOrder(bench)
      } else {
        setModuleId(system.defaultModuleId)
        setSlots(emptySlots)
        setBenchOrder([])
      }

      setSaveError(null)
      setSaveSuccess(false)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [id, user.id])

  const playersById = useMemo(() => {
    const map = {}
    roster.forEach((r) => {
      map[r.player_id] = r.players
    })
    return map
  }, [roster])

  const activeModule = moduleSystem && moduleId ? getLeagueModule(moduleSystem, moduleId) : null
  const locked = isLeagueLineupLocked(gameweek, league)
  const deadlineLabel = formatLeagueDeadline(gameweek, league)

  const startersSet = useMemo(() => new Set(slots.filter(Boolean)), [slots])

  const benchEligibleIds = useMemo(
    () => roster.filter((r) => !startersSet.has(r.player_id)).map((r) => r.player_id),
    [roster, startersSet]
  )

  const displayedBench = useMemo(() => {
    const eligibleSet = new Set(benchEligibleIds)
    const kept = benchOrder.filter((pid) => eligibleSet.has(pid))
    const keptSet = new Set(kept)
    const added = benchEligibleIds.filter((pid) => !keptSet.has(pid))
    return [...kept, ...added]
  }, [benchOrder, benchEligibleIds])

  const pickerRoles = pickerSlot != null && activeModule ? activeModule.slots[pickerSlot].roles : null
  const pickerCurrentPlayerId = pickerSlot != null ? slots[pickerSlot] : null

  function computePickerPlayers() {
    if (!pickerRoles || !moduleSystem) return []
    const excludeIds = new Set(slots.filter((pid, idx) => pid != null && idx !== pickerSlot))
    return roster
      .filter((r) => !excludeIds.has(r.player_id) && playerFitsSlot(r.players, moduleSystem.roleField, pickerRoles))
      .map((r) => r.players)
  }
  const pickerPlayers = computePickerPlayers()

  function requestModuleChange(newModuleId) {
    if (!moduleSystem || newModuleId === moduleId || locked) return
    if (slots.some(Boolean)) {
      setPendingModuleId(newModuleId)
    } else {
      setModuleId(newModuleId)
      setSlots(Array(moduleSystem.starterCount).fill(null))
    }
  }

  function confirmModuleChange() {
    setModuleId(pendingModuleId)
    setSlots(Array(moduleSystem.starterCount).fill(null))
    setPendingModuleId(null)
  }

  function handleSelectPlayer(playerId) {
    setSlots((prev) => {
      const next = [...prev]
      next[pickerSlot] = playerId
      return next
    })
    setPickerSlot(null)
  }

  function handleRemovePlayer() {
    setSlots((prev) => {
      const next = [...prev]
      next[pickerSlot] = null
      return next
    })
    setPickerSlot(null)
  }

  function moveBench(playerId, direction) {
    const idx = displayedBench.indexOf(playerId)
    const swapIdx = idx + direction
    if (idx < 0 || swapIdx < 0 || swapIdx >= displayedBench.length) return
    const next = [...displayedBench]
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setBenchOrder(next)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    const { data: lineupRow, error: upsertError } = await supabase
      .from('league_lineups')
      .upsert(
        { league_id: Number(id), user_id: user.id, gameweek_id: gameweek.id, module: moduleId, updated_at: new Date().toISOString() },
        { onConflict: 'league_id,user_id,gameweek_id' }
      )
      .select()
      .single()

    if (upsertError || !lineupRow) {
      setSaving(false)
      setSaveError('La deadline potrebbe essere passata, oppure il salvataggio non è riuscito.')
      return
    }

    await supabase.from('league_lineup_players').delete().eq('lineup_id', lineupRow.id)

    const starterRows = slots.map((playerId, idx) => {
      const slotDef = activeModule.slots[idx]
      const player = playersById[playerId]
      return {
        lineup_id: lineupRow.id,
        player_id: playerId,
        slot_type: 'starter',
        slot_role: player ? resolveSlotRole(player, moduleSystem.roleField, slotDef.roles) : slotDef.roles[0],
        slot_position: idx + 1,
      }
    })
    const benchRows = displayedBench.map((playerId, idx) => ({
      lineup_id: lineupRow.id,
      player_id: playerId,
      slot_type: 'bench',
      slot_role: null,
      slot_position: idx + 1,
    }))

    const { error: insertError } = await supabase.from('league_lineup_players').insert([...starterRows, ...benchRows])

    setSaving(false)

    if (insertError) {
      setSaveError('Salvataggio non riuscito. Riprova.')
      return
    }

    setSaveSuccess(true)
  }

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  if (!isMember) {
    return (
      <div className="lineup-page">
        <Link to={`/leagues/${id}`} className="back-link">
          ‹ {league.name}
        </Link>
        <p className="status-text">Non fai parte di questa lega.</p>
      </div>
    )
  }

  const missingSlots = slots.filter((s) => s == null).length
  const canSave = !locked && missingSlots === 0 && !saving

  function renderSlot(idx) {
    const slotDef = activeModule.slots[idx]
    const playerId = slots[idx]
    const player = playerId ? playersById[playerId] : null
    return (
      <button
        key={idx}
        type="button"
        className={'pitch-slot' + (player ? ' filled' : '')}
        disabled={locked}
        onClick={() => setPickerSlot(idx)}
      >
        <span className="slot-role">{slotDef.roles.join('/')}</span>
        {player ? (
          <>
            <span className="slot-player-name">{player.name}</span>
            <span className="slot-player-team">{player.team}</span>
          </>
        ) : (
          <span className="slot-empty">+</span>
        )}
      </button>
    )
  }

  const starterCount = moduleSystem.starterCount
  const defenseCount = Math.floor((starterCount - 1) / 2)
  const offenseIndices = Array.from({ length: starterCount - 1 - defenseCount }, (_, i) => 1 + defenseCount + i)
  const defenseIndices = Array.from({ length: defenseCount }, (_, i) => 1 + i)

  return (
    <div className="lineup-page">
      <Link to={`/leagues/${id}`} className="back-link">
        ‹ {league.name}
      </Link>

      <div className="lineup-header card">
        <h1>
          {league.name} — Giornata {gameweek.number}
        </h1>
        {locked ? (
          <span className="badge-tag deadline-locked">Formazione bloccata</span>
        ) : (
          <span className="deadline-info">Deadline: {deadlineLabel}</span>
        )}
      </div>

      {locked && <p className="error-text">Formazione bloccata — la giornata è in corso.</p>}

      <div className="pitch">
        <div className="pitch-row offense">{offenseIndices.map((idx) => renderSlot(idx))}</div>
        <div className="pitch-row defense">{defenseIndices.map((idx) => renderSlot(idx))}</div>
        <div className="pitch-row keeper">{renderSlot(0)}</div>
      </div>

      <section className="module-selector">
        <h2>Modulo</h2>
        <div className="module-list">
          {moduleSystem.modules.map((m) => (
            <button
              key={m.id}
              type="button"
              className={'module-btn' + (m.id === moduleId ? ' active' : '')}
              disabled={locked}
              onClick={() => requestModuleChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      <section className="bench-section">
        <h2>Panchina ({displayedBench.length})</h2>
        <p className="bench-hint">Ordina con le frecce: priorità di sostituzione, 1 = primo a entrare.</p>
        {displayedBench.length === 0 ? (
          <p className="status-text">Nessun giocatore disponibile in panchina.</p>
        ) : (
          <ul className="bench-list">
            {displayedBench.map((playerId, idx) => {
              const p = playersById[playerId]
              if (!p) return null
              return (
                <li key={playerId} className="bench-row card">
                  <span className="bench-order">{idx + 1}</span>
                  <div className="bench-main">
                    <span className="player-name">{p.name}</span>
                    <span className="player-team">{p.team}</span>
                  </div>
                  <span className="role-tag">{p[moduleSystem.roleField]}</span>
                  {!locked && (
                    <div className="bench-arrows">
                      <button type="button" disabled={idx === 0} onClick={() => moveBench(playerId, -1)} aria-label="Sposta su">
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={idx === displayedBench.length - 1}
                        onClick={() => moveBench(playerId, 1)}
                        aria-label="Sposta giù"
                      >
                        ▼
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {!locked && (
        <div className="lineup-save-bar">
          {missingSlots > 0 && <p className="error-text">Mancano {missingSlots} titolari.</p>}
          {saveError && <p className="error-text">{saveError}</p>}
          {saveSuccess && <p className="success-text">Formazione salvata.</p>}
          <button type="button" className="btn btn-primary btn-block" disabled={!canSave} onClick={handleSave}>
            {saving ? 'Salvataggio…' : 'Salva formazione'}
          </button>
        </div>
      )}

      <PlayerPickerModal
        open={pickerSlot != null}
        role={pickerRoles ? pickerRoles.join('/') : ''}
        players={pickerPlayers}
        fieldedElsewhere={{}}
        currentPlayerId={pickerCurrentPlayerId}
        onSelect={handleSelectPlayer}
        onRemove={handleRemovePlayer}
        onClose={() => setPickerSlot(null)}
        roleField={moduleSystem?.roleField}
      />

      <ConfirmDialog
        open={pendingModuleId != null}
        title="Cambiare modulo?"
        confirmLabel="Cambia modulo"
        onConfirm={confirmModuleChange}
        onCancel={() => setPendingModuleId(null)}
      >
        <span>Cambiare modulo svuoterà la formazione attuale.</span>
      </ConfirmDialog>
    </div>
  )
}
