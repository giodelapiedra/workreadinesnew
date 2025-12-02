import { useState, type ReactNode, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { TopNavbar } from './TopNavbar'
import './DashboardLayout.css'

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile vs desktop
  useEffect(() => {
    const checkMobile = () => {
      const wasMobile = isMobile
      const nowMobile = window.innerWidth < 768
      setIsMobile(nowMobile)
      
      // On mobile, sidebar should be closed (hidden off-screen)
      // On desktop, sidebar should stay open (but can be collapsed to icon-only)
      if (nowMobile) {
        setSidebarOpen(false)
      } else if (wasMobile && !nowMobile) {
        // Transitioning from mobile to desktop - open sidebar
        setSidebarOpen(true)
      }
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [isMobile])

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  const closeSidebar = () => {
    if (isMobile) {
      setSidebarOpen(false)
    }
  }

  // Calculate sidebar width for CSS variable
  const sidebarWidth = isMobile ? 0 : (!sidebarOpen ? 70 : 260)

  // Prevent body blur when sidebar is open on mobile
  useEffect(() => {
    if (isMobile && sidebarOpen) {
      // Ensure body and html have no blur
      document.body.style.setProperty('filter', 'none', 'important')
      document.body.style.setProperty('backdrop-filter', 'none', 'important')
      document.body.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
      document.documentElement.style.setProperty('filter', 'none', 'important')
      document.documentElement.style.setProperty('backdrop-filter', 'none', 'important')
      document.documentElement.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
      
      // Ensure dashboard content has no blur
      const content = document.querySelector('.dashboard-content') as HTMLElement
      if (content) {
        content.style.setProperty('filter', 'none', 'important')
        content.style.setProperty('backdrop-filter', 'none', 'important')
        content.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
      }
    } else {
      // Reset when sidebar is closed
      document.body.style.removeProperty('filter')
      document.body.style.removeProperty('backdrop-filter')
      document.body.style.removeProperty('-webkit-backdrop-filter')
      document.documentElement.style.removeProperty('filter')
      document.documentElement.style.removeProperty('backdrop-filter')
      document.documentElement.style.removeProperty('-webkit-backdrop-filter')
    }
  }, [isMobile, sidebarOpen])

  return (
    <div 
      className="dashboard-layout"
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {/* No overlay on mobile - sidebar opens without dark background */}
      
      <Sidebar 
        isOpen={sidebarOpen} 
        isMobile={isMobile}
        onClose={closeSidebar}
      />
      
      <TopNavbar 
        onToggleSidebar={toggleSidebar}
        sidebarOpen={sidebarOpen}
      />
      
      <main className={`dashboard-content ${!sidebarOpen && !isMobile ? 'expanded' : ''} ${isMobile ? 'mobile' : 'desktop'}`}>
        {children}
      </main>
    </div>
  )
}

