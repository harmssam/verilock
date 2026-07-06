import { Copy, Mail } from 'lucide-react'
import { ShareEmailPreview } from './ShareEmailPreview'
import { buildShareInviteContent, buildShareMailtoUrl } from './shareInvite'
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
  const inviteContent = buildShareInviteContent(document, shareUrl)
  const pdfName = document.originalFilename ?? 'your agreement PDF'

  return (
    <div className={embedded ? 'share-card share-card--embedded' : 'card share-card'}>
      {!embedded && <h2>Invite signers</h2>}
      <p className="muted share-card-intro">
        {document.signingProgress.signed}/{document.signingProgress.required} signed — share with the
        other party. Attach <span className="share-pdf-name">{pdfName}</span> from your computer; VeriLock
        never hosts the file.
      </p>

      <div className="share-options">
        <div className="share-option share-option--email">
          <p className="share-option-label">Send to contacts</p>
          <p className="muted share-option-detail">
            Opens your mail app with the signing link, instructions, and agreement details. You attach{' '}
            <span className="share-pdf-name">{pdfName}</span> yourself.
          </p>
          <a href={mailtoUrl} className="btn btn-primary share-email-btn">
            <Mail size={16} strokeWidth={2.25} aria-hidden />
            Send email
          </a>
        </div>

        <p className="share-options-divider" aria-hidden>
          or
        </p>

        <div className="share-option share-option--copy">
          <p className="share-option-label">Copy link &amp; send yourself</p>
          <p className="muted share-option-detail">
            Share the URL below along with the PDF file — by text, AirDrop, Slack, or any channel you
            prefer.
          </p>
          <TextLink href={shareUrl} className="hash-chip share-link-chip" title="Open signing link">
            {shareUrl}
          </TextLink>
          <button type="button" className="btn btn-secondary share-copy-btn" onClick={onCopyLink}>
            <Copy size={15} strokeWidth={2.25} aria-hidden />
            {linkCopied ? 'Link copied' : 'Copy link'}
          </button>
          <ul className="share-copy-instructions muted">
            <li>Send the link and the PDF file together</li>
            <li>Signer opens the link and connects a Nimiq wallet</li>
            <li>They choose the PDF on their computer to verify it matches</li>
          </ul>
        </div>
      </div>

      <details className="share-email-preview">
        <summary>Preview invite</summary>
        <div className="share-email-preview-wrap">
          <ShareEmailPreview content={inviteContent} />
        </div>
      </details>
    </div>
  )
}