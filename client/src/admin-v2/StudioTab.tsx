/**
 * StudioTab — iframe embed for X Post Studio and Blog Studio.
 * Ported from the old admin's Studio tab.
 */
import type { StudioPane } from './components/Sidebar'
import './StudioTab.css'

interface StudioTabProps {
  pane: StudioPane
  studioProxyEnabled?: boolean
}

export function StudioTab({ pane, studioProxyEnabled }: StudioTabProps) {
  const title = pane === 'blog' ? 'Blog Studio' : 'X Post Studio'
  const src = pane === 'blog' ? '/blog-studio' : '/x-studio'

  return (
    <div className="av2-studio">
      <div className="av2-studio-toolbar">
        <div className="av2-studio-status">
          <span
            className={`av2-studio-status-dot${studioProxyEnabled ? ' av2-studio-status-dot--on' : ''}`}
            aria-hidden="true"
          />
          <span className="av2-studio-status-text">
            {studioProxyEnabled ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <a
          className="av2-btn av2-btn-ghost"
          href={src}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in new tab ↗
        </a>
      </div>

      {!studioProxyEnabled ? (
        <div className="av2-studio-missing">
          <h2>Content Studio not connected</h2>
          <p>
            Set <code>CONTENT_STUDIO_URL</code> and{' '}
            <code>CONTENT_STUDIO_TOKEN</code> on the VeriLock Railway service
            (private URL of the <code>content-studio</code> service). Redeploy
            after saving variables.
          </p>
        </div>
      ) : (
        <iframe
          key={pane}
          className="av2-studio-frame"
          title={title}
          src={src}
        />
      )}
    </div>
  )
}
