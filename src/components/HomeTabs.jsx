import { NavLink } from 'react-router-dom'
import './HomeTabs.css'

export default function HomeTabs() {
  return (
    <div className="home-tabs">
      <NavLink
        to="/categories"
        className={({ isActive }) => 'home-tab' + (isActive ? ' active' : '')}
      >
        Categorie
      </NavLink>
      <NavLink
        to="/leagues"
        className={({ isActive }) => 'home-tab' + (isActive ? ' active' : '')}
      >
        Leghe
      </NavLink>
    </div>
  )
}
