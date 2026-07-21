import { useEffect, useState } from 'react'
import { shortAddress } from './addresses'
import { buildNimiqAddressExplorerUrl } from './explorer'
import { formatPartyRole } from './signing'
import type { DocumentParty, DocumentSignature } from './types'
import './SignaturesPanel.css'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

function resolveImageUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${API_BASE}${path}`
}

interface SignaturesPanelProps {
  signatures: DocumentSignature[]
  parties: DocumentParty[]
  compact?: boolean
  /**
   * When false (public viewer), hide names and ink even if the API leaked them.
   * Prefer server `participantDetailsRevealed`; this is defense-in-depth.
   */
  revealPrivate?: boolean
  /** Session token — required to load private signature images. */
  authToken?: string | null
}

function PrivateSignatureImage({
  src,
  alt,
  token,
}: {
  src: string
  alt: string
  token: string
}) {
  // Authenticated fetch so gated image routes work (img src cannot send Bearer).
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(resolveImageUrl(src), {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok || cancelled) return
        const blob = await res.blob()
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        revoked = url
        setObjectUrl(url)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [src, token])

  if (!objectUrl) {
    return <span className="signatures-panel-typed">Loading signature…</span>
  }
  return (
    <img
      className="signatures-panel-image"
      src={objectUrl}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  )
}

export function SignaturesPanel({
  signatures,
  parties,
  compact,
  revealPrivate = true,
  authToken,
}: SignaturesPanelProps) {
  if (signatures.length === 0) return null

  const partyById = new Map(parties.map(party => [party.id, party]))
  const showPrivate = revealPrivate

  // Public / non-party: address + signed-at only (no names, roles, or ink).
  if (!showPrivate) {
    return (
      <div
        className={`signatures-panel signatures-panel--public${compact ? ' signatures-panel--compact' : ''}`}
      >
        <h3 className="signatures-panel-title">Signatures on this agreement</h3>
        <ul className="signatures-panel-list">
          {signatures.map(sig => {
            const signedAt = new Date(sig.signedAt).toLocaleString()
            return (
              <li key={sig.id} className="signatures-panel-item signatures-panel-item--public">
                <div className="signatures-panel-meta">
                  <a
                    className="signatures-panel-address signatures-panel-address--primary"
                    href={buildNimiqAddressExplorerUrl(sig.signerAddress)}
                    target="_blank"
                    rel="noreferrer"
                    title={sig.signerAddress}
                  >
                    {shortAddress(sig.signerAddress)}
                  </a>
                  <span className="muted">{signedAt}</span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <div className={`signatures-panel${compact ? ' signatures-panel--compact' : ''}`}>
      <h3 className="signatures-panel-title">Recorded signatures</h3>
      <ul className="signatures-panel-list">
        {signatures.map(sig => {
          const party = partyById.get(sig.partyId)
          const role = party ? formatPartyRole(party.role) : 'Signer'
          const signedAt = new Date(sig.signedAt).toLocaleString()
          const name = party?.displayName?.trim() ? party.displayName.trim() : null
          const label = name ?? role
          const imageUrl = sig.imageUrl ?? null

          return (
            <li key={sig.id} className="signatures-panel-item">
              <div className="signatures-panel-meta">
                <strong>{label}</strong>
                <span className="muted">
                  {name ? `${role} · ` : null}
                  <a
                    className="signatures-panel-address"
                    href={buildNimiqAddressExplorerUrl(sig.signerAddress)}
                    target="_blank"
                    rel="noreferrer"
                    title={sig.signerAddress}
                  >
                    {shortAddress(sig.signerAddress)}
                  </a>
                  {' · '}
                  {signedAt}
                </span>
                {sig.signatureType === 'typed' && !imageUrl && (
                  <span className="signatures-panel-typed">Typed acknowledgment</span>
                )}
              </div>
              {imageUrl && authToken ? (
                <PrivateSignatureImage
                  src={imageUrl}
                  alt={`Signature of ${label}`}
                  token={authToken}
                />
              ) : imageUrl ? (
                <img
                  className="signatures-panel-image"
                  src={resolveImageUrl(imageUrl)}
                  alt={`Signature of ${label}`}
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
