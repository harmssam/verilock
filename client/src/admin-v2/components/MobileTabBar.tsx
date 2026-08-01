/**
 * Mobile bottom tab bar (<768px). Fixed at the bottom with 5 icon tabs.
 * "More" tab opens a slide-up menu with Content + Settings.
 */
import { useState, type ReactNode } from 'react'
import {
  BarChart3,
  MailOpen,
  Ticket,
  TrendingUp,
  MoreHorizontal,
  PenLine,
  Settings,
  MonitorPlay,
} from 'lucide-react'
import { Badge } from './Badge'
import type { AdminV2Tab } from './Sidebar'
import './MobileTabBar.css'

interface MobileTabBarProps {
  activeTab: AdminV2Tab
  onTabChange: (tab: AdminV2Tab) => void
  inboxBadge?: number
  supportBadge?: number
}

interface TabItem {
  id: AdminV2Tab | 'more'
  label: string
  icon: ReactNode
  badge?: number
}

const iconSize = 20
const iconStroke = 1.5

export function MobileTabBar({
  activeTab,
  onTabChange,
  inboxBadge = 0,
  supportBadge = 0,
}: MobileTabBarProps) {
  const [moreOpen, setMoreOpen] = useState(false)

  const tabs: TabItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={iconSize} strokeWidth={iconStroke} /> },
    { id: 'inbox', label: 'Inbox', icon: <MailOpen size={iconSize} strokeWidth={iconStroke} />, badge: inboxBadge },
    { id: 'support', label: 'Support', icon: <Ticket size={iconSize} strokeWidth={iconStroke} />, badge: supportBadge },
    { id: 'stats', label: 'Stats', icon: <TrendingUp size={iconSize} strokeWidth={iconStroke} /> },
    { id: 'more', label: 'More', icon: <MoreHorizontal size={iconSize} strokeWidth={iconStroke} /> },
  ]

  const moreItems: { id: AdminV2Tab; label: string; icon: ReactNode }[] = [
    { id: 'content', label: 'Content', icon: <PenLine size={iconSize} strokeWidth={iconStroke} /> },
    { id: 'studio', label: 'Studio', icon: <MonitorPlay size={iconSize} strokeWidth={iconStroke} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={iconSize} strokeWidth={iconStroke} /> },
  ]

  const handleTabPress = (tabId: AdminV2Tab | 'more') => {
    if (tabId === 'more') {
      setMoreOpen(!moreOpen)
    } else {
      onTabChange(tabId)
    }
  }

  const handleMoreItemPress = (tabId: AdminV2Tab) => {
    setMoreOpen(false)
    onTabChange(tabId)
  }

  const isMoreActive = activeTab === 'content' || activeTab === 'studio' || activeTab === 'settings'

  return (
    <>
      <nav className="av2-mobile-tabs" aria-label="Mobile navigation">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`av2-mobile-tab${
              tab.id !== 'more' && activeTab === tab.id
                ? ' av2-mobile-tab--active'
                : ''
            }${tab.id === 'more' && isMoreActive ? ' av2-mobile-tab--active' : ''}${
              moreOpen && tab.id === 'more' ? ' av2-mobile-tab--more-open' : ''
            }`}
            onClick={() => handleTabPress(tab.id)}
            aria-current={
              tab.id !== 'more' && activeTab === tab.id ? 'page' : undefined
            }
          >
            <span className="av2-mobile-tab-icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span className="av2-mobile-tab-label">{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <Badge count={tab.badge} variant="amber" className="av2-mobile-tab-badge" />
            )}
          </button>
        ))}
      </nav>

      {/* More slide-up menu */}
      {moreOpen && (
        <>
          <div
            className="av2-mobile-overlay"
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          <div className="av2-mobile-more-menu" role="menu">
            <div className="av2-mobile-more-handle" />
            {moreItems.map(item => (
              <button
                key={item.id}
                type="button"
                className={`av2-mobile-more-item${
                  activeTab === item.id ? ' av2-mobile-more-item--active' : ''
                }`}
                onClick={() => handleMoreItemPress(item.id)}
                role="menuitem"
              >
                <span className="av2-mobile-more-item-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
