/**
 * Desktop sidebar navigation (>=768px). Collapses to icon-only on tablet (768-1023px).
 */
import { useState, type ReactNode } from 'react'
import {
  BarChart3,
  MailOpen,
  Ticket,
  TrendingUp,
  PenLine,
  Settings,
} from 'lucide-react'
import { Badge } from './Badge'
import './Sidebar.css'

export type AdminV2Tab =
  | 'dashboard'
  | 'inbox'
  | 'support'
  | 'stats'
  | 'content'
  | 'studio'
  | 'settings'

export type StudioPane = 'x' | 'blog'

interface NavItem {
  id: AdminV2Tab
  label: string
  icon: ReactNode
  badge?: number
  badgeVariant?: 'mint' | 'amber' | 'red' | 'gray'
}

interface SidebarProps {
  activeTab: AdminV2Tab
  onTabChange: (tab: AdminV2Tab, opts?: { studioPane?: StudioPane }) => void
  username: string
  onLogout: () => void
  inboxBadge?: number
  supportBadge?: number
}

const iconSize = 20
const iconStroke = 1.5

export function Sidebar({
  activeTab,
  onTabChange,
  username,
  onLogout,
  inboxBadge = 0,
  supportBadge = 0,
}: SidebarProps) {
  const [contentOpen, setContentOpen] = useState(false)

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={iconSize} strokeWidth={iconStroke} /> },
    {
      id: 'inbox',
      label: 'Inbox',
      icon: <MailOpen size={iconSize} strokeWidth={iconStroke} />,
      badge: inboxBadge,
      badgeVariant: 'amber',
    },
    {
      id: 'support',
      label: 'Support',
      icon: <Ticket size={iconSize} strokeWidth={iconStroke} />,
      badge: supportBadge,
      badgeVariant: 'red',
    },
    { id: 'stats', label: 'Stats', icon: <TrendingUp size={iconSize} strokeWidth={iconStroke} /> },
    { id: 'content', label: 'Content', icon: <PenLine size={iconSize} strokeWidth={iconStroke} /> },
  ]

  const bottomItems: NavItem[] = [
    { id: 'settings', label: 'Settings', icon: <Settings size={iconSize} strokeWidth={iconStroke} /> },
  ]

  const contentChildren: { id: AdminV2Tab; label: string; studioPane?: StudioPane }[] = [
    { id: 'content', label: 'X Ideas' },
    { id: 'studio', label: 'X Post Studio', studioPane: 'x' },
    { id: 'studio', label: 'Blog Studio', studioPane: 'blog' },
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
              <span className="av2-sidenav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="av2-sidenav-label">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <Badge count={item.badge} variant={item.badgeVariant || 'gray'} />
              )}
              {item.id === 'content' && (
                <span
                  className={`av2-sidenav-chevron${contentOpen ? ' av2-sidenav-chevron--open' : ''}`}
                >
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
                    className={`av2-sidenav-child${
                      activeTab === child.id &&
                      (child.studioPane ? activeTab === 'studio' : true)
                        ? ' av2-sidenav-child--active'
                        : ''
                    }`}
                    onClick={() => onTabChange(child.id, { studioPane: child.studioPane })}
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
            <span className="av2-sidenav-icon" aria-hidden="true">
              {item.icon}
            </span>
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
