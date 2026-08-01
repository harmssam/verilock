/**
 * Admin v2 Settings — auto-ack editor + placeholder sections for Notifications and Display.
 */
import { useCallback, useEffect, useState } from 'react'
import { adminApi, type SupportAutoAckSettings } from '../admin/adminApi'
import './SettingsTab.css'

export function SettingsTab() {
  // Auto-ack
  const [autoAckMeta, setAutoAckMeta] = useState<SupportAutoAckSettings | null>(null)
  const [autoAckDraft, setAutoAckDraft] = useState('')
  const [autoAckLoading, setAutoAckLoading] = useState(true)
  const [autoAckBusy, setAutoAckBusy] = useState(false)
  const [autoAckError, setAutoAckError] = useState<string | null>(null)
  const [autoAckSaved, setAutoAckSaved] = useState(false)

  const loadAutoAck = useCallback(async () => {
    setAutoAckLoading(true)
    setAutoAckError(null)
    try {
      const settings = await adminApi.supportAutoAck()
      setAutoAckMeta(settings)
      setAutoAckDraft(settings.body)
      setAutoAckSaved(false)
    } catch (err) {
      setAutoAckError(err instanceof Error ? err.message : 'Could not load auto-reply')
    } finally {
      setAutoAckLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAutoAck()
  }, [loadAutoAck])

  async function saveAutoAck() {
    if (autoAckBusy) return
    setAutoAckBusy(true)
    setAutoAckError(null)
    setAutoAckSaved(false)
    try {
      const result = await adminApi.saveSupportAutoAck(autoAckDraft)
      setAutoAckMeta(result)
      setAutoAckDraft(result.body)
      setAutoAckSaved(true)
    } catch (err) {
      setAutoAckError(err instanceof Error ? err.message : 'Could not save auto-reply')
    } finally {
      setAutoAckBusy(false)
    }
  }

  async function resetAutoAck() {
    if (autoAckBusy) return
    setAutoAckBusy(true)
    setAutoAckError(null)
    setAutoAckSaved(false)
    try {
      const result = await adminApi.resetSupportAutoAck()
      setAutoAckMeta(result)
      setAutoAckDraft(result.body)
      setAutoAckSaved(true)
    } catch (err) {
      setAutoAckError(err instanceof Error ? err.message : 'Could not reset auto-reply')
    } finally {
      setAutoAckBusy(false)
    }
  }

  return (
    <div className="av2-settings">
      <div className="av2-dash-head">
        <div>
          <h1 className="av2-dash-title">Settings</h1>
          <p className="av2-dash-subtitle">Configure admin behavior and preferences.</p>
        </div>
      </div>

      {/* ── Auto-ack section ─────────────────────────────────────────── */}
      <section className="av2-settings-section">
        <h2 className="av2-settings-section-title">
          <span className="av2-settings-section-icon" aria-hidden="true">📧</span>
          Support Auto-Reply
        </h2>
        <p className="av2-settings-section-desc">
          Sent automatically when someone submits the contact form (when outbound email is
          enabled). Use placeholders:{' '}
          <code>{'{{name}}'}</code>, <code>{'{{publicId}}'}</code>,{' '}
          <code>{'{{subject}}'}</code>, <code>{'{{site}}'}</code>.
        </p>

        {autoAckLoading && !autoAckMeta ? (
          <p className="av2-settings-loading">Loading auto-reply…</p>
        ) : (
          <div className="av2-settings-auto-ack">
            <div className="av2-settings-auto-ack-meta">
              <span className="av2-settings-auto-ack-badge">
                {autoAckMeta?.isCustom ? 'Custom' : 'Default'}
              </span>
              {autoAckMeta?.updatedAt && (
                <span className="av2-settings-auto-ack-updated">
                  Last updated: {new Date(autoAckMeta.updatedAt).toLocaleString()}
                </span>
              )}
            </div>
            <textarea
              className="av2-settings-auto-ack-textarea"
              value={autoAckDraft}
              onChange={e => {
                setAutoAckDraft(e.target.value)
                setAutoAckSaved(false)
              }}
              rows={8}
              maxLength={autoAckMeta?.maxLength ?? 8000}
              disabled={autoAckBusy}
              spellCheck
              aria-label="Initial contact auto-reply message"
            />
            <div className="av2-settings-auto-ack-footer">
              <span className="av2-settings-auto-ack-count">
                {autoAckDraft.length.toLocaleString()}
                {autoAckMeta?.maxLength
                  ? ` / ${autoAckMeta.maxLength.toLocaleString()}`
                  : ''}
              </span>
              <div className="av2-settings-auto-ack-actions">
                <button
                  type="button"
                  className="av2-btn av2-btn-ghost"
                  onClick={() => void resetAutoAck()}
                  disabled={autoAckBusy || !autoAckMeta?.isCustom}
                  title={
                    autoAckMeta?.isCustom
                      ? 'Restore the built-in default message'
                      : 'Already using the built-in default'
                  }
                >
                  Reset to default
                </button>
                <button
                  type="button"
                  className="av2-btn av2-btn-primary"
                  onClick={() => void saveAutoAck()}
                  disabled={
                    autoAckBusy ||
                    autoAckDraft.trim().length < 8 ||
                    (autoAckMeta != null && autoAckDraft === autoAckMeta.body)
                  }
                >
                  {autoAckBusy ? 'Saving…' : 'Save auto-reply'}
                </button>
              </div>
            </div>
            {autoAckError ? (
              <p className="av2-error" role="alert">
                {autoAckError}
              </p>
            ) : null}
            {autoAckSaved && !autoAckError ? (
              <p className="av2-settings-saved" role="status">
                ✓ Saved. New contact submissions will use this message.
              </p>
            ) : null}
          </div>
        )}
      </section>

      {/* ── Notifications placeholder (Phase 3) ──────────────────────── */}
      <section className="av2-settings-section av2-settings-section--placeholder">
        <h2 className="av2-settings-section-title">
          <span className="av2-settings-section-icon" aria-hidden="true">🔔</span>
          Notifications
        </h2>
        <p className="av2-settings-placeholder-text">
          Notification preferences will be available in a future update. You'll be able to
          configure email digests, browser notifications, and ticket assignment alerts.
        </p>
      </section>

      {/* ── Display placeholder (Phase 4) ────────────────────────────── */}
      <section className="av2-settings-section av2-settings-section--placeholder">
        <h2 className="av2-settings-section-title">
          <span className="av2-settings-section-icon" aria-hidden="true">🎨</span>
          Display
        </h2>
        <p className="av2-settings-placeholder-text">
          Theme and display preferences (dark mode, font size, density) will be available in a
          future update.
        </p>
      </section>
    </div>
  )
}
