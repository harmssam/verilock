/**
 * Admin v2 Settings — auto-ack, OpenCode, Imagine proxy, audit log.
 */
import { useCallback, useEffect, useState } from 'react'
import { Mail, ClipboardList, Palette, KeyRound, Image } from 'lucide-react'
import {
  adminApi,
  type ImagineProxyConfigStatus,
  type OpenCodeConfigStatus,
  type SupportAutoAckSettings,
} from '../admin/adminApi'
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

  // OpenCode Go API
  const [openCodeMeta, setOpenCodeMeta] = useState<OpenCodeConfigStatus | null>(null)
  const [openCodeDraft, setOpenCodeDraft] = useState('')
  const [openCodeLoading, setOpenCodeLoading] = useState(true)
  const [openCodeBusy, setOpenCodeBusy] = useState(false)
  const [openCodeError, setOpenCodeError] = useState<string | null>(null)
  const [openCodeSaved, setOpenCodeSaved] = useState(false)
  const [openCodeShow, setOpenCodeShow] = useState(false)

  // Grok Imagine proxy
  const [imagineMeta, setImagineMeta] = useState<ImagineProxyConfigStatus | null>(null)
  const [imaginePasteDraft, setImaginePasteDraft] = useState('')
  const [imagineUrlDraft, setImagineUrlDraft] = useState('')
  const [imagineTokenDraft, setImagineTokenDraft] = useState('')
  const [imagineLoading, setImagineLoading] = useState(true)
  const [imagineBusy, setImagineBusy] = useState(false)
  const [imagineError, setImagineError] = useState<string | null>(null)
  const [imagineSaved, setImagineSaved] = useState(false)
  const [imagineTokenShow, setImagineTokenShow] = useState(false)
  const [imagineShowAdvanced, setImagineShowAdvanced] = useState(false)

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

  const loadOpenCode = useCallback(async () => {
    setOpenCodeLoading(true)
    setOpenCodeError(null)
    try {
      const status = await adminApi.openCodeConfig()
      setOpenCodeMeta(status)
      setOpenCodeDraft('')
      setOpenCodeSaved(false)
    } catch (err) {
      setOpenCodeError(err instanceof Error ? err.message : 'Could not load OpenCode config')
    } finally {
      setOpenCodeLoading(false)
    }
  }, [])

  const loadImagine = useCallback(async () => {
    setImagineLoading(true)
    setImagineError(null)
    try {
      const status = await adminApi.imagineProxyConfig()
      setImagineMeta(status)
      setImagineUrlDraft(status.proxyUrl ?? '')
      setImagineTokenDraft('')
      setImagineSaved(false)
    } catch (err) {
      setImagineError(err instanceof Error ? err.message : 'Could not load Imagine proxy config')
    } finally {
      setImagineLoading(false)
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
    void loadOpenCode()
    void loadImagine()
    void loadAuditLog(0, '')
  }, [loadAutoAck, loadOpenCode, loadImagine, loadAuditLog])

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

  async function saveOpenCode() {
    if (openCodeBusy) return
    const key = openCodeDraft.trim()
    if (key.length < 8) {
      setOpenCodeError('API key is too short.')
      return
    }
    setOpenCodeBusy(true)
    setOpenCodeError(null)
    setOpenCodeSaved(false)
    try {
      const result = await adminApi.saveOpenCodeApiKey(key)
      setOpenCodeMeta(result)
      setOpenCodeDraft('')
      setOpenCodeSaved(true)
    } catch (err) {
      setOpenCodeError(err instanceof Error ? err.message : 'Could not save API key')
    } finally {
      setOpenCodeBusy(false)
    }
  }

  async function clearOpenCode() {
    if (openCodeBusy) return
    setOpenCodeBusy(true)
    setOpenCodeError(null)
    setOpenCodeSaved(false)
    try {
      const result = await adminApi.clearOpenCodeApiKey()
      setOpenCodeMeta(result)
      setOpenCodeDraft('')
      setOpenCodeSaved(true)
    } catch (err) {
      setOpenCodeError(err instanceof Error ? err.message : 'Could not clear API key')
    } finally {
      setOpenCodeBusy(false)
    }
  }

  async function saveImagine() {
    if (imagineBusy) return
    const paste = imaginePasteDraft.trim()
    const url = imagineUrlDraft.trim()
    const token = imagineTokenDraft.trim()
    if (!paste && !url && !token) {
      setImagineError('Paste the setup string from Imagine Bridge (or enter a proxy URL).')
      return
    }
    if (!paste && url) {
      try {
        const u = new URL(url)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          setImagineError('Proxy URL must be http or https.')
          return
        }
      } catch {
        setImagineError('Invalid proxy URL.')
        return
      }
    }
    setImagineBusy(true)
    setImagineError(null)
    setImagineSaved(false)
    try {
      // Prefer one clipboard paste from Imagine Bridge.
      if (paste) {
        const result = await adminApi.saveImagineProxyConfig({ paste })
        setImagineMeta(result)
        setImagineUrlDraft(result.proxyUrl ?? '')
        setImagineTokenDraft('')
        setImaginePasteDraft('')
        setImagineSaved(true)
        return
      }
      const body: { proxyUrl?: string; proxyToken?: string } = {}
      if (url) body.proxyUrl = url
      if (token) body.proxyToken = token
      // If only token changed, still send current URL so studio has a full override.
      if (!url && token && imagineMeta?.proxyUrl) body.proxyUrl = imagineMeta.proxyUrl
      const result = await adminApi.saveImagineProxyConfig(body)
      setImagineMeta(result)
      setImagineUrlDraft(result.proxyUrl ?? '')
      setImagineTokenDraft('')
      setImagineSaved(true)
    } catch (err) {
      setImagineError(err instanceof Error ? err.message : 'Could not save Imagine proxy')
    } finally {
      setImagineBusy(false)
    }
  }

  async function clearImagine() {
    if (imagineBusy) return
    setImagineBusy(true)
    setImagineError(null)
    setImagineSaved(false)
    try {
      const result = await adminApi.clearImagineProxyConfig()
      setImagineMeta(result)
      setImaginePasteDraft('')
      setImagineUrlDraft(result.proxyUrl ?? '')
      setImagineTokenDraft('')
      setImagineSaved(true)
    } catch (err) {
      setImagineError(err instanceof Error ? err.message : 'Could not clear Imagine proxy')
    } finally {
      setImagineBusy(false)
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

      {/* ── OpenCode Go API ──────────────────────────────────────────── */}
      <section className="av2-settings-section">
        <h2 className="av2-settings-section-title">
          <span className="av2-settings-section-icon" aria-hidden="true">
            <KeyRound size={18} strokeWidth={1.5} />
          </span>
          OpenCode Go API
        </h2>
        <p className="av2-settings-section-desc">
          API key for{' '}
          <a
            href="https://opencode.ai/docs/go/"
            target="_blank"
            rel="noopener noreferrer"
            className="av2-settings-link"
          >
            OpenCode Go
          </a>{' '}
          used by Blog Studio / X Studio LLM. Saving here stores the key on VeriLock and pushes it
          to the content-studio service (runtime override of <code>OPENCODE_API_KEY</code> — no
          redeploy). The full token is never shown after save.
        </p>

        {openCodeLoading && !openCodeMeta ? (
          <p className="av2-settings-loading">Loading OpenCode config…</p>
        ) : (
          <div className="av2-settings-opencode">
            <div className="av2-settings-auto-ack-meta">
              <span
                className={
                  openCodeMeta?.configured
                    ? 'av2-settings-auto-ack-badge'
                    : 'av2-settings-auto-ack-badge av2-settings-badge--muted'
                }
              >
                {openCodeMeta?.configured
                  ? openCodeMeta.source === 'database'
                    ? 'Saved in database'
                    : 'From environment'
                  : 'Not configured'}
              </span>
              {openCodeMeta?.maskedToken ? (
                <span className="av2-settings-token-mask" title="Masked token">
                  <code>{openCodeMeta.maskedToken}</code>
                </span>
              ) : null}
              {openCodeMeta?.updatedAt ? (
                <span className="av2-settings-auto-ack-updated">
                  Last updated: {new Date(openCodeMeta.updatedAt).toLocaleString()}
                </span>
              ) : null}
            </div>

            {(openCodeMeta?.model || openCodeMeta?.modelFallback) && (
              <p className="av2-settings-opencode-models">
                Models (env):{' '}
                {openCodeMeta.model ? <code>{openCodeMeta.model}</code> : '—'}
                {openCodeMeta.modelFallback ? (
                  <>
                    {' '}
                    · fallback <code>{openCodeMeta.modelFallback}</code>
                  </>
                ) : null}
              </p>
            )}

            <label className="av2-settings-field-label" htmlFor="av2-opencode-api-key">
              {openCodeMeta?.configured ? 'Replace API key' : 'API key'}
            </label>
            <div className="av2-settings-token-row">
              <input
                id="av2-opencode-api-key"
                className="av2-settings-token-input"
                type={openCodeShow ? 'text' : 'password'}
                value={openCodeDraft}
                onChange={e => {
                  setOpenCodeDraft(e.target.value)
                  setOpenCodeSaved(false)
                  setOpenCodeError(null)
                }}
                placeholder={
                  openCodeMeta?.configured
                    ? 'Paste a new key to replace the current one'
                    : 'sk-…'
                }
                autoComplete="off"
                spellCheck={false}
                disabled={openCodeBusy}
                aria-label="OpenCode Go API key"
              />
              <button
                type="button"
                className="av2-btn av2-btn-ghost av2-btn-sm"
                onClick={() => setOpenCodeShow(v => !v)}
                disabled={openCodeBusy}
              >
                {openCodeShow ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className="av2-settings-auto-ack-footer">
              <span className="av2-settings-auto-ack-count">
                {openCodeMeta?.hasEnvironmentKey
                  ? 'Env key present — clear saved key to fall back to it.'
                  : openCodeMeta?.hasDatabaseOverride
                    ? 'Only the database key is set.'
                    : 'No key in env or database yet.'}
              </span>
              <div className="av2-settings-auto-ack-actions">
                <button
                  type="button"
                  className="av2-btn av2-btn-ghost"
                  onClick={() => void clearOpenCode()}
                  disabled={openCodeBusy || !openCodeMeta?.hasDatabaseOverride}
                  title={
                    openCodeMeta?.hasDatabaseOverride
                      ? 'Remove the database key (env may still apply)'
                      : 'No database key to clear'
                  }
                >
                  Clear saved key
                </button>
                <button
                  type="button"
                  className="av2-btn av2-btn-primary"
                  onClick={() => void saveOpenCode()}
                  disabled={openCodeBusy || openCodeDraft.trim().length < 8}
                >
                  {openCodeBusy ? 'Saving…' : 'Save API key'}
                </button>
              </div>
            </div>

            {openCodeError ? (
              <p className="av2-error" role="alert">
                {openCodeError}
              </p>
            ) : null}
            {openCodeSaved && !openCodeError ? (
              <p className="av2-settings-saved" role="status">
                {openCodeMeta?.studioSynced === false
                  ? '✓ Saved on VeriLock, but content-studio sync failed — see error below.'
                  : '✓ Saved. Blog Studio will use this key for OpenCode Go.'}
              </p>
            ) : null}
            {openCodeMeta?.studioError ? (
              <p className="av2-error" role="alert">
                Studio sync: {openCodeMeta.studioError}
              </p>
            ) : null}
            {openCodeMeta?.studioSynced === true && !openCodeError && !openCodeSaved ? (
              <p className="av2-settings-auto-ack-updated" style={{ marginTop: '0.5rem' }}>
                Content-studio is using this key for generation.
              </p>
            ) : null}
          </div>
        )}
      </section>

      {/* ── Grok Imagine proxy ───────────────────────────────────────── */}
      <section className="av2-settings-section">
        <h2 className="av2-settings-section-title">
          <span className="av2-settings-section-icon" aria-hidden="true">
            <Image size={18} strokeWidth={1.5} />
          </span>
          Grok Imagine proxy
        </h2>
        <p className="av2-settings-section-desc">
          One paste from Imagine Bridge. Copy the setup string on the bridge status page
          (looks like <code>https://….trycloudflare.com#token=…</code>), paste below, Save.
          Pushed to content-studio — no redeploy. Quick tunnels change every launch.
        </p>

        {imagineLoading && !imagineMeta ? (
          <p className="av2-settings-loading">Loading Imagine proxy config…</p>
        ) : (
          <div className="av2-settings-imagine">
            <div className="av2-settings-auto-ack-meta">
              <span
                className={
                  imagineMeta?.configured
                    ? 'av2-settings-auto-ack-badge'
                    : 'av2-settings-auto-ack-badge av2-settings-badge--muted'
                }
              >
                {imagineMeta?.configured
                  ? imagineMeta.source === 'database'
                    ? 'Saved in database'
                    : 'From environment'
                  : 'Not configured'}
              </span>
              {imagineMeta?.tokenConfigured ? (
                <span className="av2-settings-token-mask" title="Masked token">
                  token <code>{imagineMeta.maskedToken ?? '••••'}</code>
                </span>
              ) : (
                <span className="av2-settings-auto-ack-updated">No proxy token set</span>
              )}
              {imagineMeta?.updatedAt ? (
                <span className="av2-settings-auto-ack-updated">
                  Last updated: {new Date(imagineMeta.updatedAt).toLocaleString()}
                </span>
              ) : null}
            </div>

            {imagineMeta?.proxyUrl ? (
              <p className="av2-settings-auto-ack-updated" style={{ margin: '0.35rem 0 0.75rem' }}>
                Current URL: <code style={{ wordBreak: 'break-all' }}>{imagineMeta.proxyUrl}</code>
              </p>
            ) : null}

            <label className="av2-settings-field-label" htmlFor="av2-imagine-proxy-paste">
              Setup string (paste once)
            </label>
            <textarea
              id="av2-imagine-proxy-paste"
              className="av2-settings-auto-ack-textarea av2-settings-imagine-paste"
              value={imaginePasteDraft}
              onChange={e => {
                setImaginePasteDraft(e.target.value)
                setImagineSaved(false)
                setImagineError(null)
              }}
              onPaste={e => {
                // Capture clipboard even if browser tries to sanitize
                const text = e.clipboardData?.getData('text')?.trim()
                if (text && (text.includes('#token=') || text.includes('IMAGINE_PROXY') || text.includes('|'))) {
                  e.preventDefault()
                  setImaginePasteDraft(text)
                  setImagineSaved(false)
                  setImagineError(null)
                }
              }}
              placeholder="https://something.trycloudflare.com#token=yoursecret"
              rows={3}
              autoComplete="off"
              spellCheck={false}
              disabled={imagineBusy}
              aria-label="Imagine Bridge setup string"
            />
            <p className="av2-settings-auto-ack-updated" style={{ marginTop: '0.35rem' }}>
              Paste the full line from Imagine Bridge — do not split into URL and token.
            </p>

            <div className="av2-settings-auto-ack-footer" style={{ marginTop: '0.85rem' }}>
              <span className="av2-settings-auto-ack-count">
                {imagineMeta?.hasDatabaseOverride
                  ? 'Using database override (syncs to content-studio).'
                  : 'Run Imagine Bridge → Connected → Copy setup string → paste here → Save.'}
              </span>
              <div className="av2-settings-auto-ack-actions">
                <button
                  type="button"
                  className="av2-btn av2-btn-ghost"
                  onClick={() => void clearImagine()}
                  disabled={imagineBusy || !imagineMeta?.hasDatabaseOverride}
                  title={
                    imagineMeta?.hasDatabaseOverride
                      ? 'Remove saved URL/token (env may still apply)'
                      : 'No database override to clear'
                  }
                >
                  Clear saved
                </button>
                <button
                  type="button"
                  className="av2-btn av2-btn-primary"
                  onClick={() => void saveImagine()}
                  disabled={
                    imagineBusy ||
                    (!imaginePasteDraft.trim() &&
                      !imagineUrlDraft.trim() &&
                      !imagineTokenDraft.trim())
                  }
                >
                  {imagineBusy ? 'Saving…' : 'Save setup string'}
                </button>
              </div>
            </div>

            <button
              type="button"
              className="av2-btn av2-btn-ghost av2-btn-sm"
              style={{ marginTop: '0.85rem' }}
              onClick={() => setImagineShowAdvanced(v => !v)}
              disabled={imagineBusy}
            >
              {imagineShowAdvanced ? 'Hide advanced fields' : 'Advanced: separate URL / token'}
            </button>

            {imagineShowAdvanced ? (
              <>
                <label
                  className="av2-settings-field-label"
                  htmlFor="av2-imagine-proxy-url"
                  style={{ marginTop: '0.85rem' }}
                >
                  Proxy URL
                </label>
                <input
                  id="av2-imagine-proxy-url"
                  className="av2-settings-token-input"
                  type="text"
                  inputMode="url"
                  value={imagineUrlDraft}
                  onChange={e => {
                    const v = e.target.value
                    // If operator pastes full setup string into URL field, route to paste box
                    if (
                      v.includes('#token=') ||
                      v.includes('|') ||
                      /IMAGINE_PROXY_/i.test(v)
                    ) {
                      setImaginePasteDraft(v.trim())
                      setImagineUrlDraft('')
                      setImagineTokenDraft('')
                    } else {
                      setImagineUrlDraft(v)
                    }
                    setImagineSaved(false)
                    setImagineError(null)
                  }}
                  placeholder="https://….trycloudflare.com"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={imagineBusy}
                  aria-label="Imagine proxy URL"
                />

                <label
                  className="av2-settings-field-label"
                  htmlFor="av2-imagine-proxy-token"
                  style={{ marginTop: '0.85rem' }}
                >
                  Shared token {imagineMeta?.tokenConfigured ? '(leave blank to keep)' : '(optional)'}
                </label>
                <div className="av2-settings-token-row">
                  <input
                    id="av2-imagine-proxy-token"
                    className="av2-settings-token-input"
                    type={imagineTokenShow ? 'text' : 'password'}
                    value={imagineTokenDraft}
                    onChange={e => {
                      setImagineTokenDraft(e.target.value)
                      setImagineSaved(false)
                      setImagineError(null)
                    }}
                    placeholder={
                      imagineMeta?.tokenConfigured
                        ? 'Paste a new token to replace'
                        : 'Same as laptop IMAGINE_PROXY_TOKEN'
                    }
                    autoComplete="off"
                    spellCheck={false}
                    disabled={imagineBusy}
                    aria-label="Imagine proxy shared token"
                  />
                  <button
                    type="button"
                    className="av2-btn av2-btn-ghost av2-btn-sm"
                    onClick={() => setImagineTokenShow(v => !v)}
                    disabled={imagineBusy}
                  >
                    {imagineTokenShow ? 'Hide' : 'Show'}
                  </button>
                </div>
              </>
            ) : null}

            {imagineError ? (
              <p className="av2-error" role="alert">
                {imagineError}
              </p>
            ) : null}
            {imagineSaved && !imagineError ? (
              <p className="av2-settings-saved" role="status">
                {imagineMeta?.studioSynced === false
                  ? '✓ Saved on VeriLock, but content-studio sync failed — see error below.'
                  : '✓ Saved. Blog Studio Imagine will use this proxy URL.'}
              </p>
            ) : null}
            {imagineMeta?.studioError ? (
              <p className="av2-error" role="alert">
                Studio sync: {imagineMeta.studioError}
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
