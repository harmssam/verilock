import { useEffect, useState } from 'react'
import { shortAddress, normalizeAddress } from './addresses'
import { api } from './api'
import { buildNimiqAddressExplorerUrl } from './explorer'
import type { PlacementSlot } from './pdf/placements'
import { reconstructAnnotationsFromPlanAndFills } from './pdf/placementStream'
import { formatPartyRole } from './signing'
import type { DocumentParty, DocumentSignature } from './types'
import './SignaturesPanel.css'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

function resolveImageUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path
  }
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
  /** Session token — required to load private signature images / fill frames. */
  authToken?: string | null
  /**
   * Document fingerprint (original sha256). When set with authToken, prefer full
   * signature ink from placement fills over the stored party image (which may
   * incorrectly be initials from older clients).
   */
  fingerprint?: string | null
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
        // data: URLs don't need auth fetch
        if (src.startsWith('data:')) {
          if (!cancelled) setObjectUrl(src)
          return
        }
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

/**
 * Rebuild full-signature PNGs from placement fill frames (signature slots only).
 * Returns map: partyId → data URL.
 */
async function loadSignatureInkFromPlacementFills(input: {
  fingerprint: string
  authToken: string
  parties: DocumentParty[]
}): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const hash = input.fingerprint.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) return out

  const planRes = await api.getPlacementPlan(hash, input.authToken)
  if (!planRes.fillPayloadRevealed) return out

  const slots: PlacementSlot[] = (planRes.plan?.slots ?? []).map(s => ({
    id: s.id,
    personSlotIndex: s.personSlotIndex,
    kind: (s.kind as PlacementSlot['kind']) || 'signature',
    pageIndex: s.pageIndex,
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    ...(s.lockedContent ? { lockedContent: s.lockedContent } : {}),
  }))
  const signatureSlots = slots.filter(s => s.kind === 'signature')
  if (signatureSlots.length === 0) return out

  const fillBatches = planRes.fillBatches ?? []
  if (!fillBatches.some(b => Array.isArray(b.framesHex) && b.framesHex.length > 0)) {
    return out
  }

  const { annotations } = await reconstructAnnotationsFromPlanAndFills({
    slots: signatureSlots,
    fillBatches,
  })

  // personSlotIndex → ink path (first signature-slot fill for that person)
  const pathByPerson = new Map<
    number,
    { epsilon: number; lineWidthRatio: number; strokes: Array<{ points: Array<{ x: number; y: number }> }>; captureAspect?: number }
  >()
  for (const ann of annotations) {
    if (ann.type !== 'signature' || !ann.path?.strokes?.length) continue
    const slot = signatureSlots.find(s => s.id === ann.id)
    if (!slot) continue
    if (!pathByPerson.has(slot.personSlotIndex)) {
      pathByPerson.set(slot.personSlotIndex, ann.path)
    }
  }
  if (pathByPerson.size === 0) return out

  const people = planRes.plan?.people ?? []
  const required = input.parties.filter(p => p.required)
  const orderedParties =
    required.length > 0 ? required : [...input.parties].sort((a, b) => a.id.localeCompare(b.id))

  const personToParty = new Map<number, string>()
  for (const person of people) {
    const personWallet = person.walletAddress?.replace(/\s/g, '').toUpperCase()
    const byWallet =
      personWallet &&
      orderedParties.find(
        p =>
          p.walletAddress &&
          p.walletAddress.replace(/\s/g, '').toUpperCase() === personWallet,
      )
    if (byWallet) {
      personToParty.set(person.slotIndex, byWallet.id)
      continue
    }
    const byName =
      person.displayName?.trim() &&
      orderedParties.find(
        p =>
          p.displayName?.trim() &&
          p.displayName.trim().toLowerCase() === person.displayName!.trim().toLowerCase(),
      )
    if (byName) {
      personToParty.set(person.slotIndex, byName.id)
      continue
    }
    const byIndex = orderedParties[person.slotIndex - 1]
    if (byIndex) personToParty.set(person.slotIndex, byIndex.id)
  }
  if (people.length === 0) {
    orderedParties.forEach((p, i) => personToParty.set(i + 1, p.id))
  }

  // Also map by wallet match on fill batch signer when plan people lack wallets
  for (const batch of fillBatches) {
    const personIdx = batch.personSlotIndex
    if (personToParty.has(personIdx)) continue
    const signer = batch.signerAddress
    if (!signer) continue
    const me = normalizeAddress(signer)
    const party = orderedParties.find(
      p => p.walletAddress && normalizeAddress(p.walletAddress) === me,
    )
    if (party) personToParty.set(personIdx, party.id)
  }

  const { pathToPngDataUrl } = await import('./signatureHandoff/crypto')
  for (const [personIdx, path] of pathByPerson) {
    const partyId = personToParty.get(personIdx)
    if (!partyId || !path) continue
    try {
      const dataUrl = pathToPngDataUrl(path)
      if (dataUrl) out.set(partyId, dataUrl)
    } catch {
      /* skip */
    }
  }

  return out
}

export function SignaturesPanel({
  signatures,
  parties,
  compact,
  revealPrivate = true,
  authToken,
  fingerprint = null,
}: SignaturesPanelProps) {
  const [fillInkByParty, setFillInkByParty] = useState<Map<string, string>>(() => new Map())
  const partyKey = parties
    .map(p => `${p.id}:${p.walletAddress ?? ''}:${p.displayName ?? ''}`)
    .join('|')

  useEffect(() => {
    if (!revealPrivate || !authToken || !fingerprint) {
      setFillInkByParty(new Map())
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const map = await loadSignatureInkFromPlacementFills({
          fingerprint,
          authToken,
          parties,
        })
        if (!cancelled) setFillInkByParty(map)
      } catch {
        if (!cancelled) setFillInkByParty(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
    // partyKey stabilizes parties array identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealPrivate, authToken, fingerprint, partyKey])

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
          // Prefer placement signature-slot ink over stored party image (may be initials).
          const fillInk = fillInkByParty.get(sig.partyId) ?? null
          const imageUrl = fillInk ?? sig.imageUrl ?? null
          const imageIsData = Boolean(fillInk)

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
              {imageUrl && imageIsData ? (
                <img
                  className="signatures-panel-image"
                  src={imageUrl}
                  alt={`Signature of ${label}`}
                  loading="lazy"
                  decoding="async"
                />
              ) : imageUrl && authToken ? (
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
