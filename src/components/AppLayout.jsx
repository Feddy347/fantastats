import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { PageTitleContext } from '../lib/pageTitleContext'
import Header from './Header'
import Drawer from './Drawer'
import './AppLayout.css'

export default function AppLayout() {
  const [title, setTitle] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    function closeDrawer() {
      setDrawerOpen(false)
    }
    closeDrawer()
  }, [location.pathname])

  return (
    <PageTitleContext.Provider value={{ title, setTitle }}>
      <div className="app-layout">
        <Header title={title} onMenuClick={() => setDrawerOpen(true)} />
        <main className="app-content page-fade" key={location.pathname}>
          <Outlet />
        </main>
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    </PageTitleContext.Provider>
  )
}
