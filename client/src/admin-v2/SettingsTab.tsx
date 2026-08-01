/**
 * Admin v2 Settings — auto-ack editor + audit log.
 */
import { useCallback, useEffect, useState } from 'react'
import { Mail, ClipboardList, Palette } from 'lucide-react'
import { adminApi, type SupportAutoAckSettings } from '../admin/adminApi'
import './SettingsTab.css'

interface AuditEntry {
  id: string
  action: string
  actor: string
  target_type: string | null
  target_id: string | null
  detail: string | null
  metadata: unknown
  created_at: number
}

function formatWhen(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}

export function SettingsTab() {
  // Auto-ack
  const [autoAckMeta, setAutoAckMeta] = useState<SupportAutoAckSettings | null>(null)
  const [autoAckDraft, setAutoAckDraft] = useState('')
  const [autoAckLoading, setAutoAckLoading] = useState(true)
  const [autoAckBusy, setAutoAckBusy] = useState(false)
  const [autoAckError, setAutoAckError] = useState<string | null>(null)
  const [autoAckSaved, setAutoAckSaved] = useState(false)

  // Audit log
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditActions, setAuditActions] = useState<string[]>([])
  const [auditFilter, setAuditFilter] = useState('')
  const [auditOffset, setAuditOffset] = useState(0)
  const [auditLoading, setAuditLoading] = useState(false)
  const auditPageSize = 20

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

  const loadAuditLog = useCallback(async (offset: number, filter: string) => {
    setAuditLoading(true)
    try {
      const result = await adminApi.auditLog({
        limit: auditPageSize,
        offset,
        action: filter || undefined,
      })
      setAuditEntries(result.entries)
      setAuditTotal(result.total)
      setAuditActions(result.actions)
    } catch (err) {
      console.error('[settings] audit log load', err)
    } finally {
      setAuditLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAutoAck()
    void loadAuditLog(0, '')
  }, [loadAutoAck, loadAuditLog])

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

  function handleAuditFilterChange(newFilter: string) {
    setAuditFilter(newFilter)
    setAuditOffset(0)
    void loadAuditLog(0, newFilter)
  }

  function handleAuditPage(offset: number) {
    setAuditOffset(offset)
    void loadAuditLog(offset, auditFilter)
  }

  const hasPrev = auditOffset > 0
  const hasNext = auditOffset + auditPageSize < auditTotal

  return (
    <div className="av2-settings">
      <div className="av2-dash-head">
        <div>
          <h1 className="av2-dash-title">Settings</h1>
          <p className="av2-dash-subtitle">Configure admin behavior and review activity.</p>
        </div>
      </div>

      {/* ── Auto-ack section ─────────────────────────────────────────── */}
      <section className="av2-settings-section">
        <h2 className="av2-settings-section-title">
          <span className="av2-settings-section-icon" aria-hidden="true">
            <Mail size={18} strokeWidth={1.5} />
          </span>
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

      {/* ── Audit Log section ────────────────────────────────────────── */}
      <section className="av2-settings-section">
        <h2 className="av2-settings-section-title">
          <span className="av2-settings-section-icon" aria-hidden="true">
            <ClipboardList size={18} strokeWidth={1.5} />
          </span>
          Audit Log
        </h2>
        <p className="av2-settings-section-desc">
          Track admin actions — status changes, bulk operations, tag updates, and more.
        </p>

        {/* Filter */}
        {auditActions.length > 0 && (
          <div className="av2-audit-filters" style={{ marginBottom: '0.75rem' }}>
            <select
              value={auditFilter}
              onChange={e => handleAuditFilterChange(e.target.value)}
              className="av2-audit-select"
              aria-label="Filter by action type"
            >
              <option value="">All actions</option>
              {auditActions.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <span className="av2-audit-total">{auditTotal.toLocaleString()} entries</span>
          </div>
        )}

        {auditLoading && auditEntries.length === 0 ? (
          <p className="av2-settings-loading">Loading audit log…</p>
        ) : auditEntries.length === 0 ? (
          <p className="av2-settings-placeholder-text">
            No audit log entries yet. Admin actions will appear here as they happen.
          </p>
        ) : (
          <>
            <div className="av2-audit-table-wrap">
              <table className="av2-audit-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map(e => (
                    <tr key={e.id}>
                      <td className="av2-audit-time">{formatWhen(e.created_at)}</td>
                      <td className="av2-audit-actor">{e.actor}</td>
                      <td>
                        <span className="av2-audit-action-chip">{e.action}</span>
                      </td>
                      <td className="av2-audit-detail">{e.detail || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="av2-audit-pagination">
              <button
                type="button"
                className="av2-btn av2-btn-ghost av2-btn-sm"
                disabled={!hasPrev}
                onClick={() => handleAuditPage(auditOffset - auditPageSize)}
              >
                ← Previous
              </button>
              <span className="av2-audit-page-info">
                {auditOffset + 1}–{Math.min(auditOffset + auditPageSize, auditTotal)} of {auditTotal.toLocaleString()}
              </span>
              <button
                type="button"
                className="av2-btn av2-btn-ghost av2-btn-sm"
                disabled={!hasNext}
                onClick={() => handleAuditPage(auditOffset + auditPageSize)}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── Display placeholder ──────────────────────────────────────── */}
      <section className="av2-settings-section av2-settings-section--placeholder">
        <h2 className="av2-settings-section-title">
          <span className="av2-settings-section-icon" aria-hidden="true">
            <Palette size={18} strokeWidth={1.5} />
          </span>
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
