import { Mail } from 'lucide-react'
import { buildShareEmailBody, buildShareMailtoUrl } from './shareInvite'
import { TextLink } from './TextLink'
import type { SealDocument } from './types'
import './ShareInviteCard.css'

interface ShareInviteCardProps {
  document: SealDocument
  shareUrl: string
  linkCopied: boolean
  onCopyLink: () => void
  embedded?: boolean
}

export function ShareInviteCard({
  document,
  shareUrl,
  linkCopied,
  onCopyLink,
  embedded,
}: ShareInviteCardProps) {
  const mailtoUrl = buildShareMailtoUrl(document, shareUrl)
  const emailPreview = buildShareEmailBody(document, shareUrl)
  const pdfName = document.originalFilename ?? 'your agreement PDF'

  return (
    <div className={embedded ? 'share-card share-card--embedded' : 'card share-card'}>
      {!embedded && <h2>Invite signers</h2>}
      <p className="muted share-card-intro">
        {document.signingProgress.signed}/{document.signingProgress.required} signed — send the link
        and the PDF file from your computer. VeriLock never hosts the document.
      </p>

      <ol className="share-steps">
        <li className="share-step">
          <div className="share-step-heading">
            <span className="share-step-num" aria-hidden>
              1
            </span>
            <strong>Copy the signing link</strong>
          </div>
          <p className="muted share-step-detail">
            Share this URL — it opens the agreement in VeriLock.
          </p>
          <TextLink href={shareUrl} className="hash-chip share-link-chip" title="Open signing link">
            {shareUrl}
          </TextLink>
          <button type="button" className="btn btn-secondary share-step-action" onClick={onCopyLink}>
            {linkCopied ? 'Link copied' : 'Copy link'}
          </button>
        </li>

        <li className="share-step">
          <div className="share-step-heading">
            <span className="share-step-num" aria-hidden>
              2
            </span>
            <strong>Attach the PDF</strong>
          </div>
          <p className="muted share-step-detail">
            Send the same file you fingerprinted:{' '}
            <span className="share-pdf-name">{pdfName}</span>. The signer verifies it locally — it is
            never uploaded.
          </p>
        </li>

        <li className="share-step">
          <div className="share-step-heading">
            <span className="share-step-num" aria-hidden>
              3
            </span>
            <strong>Compose an email</strong>
          </div>
          <p className="muted share-step-detail">
            Opens your mail app with the link, agreement details, and signing steps. You still attach{' '}
            <span className="share-pdf-name">{pdfName}</span> yourself.
          </p>
          <a href={mailtoUrl} className="btn btn-primary share-step-action share-email-btn">
            <Mail size={16} strokeWidth={2.25} aria-hidden />
            Compose email
          </a>
          <details className="share-email-preview">
            <summary>Preview email text</summary>
            <pre>{emailPreview}</pre>
          </details>
        </li>
      </ol>
    </div>
  )
}