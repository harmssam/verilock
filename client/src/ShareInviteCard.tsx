import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Download, Mail, Paperclip, Share2, X } from 'lucide-react'
import { sha256Hex } from './pdf/hashPdf'
import { ShareEmailPreview } from './ShareEmailPreview'
import {
  buildShareActionPlan,
  shareHintForPlan,
  shareInstructionKinds,
  shareIntroForPlan,
  type ShareActionId,
  type ShareActionPlan,
  type ShareInstructionKind,
} from './shareDeviceProfile'
import {
  buildShareEmlBlob,
  buildShareInviteContent,
  buildShareMailtoUrl,
  canShareFiles,
  downloadBlob,
  handoffShareEml,
  isValidEmailAddress,
  openMailtoCompose,
  shareEmlDownloadName,
  shareInviteWithPdf,
} from './shareInvite'
import { TextLink } from './TextLink'
import type { SealDocument } from './types'
import './ShareInviteCard.css'

interface ShareInviteCardProps {
  document: SealDocument
  shareUrl: string
  linkCopied: boolean
  /**
   * Copy the signing link. Return `false` if copy failed (modal stays closed).
   * `void` / `true` / `undefined` opens the “link copied” reminder modal.
   */
  onCopyLink: () => void | boolean | Promise<void | boolean>
  /**
   * Local PDF still in memory (create/share session).
   * When set, user can share or package the file — never uploaded.
   */
  pdfFile?: File | null
  /**
   * Co-signer invite emails from the Signatures UI (client-only).
   * Used as Mail / .eml To — no separate field here.
   */
  inviteRecipients?: string[]
  embedded?: boolean
}

function isPdfFile(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return true
  return file.type === 'application/pdf' || file.type === 'application/x-pdf'
}

function isAbortError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'name' in err &&
      String((err as { name?: unknown }).name) === 'AbortError',
  )
}

function actionButtonClass(id: ShareActionId, role: 'primary' | 'secondary' | 'more'): string {
  const tone = role === 'primary' ? 'btn-primary' : 'btn-secondary'
  const byId: Record<ShareActionId, string> = {
    'web-share': 'share-web-btn',
    'open-mail': 'share-mail-btn',
    eml: 'share-eml-btn',
    'copy-link': 'share-copy-btn',
  }
  return `btn ${tone} ${byId[id]}`
}

