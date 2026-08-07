/**
 * Support / contact - public form with layered bot protection
 * (honeypot, min fill time, rate limit, optional Cloudflare Turnstile).
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import {
  MAX_SUPPORT_EMAIL_LENGTH,
  MAX_SUPPORT_MESSAGE_LENGTH,
  MAX_SUPPORT_NAME_LENGTH,
} from './fieldLimits'
import { loadSession } from './session'
import { SUPPORT_ISSUE_OPTIONS, type SupportIssueId } from './supportIssues'
import './SupportPage.css'

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string
          callback?: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
          size?: 'normal' | 'compact' | 'flexible'
        },
      ) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
  }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let turnstileScriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-verilock-turnstile]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile script failed')), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.defer = true
    script.dataset.verilockTurnstile = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile script failed to load'))
    document.head.appendChild(script)
  })

  return turnstileScriptPromise
}

type FormStatus = 'idle' | 'submitting' | 'success' | 'error'

export function SupportPage() {
  const formId = useId()
  const formStartedAtRef = useRef(Date.now())
  const turnstileHostRef = useRef<HTMLDivElement | null>(null)
  const turnstileWidgetIdRef = useRef<string | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [issue, setIssue] = useState<SupportIssueId | ''>('')
  const [message, setMessage] = useState('')
  /** Honeypot - must stay empty. */
  const [website, setWebsite] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null)
  const [turnstileRequired, setTurnstileRequired] = useState(false)
  const [turnstileReady, setTurnstileReady] = useState(false)
  /** Signed-in wallet if present - sent for ops context only, never shown. */
  const walletAddressRef = useRef<string | null>(null)

  const [status, setStatus] = useState<FormStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [ticketPublicId, setTicketPublicId] = useState<string | null>(null)

  useEffect(() => {
    formStartedAtRef.current = Date.now()
    const session = loadSession()
    walletAddressRef.current = session?.address?.trim() || null
  }, [])

  useEffect(() => {
    let cancelled = false
    void api
      .features()
      .then(f => {
        if (cancelled) return
        const key = f.turnstileSiteKey?.trim() || null
        setTurnstileSiteKey(key)
        setTurnstileRequired(Boolean(f.turnstileRequired && key))
      })
      .catch(() => {
        // Features optional for form shell; server still enforces Turnstile when required.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const resetTurnstile = useCallback(() => {
    setTurnstileToken(null)
    const id = turnstileWidgetIdRef.current
    if (id && window.turnstile) {
      try {
        window.turnstile.reset(id)
      } catch {
        // ignore
      }
    }
  }, [])

  useEffect(() => {
    if (!turnstileRequired || !turnstileSiteKey || !turnstileHostRef.current) return
    let cancelled = false

    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !turnstileHostRef.current || !window.turnstile) return
        // Clear previous widget if remounting
        if (turnstileWidgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(turnstileWidgetIdRef.current)
          } catch {
            // ignore
          }
          turnstileWidgetIdRef.current = null
        }
        turnstileHostRef.current.innerHTML = ''
        const widgetId = window.turnstile.render(turnstileHostRef.current, {
          sitekey: turnstileSiteKey,
          theme: 'light',
          size: 'flexible',
          callback: token => {
            if (!cancelled) setTurnstileToken(token)
          },
          'expired-callback': () => {
            if (!cancelled) setTurnstileToken(null)
          },
          'error-callback': () => {
            if (!cancelled) setTurnstileToken(null)
          },
        })
        turnstileWidgetIdRef.current = widgetId
        setTurnstileReady(true)
      })
      .catch(err => {
        console.error('[support] turnstile load', err)
        if (!cancelled) setTurnstileReady(false)
      })

    return () => {
      cancelled = true
      const id = turnstileWidgetIdRef.current
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id)
        } catch {
          // ignore
        }
      }
      turnstileWidgetIdRef.current = null
    }
  }, [turnstileSiteKey, turnstileRequired])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (status === 'submitting') return

    setError(null)

    if (turnstileRequired && !turnstileToken) {
      setError('Please complete the bot check before sending.')
      setStatus('error')
      return
    }

    if (!issue) {
      setError('Please select an issue.')
      setStatus('error')
      return
    }

    setStatus('submitting')
    try {
      // Refresh session wallet at submit in case they signed in after opening the form.
      const session = loadSession()
      const walletAddress = session?.address?.trim() || walletAddressRef.current || null
      walletAddressRef.current = walletAddress

      const result = await api.submitSupportContact({
        name: name.trim(),
        email: email.trim(),
        issue,
        message: message.trim(),
        walletAddress: walletAddress || undefined,
        website,
        formStartedAt: formStartedAtRef.current,
        turnstileToken: turnstileToken ?? undefined,
      })
      setTicketPublicId(result.ticketPublicId?.trim() || null)
      setStatus('success')
      setName('')
      setEmail('')
      setIssue('')
      setMessage('')
      setWebsite('')
      formStartedAtRef.current = Date.now()
      resetTurnstile()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send your message.'
      setError(msg)
      setStatus('error')
      resetTurnstile()
    }
  }

  if (status === 'success') {
    return (
      <div className="card support-page">
        <p className="support-eyebrow">Contact</p>
        <h2>Support</h2>
        <div className="support-success" role="status">
          <p className="support-success-title">Message sent</p>
          <p className="muted">
            Thanks - we received your note. If a reply is needed, we&apos;ll use the email address you
            provided.
          </p>
          {ticketPublicId ? (
            <p className="muted" style={{ marginTop: '0.65rem' }}>
              Reference:{' '}
              <strong style={{ color: 'var(--lr-text, #0f172a)', fontVariantNumeric: 'tabular-nums' }}>
                {ticketPublicId}
              </strong>
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-primary support-again-btn"
            onClick={() => {
              setTicketPublicId(null)
              setStatus('idle')
              setError(null)
              formStartedAtRef.current = Date.now()
            }}
          >
            Send another message
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card support-page">
      <p className="support-eyebrow">Contact</p>
      <h2>Support</h2>
      <p className="muted support-lead">
        Questions about signing, locking, verification, or billing? Send a message and we&apos;ll get back
        to you. Your document never needs to leave your device for support - describe the issue in words; don&apos;t
        attach files here.
      </p>

      <form className="support-form" onSubmit={onSubmit} noValidate>
        {/* Honeypot: hidden from assistive tech and sighted users; bots often fill it. */}
        <div className="support-hp" aria-hidden="true">
          <label htmlFor={`${formId}-website`}>Website</label>
          <input
            id={`${formId}-website`}
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={e => setWebsite(e.target.value)}
          />
        </div>

        <div className="field-stack support-fields">
          <div className="field">
            <label className="field-label" htmlFor={`${formId}-name`}>
              Name
            </label>
            <input
              id={`${formId}-name`}
              name="name"
              type="text"
              autoComplete="name"
              required
              maxLength={MAX_SUPPORT_NAME_LENGTH}
              value={name}
              onChange={e => setName(e.target.value.slice(0, MAX_SUPPORT_NAME_LENGTH))}
              disabled={status === 'submitting'}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${formId}-email`}>
              Email
            </label>
            <input
              id={`${formId}-email`}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              maxLength={MAX_SUPPORT_EMAIL_LENGTH}
              value={email}
              onChange={e => setEmail(e.target.value.slice(0, MAX_SUPPORT_EMAIL_LENGTH))}
              disabled={status === 'submitting'}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${formId}-issue`}>
              Issue
            </label>
            <select
              id={`${formId}-issue`}
              name="issue"
              required
              value={issue}
              onChange={e => setIssue(e.target.value as SupportIssueId | '')}
              disabled={status === 'submitting'}
            >
              <option value="" disabled>
                Select an issue…
              </option>
              {SUPPORT_ISSUE_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${formId}-message`}>
              Message
            </label>
            <textarea
              id={`${formId}-message`}
              name="message"
              required
              rows={6}
              maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, MAX_SUPPORT_MESSAGE_LENGTH))}
              disabled={status === 'submitting'}
              placeholder="What happened, what you expected, and any document title or step (create / sign / lock / verify)."
            />
            <p className="muted support-char-hint">
              {message.length}/{MAX_SUPPORT_MESSAGE_LENGTH}
            </p>
          </div>
        </div>

        {turnstileRequired && turnstileSiteKey ? (
          <div className="support-turnstile">
            <div ref={turnstileHostRef} className="support-turnstile-host" />
            {!turnstileReady && (
              <p className="muted support-turnstile-loading">Loading bot check…</p>
            )}
          </div>
        ) : null}

        {error && (
          <p className="support-error" role="alert">
            {error}
          </p>
        )}

        <div className="support-actions">
          <button
            type="submit"
            className={`btn btn-primary${status === 'submitting' ? ' btn--busy' : ''}`}
            disabled={status === 'submitting' || (turnstileRequired && !turnstileToken)}
          >
            {status === 'submitting' ? 'Sending…' : 'Send message'}
          </button>
        </div>

        <p className="muted support-privacy-note">
          We use your name, email, and message only to respond. Bot checks help block spam. See the{' '}
          <a href="/privacy">Privacy Policy</a> for how VeriLock handles data.
        </p>
      </form>
    </div>
  )
}
