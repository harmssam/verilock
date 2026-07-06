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
}

export function SignaturesPanel({ signatures, parties, compact }: SignaturesPanelProps) {
  if (signatures.length === 0) return null

  const partyById = new Map(parties.map(party => [party.id, party]))

  return (
    <div className={`signatures-panel${compact ? ' signatures-panel--compact' : ''}`}>
      <h3 className="signatures-panel-title">Recorded signatures</h3>
      <ul className="signatures-panel-list">
        {signatures.map(sig => {
          const party = partyById.get(sig.partyId)
          const label = party?.displayName ?? shortAddress(sig.signerAddress)
          const role = party ? formatPartyRole(party.role) : 'signer'
          const signedAt = new Date(sig.signedAt).toLocaleString()

          return (
            <li key={sig.id} className="signatures-panel-item">
              <div className="signatures-panel-meta">
                <strong>{label}</strong>
                <span className="muted">
                  {role} ·{' '}
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
                {sig.signatureType === 'typed' && !sig.imageUrl && (
                  <span className="signatures-panel-typed muted">Typed acknowledgment</span>
                )}
              </div>
              {sig.imageUrl ? (
                <img
                  className="signatures-panel-image"
                  src={resolveImageUrl(sig.imageUrl)}
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