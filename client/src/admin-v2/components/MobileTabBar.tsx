/**
 * Mobile bottom tab bar (<768px). Fixed at the bottom with 5 icon tabs.
 * "More" tab opens a slide-up menu with Content + Settings.
 */
import { useState } from 'react'
import { Badge } from './Badge'
import type { AdminV2Tab } from './Sidebar'
import './MobileTabBar.css'

interface MobileTabBarProps {
  activeTab: AdminV2Tab
  onTabChange: (tab: AdminV2Tab) => void
}

interface TabItem {
  id: AdminV2Tab | 'more'
  label: string
  icon: string
  badge?: number
}

export function MobileTabBar({ activeTab, onTabChange }: MobileTabBarProps) {
  const [moreOpen, setMoreOpen] = useState(false)

  const tabs: TabItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'inbox', label: 'Inbox', icon: '📬', badge: 0 },
    { id: 'support', label: 'Support', icon: '🎫', badge: 0 },
    { id: 'stats', label: 'Stats', icon: '📈' },
    { id: 'more', label: 'More', icon: '⋯' },
  ]

  const moreItems: { id: AdminV2Tab; label: string; icon: string }[] = [
    { id: 'content', label: 'Content', icon: '✍️' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
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

  const isMoreActive = activeTab === 'content' || activeTab === 'settings'

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
