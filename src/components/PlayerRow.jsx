import './PlayerRow.css'

export default function PlayerRow({ player, badges, meta, actions }) {
  return (
    <li className="player-row card">
      <div className="player-main">
        <span className="player-name">{player.name}</span>
        <span className="player-team">{player.team}</span>
      </div>

      <div className="player-roles">
        <span className="role-tag" title="Ruolo Fantastats">
          {player.role_fantastats}
        </span>
      </div>

      {badges && badges.length > 0 && (
        <div className="player-badges">
          {badges.map((b) => (
            <span key={b} className="badge-tag">
              {b}
            </span>
          ))}
        </div>
      )}

      {meta && <div className="player-meta">{meta}</div>}

      {actions && <div className="player-actions">{actions}</div>}
    </li>
  )
}
