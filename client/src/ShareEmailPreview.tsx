import type { ShareInviteContent } from './shareInvite'
import './ShareEmailPreview.css'

interface ShareEmailPreviewProps {
  content: ShareInviteContent
  compact?: boolean
}

export function ShareEmailPreview({ content, compact }: ShareEmailPreviewProps) {
  return (
    <div className={`share-email-preview-card${compact ? ' share-email-preview-card--compact' : ''}`}>
      <div className="share-email-preview-header">
        <span className="share-email-preview-brand">VeriLock</span>
        <span className="share-email-preview-tag">Signing invite</span>
      </div>

      <p className="share-email-preview-greeting">Hi,</p>
      <p className="share-email-preview-lead">
        You&apos;re invited to sign <strong>{content.title}</strong> on VeriLock.
      </p>

      <section className="share-email-preview-section share-email-preview-section--link">
        <h4>Signing link</h4>
        <a className="share-email-preview-url" href={content.shareUrl}>
          {content.shareUrl}
        </a>
      </section>

      <section className="share-email-preview-section share-email-preview-section--pdf">
        <h4>{content.pdfAttached ? 'Agreement file (attached)' : 'Attach the file (required)'}</h4>
        <p>
          {content.pdfAttached ? (
            <>
              This invite includes the exact file to sign:{' '}
              <code className="share-email-preview-pdf">{content.pdfName}</code>
            </>
          ) : (
            <>
              Send this exact file with your message:{' '}
              <code className="share-email-preview-pdf">{content.pdfName}</code>
            </>
          )}
        </p>
        <p className="share-email-preview-note">
          VeriLock never hosts your file. The signer must receive the same file you fingerprinted so they
          can verify it locally.
        </p>
      </section>

      <section className="share-email-preview-section">
        <h4>How to sign</h4>
        <ol className="share-email-preview-steps">
          {content.signingSteps.map(step => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="share-email-preview-section share-email-preview-section--details">
        <h4>Agreement details</h4>
        <ul className="share-email-preview-details">
          <li>
            <span>Title</span>
            <strong>{content.title}</strong>
          </li>
          <li>
            <span>Signatures</span>
            <strong>
              {content.signed}/{content.required} collected
            </strong>
          </li>
          {content.detailLines.map(line => (
            <li key={line}>
              <span>Details</span>
              <strong>{line}</strong>
            </li>
          ))}
          {content.waitingOn.length > 0 && (
            <li>
              <span>Waiting on</span>
              <strong>{content.waitingOn.join(', ')}</strong>
            </li>
          )}
        </ul>
      </section>

      <p className="share-email-preview-footer">VeriLock · Sign together. Prove forever.</p>
    </div>
  )
}