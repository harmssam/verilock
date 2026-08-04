/**
 * Desktop sidebar navigation (>=768px). Collapses to icon-only on tablet (768-1023px)
 * or when the operator toggles collapse (persisted in localStorage).
 */
import { useState, useEffect, type ReactNode } from 'react'
import {
  BarChart3,
  MailOpen,
  Ticket,
  TrendingUp,
  PenLine,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { Badge } from './Badge'
import './Sidebar.css'

const COLLAPSED_KEY = 'verilock-admin-v2-sidebar-collapsed'

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
  activeStudioPane?: StudioPane
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
  activeStudioPane = 'x',
  onTabChange,
  username,
  onLogout,
  inboxBadge = 0,
  supportBadge = 0,
}: SidebarProps) {
  const [contentOpen, setContentOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })

  // Auto-expand Content section when on a content child tab (only when expanded)
  useEffect(() => {
    if (!collapsed && (activeTab === 'studio' || activeTab === 'content')) {
      setContentOpen(true)
    }
  }, [activeTab, collapsed])

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      if (next) setContentOpen(false)
      return next
    })
  }

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
    <nav
      className={`av2-sidebar${collapsed ? ' av2-sidebar--collapsed' : ''}`}
      aria-label="Main navigation"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="av2-sidebar-top">
        <div className="av2-sidebar-collapse-row">
          <button
            type="button"
            className="av2-sidebar-collapse-btn"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            {collapsed ? (
              <PanelLeft size={iconSize} strokeWidth={iconStroke} />
            ) : (
              <PanelLeftClose size={iconSize} strokeWidth={iconStroke} />
            )}
            <span className="av2-sidenav-label">Collapse</span>
          </button>
        </div>

        {navItems.map(item => (
          <div key={item.id}>
            <button
              type="button"
              className={`av2-sidenav-item${activeTab === item.id || (item.id === 'content' && activeTab === 'studio') ? ' av2-sidenav-item--active' : ''}${
                item.id === 'content' && contentOpen && !collapsed ? ' av2-sidenav-item--expanded' : ''
              }`}
              onClick={() => {
                if (item.id === 'content') {
                  if (collapsed) {
                    // Icon-only: go to X Ideas (content)
                    onTabChange('content')
                  } else {
                    setContentOpen(!contentOpen)
                  }
                } else {
                  onTabChange(item.id)
                }
              }}
              aria-current={
                activeTab === item.id || (item.id === 'content' && activeTab === 'studio')
                  ? 'page'
                  : undefined
              }
              title={collapsed ? item.label : undefined}
            >
              <span className="av2-sidenav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="av2-sidenav-label">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <Badge count={item.badge} variant={item.badgeVariant || 'gray'} />
              )}
              {item.id === 'content' && !collapsed && (
                <span
                  className={`av2-sidenav-chevron${contentOpen ? ' av2-sidenav-chevron--open' : ''}`}
                >
                  ▾
                </span>
              )}
            </button>

            {/* Content children — only when expanded */}
            {item.id === 'content' && contentOpen && !collapsed && (
              <div className="av2-sidenav-children">
                {contentChildren.map(child => {
                  const childActive =
                    child.id === 'content'
                      ? activeTab === 'content'
                      : activeTab === 'studio' && child.studioPane === activeStudioPane
                  return (
                    <button
                      key={child.label}
                      type="button"
                      className={`av2-sidenav-child${childActive ? ' av2-sidenav-child--active' : ''}`}
                      onClick={() => onTabChange(child.id, { studioPane: child.studioPane })}
                    >
                      {child.label}
                    </button>
                  )
                })}
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
            title={collapsed ? item.label : undefined}
          >
            <span className="av2-sidenav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="av2-sidenav-label">{item.label}</span>
          </button>
        ))}

        <div className="av2-sidebar-user" title={collapsed ? username : undefined}>
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
