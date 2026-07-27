/**
 * AppSumo / promo code redemption.
 * Buyers land on /redeem after checkout, connect a wallet, paste their code,
 * and receive seal credits (default 500).
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { api } from './api'
import { writeCreditsBalanceCache } from './creditsBalanceCache'
import './RedeemPage.css'

export interface RedeemPageProps {
  token: string | null
  address: string | null
  connecting: boolean
  onConnect: () => void
  onCreditsRedeemed?: (balance: number, creditsMinted: number) => void
  onGetCredits?: () => void
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function RedeemPage({
  token,
  address,
  connecting,
  onConnect,
  onCreditsRedeemed,
  onGetCredits,
}: RedeemPageProps) {
  const formId = useId()
  const [code, setCode] = useState('')
  const [defaultCredits, setDefaultCredits] = useState(500)
  const [enabled, setEnabled] = useState(true)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [minted, setMinted] = useState<number | null>(null)
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .redeemInfo()
      .then(info => {
        if (cancelled) return
        setEnabled(info.enabled)
        if (info.defaultCredits > 0) setDefaultCredits(info.defaultCredits)
      })
      .catch(() => {
        /* keep defaults */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!token) {
        setError('Connect your wallet first, then redeem your code.')
        setStatus('error')
        return
      }
      const trimmed = code.trim()
      if (!trimmed) {
        setError('Enter the code from your AppSumo purchase.')
        setStatus('error')
        return
      }

      setStatus('submitting')
      setError(null)
      try {
        const result = await api.redeemCode(token, trimmed)
        setMinted(result.creditsMinted)
        setBalance(result.balance)
        setStatus('success')
        writeCreditsBalanceCache(token, result.balance)
        window.dispatchEvent(
          new CustomEvent('verilock:credits-topup', {
            detail: {
              ok: true,
              balance: result.balance,
              creditsMinted: result.creditsMinted,
            },
          }),
        )
        onCreditsRedeemed?.(result.balance, result.creditsMinted)
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Redemption failed')
      }
    },
    [token, code, onCreditsRedeemed],
  )

  return (
    <main className="redeem-page card">
      <p className="redeem-eyebrow">Promo</p>
      <h2>Redeem your code</h2>
      <p className="redeem-lead muted">
        AppSumo buyers get <strong>{defaultCredits} seal credits</strong> per code
        (1 credit = 1 document lock on Nimiq). Connect the wallet you want to use
        with VeriLock, then paste the code from your purchase email or AppSumo library.
      </p>

      {!enabled && (
        <p className="redeem-error" role="alert">
          Credit redemption is temporarily unavailable. Please try again later or
          contact support.
        </p>
      )}

      {status === 'success' ? (
        <div className="redeem-success" role="status">
          <p className="redeem-success-title">
            {minted != null && minted > 0
              ? `+${minted.toLocaleString()} credits added`
              : 'Code redeemed'}
          </p>
          <p className="muted">
            {balance != null && (
              <>
                Your balance is now <strong>{balance.toLocaleString()}</strong> credit
                {balance === 1 ? '' : 's'}.
              </>
            )}{' '}
            Open Pricing or start an agreement to use them for locking documents.
          </p>
          <div className="redeem-success-actions">
            {onGetCredits && (
              <button type="button" className="primary-btn" onClick={onGetCredits}>
                View pricing & balance
              </button>
            )}
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setCode('')
                setStatus('idle')
                setMinted(null)
                setError(null)
              }}
            >
              Redeem another code
            </button>
          </div>
        </div>
      ) : (
        <form className="redeem-form" onSubmit={e => void submit(e)} noValidate>
          <div className="redeem-wallet">
            {token && address ? (
              <p className="redeem-wallet-connected" role="status">
                Credits will go to <span className="redeem-wallet-addr">{shortAddress}</span>
              </p>
            ) : (
              <div className="redeem-wallet-prompt">
                <p className="muted">
                  Sign in with Nimiq Hub or Nimiq Pay so we know which wallet receives
                  the credits.
                </p>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={onConnect}
                  disabled={connecting}
                >
                  {connecting ? 'Connecting…' : 'Connect wallet'}
                </button>
              </div>
            )}
          </div>

          <div className="redeem-fields">
            <label htmlFor={`${formId}-code`}>Redemption code</label>
            <input
              id={`${formId}-code`}
              name="code"
              type="text"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="characters"
              placeholder="e.g. VLAS-XXXX-XXXX-XXXX"
              value={code}
              onChange={e => {
                setCode(e.target.value)
                if (status === 'error') {
                  setStatus('idle')
                  setError(null)
                }
              }}
              disabled={!enabled || status === 'submitting'}
              maxLength={200}
              required
            />
            <p className="redeem-hint muted">
              Spaces and dashes are fine — we normalize the code when you submit.
            </p>
          </div>

          {error && (
            <p className="redeem-error" role="alert">
              {error}
            </p>
          )}

          <div className="redeem-actions">
            <button
              type="submit"
              className="primary-btn"
              disabled={!enabled || status === 'submitting' || !token}
            >
              {status === 'submitting' ? 'Redeeming…' : `Redeem ${defaultCredits} credits`}
            </button>
          </div>
        </form>
      )}

      <p className="redeem-foot muted">
        Each code works once. If you bought multiple licenses, redeem each code on the
        wallet you want funded. Need help?{' '}
        <a href="/support">Contact support</a>.
      </p>
    </main>
  )
}
