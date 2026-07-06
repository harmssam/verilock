import { ShieldCheck } from 'lucide-react'

interface PrivacyNoticeProps {
  variant?: 'banner' | 'inline'
}

export function PrivacyNotice({ variant = 'banner' }: PrivacyNoticeProps) {
  if (variant === 'inline') {
    return (
      <p className="privacy-notice privacy-notice--inline muted" role="note">
        Your PDF never leaves your computer — only the fingerprint and drawn signature images are saved on our servers.
      </p>
    )
  }

  return (
    <div className="privacy-notice" role="note">
      <ShieldCheck className="privacy-notice-icon" size={18} strokeWidth={2.25} aria-hidden />
      <div className="privacy-notice-body">
        <strong>Your PDF never leaves your computer</strong>
        <p className="muted">
          VeriLock fingerprints your file in the browser and stores the SHA-256 hash, wallet records, and
          drawn signature images. The PDF itself is never uploaded to our servers.
        </p>
      </div>
    </div>
  )
}