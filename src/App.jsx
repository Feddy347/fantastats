import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import CategoriesList from './pages/CategoriesList'
import LeaguesList from './pages/LeaguesList'
import LeagueDetail from './pages/LeagueDetail'
import LeagueLineup from './pages/LeagueLineup'
import LeagueMarket from './pages/LeagueMarket'
import AuctionAdmin from './pages/AuctionAdmin'
import AuctionLive from './pages/AuctionLive'
import CategoryDetail from './pages/CategoryDetail'
import Lineup from './pages/Lineup'
import Live from './pages/Live'
import LiveCategoryDetail from './pages/LiveCategoryDetail'
import LiveLeagueDetail from './pages/LiveLeagueDetail'
import Market from './pages/Market'
import Roster from './pages/Roster'
import Profile from './pages/Profile'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/AppLayout'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/categories" replace />} />
        <Route path="/categories" element={<CategoriesList />} />
        <Route path="/categories/:slug" element={<CategoryDetail />} />
        <Route path="/categories/:slug/lineup" element={<Lineup />} />
        <Route path="/live" element={<Live />} />
        <Route path="/live/league/:leagueId" element={<LiveLeagueDetail />} />
        <Route path="/live/:categorySlug" element={<LiveCategoryDetail />} />
        <Route path="/leagues" element={<LeaguesList />} />
        <Route path="/leagues/:id" element={<LeagueDetail />} />
        <Route path="/leagues/:id/lineup" element={<LeagueLineup />} />
        <Route path="/leagues/:id/market" element={<LeagueMarket />} />
        <Route path="/leagues/:id/auction" element={<AuctionAdmin />} />
        <Route path="/leagues/:id/auction/live" element={<AuctionLive />} />
        <Route path="/market" element={<Market />} />
        <Route path="/roster" element={<Roster />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
