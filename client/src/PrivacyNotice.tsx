import { Lock } from 'lucide-react'

export function PrivacyNotice() {
  return (
    <div className="privacy-notice" role="note">
      <Lock className="privacy-notice-icon" size={18} strokeWidth={2.25} aria-hidden />
      <div className="privacy-notice-body">
        <strong>Agreements that prove themselves</strong>
        <p className="muted">
          VeriLock seals documents the right way: fingerprint your file locally, collect wallet-backed
          signatures from every party, and anchor the hash permanently on the Nimiq blockchain. Your file
          stays on your device — yet anyone with a copy can verify it matches the sealed record.
        </p>
      </div>
    </div>
  )
}