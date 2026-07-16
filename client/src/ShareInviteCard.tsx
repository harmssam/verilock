import { useId, useState } from 'react'
import { Copy, Download, Mail, Paperclip } from 'lucide-react'
import { sha256Hex } from './pdf/hashPdf'
import { ShareEmailPreview } from './ShareEmailPreview'
import {
  buildShareEmlBlob,
  buildShareInviteContent,
  buildShareMailtoUrl,
  downloadBlob,
  shareEmlDownloadName,
} from './shareInvite'
import { TextLink } from './TextLink'
import type { SealDocument } from './types'
import './ShareInviteCard.css'

interface ShareInviteCardProps {
  document: SealDocument
  shareUrl: string
  linkCopied: boolean
  onCopyLink: () => void
  /**
   * Local PDF still in memory (create/share session).
   * When set, user can download an .eml with the file attached — never uploaded.
   */
  pdfFile?: File | null
  embedded?: boolean
}

function isPdfFile(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return true
  return file.type === 'application/pdf' || file.type === 'application/x-pdf'
}

export function ShareInviteCard({
  document,
  shareUrl,
  linkCopied,
  onCopyLink,
  pdfFile = null,
  embedded,
}: ShareInviteCardProps) {
  const pickId = useId()
  /** Extra local pick when parent did not pass a File (e.g. after reload). */
  const [pickedPdf, setPickedPdf] = useState<File | null>(null)
  const [pickBusy, setPickBusy] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  const localPdf = pdfFile ?? pickedPdf
  const canPackEml = Boolean(localPdf)
  const mailtoUrl = buildShareMailtoUrl(document, shareUrl)
  const inviteContent = buildShareInviteContent(document, shareUrl, {
    pdfAttached: canPackEml,
  })
  const pdfName =
    localPdf?.name || document.originalFilename || 'your agreement PDF'

  const [emlBusy, setEmlBusy] = useState(false)
  const [emlError, setEmlError] = useState<string | null>(null)
  const [emlReady, setEmlReady] = useState(false)

  const onPickPdf = async (fileList: FileList | null) => {
    const file = fileList?.[0]
    if (!file) return
    setPickError(null)
    if (!isPdfFile(file)) {
      setPickError('Please choose a PDF file.')
      return
    }
    setPickBusy(true)
    try {
      const hash = await sha256Hex(await file.arrayBuffer())
      if (hash !== document.originalSha256) {
        setPickedPdf(null)
        setPickError(
          'That PDF does not match this agreement’s fingerprint. Use the exact file you sealed.',
        )
        return
      }
      setPickedPdf(file)
    } catch (err) {
      setPickedPdf(null)
      setPickError(err instanceof Error ? err.message : 'Could not read that PDF.')
    } finally {
      setPickBusy(false)
    }
  }

  const downloadEml = async () => {
    if (!localPdf || emlBusy) return
    setEmlBusy(true)
    setEmlError(null)
    try {
      const blob = await buildShareEmlBlob(document, shareUrl, localPdf)
      downloadBlob(blob, shareEmlDownloadName(document))
      setEmlReady(true)
      window.setTimeout(() => setEmlReady(false), 2200)
    } catch (err) {
      setEmlError(
        err instanceof Error ? err.message : 'Could not build the email package.',
      )
    } finally {
      setEmlBusy(false)
    }
  }

  return (
    <div className={embedded ? 'share-card share-card--embedded' : 'card share-card'}>
      {!embedded && <h2>Invite signers</h2>}
      <p className="muted share-card-intro">
        {document.signingProgress.required === 0
          ? 'Direct seal mode — no signers to invite.'
          : `${document.signingProgress.signed}/${document.signingProgress.required} signed — share with the other party.`}{' '}
        {canPackEml ? (
          <>
            Download an email package with <span className="share-pdf-name">{pdfName}</span>{' '}
            attached. The file never leaves your device for VeriLock — only your mail app sends it.
          </>
        ) : (
          <>
            Choose <span className="share-pdf-name">{pdfName}</span> to build an email package with
            the attachment. VeriLock never hosts the file.
          </>
        )}
      </p>

      <div className={`share-actions${canPackEml ? ' share-actions--with-eml' : ''}`}>
        {canPackEml && (
          <button
            type="button"
            className="btn btn-primary share-eml-btn"
            disabled={emlBusy}
            onClick={() => void downloadEml()}
          >
            <Download size={16} strokeWidth={2.25} aria-hidden />
            {emlBusy
              ? 'Building package…'
              : emlReady
                ? 'Package downloaded'
                : 'Download email package'}
          </button>
        )}
        {!canPackEml && (
          <label
            htmlFor={pickId}
            className={`btn btn-primary share-eml-btn share-eml-pick${pickBusy ? ' btn--busy' : ''}`}
          >
            <Paperclip size={16} strokeWidth={2.25} aria-hidden />
            {pickBusy ? 'Checking PDF…' : 'Choose PDF for email package'}
            <input
              id={pickId}
              type="file"
              accept="application/pdf,.pdf"
              className="share-eml-file-input"
              disabled={pickBusy}
              onChange={e => {
                void onPickPdf(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        )}
        <a href={mailtoUrl} className="btn btn-secondary share-email-btn">
          <Mail size={16} strokeWidth={2.25} aria-hidden />
          {canPackEml ? 'Empty mail draft' : 'Mail draft (no PDF)'}
        </a>
        <button type="button" className="btn btn-secondary share-copy-btn" onClick={onCopyLink}>
          <Copy size={15} strokeWidth={2.25} aria-hidden />
          {linkCopied ? 'Link copied' : 'Copy link'}
        </button>
      </div>

      {(emlError || pickError) && (
        <p className="share-eml-error" role="alert">
          {emlError || pickError}
        </p>
      )}

      <div className="share-link-block">
        <p className="share-option-label">Signing link</p>
        <TextLink href={shareUrl} className="hash-chip share-link-chip" title="Open signing link">
          {shareUrl}
        </TextLink>
        <ul className="share-copy-instructions muted">
          {canPackEml ? (
            <>
              <li>
                Download the email package, open the <code className="share-pdf-name">.eml</code>{' '}
                file, add recipients, and send
              </li>
              <li>Signer opens the link and connects a Nimiq wallet</li>
              <li>They use the attached PDF to verify it matches</li>
            </>
          ) : (
            <>
              <li>Send the link and the PDF file together</li>
              <li>Signer opens the link and connects a Nimiq wallet</li>
              <li>They choose the PDF on their computer to verify it matches</li>
            </>
          )}
        </ul>
      </div>

      <p className="muted share-option-detail share-email-hint">
        {canPackEml ? (
          <>
            <strong>Download email package</strong> builds a mail file with the signing link and{' '}
            <span className="share-pdf-name">{pdfName}</span> attached on your device. Open it in
            Apple Mail, Outlook, or another client to send. VeriLock never uploads the PDF.
          </>
        ) : (
          <>
            Choose <span className="share-pdf-name">{pdfName}</span> on this device to build an
            email package with the file attached, or use a mail draft / copy link and attach the
            PDF yourself. VeriLock never hosts the file.
          </>
        )}
      </p>

      <details className="share-email-preview">
        <summary>Preview invite</summary>
        <div className="share-email-preview-wrap">
          <ShareEmailPreview content={inviteContent} />
        </div>
      </details>
    </div>
  )
}
