import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import { generateInviteCode } from '../lib/inviteCode'
import '../components/ConfirmDialog.css'
import '../components/PlayerPickerModal.css'
import './CreateLeagueModal.css'

const COMPETITION_FORMATS = [
  { value: 'direct_serie_a', label: 'Scontri diretti + Serie A (3-1-0)' },
  { value: 'direct_vote_sum', label: 'Scontri diretti + Somma voti' },
  { value: 'royal_rumble_seria', label: 'Royal rumble + Serie A (3-1-0 vs tutti)' },
  { value: 'royal_rumble_f1', label: 'Royal rumble + Formula 1 (punti posizione)' },
]

export default function CreateLeagueModal({ onClose }) {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [gameweeks, setGameweeks] = useState([])
  const [name, setName] = useState('')
  const [formationType, setFormationType] = useState('7')
  const [roleSystem, setRoleSystem] = useState('fantastats')
  const [competitionFormat, setCompetitionFormat] = useState('royal_rumble_seria')
  const [marketType, setMarketType] = useState('auction')
  const [rosterSize, setRosterSize] = useState(18)
  const [startingCredits, setStartingCredits] = useState(500)
  const [seasonStartGameweek, setSeasonStartGameweek] = useState('')
  const [teamName, setTeamName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase.from('gameweeks').select('id, number').order('number')
      if (cancelled) return
      setGameweeks(data ?? [])
      if (data?.length) setSeasonStartGameweek(String(data[0].id))
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  function handleFormationTypeChange(value) {
    setFormationType(value)
    if (value === '7') {
      setRoleSystem('fantastats')
      setRosterSize(18)
    } else {
      setRoleSystem('mantra')
      setRosterSize(25)
    }
  }

  const rosterRange = formationType === '7' ? { min: 12, max: 24 } : { min: 20, max: 32 }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !teamName.trim() || !seasonStartGameweek) return

    setSubmitting(true)
    setError(null)

    let league = null
    for (let attempt = 0; attempt < 5 && !league; attempt++) {
      const { data, error: insertError } = await supabase
        .from('leagues')
        .insert({
          name: name.trim(),
          admin_id: user.id,
          invite_code: generateInviteCode(),
          formation_type: formationType,
          role_system: roleSystem,
          competition_format: competitionFormat,
          market_type: marketType,
          roster_size: rosterSize,
          starting_credits: startingCredits,
          season_start_gameweek: Number(seasonStartGameweek),
        })
        .select()
        .single()

      if (!insertError) {
        league = data
        break
      }
      if (insertError.code !== '23505') {
        setSubmitting(false)
        setError('Creazione lega non riuscita. Riprova.')
        return
      }
      // 23505 = unique_violation on invite_code: loop and retry with a new code
    }

    if (!league) {
      setSubmitting(false)
      setError('Impossibile generare un codice invito univoco. Riprova.')
      return
    }

    const { error: memberError } = await supabase.from('league_members').insert({
      league_id: league.id,
      user_id: user.id,
      team_name: teamName.trim(),
      league_credits: startingCredits,
    })

    setSubmitting(false)

    if (memberError) {
      setError('Lega creata ma non sei riuscito a unirti. Riprova dalla lista leghe.')
      return
    }

    navigate(`/leagues/${league.id}`)
  }

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        className="create-league-panel card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-header">
          <h2>Crea lega</h2>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Chiudi">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="create-league-form">
          <div className="form-field">
            <label htmlFor="league-name">Nome lega</label>
            <input id="league-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="form-field">
            <span className="form-label">Tipo formazione</span>
            <div className="radio-row">
              <label className="radio-option">
                <input
                  type="radio"
                  checked={formationType === '7'}
                  onChange={() => handleFormationTypeChange('7')}
                />
                7
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  checked={formationType === '11'}
                  onChange={() => handleFormationTypeChange('11')}
                />
                11
              </label>
            </div>
          </div>

          {formationType === '11' && (
            <div className="form-field">
              <span className="form-label">Sistema ruoli</span>
              <div className="radio-row">
                <label className="radio-option">
                  <input
                    type="radio"
                    checked={roleSystem === 'classic'}
                    onChange={() => setRoleSystem('classic')}
                  />
                  Classic
                </label>
                <label className="radio-option">
                  <input type="radio" checked={roleSystem === 'mantra'} onChange={() => setRoleSystem('mantra')} />
                  Mantra
                </label>
              </div>
            </div>
          )}

          <div className="form-field">
            <label htmlFor="competition-format">Formato competizione</label>
            <select
              id="competition-format"
              value={competitionFormat}
              onChange={(e) => setCompetitionFormat(e.target.value)}
            >
              {COMPETITION_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <span className="form-label">Tipo mercato</span>
            <div className="radio-row">
              <label className="radio-option">
                <input type="radio" checked={marketType === 'auction'} onChange={() => setMarketType('auction')} />
                Asta in presenza
              </label>
              <label className="radio-option">
                <input type="radio" checked={marketType === 'credits'} onChange={() => setMarketType('credits')} />
                Crediti
              </label>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="roster-size">
              Dimensione rosa ({rosterRange.min}-{rosterRange.max})
            </label>
            <input
              id="roster-size"
              type="number"
              min={rosterRange.min}
              max={rosterRange.max}
              value={rosterSize}
              onChange={(e) => setRosterSize(Number(e.target.value))}
            />
          </div>

          <div className="form-field">
            <label htmlFor="starting-credits">Crediti iniziali</label>
            <input
              id="starting-credits"
              type="number"
              min={0}
              value={startingCredits}
              onChange={(e) => setStartingCredits(Number(e.target.value))}
            />
          </div>

          <div className="form-field">
            <label htmlFor="season-start">Giornata di inizio</label>
            <select
              id="season-start"
              value={seasonStartGameweek}
              onChange={(e) => setSeasonStartGameweek(e.target.value)}
            >
              {gameweeks.map((gw) => (
                <option key={gw.id} value={gw.id}>
                  Giornata {gw.number}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="team-name">Nome della tua squadra</label>
            <input
              id="team-name"
              type="text"
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Creazione…' : 'Crea lega'}
          </button>
        </form>
      </div>
    </div>
  )
}