/** Embed pdf filename spans inside profile copy strings. */
function withPdfName(text: string, pdfName: string): ReactNode {
  if (!pdfName || !text.includes(pdfName)) return text
  const parts = text.split(pdfName)
  return parts.map((part, i) =>
    i < parts.length - 1 ? (
      <span key={i}>
        {part}
        <span className="share-pdf-name">{pdfName}</span>
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

function instructionItems(
  kinds: ShareInstructionKind[],
  pdfName: string,
  plan: ShareActionPlan,
): ReactNode[] {
  const items: ReactNode[] = []
  for (const kind of kinds) {
    if (kind === 'web-share') {
      items.push(
        <li key="web-share">
          {plan.isMobile ? 'Tap' : 'Use'} <strong>Share PDF + invite</strong> and pick Mail,
          Messages, or another app
        </li>,
      )
    } else if (kind === 'open-mail') {
      items.push(
        <li key="open-mail">
          {kinds[0] === 'web-share' ? (
            <>
              Or use <strong>Open in Mail</strong> under More (fills To from invite email above)
              and attach the downloaded PDF
            </>
          ) : (
            <>
              Enter the co-signer invite email above, then <strong>Open in Mail</strong> — To and
              the invite body fill automatically
            </>
          )}
        </li>,
      )
      if (kinds[0] === 'open-mail') {
        items.push(
          <li key="open-mail-attach">
            Attach the downloaded <span className="share-pdf-name">{pdfName}</span> in Mail
          </li>,
        )
      }
    } else if (kind === 'eml') {
      items.push(
        <li key="eml">
          Enter the co-signer invite email above, then <strong>Download .eml package</strong> and
          open it in Outlook (or your mail app)
        </li>,
      )
    } else {
      items.push(<li key="generic">Send the link and the PDF file together</li>)
    }
  }
  items.push(
    <li key="wallet">Signer opens the link and connects a Nimiq wallet</li>,
    <li key="pdf-match">
      {plan.isMobile
        ? 'They use the same PDF to verify it matches'
        : 'They use that PDF to verify it matches'}
    </li>,
  )
  return items
}

export function ShareInviteCard({
  document,
  shareUrl,
  linkCopied,
  onCopyLink,
  pdfFile = null,
  inviteRecipients = [],
  embedded,
}: ShareInviteCardProps) {
  const pickId = useId()
  const moreId = useId()
  const copyModalTitleId = useId()
  const copyModalRef = useRef<HTMLDivElement>(null)
  /** Extra local pick when parent did not pass a File (e.g. after reload). */
  const [pickedPdf, setPickedPdf] = useState<File | null>(null)
  const [pickBusy, setPickBusy] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const [recipientError, setRecipientError] = useState<string | null>(null)
  const [copyModalOpen, setCopyModalOpen] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)

  const localPdf = pdfFile ?? pickedPdf
  const canPackEml = Boolean(localPdf)

  const [webShareOk, setWebShareOk] = useState(false)
  useEffect(() => {
    if (!localPdf) {
      setWebShareOk(false)
      return
    }
    setWebShareOk(canShareFiles([localPdf]))
  }, [localPdf])

  const plan = useMemo(
    () => buildShareActionPlan({ webShareFiles: webShareOk }),
    [webShareOk],
  )

  /** From Signatures UI only — no duplicate To field. */
  const recipients = useMemo(
    () =>
      inviteRecipients
        .map(e => e.trim())
        .filter(Boolean)
        .filter((email, index, all) => {
          const key = email.toLowerCase()
          return all.findIndex(x => x.toLowerCase() === key) === index
        }),
    [inviteRecipients],
  )

  const pdfName =
    localPdf?.name || document.originalFilename || 'your agreement PDF'

  const mailtoUrl = buildShareMailtoUrl(document, shareUrl, recipients, {
    pdfDownloadName: canPackEml ? pdfName : undefined,
  })
  const inviteContent = buildShareInviteContent(document, shareUrl, {
    pdfAttached: canPackEml,
  })

  const [shareBusy, setShareBusy] = useState(false)
  const [shareReady, setShareReady] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  const [mailBusy, setMailBusy] = useState(false)
  const [mailReady, setMailReady] = useState(false)

  const [emlBusy, setEmlBusy] = useState(false)
  const [emlReady, setEmlReady] = useState<'shared' | 'downloaded' | null>(null)
  const [emlError, setEmlError] = useState<string | null>(null)

  // Clear recipient errors when parent emails change.
  useEffect(() => {
    setRecipientError(null)
  }, [recipients.join('|')])

  const resolveRecipients = (): string[] | null => {
    const invalid = recipients.filter(email => !isValidEmailAddress(email))
    if (invalid.length > 0) {
      setRecipientError(
        invalid.length === 1
          ? `Not a valid invite email: ${invalid[0]}`
          : `Not valid invite emails: ${invalid.join(', ')}`,
      )
      return null
    }
    setRecipientError(null)
    return recipients
  }

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

  const onWebShare = async () => {
    if (!localPdf || shareBusy) return
    setShareBusy(true)
    setShareError(null)
    try {
      const result = await shareInviteWithPdf(document, shareUrl, localPdf)
      if (result === 'shared') {
        setShareReady(true)
        window.setTimeout(() => setShareReady(false), 2200)
      } else if (result === 'cancelled') {
        // User dismissed the sheet — no error.
      } else {
        const fallback =
          plan.platform === 'windows'
            ? 'Download .eml package'
            : 'Open in Mail'
        setShareError(
          `Sharing isn’t available here. Use “${fallback}” instead — the PDF never leaves this device for VeriLock.`,
        )
        setWebShareOk(false)
      }
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Could not open the share sheet.')
    } finally {
      setShareBusy(false)
    }
  }

  /**
   * mailto fills To/subject/body from invite emails above; PDF downloads for attach.
   * Browsers cannot open mailto: with an attachment.
   */
  const openInMail = async () => {
    if (!localPdf || mailBusy) return
    const to = resolveRecipients()
    if (to === null) return
    if (to.length === 0) {
      setRecipientError(
        'Add the co-signer invite email above first — Mail will open with that address filled in.',
      )
      return
    }

    setMailBusy(true)
    setEmlError(null)
    try {
      downloadBlob(localPdf, pdfName)
      const url = buildShareMailtoUrl(document, shareUrl, to, {
        pdfDownloadName: pdfName,
      })
      window.setTimeout(() => {
        openMailtoCompose(url)
      }, 150)
      setMailReady(true)
      window.setTimeout(() => setMailReady(false), 4000)
    } catch (err) {
      setEmlError(err instanceof Error ? err.message : 'Could not open Mail.')
    } finally {
      setMailBusy(false)
    }
  }

  const openEmlPackage = async () => {
    if (!localPdf || emlBusy) return
    const to = resolveRecipients()
    if (to === null) return
    if (to.length === 0) {
      setRecipientError(
        'Add the co-signer invite email above first so the package includes a recipient.',
      )
      return
    }

    setEmlBusy(true)
    setEmlError(null)
    try {
      const blob = await buildShareEmlBlob(document, shareUrl, localPdf, {
        recipients: to,
      })
      const result = await handoffShareEml(blob, shareEmlDownloadName(document))
      setEmlReady(result)
      window.setTimeout(() => setEmlReady(null), 2800)
    } catch (err) {
      if (isAbortError(err)) {
        // User cancelled share sheet for the .eml
      } else {
        setEmlError(
          err instanceof Error ? err.message : 'Could not build the email package.',
        )
      }
    } finally {
      setEmlBusy(false)
    }
  }

  const actionError = shareError || emlError || pickError || recipientError
  const anyBusy = shareBusy || mailBusy || emlBusy || copyBusy

  const closeCopyModal = () => setCopyModalOpen(false)

  const handleCopyLink = async () => {
    if (copyBusy) return
    setCopyBusy(true)
    setShareError(null)
    try {
      const result = await Promise.resolve(onCopyLink())
      if (result === false) return
      setCopyModalOpen(true)
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Could not copy the link.')
    } finally {
      setCopyBusy(false)
    }
  }

  const downloadPdfForShare = () => {
    if (!localPdf) return
    downloadBlob(localPdf, pdfName)
  }

  useEffect(() => {
    if (!copyModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCopyModal()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus primary action for keyboard users.
    window.setTimeout(() => {
      copyModalRef.current?.querySelector<HTMLButtonElement>('[data-copy-modal-primary]')?.focus()
    }, 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [copyModalOpen])

  const renderAction = (id: ShareActionId, role: 'primary' | 'secondary' | 'more') => {
    const className = actionButtonClass(id, role)
    if (id === 'web-share') {
      return (
        <button
          key={`${role}-${id}`}
          type="button"
          className={className}
          disabled={anyBusy}
          onClick={() => void onWebShare()}
        >
          <Share2 size={16} strokeWidth={2.25} aria-hidden />
          {shareBusy ? 'Opening share…' : shareReady ? 'Shared' : 'Share PDF + invite'}
        </button>
      )
    }
    if (id === 'open-mail') {
      return (
        <button
          key={`${role}-${id}`}
          type="button"
          className={className}
          disabled={anyBusy}
          onClick={() => void openInMail()}
        >
          <Mail size={16} strokeWidth={2.25} aria-hidden />
          {mailBusy
            ? 'Opening Mail…'
            : mailReady
              ? 'Mail opened — attach PDF'
              : 'Open in Mail'}
        </button>
      )
    }
    if (id === 'eml') {
      return (
        <button
          key={`${role}-${id}`}
          type="button"
          className={className}
          disabled={anyBusy}
          onClick={() => void openEmlPackage()}
        >
          <Download size={16} strokeWidth={2.25} aria-hidden />
          {emlBusy
            ? 'Building package…'
            : emlReady === 'shared'
              ? 'Opened share sheet'
              : emlReady === 'downloaded'
                ? 'Package downloaded'
                : 'Download .eml package'}
        </button>
      )
    }
    return (
      <button
        key={`${role}-${id}`}
        type="button"
        className={className}
        disabled={anyBusy}
        onClick={() => void handleCopyLink()}
      >
        <Copy size={15} strokeWidth={2.25} aria-hidden />
        {copyBusy ? 'Copying…' : linkCopied || copyModalOpen ? 'Link copied' : 'Copy link'}
      </button>
    )
  }

  const copyModal =
    copyModalOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="share-copy-modal-layer" role="presentation">
            <button
              type="button"
              className="share-copy-modal-backdrop"
              aria-label="Close"
              onClick={closeCopyModal}
            />
            <div
              ref={copyModalRef}
              className="share-copy-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={copyModalTitleId}
            >
              <header className="share-copy-modal-head">
                <div className="share-copy-modal-icon" aria-hidden>
                  <Check size={22} strokeWidth={2.5} />
                </div>
                <button
                  type="button"
                  className="share-copy-modal-close"
                  onClick={closeCopyModal}
                  aria-label="Close"
                >
                  <X size={18} strokeWidth={2.25} />
                </button>
              </header>
              <h3 id={copyModalTitleId} className="share-copy-modal-title">
                Link copied
              </h3>
              <p className="share-copy-modal-body">
                The signing link is on your clipboard. Paste it into Messages, email, or chat.
              </p>
              <p className="share-copy-modal-body share-copy-modal-body--emphasis">
                You also need to send the agreement PDF
                {canPackEml ? (
                  <>
                    {' '}
                    (<span className="share-pdf-name">{pdfName}</span>)
                  </>
                ) : null}
                . VeriLock never hosts the file — co-signers use that exact PDF to verify the
                fingerprint matches.
              </p>
              <ul className="share-copy-modal-steps">
                <li>Paste the link for your co-signer</li>
                <li>Send the same PDF file with it (attachment or separate share)</li>
                <li>They open the link, connect a Nimiq wallet, and choose that PDF</li>
              </ul>
              <div className="share-copy-modal-actions">
                {canPackEml && localPdf && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={downloadPdfForShare}
                  >
                    <Download size={16} strokeWidth={2.25} aria-hidden />
                    Download PDF to attach
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  data-copy-modal-primary
                  onClick={closeCopyModal}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div className={embedded ? 'share-card share-card--embedded' : 'card share-card'}>
      {!embedded && <h2>Invite signers</h2>}
      <p className="muted share-card-intro">
        {document.signingProgress.required === 0
          ? 'Direct seal mode — no signers to invite.'
          : `${document.signingProgress.signed}/${document.signingProgress.required} signed — share with the other party.`}{' '}
        {canPackEml ? (
          withPdfName(shareIntroForPlan(plan, pdfName), pdfName)
        ) : (
          <>
            Choose <span className="share-pdf-name">{pdfName}</span> to share or open Mail with the
            invite. VeriLock never hosts the file.
          </>
        )}
      </p>

      {recipients.length > 0 && (
        <p className="muted share-recipients-summary">
          Invite To:{' '}
          <span className="share-pdf-name">{recipients.join(', ')}</span>
        </p>
      )}

      {canPackEml ? (
        <div className="share-actions-layout">
          <div
            className={`share-actions share-actions--primary${
              plan.primary.length > 1 ? ' share-actions--multi' : ''
            }`}
          >
            {plan.primary.map(id => renderAction(id, 'primary'))}
          </div>
          {plan.secondary.length > 0 && (
            <div
              className={`share-actions share-actions--secondary${
                plan.secondary.length > 1 ? ' share-actions--multi' : ''
              }`}
            >
              {plan.secondary.map(id => renderAction(id, 'secondary'))}
            </div>
          )}
          {plan.more.length > 0 && (
            <details className="share-more">
              <summary id={moreId}>More ways to share</summary>
              <div
                className={`share-actions share-actions--more${
                  plan.more.length > 1 ? ' share-actions--multi' : ''
                }`}
                role="group"
                aria-labelledby={moreId}
              >
                {plan.more.map(id => renderAction(id, 'more'))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <div className="share-actions share-actions--no-pdf">
          <label
            htmlFor={pickId}
            className={`btn btn-primary share-eml-btn share-eml-pick${pickBusy ? ' btn--busy' : ''}`}
          >
            <Paperclip size={16} strokeWidth={2.25} aria-hidden />
            {pickBusy ? 'Checking PDF…' : 'Choose PDF to share'}
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
          <a href={mailtoUrl} className="btn btn-secondary share-email-btn">
            <Mail size={16} strokeWidth={2.25} aria-hidden />
            Mail draft (no PDF)
          </a>
          <button
            type="button"
            className="btn btn-secondary share-copy-btn"
            disabled={anyBusy}
            onClick={() => void handleCopyLink()}
          >
            <Copy size={15} strokeWidth={2.25} aria-hidden />
            {copyBusy ? 'Copying…' : linkCopied || copyModalOpen ? 'Link copied' : 'Copy link'}
          </button>
        </div>
      )}

      {copyModal}

      {actionError && (
        <p className="share-eml-error" role="alert">
          {actionError}
        </p>
      )}

      {mailReady && (
        <p className="muted share-eml-success" role="status">
          Mail should open with <strong>To</strong> filled
          {recipients.length > 0 ? ` (${recipients.join(', ')})` : ''}. Attach the downloaded{' '}
          <code className="share-pdf-name">{pdfName}</code> (paperclip or drag from Downloads),
          then Send. VeriLock never uploads the PDF.
        </p>
      )}

      {emlReady === 'downloaded' && (
        <p className="muted share-eml-success" role="status">
          .eml package downloaded with To set to {recipients.join(', ') || '(none)'}.
          {plan.platform === 'windows' ? (
            <> Open the file in Outlook to send the draft with the PDF attached.</>
          ) : plan.platform === 'ios' ? (
            <>
              {' '}
              If To is blank in Mail, prefer <strong>Open in Mail</strong> instead — Mail often
              ignores To on imported drafts.
            </>
          ) : (
            <> Open the file in your mail app to send the draft.</>
          )}
        </p>
      )}

      <div className="share-link-block">
        <p className="share-option-label">Signing link</p>
        <TextLink href={shareUrl} className="hash-chip share-link-chip" title="Open signing link">
          {shareUrl}
        </TextLink>
        <ul className="share-copy-instructions muted">
          {canPackEml ? (
            instructionItems(shareInstructionKinds(plan), pdfName, plan)
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
          withPdfName(shareHintForPlan(plan, pdfName), pdfName)
        ) : (
          <>
            Choose <span className="share-pdf-name">{pdfName}</span> on this device to share or
            open Mail with the invite. VeriLock never hosts the file.
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
