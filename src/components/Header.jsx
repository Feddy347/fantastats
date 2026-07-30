import { Link } from 'react-router-dom'
import './Header.css'

export default function Header({ title, onMenuClick }) {
  return (
    <header className="app-header">
      <Link to="/categories" className="app-header-brand">
        Fantastats
      </Link>
      <h1 className="app-header-title">{title}</h1>
      <button type="button" className="app-header-menu" onClick={onMenuClick} aria-label="Apri menu">
        <span aria-hidden="true">☰</span>
      </button>
    </header>
  )
}
