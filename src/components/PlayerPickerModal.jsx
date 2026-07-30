import './PlayerPickerModal.css'

export default function PlayerPickerModal({
  open,
  role,
  players,
  fieldedElsewhere,
  currentPlayerId,
  onSelect,
  onRemove,
  onClose,
  roleField = 'role_fantastats',
}) {
  if (!open) return null

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker-panel card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <h2>Scegli {role}</h2>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Chiudi">
            ×
          </button>
        </div>

        {currentPlayerId && (
          <button type="button" className="btn btn-secondary btn-block" onClick={onRemove}>
            Rimuovi giocatore
          </button>
        )}

        {players.length === 0 ? (
          <p className="status-text">Nessun giocatore disponibile per questo ruolo.</p>
        ) : (
          <ul className="picker-list">
            {players.map((p) => {
              const blockedIn = fieldedElsewhere[p.id]
              const isCurrent = p.id === currentPlayerId
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={'picker-item' + (isCurrent ? ' selected' : '') + (blockedIn ? ' blocked' : '')}
                    disabled={Boolean(blockedIn)}
                    onClick={() => onSelect(p.id)}
                  >
                    <span className="picker-item-main">
                      <span className="picker-item-name">{p.name}</span>
                      <span className="picker-item-team">{p.team}</span>
                    </span>
                    <span className="picker-item-role">{p[roleField]}</span>
                    {blockedIn && <span className="picker-item-blocked">Schierato in {blockedIn}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
