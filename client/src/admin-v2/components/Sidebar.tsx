/**
 * Desktop sidebar navigation (≥768px). Collapses to icon-only on tablet (768-1023px).
 */
import { useState } from 'react'
import { Badge } from './Badge'
import './Sidebar.css'

export type AdminV2Tab = 'dashboard' | 'inbox' | 'support' | 'stats' | 'content' | 'settings'

interface NavItem {
  id: AdminV2Tab
  label: string
  icon: string
  badge?: number
  badgeVariant?: 'mint' | 'amber' | 'red' | 'gray'
}

interface SidebarProps {
  activeTab: AdminV2Tab
  onTabChange: (tab: AdminV2Tab) => void
  username: string
  onLogout: () => void
}

export function Sidebar({ activeTab, onTabChange, username, onLogout }: SidebarProps) {
  const [contentOpen, setContentOpen] = useState(false)

  // TODO: Wire up real badge counts from API in Phase 1
  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'inbox', label: 'Inbox', icon: '📬', badge: 0, badgeVariant: 'amber' },
    { id: 'support', label: 'Support', icon: '🎫', badge: 0, badgeVariant: 'red' },
    { id: 'stats', label: 'Stats', icon: '📈' },
    { id: 'content', label: 'Content', icon: '✍️' },
  ]

  const bottomItems: NavItem[] = [
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  const contentChildren: { id: AdminV2Tab; label: string }[] = [
    { id: 'content', label: 'X Ideas' },
    { id: 'content', label: 'X Post Studio' },
    { id: 'content', label: 'Blog Studio' },
  ]

  const userInitial = username.charAt(0).toUpperCase()

  return (
    <nav className="av2-sidebar" aria-label="Main navigation">
      <div className="av2-sidebar-top">
        {navItems.map(item => (
          <div key={item.id}>
            <button
              type="button"
              className={`av2-sidenav-item${activeTab === item.id ? ' av2-sidenav-item--active' : ''}${
                item.id === 'content' && contentOpen ? ' av2-sidenav-item--expanded' : ''
              }`}
              onClick={() => {
                if (item.id === 'content') {
                  setContentOpen(!contentOpen)
                } else {
                  onTabChange(item.id)
                }
              }}
              aria-current={activeTab === item.id ? 'page' : undefined}
            >
              <span className="av2-sidenav-icon" aria-hidden="true">{item.icon}</span>
              <span className="av2-sidenav-label">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <Badge count={item.badge} variant={item.badgeVariant || 'gray'} />
              )}
              {item.id === 'content' && (
                <span className={`av2-sidenav-chevron${contentOpen ? ' av2-sidenav-chevron--open' : ''}`}>
                  ▾
                </span>
              )}
            </button>

            {/* Content children */}
            {item.id === 'content' && contentOpen && (
              <div className="av2-sidenav-children">
                {contentChildren.map(child => (
                  <button
                    key={child.label}
                    type="button"
                    className="av2-sidenav-child"
                    onClick={() => onTabChange('content')}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="av2-sidebar-bottom">
        {bottomItems.map(item => (
          <button
            key={item.id}
            type="button"
            className={`av2-sidenav-item${activeTab === item.id ? ' av2-sidenav-item--active' : ''}`}
            onClick={() => onTabChange(item.id)}
            aria-current={activeTab === item.id ? 'page' : undefined}
          >
            <span className="av2-sidenav-icon" aria-hidden="true">{item.icon}</span>
            <span className="av2-sidenav-label">{item.label}</span>
          </button>
        ))}

        <div className="av2-sidebar-user">
          <div className="av2-sidebar-avatar">{userInitial}</div>
          <div className="av2-sidebar-user-info">
            <span className="av2-sidebar-username">{username}</span>
            <button
              type="button"
              className="av2-sidebar-signout"
              onClick={onLogout}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
