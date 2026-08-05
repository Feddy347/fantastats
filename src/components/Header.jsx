import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import './Header.css'

export default function Header({ title, onMenuClick }) {
  return (
    <header className="app-header">
      <Link to="/" className="app-header-brand">
        <img src="/logo-splash.png" alt="Fantastats" />
      </Link>
      <h1 className="app-header-title">{title}</h1>
      <button type="button" className="app-header-menu" onClick={onMenuClick} aria-label="Apri menu">
        <Menu size={22} strokeWidth={2} />
      </button>
    </header>
  )
}
