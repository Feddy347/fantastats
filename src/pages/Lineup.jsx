import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import { buildTeamsByName, computePool } from '../lib/categoryPool'
import { MODULES, DEFAULT_MODULE_ID, getModule, playerHasRole } from '../lib/modules'
import { getCurrentGameweek, isLineupLocked, formatDeadline } from '../lib/gameweek'
import ConfirmDialog from '../components/ConfirmDialog'
import PlayerPickerModal from '../components/PlayerPickerModal'
import './Lineup.css'

const EMPTY_SLOTS = Array(7).fill(null)

export default function Lineup() {
  const { slug } = useParams()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [category, setCategory] = useState(null)
  const [gameweek, setGameweek] = useState(null)
  const [isEnrolled, setIsEnrolled] = useState(false)
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [rosterPlayerIds, setRosterPlayerIds] = useState([])
  const [fieldedElsewhere, setFieldedElsewhere] = useState({})

  const [moduleId, setModuleId] = useState(DEFAULT_MODULE_ID)
  const [slots, setSlots] = useState(EMPTY_SLOTS)
  const [benchOrder, setBenchOrder] = useState([])
  const [pendingModuleId, setPendingModuleId] = useState(null)
  const [pickerSlot, setPickerSlot] = useState(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const [{ data: categoryData, error: categoryError }, gw] = await Promise.all([
        supabase.from('categories').select('*').eq('slug', slug).maybeSingle(),
        getCurrentGameweek(),
      ])

      if (cancelled) return

      if (categoryError || !categoryData) {
        setError('Categoria non trovata.')
        setLoading(false)
        return
      }
      if (!gw) {
        setError('Nessuna giornata disponibile al momento.')
        setLoading(false)
        return
      }

      const [teamsRes, playersRes, rosterRes, enrollRes, lineupRes, otherLineupsRes] = await Promise.all([
        supabase.from('teams').select('*'),
        supabase.from('players').select('*'),
        supabase.from('user_players').select('player_id').eq('user_id', user.id),
        supabase
          .from('user_category_enrollments')
          .select('id')
          .eq('user_id', user.id)
          .eq('category_id', categoryData.id)
          .maybeSingle(),
        supabase
          .from('lineups')
          .select('*, lineup_players(*)')
          .eq('user_id', user.id)
          .eq('category_id', categoryData.id)
          .eq('gameweek_id', gw.id)
          .maybeSingle(),
        supabase
          .from('lineups')
          .select('category_id, categories(name), lineup_players(player_id)')
          .eq('user_id', user.id)
          .eq('gameweek_id', gw.id)
          .neq('category_id', categoryData.id),
      ])

      if (cancelled) return

      setCategory(categoryData)
      setGameweek(gw)
      setTeams(teamsRes.data ?? [])
      setPlayers(playersRes.data ?? [])
      setRosterPlayerIds((rosterRes.data ?? []).map((r) => r.player_id))
      setIsEnrolled(Boolean(enrollRes.data))

      const elsewhere = {}
      ;(otherLineupsRes.data ?? []).forEach((l) => {
        ;(l.lineup_players ?? []).forEach((lp) => {
          elsewhere[lp.player_id] = l.categories?.name ?? "un'altra categoria"
        })
      })
      setFieldedElsewhere(elsewhere)

      const lineup = lineupRes.data
      if (lineup) {
        setModuleId(lineup.module)
        const starters = Array(7).fill(null)
        const bench = []
        ;(lineup.lineup_players ?? [])
          .slice()
          .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))
          .forEach((lp) => {
            if (lp.slot_type === 'starter' && lp.slot_position >= 1 && lp.slot_position <= 7) {
              starters[lp.slot_position - 1] = lp.player_id
            } else if (lp.slot_type === 'bench') {
              bench.push(lp.player_id)
            }
          })
        setSlots(starters)
        setBenchOrder(bench)
      } else {
        setModuleId(DEFAULT_MODULE_ID)
        setSlots(EMPTY_SLOTS)
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
  }, [slug, user.id])

  const teamsByName = useMemo(() => buildTeamsByName(teams), [teams])
  const totalTeams = teams.length

  const playersById = useMemo(() => {
    const map = {}
    players.forEach((p) => {
      map[p.id] = p
    })
    return map
  }, [players])

  const rosterPlayers = useMemo(
    () => players.filter((p) => rosterPlayerIds.includes(p.id)),
    [players, rosterPlayerIds]
  )

  const eligibleRosterPlayers = useMemo(() => {
    if (!category) return []
    return computePool(rosterPlayers, teamsByName, category, totalTeams)
  }, [rosterPlayers, teamsByName, category, totalTeams])

  const activeModule = getModule(moduleId)
  const locked = isLineupLocked(gameweek)
  const deadlineLabel = formatDeadline(gameweek)

  const startersSet = useMemo(() => new Set(slots.filter(Boolean)), [slots])

  const benchEligibleIds = useMemo(
    () =>
      eligibleRosterPlayers
        .filter((p) => !startersSet.has(p.id) && !fieldedElsewhere[p.id])
        .map((p) => p.id),
    [eligibleRosterPlayers, startersSet, fieldedElsewhere]
  )

  // benchOrder only holds the order the user has explicitly set (via moveBench,
  // or loaded from the DB); newly-eligible players are appended here at render
  // time rather than synced back with an effect.
  const displayedBench = useMemo(() => {
    const eligibleSet = new Set(benchEligibleIds)
    const kept = benchOrder.filter((id) => eligibleSet.has(id))
    const keptSet = new Set(kept)
    const added = benchEligibleIds.filter((id) => !keptSet.has(id))
    return [...kept, ...added]
  }, [benchOrder, benchEligibleIds])

  const pickerRole = pickerSlot != null ? activeModule.slots[pickerSlot] : null
  const pickerCurrentPlayerId = pickerSlot != null ? slots[pickerSlot] : null

  const pickerPlayers = useMemo(() => {
    if (pickerRole == null) return []
    const excludeIds = new Set(slots.filter((id, idx) => id != null && idx !== pickerSlot))
    return eligibleRosterPlayers.filter((p) => playerHasRole(p, pickerRole) && !excludeIds.has(p.id))
  }, [pickerRole, pickerSlot, eligibleRosterPlayers, slots])

  function requestModuleChange(newModuleId) {
    if (newModuleId === moduleId || locked) return
    if (slots.some(Boolean)) {
      setPendingModuleId(newModuleId)
    } else {
      setModuleId(newModuleId)
    }
  }

  function confirmModuleChange() {
    setModuleId(pendingModuleId)
    setSlots(EMPTY_SLOTS)
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

  function moveBench(id, direction) {
    const idx = displayedBench.indexOf(id)
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

    const starterPayload = slots.map((playerId, idx) => ({
      player_id: playerId,
      slot_type: 'starter',
      slot_role: activeModule.slots[idx],
      slot_position: idx + 1,
    }))
    const benchPayload = displayedBench.map((playerId, idx) => ({
      player_id: playerId,
      slot_type: 'bench',
      slot_role: null,
      slot_position: idx + 1,
    }))

    const { error: saveErr } = await supabase.rpc('save_lineup', {
      p_category_id: category.id,
      p_gameweek_id: gameweek.id,
      p_module: moduleId,
      p_players: [...starterPayload, ...benchPayload],
    })

    setSaving(false)

    if (saveErr) {
      setSaveError(
        saveErr.message.includes('Deadline passed')
          ? 'La deadline per questa giornata è passata.'
          : 'Salvataggio non riuscito. Riprova.'
      )
      return
    }

    setSaveSuccess(true)
  }

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  if (!isEnrolled) {
    return (
      <div className="lineup-page">
        <Link to={`/categories/${slug}`} className="back-link">
          ‹ {category.name}
        </Link>
        <p className="status-text">Devi essere iscritto a questa categoria per schierare una formazione.</p>
      </div>
    )
  }

  const missingSlots = slots.filter((s) => s == null).length
  const canSave = !locked && missingSlots === 0 && !saving

  function renderSlot(idx) {
    const role = activeModule.slots[idx]
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
        <span className="slot-role">{role}</span>
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

  return (
    <div className="lineup-page">
      <Link to={`/categories/${slug}`} className="back-link">
        ‹ {category.name}
      </Link>

      <div className="lineup-header card">
        <h1>
          {category.name} — Giornata {gameweek.number}
        </h1>
        {locked ? (
          <span className="badge-tag deadline-locked">Formazione bloccata</span>
        ) : (
          <span className="deadline-info">Deadline: {deadlineLabel}</span>
        )}
      </div>

      {locked && <p className="error-text">Formazione bloccata — la giornata è in corso.</p>}

      <div className="pitch">
        <div className="pitch-row offense">{[4, 5, 6].map((idx) => renderSlot(idx))}</div>
        <div className="pitch-row defense">{[1, 2, 3].map((idx) => renderSlot(idx))}</div>
        <div className="pitch-row keeper">{renderSlot(0)}</div>
      </div>

      <section className="module-selector">
        <h2>Modulo</h2>
        <div className="module-list">
          {MODULES.map((m) => (
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
            {displayedBench.map((id, idx) => {
              const p = playersById[id]
              if (!p) return null
              return (
                <li key={id} className="bench-row card">
                  <span className="bench-order">{idx + 1}</span>
                  <div className="bench-main">
                    <span className="player-name">{p.name}</span>
                    <span className="player-team">{p.team}</span>
                  </div>
                  <span className="role-tag">{p.role_fantastats}</span>
                  {!locked && (
                    <div className="bench-arrows">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveBench(id, -1)}
                        aria-label="Sposta su"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={idx === displayedBench.length - 1}
                        onClick={() => moveBench(id, 1)}
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
        role={pickerRole}
        players={pickerPlayers}
        fieldedElsewhere={fieldedElsewhere}
        currentPlayerId={pickerCurrentPlayerId}
        onSelect={handleSelectPlayer}
        onRemove={handleRemovePlayer}
        onClose={() => setPickerSlot(null)}
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
