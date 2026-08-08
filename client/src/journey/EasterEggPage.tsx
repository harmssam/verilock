import { ArrowLeft, Lock, Shield } from 'lucide-react'

/**
 * VeriLock Easter egg page - reachable ONLY by redeeming the special egg document
 * key (the server short-circuits that key in `redeemDocumentKey` and the client
 * lands here). It is not a document: nothing is created, nothing is listed, there
 * is nothing to sign or archive.
 */
export function EasterEggPage({ onHome }: { onHome: () => void }) {
  return (
    <div className="journey">
      <aside className="trust-bar" aria-label="Privacy">
        <div className="trust-bar-main" aria-hidden>
          <Shield className="trust-bar-icon" size={18} strokeWidth={2.25} aria-hidden />
          <span>
            <strong>Locked agreement</strong>
            <span className="trust-bar-sub trust-bar-sub--inline">
              {' '}
              This agreement is view-only and cannot be modified.
            </span>
          </span>
        </div>
      </aside>

      <div className="journey-step-focus">
        <section className="action-dock" aria-live="polite">
          <header className="action-dock-head">
            <div className="journey-toolbar">
              <div className="journey-toolbar-start">
                <button
                  type="button"
                  className="btn btn-ghost journey-reset"
                  onClick={onHome}
                  title="Back to home"
                >
                  <ArrowLeft size={14} strokeWidth={2.25} aria-hidden />
                  Back home
                </button>
                <span className="journey-role-pill">
                  <Lock size={12} strokeWidth={2.25} aria-hidden />
                  Locked
                </span>
              </div>
            </div>
          </header>
          <div className="action-dock-body">
            <div className="result-banner result-banner--locked" role="status">
              <Lock size={18} strokeWidth={2.5} aria-hidden />
              <div>
                <strong>VeriLock Easter egg</strong>
                <p className="result-banner-meta">
                  You found the hidden agreement. It is locked and cannot be modified.
                </p>
              </div>
            </div>
            <div className="easter-egg-frame">
              <img src="/easteregg.png" alt="VeriLock Easter egg" className="easter-egg-image" />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
