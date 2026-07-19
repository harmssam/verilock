import {
  ArrowLeft,
  Check,
  Fingerprint,
  LoaderCircle,
  Lock,
  MailCheck,
  RotateCcw,
  Share2,
  Shield,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isValidNimiqAddress, normalizeAddress, shortAddress } from '../addresses'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import {
  canDeleteDocument,
  canRevealParticipantDetails,
  isDocumentCreator,
} from '../agreements'
import { api } from '../api'
import { SignaturesPanel } from '../SignaturesPanel'
import { FEATURES } from '../features'
import {
  clampField,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_DOCUMENT_NOTES_LENGTH,
  MAX_SUPPORT_EMAIL_LENGTH,
  MAX_TITLE_LENGTH,
} from '../fieldLimits'
import { stripDocumentExtension } from '../pdf/documentKinds'
import { getDocumentPageCount } from '../pdf/documentSurface'
import { sha256Hex, shortHash } from '../pdf/hashPdf'
import { prepareSignatureImageUpload } from '../signatureImage'
import { isMobileDevice } from '../nimiq'
import { SealPricingDisplay } from '../SealPricingDisplay'
import { canShareFiles, shareInviteWithPdf } from '../shareInvite'
import {
  formatPartyRole,
  partyNeedsSignerName,
  resolveSigningParty,
} from '../signing'
import {
  documentTypeUsesNotes,
  type DocumentType,
  type VerifyResult,
} from '../types'
import { VerifyMatchesPanel } from '../VerifyMatchesPanel'
import { DocumentStage } from './DocumentStage'
import { HowVeriLockWorks } from './HowVeriLockWorks'
import { NotFoundPage } from './NotFoundPage'
import {
  clearJourneyIntent,
  resolveJourneyIntent,
  saveJourneyIntent,
  syncIntentToUrl,
} from './journeyIntent'
import { useCreatePdfDraft } from './useCreatePdfDraft'
import { useRevealDocumentOnAuth } from './useRevealDocumentOnAuth'
import {
  journeyConnectOptions,
  journeyLoginEntryLabels,
  journeyLoginNeedsSheet,
  resolveJourneyConnectMode,
  type JourneyConnectRequest,
} from './journeyConnectUi'
import { LoginSheet } from './LoginSheet'
import { CreditsPanel } from './CreditsPanel'
import { CreditSealProgress } from './CreditSealProgress'
import {
  finishJourneyLock,
  sealJourneyDocument,
  sealJourneyDocumentWithCredit,
} from './journeySeal'
import { formatFileSize } from './PdfDropZone'
import { SignaturePad } from './SignaturePad'
import { SignOnMobileModal, isLikelyMobileViewport } from './SignOnMobileModal'
import { StageRail } from './StageRail'
import { PlacementEditor } from '../pdf/PlacementEditor'
import { SignerFillView, type SignerFillResult } from '../pdf/SignerFillView'
import {
  buildFillBatch,
  computePlanRoot,
  emptyPlan,
  lockPlan as lockConstructionPlanLocal,
  type ConstructionPlan,
  type PlacementSlot,
} from '../pdf/placements'
import {
  computeBatchRoot,
  framesToHex,
  packLockedPlan,
  packPlacementBatch,
} from '../pdf/placementStream'
import { saveHubReturnPath } from '../hubReturnPath'
import { journeyPathMeta, type PageMeta } from '../seo'
import {
  allSigned,
  requiredCount,
  signedCount,
  stagesForRole,
  toJourneyDoc,
  type JourneyDoc,
  type JourneyStepId,
  type PathRole,
} from './types'
import type { UseJourneyWalletResult } from './useJourneyWallet'

interface DocumentJourneyProps {
  wallet: UseJourneyWalletResult
  /** Shell pushState navigation epoch — re-read /d/:slug deep links. */
  navEpoch?: number
  /** Per-route document meta for SEO (title, canonical, noindex). */
  onPageMeta?: (meta: PageMeta) => void
  /** Return to home (invalid deep link). */
  onHome?: () => void
  /** Fresh create path after “Start another agreement” (shell remounts journey). */
  onStartCreate?: () => void
  /**
   * Switch shell path track without remounting (preserves in-memory PDF).
   * Used after seal → verify with the same file preloaded.
   */
  onSwitchPath?: (role: PathRole) => void
}

type VerifyOutcome =
  | { kind: 'idle' }
  | { kind: 'hashing' }
  | { kind: 'local'; fingerprint: string; fileName: string; fileSize: number }
  | {
      kind: 'match'
      fingerprint: string
      fileName: string
      title?: string
      explorerUrl?: string | null
      /** Full agreement records (signatures, parties, attestation) */
      matches: VerifyResult[]
    }
  | { kind: 'mismatch'; expected: string; got: string; fileName: string }
  | { kind: 'lookup'; fingerprint: string; fileName: string; titles: string[] }

function slugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/d\/([a-zA-Z0-9_-]+)/)
  return m?.[1] ?? null
}

function verifySlugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/v\/([a-zA-Z0-9_-]+)/)
  return m?.[1] ?? null
}

async function loadVerifyDetails(
  slugs: string[],
  token?: string | null,
): Promise<VerifyResult[]> {
  const unique = [...new Set(slugs)]
  const details = await Promise.all(unique.map(slug => api.verifyDocument(slug, token)))
  return details.sort((a, b) => (b.lockedAt ?? b.createdAt) - (a.lockedAt ?? a.createdAt))
}

export function DocumentJourney({
  wallet,
  navEpoch = 0,
  onPageMeta,
  onHome,
  onStartCreate,
  onSwitchPath,
}: DocumentJourneyProps) {
  const {
    account,
    token,
    address,
    connecting,
    walletStatus,
    connect,
    setError,
    nimiq,
    setNimiq,
    applySession,
    registerHubLockComplete,
    registerHubLockError,
    bootReady,
    inNimiqPay,
    mobilePayConnect,
    showOpenInPay,
  } = wallet

  // Restore path after Hub login redirect (full page reload loses React state)
  const [role, setRole] = useState<PathRole | null>(() => resolveJourneyIntent())
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfHash, setPdfHash] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [title, setTitle] = useState('')
  const [creatorName, setCreatorName] = useState('')
  /** Optional ready-to-seal email — collected only when FEATURES.emailNotifyUi is on. */
  const [creatorNotifyEmail, setCreatorNotifyEmail] = useState('')
  const [docType, setDocType] = useState<DocumentType>('contract')
  /** Optional display names for other parties (index 0 = first co-signer). */
  const [coSignerNames, setCoSignerNames] = useState<string[]>([''])
  /** Client-only invite emails for co-signers — prefill Share .eml To; never uploaded with the PDF. */
  const [coSignerEmails, setCoSignerEmails] = useState<string[]>([''])
  const [docNotes, setDocNotes] = useState('')
  /** Draft total parties for share-step Signatures UI (applied via API). */
  const [requiredSigners, setRequiredSigners] = useState(1)
  const [busy, setBusy] = useState(false)
  const [doc, setDoc] = useState<JourneyDoc | null>(null)
  const [sharedAck, setSharedAck] = useState(false)
  const [signFile, setSignFile] = useState<File | null>(null)
  const [signHash, setSignHash] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const [sigBlob, setSigBlob] = useState<Blob | null>(null)
  const [sigPadKey, setSigPadKey] = useState(0)
  const [signOnMobileOpen, setSignOnMobileOpen] = useState(false)
  const [mobileSigPreview, setMobileSigPreview] = useState<string | null>(null)
  /** Construction placements (Arrange step) — empty slots until lock; then immutable. */
  const [constructionPlan, setConstructionPlan] = useState<ConstructionPlan | null>(null)
  /** idle → loading → ready (has plan) | none (404 / no plan). Avoids draft-seed race. */
  const [planLoadState, setPlanLoadState] = useState<'idle' | 'loading' | 'ready' | 'none'>('idle')
  const [placementLockBusy, setPlacementLockBusy] = useState(false)
  const [placementStatus, setPlacementStatus] = useState<string | null>(null)
  const [filledSlotIds, setFilledSlotIds] = useState<Set<string>>(() => new Set())
  const [knownBlobIds, setKnownBlobIds] = useState<Set<string>>(() => new Set())
  const [lastBatchRoot, setLastBatchRoot] = useState<string | null>(null)
  const [pageFieldsConfirmed, setPageFieldsConfirmed] = useState(false)
  const [fillBusy, setFillBusy] = useState(false)
  /** Invitee chose a name-only party (or from ?party= link). */
  const [pickedPartyId, setPickedPartyId] = useState<string | null>(null)
  /** partyId → last invite send status for UI feedback */
  const [inviteSendBusyId, setInviteSendBusyId] = useState<string | null>(null)
  const [inviteSendNote, setInviteSendNote] = useState<Record<string, string>>({})
  /** Floating reminder after any successful invite email (PDF is never attached). */
  const [inviteToast, setInviteToast] = useState<{
    key: number
    contactLabel: string
  } | null>(null)
  const inviteToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [emailSendEnabled, setEmailSendEnabled] = useState(false)
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [verifyOutcome, setVerifyOutcome] = useState<VerifyOutcome>({ kind: 'idle' })
  const [howOpen, setHowOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [lockMessage, setLockMessage] = useState<string | null>(null)
  const [creditBalance, setCreditBalance] = useState(0)
  const [creditsRefresh, setCreditsRefresh] = useState(0)
  /** Deep-link /d/ or /v/ slug that does not resolve on the server. */
  const [missingDeepLink, setMissingDeepLink] = useState<string | null>(null)
  const fileSizeByDocIdRef = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!onPageMeta) return
    const path = window.location.pathname
    const search = window.location.search
    const verifyMatchTitle =
      verifyOutcome.kind === 'match' && verifyOutcome.matches.length === 1
        ? verifyOutcome.matches[0]!.title
        : verifyOutcome.kind === 'match' && verifyOutcome.title
          ? verifyOutcome.title
          : null

    onPageMeta(
      journeyPathMeta(path, search, {
        document: doc ? { title: doc.title, slug: doc.slug } : null,
        verifyMatchTitle,
        role: role ?? null,
      }),
    )
  }, [onPageMeta, doc, role, verifyOutcome, navEpoch])

  const setActiveFromSeal = useCallback(
    (sealDoc: Parameters<typeof toJourneyDoc>[0], fileSize?: number) => {
      if (fileSize != null) {
        fileSizeByDocIdRef.current[sealDoc.id] = fileSize
      }
      const size = fileSizeByDocIdRef.current[sealDoc.id] ?? fileSize ?? 0
      setDoc(toJourneyDoc(sealDoc, size))
    },
    [],
  )


  // After Hub returns: restore role from ?intent= (or session on deep links).
  // Never rewrite the URL here — sticky session + syncIntentToUrl caused ?intent=signer loops.
  useEffect(() => {
    if (!bootReady) return
    const intent = resolveJourneyIntent()
    if (!intent) return
    setRole(prev => prev ?? intent)
  }, [bootReady, address])

  // Deep-link /d/:slug (invite) or /v/:slug (verify record).
  // navEpoch re-runs when shell navigates via pushState (e.g. Agreements → open).
  useEffect(() => {
    if (!bootReady) return
    const docSlug = slugFromPath(window.location.pathname)
    const vSlug = verifySlugFromPath(window.location.pathname)
    const preferSeal =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('preferSeal') === '1'

    // Leaving deep-link routes clears missing state
    if (!docSlug && !vSlug) {
      setMissingDeepLink(null)
      const intent = resolveJourneyIntent()
      if (intent) setRole(intent)
      return
    }

    if (vSlug) {
      let cancelled = false
      void (async () => {
        try {
          const details = await loadVerifyDetails([vSlug], token)
          if (cancelled) return
          if (details.length === 0) {
            setMissingDeepLink(`/v/${vSlug}`)
            setDoc(null)
            return
          }
          setMissingDeepLink(null)
          setRole('verifier')
          const first = details[0]!
          setVerifyOutcome({
            kind: 'match',
            fingerprint: shortHash(first.finalSha256 ?? first.originalSha256),
            fileName: first.originalFilename ?? first.title,
            title: first.title,
            explorerUrl: first.attestation?.explorerUrl,
            matches: details,
          })
          // Also load journey doc so stage/card can reflect sealed state
          try {
            const { document } = await api.getDocument(vSlug, token)
            if (!cancelled) setActiveFromSeal(document)
          } catch {
            /* verify record is enough */
          }
        } catch (err) {
          if (!cancelled) {
            const message = err instanceof Error ? err.message : 'Could not open verify link'
            if (
              /not found|404/i.test(message) ||
              (err as Error & { status?: number }).status === 404
            ) {
              setMissingDeepLink(`/v/${vSlug}`)
              setDoc(null)
            } else {
              setLocalError(message)
            }
          }
        }
      })()
      return () => {
        cancelled = true
      }
    }

    if (!docSlug) return

    let cancelled = false
    void (async () => {
      try {
        // Pass session when present so names + signature images unlock for parties.
        const { document } = await api.getDocument(docSlug, token)
        if (cancelled) return
        setMissingDeepLink(null)
        setActiveFromSeal(document)
        setLocalError(null)
        setLockMessage(null)
        const isCreator =
          address &&
          document.creatorAddress.replace(/\s/g, '').toUpperCase() ===
            address.replace(/\s/g, '').toUpperCase()
        const sealed =
          document.status === 'locked' || document.attestation?.status === 'confirmed'

        if (isCreator) {
          setRole('creator')
          saveJourneyIntent('creator')
          const { signed, required } = document.signingProgress
          // Solo agreements must re-open on share (Signatures) so co-signers can still
          // be added — do not auto-ack just because the creator already signed.
          // Multi incomplete: treat as invite-sent so polling/share banner works.
          // preferSeal / agreements “seal now” skips share intentionally.
          setSharedAck(
            preferSeal ||
              required === 0 ||
              (required > 1 && signed > 0),
          )
        } else {
          // /d/:slug is the invite path — land on signer flow (connect → sign), not verify.
          // Unclaimed co-signers may not match canRevealParticipantDetails until they sign.
          if (sealed && address && !canRevealParticipantDetails(document, address)) {
            setRole(prev => (prev === 'creator' ? prev : 'verifier'))
          } else {
            setRole('signer')
            saveJourneyIntent('signer')
          }
          setSharedAck(true)
        }
        // Strip preferSeal from URL after apply (clean shareable /d/ links)
        if (preferSeal) {
          window.history.replaceState({}, '', `/d/${document.slug}`)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Could not open agreement link'
          if (
            /not found|404/i.test(message) ||
            (err as Error & { status?: number }).status === 404
          ) {
            setMissingDeepLink(`/d/${docSlug}`)
            setDoc(null)
            setLocalError(null)
          } else {
            setLocalError(message)
          }
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bootReady, address, token, setActiveFromSeal, navEpoch])

  // Hub seal return
  useEffect(() => {
    registerHubLockComplete(async result => {
      try {
        setBusy(true)
        setLockMessage('Finishing seal from Nimiq Hub…')
        const me = await api.me(result.token)
        applySession(result.token, me.address)
        const { document: current } = await api.getDocument(result.docId, result.token)
        const finalHash = current.finalSha256 ?? current.originalSha256
        await api.prepareLock(result.token, result.docId, finalHash).catch(() => {})
        await api.beginLock(result.token, result.docId)
        const sealed = await finishJourneyLock(
          result.docId,
          result.txHash,
          result.token,
          setLockMessage,
        )
        setActiveFromSeal(sealed)
        setRole('creator')
        setLocalError(null)
        window.history.replaceState({}, '', `/d/${sealed.slug}`)
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Hub seal return failed')
      } finally {
        setBusy(false)
      }
    })
    registerHubLockError(err => {
      setLocalError(err.message)
      setLockMessage(null)
      setBusy(false)
    })
  }, [registerHubLockComplete, registerHubLockError, applySession, setActiveFromSeal])

  const step = useMemo<JourneyStepId>(() => {
    if (!role) return 'welcome'
    if (role === 'verifier') return 'verify'
    // Wallet login is a gate on actions — not a numbered rail step.
    if (role === 'signer') {
      if (!doc) return 'sign'
      // After this wallet has signed (or everyone has), show the short "done" step
      const meNorm = address ? normalizeAddress(address) : null
      const meSigned =
        Boolean(meNorm) &&
        doc.parties.some(
          p => p.signed && p.walletAddress && normalizeAddress(p.walletAddress) === meNorm,
        )
      if (doc.sealed || meSigned || allSigned(doc)) return 'done'
      return 'sign'
    }
    // Creator path: add PDF → arrange → sign (if organizer is a party) → invite → seal
    if (!doc) return 'fingerprint'
    if (doc.sealed) return 'done'
    if (doc.directSeal) return 'seal'
    // Construction first (when UI on): lock placements before any wallet signature.
    // Wait for plan GET before treating as unlocked draft (avoids flash / wrong step).
    if (FEATURES.pdfAnnotationUi && planLoadState === 'loading' && signedCount(doc) === 0) {
      return 'share'
    }
    const needsArrange =
      FEATURES.pdfAnnotationUi &&
      planLoadState !== 'loading' &&
      constructionPlan?.status !== 'locked' &&
      signedCount(doc) === 0
    if (needsArrange) return 'share'

    // Only the *document creator* who chose “not signing” is blocked from open-slot claim.
    // Invitees must still claim open parties.
    const creatorBlocksOpenClaim =
      FEATURES.pdfAnnotationUi &&
      constructionPlan?.status === 'locked' &&
      (constructionPlan.creatorSigningAs == null ||
        constructionPlan.creatorSigningAs === 0) &&
      Boolean(address && isDocumentCreator(doc.source, address))

    if (address) {
      const resolution = resolveSigningParty(doc.source, address, {
        allowOpenClaim: !creatorBlocksOpenClaim,
      })
      if (resolution.ok) return 'sign'
    } else if (
      signedCount(doc) === 0 &&
      !(
        FEATURES.pdfAnnotationUi &&
        constructionPlan?.status === 'locked' &&
        (constructionPlan.creatorSigningAs == null ||
          constructionPlan.creatorSigningAs === 0)
      )
    ) {
      return 'sign'
    }
    // Waiting on invitees / progress (organizer lands here after lock if not signing)
    if (!allSigned(doc)) return 'share'
    if (requiredCount(doc) <= 1 && !sharedAck) return 'share'
    return 'seal'
  }, [
    role,
    doc,
    address,
    sharedAck,
    constructionPlan?.status,
    constructionPlan?.creatorSigningAs,
    planLoadState,
  ])

  const pathStages = useMemo(() => stagesForRole(role), [role])

  // Quiet refresh while creator waits for co-signers after signing (share step).
  useEffect(() => {
    if (role !== 'creator' || !doc || doc.sealed) return
    if (step !== 'share') return
    if (allSigned(doc)) return
    const slug = doc.slug
    const size = fileSizeByDocIdRef.current[doc.id] ?? doc.fileSize
    const tick = () => {
      void (async () => {
        try {
          const { document } = await api.getDocument(slug, token)
          setActiveFromSeal(document, size)
        } catch {
          /* ignore transient network */
        }
      })()
    }
    const id = window.setInterval(tick, 12_000)
    return () => window.clearInterval(id)
  }, [role, doc, step, token, setActiveFromSeal])

  // Seed share-step cosigner draft from the live document once per agreement.
  useEffect(() => {
    if (!doc || step !== 'share') return
    const need = Math.max(1, Math.min(4, requiredCount(doc)))
    setRequiredSigners(need)
    const others = Math.max(0, need - 1)
    const creatorNorm = address ? normalizeAddress(address) : null
    const coNames = doc.parties
      .filter(p => {
        if (!p.required) return false
        if (creatorNorm && p.walletAddress && normalizeAddress(p.walletAddress) === creatorNorm) {
          return false
        }
        return true
      })
      .map(p => (p.displayName && !/^invited\s/i.test(p.displayName) ? p.displayName : ''))
    setCoSignerNames(() => {
      const next = coNames.slice(0, others)
      while (next.length < others) next.push('')
      return next
    })
  }, [doc?.id, step]) // eslint-disable-line react-hooks/exhaustive-deps -- seed on open only

  const revealParticipantPrivate = Boolean(
    doc && canRevealParticipantDetails(doc.source, address),
  )
  const canCancelCurrent = Boolean(doc && canDeleteDocument(doc.source, address))

  const activeStage =
    pathStages.find(s => s.id === step) ??
    (step === 'done' ? pathStages[pathStages.length - 1] ?? null : null)

  const stepIndex = activeStage ? pathStages.findIndex(s => s.id === activeStage.id) : -1

  /** Creator opted out of signing — only blocks *this* wallet, never invitees. */
  const creatorIsOrganizerOnly =
    FEATURES.pdfAnnotationUi &&
    constructionPlan?.status === 'locked' &&
    (constructionPlan.creatorSigningAs == null || constructionPlan.creatorSigningAs === 0) &&
    Boolean(doc && address && isDocumentCreator(doc.source, address))

  /** Per-person invite: /d/:slug?party=<partyId> */
  const preferredPartyFromUrl = useMemo(() => {
    if (typeof window === 'undefined') return null
    try {
      const q = new URLSearchParams(window.location.search).get('party')
      return q?.trim() || null
    } catch {
      return null
    }
  }, [doc?.id, navEpoch])

  const effectivePreferredPartyId = pickedPartyId || preferredPartyFromUrl

  const signingResolution =
    doc && address
      ? resolveSigningParty(doc.source, address, {
          allowOpenClaim: !creatorIsOrganizerOnly,
          preferredPartyId: effectivePreferredPartyId,
        })
      : null
  const pendingParty =
    signingResolution?.ok
      ? doc!.parties.find(p => p.id === signingResolution.party.id) ?? null
      : null

  /** Invite targets: all parties when organizer does not sign; else everyone except the creator slot. */
  const inviteeSlotCount = useMemo(() => {
    if (!doc) return 0
    const need = requiredCount(doc)
    if (
      FEATURES.pdfAnnotationUi &&
      constructionPlan?.status === 'locked' &&
      (constructionPlan.creatorSigningAs == null || constructionPlan.creatorSigningAs === 0)
    ) {
      return Math.max(0, need)
    }
    return Math.max(0, need - 1)
  }, [doc, constructionPlan?.status, constructionPlan?.creatorSigningAs])

  // Resend invite capability (server RESEND_ENABLED)
  useEffect(() => {
    let cancelled = false
    void api
      .features()
      .then(f => {
        if (!cancelled) setEmailSendEnabled(Boolean(f.emailNotifySendEnabled))
      })
      .catch(() => {
        if (!cancelled) setEmailSendEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Hash PDF on select (create path)
  useEffect(() => {
    if (!pdfFile) {
      setPdfHash(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const buffer = await pdfFile.arrayBuffer()
        const hash = await sha256Hex(buffer)
        const pages = await getDocumentPageCount(pdfFile)
        if (cancelled) return
        setPdfHash(hash)
        setPageCount(pages)
        setTitle(prev =>
          (prev ?? '').trim()
            ? prev
            : clampField(stripDocumentExtension(pdfFile.name), MAX_TITLE_LENGTH),
        )
      } catch (err) {
        if (!cancelled) {
          setLocalError(err instanceof Error ? err.message : 'Failed to read document')
          setPdfHash(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfFile])

  const applyRestoredCreateMeta = useCallback(
    (m: {
      title: string
      creatorName: string
      creatorNotifyEmail: string
      docType: DocumentType
      docNotes: string
      pdfHash: string | null
      pageCount: number
    }) => {
      if (m.title) setTitle(m.title)
      if (m.creatorName) setCreatorName(m.creatorName)
      if (m.creatorNotifyEmail) setCreatorNotifyEmail(m.creatorNotifyEmail)
      if (m.docType) setDocType(m.docType)
      if (m.docNotes) setDocNotes(m.docNotes)
      if (m.pdfHash) setPdfHash(m.pdfHash)
      if (m.pageCount > 0) setPageCount(m.pageCount)
    },
    [],
  )

  const ensureCreatorRole = useCallback(() => {
    setRole(prev => prev ?? 'creator')
  }, [])

  const {
    onFileChange: onCreatePdfFileChange,
    flush: flushCreatePdfDraft,
    clear: clearCreatePdfDraftState,
  } = useCreatePdfDraft({
    enabled: !doc && (role === 'creator' || role == null),
    bootReady,
    canRestore: !doc && (role === 'creator' || role == null),
    pdfFile,
    setPdfFile,
    meta: {
      title,
      creatorName,
      creatorNotifyEmail,
      docType,
      docNotes,
      pdfHash,
      pageCount,
      role: role === 'creator' || !role ? 'creator' : role,
    },
    applyRestoredMeta: applyRestoredCreateMeta,
    ensureCreatorRole,
    role,
  })

  useRevealDocumentOnAuth(doc, token, setActiveFromSeal)

  // Hash PDF on select (sign path) + match check
  useEffect(() => {
    if (!signFile || !doc) {
      // Do not clear a hash that still matches the create-time PDF (session continuity).
      if (!signFile && !(pdfFile && pdfHash && doc && pdfHash === doc.fingerprint)) {
        setSignHash(null)
      }
      return
    }
    // Already verified for this file + agreement — skip re-hash churn.
    if (signHash === doc.fingerprint && pdfHash === doc.fingerprint && signFile === pdfFile) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const hash = await sha256Hex(await signFile.arrayBuffer())
        if (cancelled) return
        if (hash !== doc.fingerprint) {
          setSignHash(null)
          setLocalError(
            'This file does not match the agreement fingerprint. Use the exact file the creator shared.',
          )
          return
        }
        setLocalError(null)
        setSignHash(hash)
      } catch (err) {
        if (!cancelled) {
          setLocalError(err instanceof Error ? err.message : 'Failed to read document')
          setSignHash(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signFile, doc, signHash, pdfFile, pdfHash])

  // Session continuity: carry the fingerprinted create-time PDF into the sign step.
  // Only prompt for a second drop when this browser session no longer holds a matching file
  // (e.g. user left and returned via invite link).
  useEffect(() => {
    if (!doc?.fingerprint) return
    if (signFile && signHash === doc.fingerprint) return
    if (pdfFile && pdfHash && pdfHash === doc.fingerprint) {
      setSignFile(pdfFile)
      setSignHash(pdfHash)
    }
  }, [doc, pdfFile, pdfHash, signFile, signHash])

  // Verify path: hash once per selected file, then look up matches.
  // Important: do NOT depend on `doc` - loading a match used to setActiveFromSeal,
  // re-fire this effect, spam /api/verify/hash (rate limit), and flash "local fingerprint".
  const verifyRunIdRef = useRef(0)
  const verifyCacheRef = useRef<{
    key: string
    hash: string
    outcome: Exclude<VerifyOutcome, { kind: 'idle' | 'hashing' }>
  } | null>(null)

  useEffect(() => {
    if (!verifyFile) {
      setVerifyOutcome({ kind: 'idle' })
      return
    }

    const fileKey = `${verifyFile.name}:${verifyFile.size}:${verifyFile.lastModified}`
    const cached = verifyCacheRef.current
    if (cached?.key === fileKey) {
      setVerifyOutcome(cached.outcome)
      return
    }

    const runId = ++verifyRunIdRef.current
    setVerifyOutcome({ kind: 'hashing' })
    setLocalError(null)

    void (async () => {
      try {
        const got = await sha256Hex(await verifyFile.arrayBuffer())
        if (runId !== verifyRunIdRef.current) return

        const { matches } = await api.verifyHash(got)
        if (runId !== verifyRunIdRef.current) return

        if (matches.length === 0) {
          const outcome = {
            kind: 'lookup' as const,
            fingerprint: shortHash(got),
            fileName: verifyFile.name,
            titles: [] as string[],
          }
          verifyCacheRef.current = { key: fileKey, hash: got, outcome }
          setVerifyOutcome(outcome)
          return
        }

        let details: VerifyResult[] = []
        try {
          details = await loadVerifyDetails(matches.map(m => m.slug), token)
        } catch (detailErr) {
          // Hash matched - still show a usable result even if detail fetch fails
          console.warn('[journey] verify detail load failed', detailErr)
        }
        if (runId !== verifyRunIdRef.current) return

        const pick =
          details.find(m => m.status === 'locked') ??
          details[0] ??
          null
        const outcome = {
          kind: 'match' as const,
          fingerprint: shortHash(got),
          fileName: verifyFile.name,
          title: pick?.title ?? matches[0]?.title,
          explorerUrl: pick?.attestation?.explorerUrl ?? null,
          matches: details,
        }
        verifyCacheRef.current = { key: fileKey, hash: got, outcome }
        setVerifyOutcome(outcome)

        // Soft-load stage card AFTER outcome is settled (must not re-trigger this effect)
        const openSlug =
          details.find(m => m.status === 'locked')?.slug ??
          details[0]?.slug ??
          matches[0]?.slug
        if (openSlug) {
          try {
            // Prefer session when present so parties still get ink/names on the review UI.
            const { document } = await api.getDocument(openSlug, token)
            if (runId === verifyRunIdRef.current) setActiveFromSeal(document)
          } catch {
            /* panel already has verify details when available */
          }
        }
      } catch (err) {
        if (runId !== verifyRunIdRef.current) return
        const message = err instanceof Error ? err.message : 'Verify failed'
        setLocalError(message)
        // Keep a local hash preview so the drop still feels responsive
        try {
          const got = await sha256Hex(await verifyFile.arrayBuffer())
          if (runId !== verifyRunIdRef.current) return
          setVerifyOutcome({
            kind: 'local',
            fingerprint: shortHash(got),
            fileName: verifyFile.name,
            fileSize: verifyFile.size,
          })
        } catch {
          setVerifyOutcome({ kind: 'idle' })
        }
      }
    })()
  }, [verifyFile, setActiveFromSeal, token])

  const clearLocalJourneyState = () => {
    setPdfFile(null)
    setPdfHash(null)
    setTitle('')
    setCreatorName('')
    setCreatorNotifyEmail('')
    setDocType('contract')
    setCoSignerNames([''])
    setCoSignerEmails([''])
    setDocNotes('')
    setRequiredSigners(1)
    setDoc(null)
    setSharedAck(false)
    setSignFile(null)
    setSignHash(null)
    setSignerName('')
    setSigBlob(null)
    setSigPadKey(k => k + 1)
    setConstructionPlan(null)
    setPlanLoadState('idle')
    setFilledSlotIds(new Set())
    setKnownBlobIds(new Set())
    setLastBatchRoot(null)
    setPageFieldsConfirmed(false)
    setPlacementStatus(null)
    setPickedPartyId(null)
    setVerifyFile(null)
    setVerifyOutcome({ kind: 'idle' })
    verifyCacheRef.current = null
    verifyRunIdRef.current += 1
    setLocalError(null)
    setLockMessage(null)
    setError(null)
    void clearCreatePdfDraftState()
  }

  const resetAll = () => {
    // Prefer shell home (path picker / redesign landing) so we don't flash an
    // in-component welcome under a track title. Keep local UI for the fade-out.
    if (onHome) {
      clearJourneyIntent()
      syncIntentToUrl(null)
      setLocalError(null)
      setLockMessage(null)
      setError(null)
      if (
        window.location.pathname.startsWith('/d/') ||
        window.location.pathname.startsWith('/v/') ||
        window.location.search.includes('intent=')
      ) {
        window.history.pushState({}, '', '/')
      }
      onHome()
      return
    }

    setRole(null)
    clearJourneyIntent()
    syncIntentToUrl(null)
    clearLocalJourneyState()
    if (
      window.location.pathname.startsWith('/d/') ||
      window.location.pathname.startsWith('/v/') ||
      window.location.search.includes('intent=')
    ) {
      window.history.pushState({}, '', '/')
    }
  }

  /** Done step: new create flow (not path-picker home). */
  const startAnotherAgreement = () => {
    setLocalError(null)
    setLockMessage(null)
    setError(null)
    if (onStartCreate) {
      onStartCreate()
      return
    }
    // Fallback when shell is not wired: reset local state onto fingerprint create.
    clearLocalJourneyState()
    setRole('creator')
    saveJourneyIntent('creator')
    syncIntentToUrl('creator')
    window.history.pushState({}, '', '/?intent=creator')
  }

  /**
   * After a successful seal: jump to the verifier path with the same PDF preloaded
   * so the hash lookup runs without re-dropping the file.
   */
  const openVerifyWithLocalPdf = () => {
    const local = pdfFile ?? signFile
    if (local) {
      setVerifyFile(local)
    }
    setLocalError(null)
    setLockMessage(null)
    setError(null)
    setRole('verifier')
    saveJourneyIntent('verifier')
    if (onSwitchPath) {
      onSwitchPath('verifier')
    } else {
      // Standalone fallback (no shell track title update)
      window.history.pushState({}, '', '/?intent=verifier')
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const createDoc = async () => {
    if (!token || !pdfFile || !pdfHash) return
    setBusy(true)
    setLocalError(null)
    try {
      // Fingerprint only — parties / who signs are set when placements lock.
      const metadata =
        documentTypeUsesNotes(docType) && docNotes.trim()
          ? { notes: clampField(docNotes.trim(), MAX_DOCUMENT_NOTES_LENGTH) }
          : undefined

      const { document, hashWarning } = await api.createDocument(token, {
        title: clampField(title || stripDocumentExtension(pdfFile.name), MAX_TITLE_LENGTH),
        originalFileName: pdfFile.name,
        type: docType,
        creatorRole: 'creator',
        // Optional organizer label only — not assumed to be Person 1 / a signer.
        creatorDisplayName: clampField(
          creatorName.trim() || 'Organizer',
          MAX_DISPLAY_NAME_LENGTH,
        ),
        originalSha256: pdfHash,
        pageCount,
        requiredSignatures: 1,
        ...(metadata ? { metadata } : {}),
      })

      if (hashWarning) setLocalError(hashWarning)
      setActiveFromSeal(document, pdfFile.size)
      setSharedAck(false)
      setSignFile(pdfFile)
      setSignHash(pdfHash)
      setConstructionPlan(emptyPlan(pdfHash, 2))
      setPageFieldsConfirmed(false)
      window.history.pushState({}, '', `/d/${document.slug}`)
      void clearCreatePdfDraftState()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  const copyText = async (text: string, notePartyId?: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      if (notePartyId) {
        setInviteSendNote(prev => ({ ...prev, [notePartyId]: 'Link copied' }))
      }
      return true
    } catch {
      setLocalError('Could not copy — select the link and copy it manually.')
      return false
    }
  }

  const showInviteSentToast = useCallback((contactLabel: string) => {
    if (inviteToastTimerRef.current) {
      clearTimeout(inviteToastTimerRef.current)
      inviteToastTimerRef.current = null
    }
    setInviteToast({ key: Date.now(), contactLabel })
    // Long enough to read the PDF handoff reminder
    inviteToastTimerRef.current = setTimeout(() => {
      setInviteToast(null)
      inviteToastTimerRef.current = null
    }, 10000)
  }, [])

  useEffect(() => {
    return () => {
      if (inviteToastTimerRef.current) clearTimeout(inviteToastTimerRef.current)
    }
  }, [])

  /** Mobile: system share sheet (iMessage, WhatsApp, …) with personal link + local PDF when allowed. */
  const sharePersonInvite = async (opts: {
    partyId: string
    personName: string
    personLink: string
  }) => {
    if (!doc) return
    const localPdf = pdfFile ?? signFile
    setLocalError(null)
    try {
      if (localPdf && canShareFiles([localPdf])) {
        // Prefer sharing PDF + invite text (personal link in the body).
        const result = await shareInviteWithPdf(doc.source, opts.personLink, localPdf)
        if (result === 'shared') {
          setInviteSendNote(prev => ({
            ...prev,
            [opts.partyId]: 'Opened share sheet (include PDF when the app allows)',
          }))
          return
        }
        if (result === 'cancelled') return
      }
      if (typeof navigator.share === 'function') {
        const organizerLabel = creatorName.trim() || 'The organizer'
        await navigator.share({
          title: `${organizerLabel} requested you sign: ${doc.title}`,
          text: [
            `${organizerLabel} has requested you sign “${doc.title}” on VeriLock.`,
            opts.personName ? `This invite is for ${opts.personName}.` : '',
            'Open your personal link (use the exact PDF the organizer shared with you):',
            opts.personLink,
          ]
            .filter(Boolean)
            .join('\n'),
          url: opts.personLink,
        })
        setInviteSendNote(prev => ({
          ...prev,
          [opts.partyId]: 'Opened share sheet',
        }))
        return
      }
      await copyText(opts.personLink, opts.partyId)
    } catch (err) {
      if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
        return
      }
      setLocalError(err instanceof Error ? err.message : 'Could not open share sheet')
    }
  }

  /** Load placement plan for this PDF fingerprint (structure only). */
  useEffect(() => {
    if (!FEATURES.pdfAnnotationUi || !doc?.fingerprint) {
      setPlanLoadState('idle')
      return
    }
    let cancelled = false
    setPlanLoadState('loading')
    void api
      .getPlacementPlan(doc.fingerprint)
      .then(r => {
        if (cancelled) return
        if (!r.plan) {
          setPlanLoadState('none')
          return
        }
        const slots: PlacementSlot[] = (r.plan.slots ?? []).map(s => ({
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
        const planPeople =
          r.plan.people?.length > 0
            ? r.plan.people.map(p => ({
                slotIndex: p.slotIndex,
                displayName: p.displayName,
                ...(p.role ? { role: p.role } : {}),
                ...(p.walletAddress
                  ? { walletAddress: normalizeAddress(p.walletAddress) }
                  : { walletAddress: null }),
              }))
            : emptyPlan(doc.fingerprint, 2).people
        setConstructionPlan({
          pdfSha256: r.plan.pdfSha256 || doc.fingerprint,
          people: planPeople,
          slots,
          status: r.status === 'locked' ? 'locked' : 'draft',
          creatorSigningAs: r.plan.creatorSigningAs ?? null,
          ...(r.lockedAt != null ? { lockedAt: r.lockedAt } : {}),
          ...(r.planRoot ? { planRoot: r.planRoot } : {}),
        })
        if (planPeople.length) {
          setRequiredSigners(Math.max(1, Math.min(4, planPeople.length)))
        }
        setFilledSlotIds(new Set(r.filledSlotIds ?? []))
        setKnownBlobIds(new Set(r.knownBlobIds ?? []))
        setLastBatchRoot(r.lastBatchRoot ?? r.batch0Root ?? r.planRoot ?? null)
        setPlanLoadState('ready')
      })
      .catch(() => {
        if (cancelled) return
        /* 404 / no plan yet */
        setPlanLoadState('none')
      })
    return () => {
      cancelled = true
    }
  }, [doc?.id, doc?.fingerprint])

  /**
   * Seed a draft plan only after we know the server has none (create / arrange path).
   * Never overwrite while loading — that forced invitees into “unlocked arrange” flash.
   */
  useEffect(() => {
    if (!FEATURES.pdfAnnotationUi || !doc) return
    if (constructionPlan) return
    if (planLoadState !== 'none') return
    if (role !== 'creator') return
    const hash = (pdfHash || signHash || doc.fingerprint || '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(hash)) return
    setConstructionPlan(emptyPlan(hash, Math.max(2, requiredSigners)))
  }, [doc, constructionPlan, pdfHash, signHash, requiredSigners, planLoadState, role])

  /** Map signing party → construction person (1-based). */
  const personSlotForParty = useCallback(
    (partyId: string | undefined | null): number => {
      if (!doc || !partyId) return 1
      // Creator explicitly chose a person slot on Arrange
      if (
        constructionPlan?.creatorSigningAs != null &&
        constructionPlan.creatorSigningAs > 0 &&
        address &&
        isDocumentCreator(doc.source, address)
      ) {
        const party = doc.parties.find(p => p.id === partyId)
        if (
          party?.walletAddress &&
          normalizeAddress(party.walletAddress) === normalizeAddress(address)
        ) {
          return constructionPlan.creatorSigningAs
        }
      }
      if (constructionPlan?.people?.length) {
        const party = doc.parties.find(p => p.id === partyId)
        const name = party?.displayName?.trim().toLowerCase()
        if (name) {
          const byName = constructionPlan.people.find(
            p => p.displayName.trim().toLowerCase() === name,
          )
          if (byName) return byName.slotIndex
        }
        // Match by party order among required parties
        const required = doc.parties.filter(p => p.required)
        const idx = required.findIndex(p => p.id === partyId)
        if (idx >= 0 && constructionPlan.people[idx]) {
          return constructionPlan.people[idx]!.slotIndex
        }
      }
      const required = doc.parties.filter(p => p.required)
      const idx = required.findIndex(p => p.id === partyId)
      return idx >= 0 ? idx + 1 : 1
    },
    [doc, constructionPlan, address],
  )

  const submitPageFields = useCallback(
    async (result: SignerFillResult) => {
      if (!token || !doc || !constructionPlan?.planRoot) {
        throw new Error('Missing session or locked plan')
      }
      const hash = (pdfHash || signHash || doc.fingerprint || '').toLowerCase()
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Document fingerprint missing')

      setFillBusy(true)
      try {
        // Use drawn ink for the wallet signature image (no second pad).
        if (result.signatureImageDataUrl) {
          try {
            const blob = await (await fetch(result.signatureImageDataUrl)).blob()
            setSigBlob(blob)
          } catch {
            /* pad still available as fallback */
          }
        }
        if (result.printedName && !signerName.trim()) {
          setSignerName(result.printedName)
        }

        if (result.fills.length === 0) {
          setPageFieldsConfirmed(true)
          return
        }

        const planRoot = constructionPlan.planRoot
        let lastErr: Error | null = null
        // Concurrent signers may race on prevRoot — refresh tip and retry.
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            let known = knownBlobIds
            let batchIndex = 1
            let prev =
              lastBatchRoot ||
              planRoot ||
              '0000000000000000000000000000000000000000000000000000000000000000'
            const live = await api.getPlacementPlan(hash)
            batchIndex = (live.fillBatchCount ?? 0) + 1
            prev = live.lastBatchRoot || live.batch0Root || live.planRoot || prev
            known = new Set(live.knownBlobIds ?? [])
            setFilledSlotIds(new Set(live.filledSlotIds ?? []))
            setKnownBlobIds(known)
            setLastBatchRoot(prev)

            const batch = await buildFillBatch({
              batchIndex,
              prevRoot: prev,
              pdfSha256: hash,
              planRoot,
              knownBlobIds: known,
              fills: result.fills,
            })
            const batchRoot = await computeBatchRoot(batch)
            const frames = packPlacementBatch({ ...batch, batchRoot })
            const saved = await api.appendPlacementFill(token, hash, {
              personSlotIndex: result.personSlotIndex,
              prevRoot: prev,
              batchRoot,
              batchIndex,
              framesHex: framesToHex(frames),
              fills: batch.fills.map(f => ({
                slotId: f.slotId,
                blobId: f.blobId,
                personSlotIndex: f.personSlotIndex,
              })),
              blobIds: batch.blobs.map(b => b.blobId),
            })
            setFilledSlotIds(
              new Set([
                ...(saved.filledSlotIds ?? []),
                ...result.fills.map(f => f.slotId),
              ]),
            )
            setKnownBlobIds(
              new Set([
                ...(saved.knownBlobIds ?? [...known]),
                ...batch.blobs.map(b => b.blobId),
              ]),
            )
            setLastBatchRoot(saved.lastBatchRoot ?? batchRoot)
            setPageFieldsConfirmed(true)
            return
          } catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err))
            const msg = lastErr.message
            const retryable =
              /prevRoot|batchIndex|refresh and retry|Expected batchIndex/i.test(msg)
            if (!retryable || attempt === 3) break
          }
        }
        throw lastErr ?? new Error('Could not save page fields')
      } finally {
        setFillBusy(false)
      }
    },
    [token, doc, constructionPlan, pdfHash, signHash, lastBatchRoot, knownBlobIds, signerName],
  )

  const lockPlacements = useCallback(async () => {
    if (!token || !doc || !constructionPlan) return
    const hash = (pdfHash || signHash || doc.fingerprint || constructionPlan.pdfSha256).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      setLocalError('Document fingerprint missing — re-open the file.')
      return
    }
    if (constructionPlan.slots.length === 0) {
      setLocalError('Place at least one signature or name box before locking.')
      return
    }
    for (const p of constructionPlan.people) {
      if (p.walletAddress && !isValidNimiqAddress(p.walletAddress)) {
        setLocalError(
          `Person ${p.slotIndex}${p.displayName ? ` (${p.displayName})` : ''}: Nimiq address looks invalid.`,
        )
        return
      }
    }
    setPlacementLockBusy(true)
    setPlacementStatus(null)
    setLocalError(null)
    try {
      const planForHash = { ...constructionPlan, pdfSha256: hash }
      const planRoot = await computePlanRoot(planForHash)
      const lockedLocal = lockConstructionPlanLocal(planForHash, planRoot)
      const packed = await packLockedPlan(lockedLocal)
      const saved = await api.savePlacementPlan(token, {
        originalSha256: hash,
        documentId: doc.id,
        plan: lockedLocal,
        lock: true,
        planRoot,
        batch0FramesHex: framesToHex(packed.frames),
        batch0Root: packed.batchRoot,
      })
      // Explicit null = organizer-only (do not default to Person 1).
      const cs =
        lockedLocal.creatorSigningAs == null || lockedLocal.creatorSigningAs === 0
          ? null
          : lockedLocal.creatorSigningAs
      setConstructionPlan({
        ...lockedLocal,
        status: 'locked',
        planRoot: saved.planRoot ?? planRoot,
        lockedAt: saved.lockedAt ?? lockedLocal.lockedAt,
        creatorSigningAs: cs,
      })
      setLastBatchRoot(saved.batch0Root ?? saved.planRoot ?? planRoot)
      setFilledSlotIds(new Set())
      setKnownBlobIds(new Set())
      setPageFieldsConfirmed(false)

      // Rebuild parties from people; creator may claim one slot or none.
      const sortedPeople = [...lockedLocal.people].sort((a, b) => a.slotIndex - b.slotIndex)
      let rosterIdx: number | null = null
      if (cs != null) {
        const found = sortedPeople.findIndex(p => p.slotIndex === cs)
        rosterIdx = found >= 0 ? found : null
      }

      const { document: rosterDoc } = await api.configureSigningRoster(token, doc.id, {
        parties: sortedPeople.map(p => ({
          displayName: p.displayName?.trim() || `Person ${p.slotIndex}`,
          role: p.role,
          walletAddress: p.walletAddress?.trim()
            ? normalizeAddress(p.walletAddress)
            : null,
        })),
        creatorSignsAsIndex: rosterIdx,
      })
      setActiveFromSeal(rosterDoc, fileSizeByDocIdRef.current[doc.id] ?? doc.fileSize)
      setRequiredSigners(sortedPeople.length)
      setCoSignerNames(
        sortedPeople
          .filter((_, i) => i !== rosterIdx)
          .map(p => p.displayName?.trim() || ''),
      )

      const asLabel =
        rosterIdx == null
          ? 'you are organizing only (not signing)'
          : `you sign as ${sortedPeople[rosterIdx]?.displayName || `Person ${cs}`}`
      setPlacementStatus(
        `Placements locked · ${saved.slotCount} boxes · ${asLabel} · root ${shortHash(saved.planRoot ?? planRoot)}`,
      )
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not lock placements')
    } finally {
      setPlacementLockBusy(false)
    }
  }, [
    token,
    doc,
    constructionPlan,
    pdfHash,
    signHash,
    creatorNotifyEmail,
  ])

  /** Mark invite as sent, or solo “continue to seal” (share is after creator sign). */
  const acknowledgeShare = () => {
    setSharedAck(true)
  }

  /**
   * Persist cosigner count + optional names from the share-step Signatures UI.
   * Called automatically when party count changes or names blur — no Save button.
   */
  const applyCosigners = async (overrides?: {
    requiredSignatures?: number
    coSignerNames?: string[]
    notifyEmail?: string
  }) => {
    if (!token || !doc) return
    const total = Math.max(
      1,
      Math.min(4, overrides?.requiredSignatures ?? requiredSigners),
    )
    const names = overrides?.coSignerNames ?? coSignerNames
    const notifyRaw =
      overrides?.notifyEmail !== undefined ? overrides.notifyEmail : creatorNotifyEmail
    setBusy(true)
    setLocalError(null)
    try {
      const others = Math.max(0, total - 1)
      const { document } = await api.configureCosigners(token, doc.id, {
        requiredSignatures: total,
        coSignerNames: names.slice(0, others).map(n => n.trim()),
      })
      setActiveFromSeal(document, doc.fileSize)
      if (FEATURES.emailNotifyUi) {
        const email = total > 1 && notifyRaw.trim() ? notifyRaw.trim() : null
        try {
          await api.setDocumentNotifyEmail(token, doc.id, email)
        } catch {
          /* non-fatal — cosigners already saved */
        }
      }
      // Expanding beyond solo: stay on share for invites (sharedAck resets for multi wait).
      if (total > 1) setSharedAck(false)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not update signers')
    } finally {
      setBusy(false)
    }
  }

  /** Creator-only: cancel before anyone has signed. */
  const cancelCurrentAgreement = async () => {
    if (!token || !doc || !canDeleteDocument(doc.source, address)) return
    const ok = window.confirm(
      `Cancel “${doc.title}”? This removes the agreement permanently. Only possible before anyone signs.`,
    )
    if (!ok) return
    setBusy(true)
    setLocalError(null)
    try {
      await api.deleteDocument(token, doc.id)
      setDoc(null)
      setSharedAck(false)
      setSignFile(null)
      setSignHash(null)
      setPdfFile(null)
      setPdfHash(null)
      setRole(null)
      clearJourneyIntent()
      syncIntentToUrl(null)
      window.history.pushState({}, '', '/')
      setLockMessage(null)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not cancel agreement')
    } finally {
      setBusy(false)
    }
  }

  const signAsCurrentUser = async () => {
    if (!token || !doc || !address) return

    // Prefer explicit sign-step hash; fall back to create-time PDF still in this session.
    const clientHash =
      signHash && signHash === doc.fingerprint
        ? signHash
        : pdfHash && pdfHash === doc.fingerprint
          ? pdfHash
          : null
    if (!clientHash) {
      setLocalError('Choose the matching PDF before signing')
      return
    }

    const creatorOnlyBlock =
      FEATURES.pdfAnnotationUi &&
      constructionPlan?.status === 'locked' &&
      (constructionPlan.creatorSigningAs == null || constructionPlan.creatorSigningAs === 0) &&
      isDocumentCreator(doc.source, address)
    const resolution = resolveSigningParty(doc.source, address, {
      allowOpenClaim: !creatorOnlyBlock,
      preferredPartyId: effectivePreferredPartyId,
    })
    if (!resolution.ok) {
      setLocalError(resolution.message)
      return
    }
    const myParty = resolution.party
    if (partyNeedsSignerName(myParty) && !signerName.trim()) {
      setLocalError('Enter your full name before signing')
      return
    }
    if (!sigBlob) {
      setLocalError('Draw your signature before signing')
      return
    }

    setBusy(true)
    setLocalError(null)
    try {
      const signatureImage = await prepareSignatureImageUpload(sigBlob)
      const { document: signedDoc } = await api.signDocument(token, doc.id, {
        partyId: myParty.id,
        signatureType: 'drawn',
        clientSha256: clientHash,
        displayName: partyNeedsSignerName(myParty)
          ? clampField(signerName.trim(), MAX_DISPLAY_NAME_LENGTH)
          : undefined,
        signatureImage,
      })
      setActiveFromSeal(signedDoc, doc.fileSize)
      // Keep the matched PDF in this session for share / any return to sign.
      // Re-upload is only needed after a full leave (reload) drops local File state.
      setSignerName('')
      setSigBlob(null)
      setSigPadKey(k => k + 1)
      if (mobileSigPreview) {
        URL.revokeObjectURL(mobileSigPreview)
        setMobileSigPreview(null)
      }
      if (signedDoc.signingProgress.readyToLock) {
        // Only the creator seals — co-signers should not be told to continue to seal.
        const solo = signedDoc.signingProgress.required <= 1
        if (isDocumentCreator(signedDoc, address)) {
          setLockMessage(
            solo
              ? 'Signature complete — continue to seal.'
              : 'All signatures collected — continue to seal.',
          )
        } else {
          setLockMessage(
            solo
              ? 'Signature complete. The creator can seal this agreement on the Nimiq blockchain.'
              : 'All signatures are in. The creator can seal this agreement on the Nimiq blockchain.',
          )
        }
      }
      // Sign form is mid-page; after success the UI swaps to done/share and the old
      // scroll offset lands near the bottom. Snap to top so the confirmation is visible.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
          window.document.documentElement.scrollTop = 0
          window.document.body.scrollTop = 0
        })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign failed'
      setLocalError(message)
      // Slot races / already-signed: pull latest party assignment for a clean retry.
      if (/already signed|claimed this slot|refresh/i.test(message) && doc?.slug) {
        try {
          const { document: latest } = await api.getDocument(doc.slug, token)
          setActiveFromSeal(latest, doc.fileSize)
        } catch {
          /* keep prior doc state */
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const seal = async () => {
    if (!token || !address || !doc) return
    if (!doc.directSeal && !allSigned(doc)) {
      setLocalError(
        `${signedCount(doc)} of ${requiredCount(doc)} signatures collected — remaining signers must sign before sealing.`,
      )
      return
    }
    setBusy(true)
    setLocalError(null)
    setLockMessage('Preparing lock…')
    const result = await sealJourneyDocument({
      token,
      address,
      doc: doc.source,
      nimiq,
      setNimiq,
      onProgress: setLockMessage,
    })
    if (result.ok) {
      setActiveFromSeal(result.document, doc.fileSize)
      setLockMessage('Agreement locked on the Nimiq blockchain.')
      setCreditsRefresh(k => k + 1)
    } else if (result.redirecting) {
      setLockMessage(result.message)
    } else {
      setLocalError(result.message)
      setLockMessage(null)
    }
    if (!result.ok && result.redirecting) {
      // leave busy - page navigates
      return
    }
    setBusy(false)
  }

  const sealWithCredit = async () => {
    if (!token || !doc) return
    if (!doc.directSeal && !allSigned(doc)) {
      setLocalError(
        `${signedCount(doc)} of ${requiredCount(doc)} signatures collected — remaining signers must sign before sealing.`,
      )
      return
    }
    setBusy(true)
    setLocalError(null)
    setLockMessage('Reserving 1 credit — you can leave this page anytime…')
    const result = await sealJourneyDocumentWithCredit({
      token,
      doc: doc.source,
      onProgress: setLockMessage,
    })
    if (result.ok) {
      setActiveFromSeal(result.document, doc.fileSize)
      setLockMessage('Sealed forever on Nimiq (1 credit).')
      setCreditsRefresh(k => k + 1)
    } else {
      setLocalError(result.message)
      setLockMessage(null)
    }
    setBusy(false)
  }

  const connectMode = resolveJourneyConnectMode({
    inNimiqPay,
    mobilePayConnect,
    showOpenInPay,
  })
  const loginNeedsSheet = journeyLoginNeedsSheet(connectMode)
  const [loginSheetOpen, setLoginSheetOpen] = useState(false)

  useEffect(() => {
    if (account) setLoginSheetOpen(false)
  }, [account])

  const connectFromPath = (options?: JourneyConnectRequest) => {
    // Stamp intent into URL only when connecting (Hub return needs it).
    if (role) {
      saveJourneyIntent(role)
      syncIntentToUrl(role)
    }
    saveHubReturnPath()
    // Hub redirect remounts the SPA — commit PDF draft before navigate.
    void (async () => {
      if (pdfFile && !doc) await flushCreatePdfDraft()
      await connect(options !== undefined ? options : journeyConnectOptions(connectMode))
    })()
  }

  /** Header-style Login: sheet on mobile (Pay vs Hub), direct Hub/Pay-native on desktop. */
  const requestLogin = () => {
    if (loginNeedsSheet) {
      if (pdfFile && !doc) void flushCreatePdfDraft()
      setLoginSheetOpen(true)
      return
    }
    connectFromPath()
  }

  /** Invited path: resolve agreement by PDF fingerprint when there is no /d/ link yet. */
  const lookupInviteByPdf = async (file: File | null) => {
    setSignFile(file)
    setSignHash(null)
    if (!file) {
      setLocalError(null)
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      const hash = await sha256Hex(await file.arrayBuffer())
      const { matches } = await api.verifyHash(hash)
      if (matches.length === 0) {
        setLocalError(
          'No agreement matches this PDF on this host. Check you have the exact file, or open the invite link from the creator.',
        )
        return
      }

      // Prefer agreements that still need signatures; fall back to any match
      const ranked = [...matches].sort((a, b) => {
        const score = (s: string) =>
          s === 'collecting_signatures' || s === 'ready_to_lock' || s === 'pending'
            ? 0
            : s === 'locked'
              ? 2
              : 1
        return score(a.status) - score(b.status)
      })

      let opened: Awaited<ReturnType<typeof api.getDocument>>['document'] | null = null
      let openError: string | null = null
      for (const m of ranked) {
        try {
          const { document } = await api.getDocument(m.slug, token)
          if (document.status === 'locked') {
            openError = `"${document.title}" is already sealed. Use Verify a PDF to check integrity.`
            continue
          }
          // If wallet connected, prefer a doc this wallet can still sign
          if (address) {
            const res = resolveSigningParty(document, address)
            if (!res.ok && res.hint === 'already_signed') {
              openError = res.message
              // still open so they see progress
              opened = document
              break
            }
            if (!res.ok && res.hint === 'wrong_wallet') {
              openError = res.message
              continue
            }
          }
          opened = document
          openError = null
          break
        } catch (err) {
          openError = err instanceof Error ? err.message : 'Could not open agreement'
        }
      }

      if (!opened) {
        setLocalError(openError ?? 'Could not open a matching agreement for signing.')
        return
      }

      setActiveFromSeal(opened, file.size)
      setSignHash(hash)
      setSharedAck(true)
      window.history.pushState({}, '', `/d/${opened.slug}`)
      if (openError) setLocalError(openError)
      else setLocalError(null)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not look up this PDF')
    } finally {
      setBusy(false)
    }
  }

  const signFileMatches = Boolean(signHash && doc && signHash === doc.fingerprint)
  /**
   * Session still holds a matching PDF. Prefer the active sign-step file when set;
   * only fall back to create-time pdf when no separate sign drop is in play.
   * (Avoid green “match” while a non-matching signFile is selected.)
   */
  const hasVerifiedLocalPdf = Boolean(
    doc &&
      (signFile
        ? signHash === doc.fingerprint
        : Boolean(pdfFile && pdfHash === doc.fingerprint)),
  )
  const displayError = localError

  if (missingDeepLink) {
    return (
      <div className="journey">
        <NotFoundPage
          title="Agreement not found"
          message="This invite or verify link is not valid. The agreement may have been cancelled, or the URL may be incomplete."
          path={missingDeepLink}
          onHome={() => {
            setMissingDeepLink(null)
            setRole(null)
            clearJourneyIntent()
            syncIntentToUrl(null)
            if (onHome) onHome()
            else window.history.pushState({}, '', '/')
          }}
        />
      </div>
    )
  }

  return (
    <div className="journey">
      <aside className="trust-bar" aria-label="Privacy">
        <button
          type="button"
          className="trust-bar-main"
          onClick={() => setPrivacyOpen(v => !v)}
          aria-expanded={privacyOpen}
        >
          <Shield className="trust-bar-icon" size={18} strokeWidth={2.25} aria-hidden />
          <span>
            <strong>Your PDF never leaves this device.</strong>
            {/* Desktop: keep subtitle on the collapsed row. Mobile: only in expanded detail. */}
            <span className="trust-bar-sub trust-bar-sub--inline">
              {' '}
              Only a SHA-256 fingerprint is stored / sealed on-chain.
            </span>
          </span>
          <span className={`trust-chevron${privacyOpen ? ' trust-chevron--open' : ''}`} />
        </button>
        {privacyOpen && (
          <div className="trust-bar-detail">
            <p className="trust-bar-sub trust-bar-sub--detail">
              Only a SHA-256 fingerprint is stored / sealed on-chain.
            </p>
            <ul>
              <li>Fingerprinting runs in your browser - bytes stay local.</li>
              <li>Servers keep metadata + hash, not the file.</li>
              <li>On-chain seal records the hash string only.</li>
              <li>Verification re-hashes a local copy - no wallet required.</li>
            </ul>
          </div>
        )}
      </aside>

      {/* Path picker home is owned by App / LandingHome. */}

      {step !== 'welcome' && (
        <>
          {role && (
            <StageRail
              role={role}
              step={step}
              account={Boolean(account)}
              doc={doc}
            />
          )}

          <section className="action-dock" aria-live="polite">
            <header className="action-dock-head">
              <div className="journey-toolbar">
                <button
                  type="button"
                  className="btn btn-ghost journey-reset"
                  onClick={resetAll}
                  title="Back to home"
                >
                  <ArrowLeft size={14} strokeWidth={2.25} aria-hidden />
                  Back home
                </button>
                {account && role === 'creator' && (
                  <span className="journey-role-pill">Creating as {account.shortAddress}</span>
                )}
                {role === 'signer' && (
                  <span className="journey-role-pill">
                    {account ? `Signing as ${account.shortAddress}` : 'Signing'}
                  </span>
                )}
                {role === 'verifier' && <span className="journey-role-pill">Verifier mode</span>}
              </div>
              <div>
                <p className="action-kicker">
                  {step === 'done' && role !== 'signer'
                    ? 'Complete'
                    : activeStage && stepIndex >= 0
                      ? `Step ${stepIndex + 1} of ${pathStages.length} · ${activeStage.label}`
                      : 'Action'}
                </p>
                <h3>
                  {step === 'done' && role === 'signer'
                    ? (activeStage?.verb ?? 'You are all set')
                    : step === 'done'
                      ? 'Agreement sealed'
                      : activeStage?.verb ?? 'Continue'}
                </h3>
                <p className="muted action-blurb">
                  {step === 'done' && role === 'signer'
                    ? (activeStage?.blurb ??
                      'Your signature is recorded. When everyone has signed, the agreement is sealed on Nimiq.')
                    : step === 'done'
                      ? 'Keep your file. Drop a copy below anytime to verify the fingerprint.'
                      : activeStage?.blurb}
                </p>
              </div>
              {activeStage && !(step === 'done' && role === 'creator') && (
                <p className="action-privacy">
                  <Shield size={14} strokeWidth={2.25} aria-hidden />
                  {activeStage.privacyNote}
                </p>
              )}
            </header>

            {displayError && (
              <div className="result-banner result-banner--bad" role="alert">
                {displayError}
              </div>
            )}
            {lockMessage && !displayError && !(step === 'seal' && busy && creditBalance >= 1) && (
              <div className="result-banner result-banner--ok" role="status">
                {lockMessage}
              </div>
            )}

            <div className="action-dock-body">
              {step === 'fingerprint' && (
                <div className="action-stack">
                  <header className="signatures-config-head">
                    <h3>Add the PDF</h3>
                    <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                      No signing on this step. Fingerprint the file locally, then name people and
                      place their fields on the next screen. You can organize without being a
                      signer.
                    </p>
                  </header>
                  <DocumentStage
                    step={step}
                    doc={doc}
                    file={pdfFile}
                    onFileChange={onCreatePdfFileChange}
                    accepting
                  />
                  <p className="muted" style={{ margin: 0 }}>
                    {pdfFile ? (
                      <>
                        Ready: <strong>{pdfFile.name}</strong>
                        {pdfHash ? (
                          <>
                            {' '}
                            · <code className="mono">{shortHash(pdfHash)}</code>
                          </>
                        ) : (
                          ' · hashing…'
                        )}
                      </>
                    ) : (
                      <>
                        <strong>Drop a PDF</strong> or <strong>Browse files</strong>. The file
                        stays on this device.
                      </>
                    )}
                  </p>
                  <label className="field">
                    <span className="field-label">Agreement type</span>
                    <select
                      value={docType}
                      onChange={e => {
                        const next = e.target.value as DocumentType
                        setDocType(next)
                        if (!documentTypeUsesNotes(next)) setDocNotes('')
                      }}
                    >
                      <option value="rental">Rental agreement</option>
                      <option value="contract">Contract</option>
                      <option value="nda">NDA</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">Title (optional)</span>
                    <input
                      value={title}
                      onChange={e => setTitle(clampField(e.target.value, MAX_TITLE_LENGTH))}
                      maxLength={MAX_TITLE_LENGTH}
                      placeholder={
                        docType === 'rental'
                          ? '123 Main St — 12-month lease'
                          : docType === 'nda'
                            ? 'Project Falcon — mutual NDA'
                            : docType === 'contract'
                              ? 'Vendor services agreement'
                              : 'Agreement title'
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Your name (optional)</span>
                    <input
                      value={creatorName}
                      onChange={e =>
                        setCreatorName(clampField(e.target.value, MAX_DISPLAY_NAME_LENGTH))
                      }
                      placeholder="Organizer name"
                      autoComplete="name"
                      maxLength={MAX_DISPLAY_NAME_LENGTH}
                    />
                    <span className="muted" style={{ fontSize: '0.78rem' }}>
                      Shown on invite emails (“Alex has requested you sign…”). On Arrange you choose
                      whether you sign as one of the people (or none).
                    </span>
                  </label>
                  {documentTypeUsesNotes(docType) && (
                    <label className="field">
                      <span className="field-label">Notes (optional)</span>
                      <textarea
                        value={docNotes}
                        onChange={e =>
                          setDocNotes(clampField(e.target.value, MAX_DOCUMENT_NOTES_LENGTH))
                        }
                        placeholder={
                          docType === 'nda'
                            ? 'e.g. Effective date, parties covered, or signing context'
                            : 'e.g. Context for signers or internal reference'
                        }
                        rows={3}
                        maxLength={MAX_DOCUMENT_NOTES_LENGTH}
                      />
                      <span className="muted" style={{ fontSize: '0.78rem' }}>
                        Visible to signers. Do not paste secrets or full contract text.
                      </span>
                    </label>
                  )}
                  <button
                    type="button"
                    className={`btn btn-primary btn-lg${busy || connecting ? ' btn--busy' : ''}`}
                    disabled={
                      !pdfFile || !pdfHash || busy || (!account && connecting)
                    }
                    onClick={() => {
                      if (!account) {
                        requestLogin()
                        return
                      }
                      void createDoc()
                    }}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                        Creating…
                      </>
                    ) : !account ? (
                      connecting ? (
                        <>
                          <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                          {journeyLoginEntryLabels().busy}
                        </>
                      ) : (
                        <>
                          <NimiqHexagonIcon size={18} />
                          {journeyLoginEntryLabels().idle} to continue
                        </>
                      )
                    ) : (
                      <>
                        <Fingerprint size={18} strokeWidth={2.25} />
                        Continue
                      </>
                    )}
                  </button>
                  {!account && loginNeedsSheet && loginSheetOpen && (
                    <LoginSheet
                      open
                      connectMode={connectMode}
                      connecting={connecting}
                      walletStatus={walletStatus}
                      onClose={() => setLoginSheetOpen(false)}
                      onProceed={connectFromPath}
                      placement="inline"
                    />
                  )}
                  {!account && (
                    <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                      Login with Nimiq when you are ready to register the fingerprint. Your file
                      never leaves this device.
                    </p>
                  )}
                </div>
              )}

              {step === 'share' && doc && (
                <div className="action-stack">
                  {/* Arrange: name people + empty placement slots (before or after first sign). */}
                  {FEATURES.pdfAnnotationUi && (pdfFile || signFile) && constructionPlan && (
                    <section className="journey-pdf-editor" aria-labelledby="arrange-pdf-title">
                      <header className="signatures-config-head">
                        <h3 id="arrange-pdf-title">
                          {constructionPlan.status === 'locked'
                            ? 'Placements locked'
                            : 'Arrange signers'}
                        </h3>
                      </header>
                      <PlacementEditor
                        file={(pdfFile ?? signFile)!}
                        plan={constructionPlan}
                        onChange={next => {
                          setConstructionPlan(next)
                          setRequiredSigners(Math.max(1, Math.min(4, next.people.length)))
                        }}
                        onLockRequest={
                          constructionPlan.status === 'locked' ? undefined : () => lockPlacements()
                        }
                        disabled={busy || !token}
                        lockBusy={placementLockBusy}
                      />
                      {placementStatus && (
                        <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>
                          {placementStatus}
                        </p>
                      )}
                    </section>
                  )}

                  {FEATURES.pdfAnnotationUi && !pdfFile && !signFile && (
                    <section className="journey-pdf-editor">
                      <p className="muted" style={{ margin: 0 }}>
                        Re-open the same PDF to arrange signature lines (bytes stay local).
                      </p>
                      <DocumentStage
                        step={step}
                        doc={doc}
                        file={null}
                        onFileChange={file => {
                          if (!file || !doc) return
                          void (async () => {
                            setBusy(true)
                            try {
                              const buf = await file.arrayBuffer()
                              const h = await sha256Hex(buf)
                              if (h !== doc.fingerprint) {
                                setLocalError(
                                  'That file does not match this agreement fingerprint. Use the same file you created with.',
                                )
                                return
                              }
                              setLocalError(null)
                              setPdfFile(file)
                              setPdfHash(h)
                              setSignFile(file)
                              setSignHash(h)
                              if (!constructionPlan) {
                                setConstructionPlan(emptyPlan(h, Math.max(1, requiredSigners)))
                              }
                            } catch (err) {
                              setLocalError(
                                err instanceof Error ? err.message : 'Could not read PDF',
                              )
                            } finally {
                              setBusy(false)
                            }
                          })()
                        }}
                        accepting
                        disabled={busy}
                        localCopyRequired
                        localCopyMatches={null}
                      />
                    </section>
                  )}

                  {!FEATURES.pdfAnnotationUi && (
                    <DocumentStage step={step} doc={doc} file={pdfFile} accepting={false} />
                  )}

                  {/* Invite options after placements locked (or when placement UI off). */}
                  {(!FEATURES.pdfAnnotationUi ||
                    constructionPlan?.status === 'locked' ||
                    signedCount(doc) > 0) && (
                  <>
                  <section className="signatures-config" aria-labelledby="signatures-config-title">
                    <header className="signatures-config-head">
                      <h3 id="signatures-config-title">Invite</h3>
                    </header>

                    <div className="progress-bar-wrap">
                      <div className="progress-bar-meta">
                        <span>
                          Signatures {signedCount(doc)}/{requiredCount(doc)}
                        </span>
                        <span className="muted">{doc.title}</span>
                      </div>
                      <div className="progress-bar-track">
                        <div
                          className="progress-bar-fill"
                          style={{
                            width: `${requiredCount(doc) ? (signedCount(doc) / requiredCount(doc)) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>

                    <PartyList doc={doc} revealNames={revealParticipantPrivate} />

                    {role === 'creator' && !doc.sealed && (
                      <div className="signatures-config-form">
                        {/* After construction lock, roster is immutable — no configureDocumentCosigners. */}
                        {!(
                          FEATURES.pdfAnnotationUi && constructionPlan?.status === 'locked'
                        ) && (
                        <label className="field">
                          <span className="field-label">How many parties must sign?</span>
                          <select
                            value={Math.max(requiredSigners, signedCount(doc))}
                            onChange={e => {
                              const n = Number(e.target.value)
                              const others = Math.max(0, n - 1)
                              const nextNames = coSignerNames.slice(0, others)
                              while (nextNames.length < others) nextNames.push('')
                              const nextEmails = coSignerEmails.slice(0, others)
                              while (nextEmails.length < others) nextEmails.push('')
                              setRequiredSigners(n)
                              setCoSignerNames(nextNames)
                              setCoSignerEmails(nextEmails)
                              if (n <= 1) setCreatorNotifyEmail('')
                              // Persist immediately so invite actions appear without a Save step.
                              void applyCosigners({
                                requiredSignatures: n,
                                coSignerNames: nextNames,
                                notifyEmail: n <= 1 ? '' : creatorNotifyEmail,
                              })
                            }}
                            disabled={busy}
                          >
                            {[1, 2, 3, 4]
                              .filter(n => n >= Math.max(1, signedCount(doc)))
                              .map(n => (
                                <option key={n} value={n}>
                                  {n === 1
                                    ? '1 signature (you only — no co-signers)'
                                    : `${n} signatures (you + ${n - 1} other${n - 1 === 1 ? '' : 's'})`}
                                </option>
                              ))}
                          </select>
                        </label>
                        )}

                        {/* After lock: one clear card per party — names frozen, emails local-only, copy personal link. */}
                        {FEATURES.pdfAnnotationUi &&
                          constructionPlan?.status === 'locked' &&
                          doc.parties.filter(p => p.required).length > 0 && (
                          <div className="field-stack">
                            <span className="field-label">Invite each person</span>
                            {doc.parties
                              .filter(p => p.required)
                              .map((p, index) => {
                                const base = doc.shareUrl.startsWith('http')
                                  ? doc.shareUrl
                                  : `${typeof window !== 'undefined' ? window.location.origin : ''}${doc.shareUrl.startsWith('/') ? '' : '/'}${doc.shareUrl}`
                                const personLink = `${base}${base.includes('?') ? '&' : '?'}party=${encodeURIComponent(p.id)}`
                                const label =
                                  p.displayName?.trim() ||
                                  p.roleLabel ||
                                  `Person ${index + 1}`
                                const emailVal = coSignerEmails[index] ?? ''
                                const sending = inviteSendBusyId === p.id
                                const note = inviteSendNote[p.id]
                                return (
                                  <div
                                    key={p.id}
                                    className="field-stack share-cosigner-fields"
                                    style={{
                                      padding: '0.65rem 0.75rem',
                                      border: '1px solid var(--border, #e2e8f0)',
                                      borderRadius: 10,
                                      background: '#f8fafc',
                                    }}
                                  >
                                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                      {label}
                                      {p.signed ? (
                                        <span className="muted" style={{ fontWeight: 500 }}>
                                          {' '}
                                          · signed
                                        </span>
                                      ) : null}
                                    </div>
                                    {p.walletAddress && (
                                      <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
                                        {shortAddress(p.walletAddress)}
                                      </p>
                                    )}
                                    <label className="field">
                                      <span className="field-label">Email</span>
                                      <input
                                        type="email"
                                        inputMode="email"
                                        autoComplete="email"
                                        value={emailVal}
                                        onChange={e => {
                                          const value = clampField(
                                            e.target.value,
                                            MAX_SUPPORT_EMAIL_LENGTH,
                                          )
                                          setCoSignerEmails(prev => {
                                            const next = [...prev]
                                            while (next.length <= index) next.push('')
                                            next[index] = value
                                            return next
                                          })
                                        }}
                                        maxLength={MAX_SUPPORT_EMAIL_LENGTH}
                                        placeholder="name@company.com"
                                        disabled={busy || p.signed || sending}
                                      />
                                    </label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                      <button
                                        type="button"
                                        className={`btn btn-primary${sending ? ' btn--busy' : ''}`}
                                        disabled={
                                          busy ||
                                          p.signed ||
                                          sending ||
                                          !token ||
                                          !emailVal.trim() ||
                                          !emailSendEnabled
                                        }
                                        title={
                                          !emailSendEnabled
                                            ? 'Invite email is off until Resend is enabled on the server'
                                            : undefined
                                        }
                                        onClick={() => {
                                          if (!token || !doc) return
                                          const to = emailVal.trim()
                                          if (!to) return
                                          setInviteSendBusyId(p.id)
                                          setInviteSendNote(prev => {
                                            const next = { ...prev }
                                            delete next[p.id]
                                            return next
                                          })
                                          setLocalError(null)
                                          void api
                                            .sendPartyInviteEmail(token, doc.id, {
                                              partyId: p.id,
                                              to,
                                            })
                                            .then(() => {
                                              setInviteSendNote(prev => ({
                                                ...prev,
                                                [p.id]: `Invite sent to ${to}`,
                                              }))
                                              showInviteSentToast(label)
                                            })
                                            .catch(err => {
                                              setLocalError(
                                                err instanceof Error
                                                  ? err.message
                                                  : 'Could not send invite email',
                                              )
                                            })
                                            .finally(() => setInviteSendBusyId(null))
                                        }}
                                      >
                                        {sending ? (
                                          <>
                                            <LoaderCircle
                                              className="btn-spinner"
                                              size={16}
                                              strokeWidth={2.5}
                                            />
                                            Sending…
                                          </>
                                        ) : (
                                          'Send invite email'
                                        )}
                                      </button>
                                      {/* Mobile: OS share sheet (iMessage, WhatsApp, …) + PDF when allowed */}
                                      {typeof navigator !== 'undefined' &&
                                        typeof navigator.share === 'function' && (
                                          <button
                                            type="button"
                                            className="btn btn-secondary"
                                            disabled={busy || p.signed}
                                            onClick={() =>
                                              void sharePersonInvite({
                                                partyId: p.id,
                                                personName: label,
                                                personLink,
                                              })
                                            }
                                          >
                                            <Share2 size={16} strokeWidth={2.25} aria-hidden />
                                            Share
                                          </button>
                                        )}
                                      <button
                                        type="button"
                                        className="btn btn-secondary"
                                        disabled={busy || p.signed}
                                        onClick={() => void copyText(personLink, p.id)}
                                      >
                                        Copy personal link
                                      </button>
                                    </div>
                                    {!emailSendEnabled && (
                                      <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
                                        Email send is disabled until Resend is configured (
                                        RESEND_ENABLED). You can still copy the personal link.
                                      </p>
                                    )}
                                    {note && (
                                      <p
                                        style={{
                                          margin: 0,
                                          fontSize: '0.8rem',
                                          color: '#0f766e',
                                          fontWeight: 500,
                                        }}
                                      >
                                        {note}
                                      </p>
                                    )}
                                    <code
                                      style={{
                                        fontSize: '0.7rem',
                                        wordBreak: 'break-all',
                                        display: 'block',
                                        color: '#475569',
                                      }}
                                    >
                                      {personLink}
                                    </code>
                                  </div>
                                )
                              })}
                          </div>
                        )}

                        {/* Pre-lock / legacy: optional co-signer names + emails */}
                        {inviteeSlotCount > 0 &&
                          !(
                            FEATURES.pdfAnnotationUi && constructionPlan?.status === 'locked'
                          ) && (
                          <div className="field-stack">
                            <span className="field-label">
                              Invite detail{inviteeSlotCount > 1 ? 's' : ''} (optional)
                            </span>
                            {Array.from({ length: inviteeSlotCount }, (_, index) => {
                              const partyLabel = `Invitee ${index + 1}`
                              return (
                                <div key={index} className="field-stack share-cosigner-fields">
                                  <label className="field">
                                    <span className="field-label">{partyLabel} name</span>
                                    <input
                                      value={coSignerNames[index] ?? ''}
                                      onChange={e => {
                                        const value = clampField(
                                          e.target.value,
                                          MAX_DISPLAY_NAME_LENGTH,
                                        )
                                        setCoSignerNames(prev => {
                                          const next = [...prev]
                                          while (next.length <= index) next.push('')
                                          next[index] = value
                                          return next
                                        })
                                      }}
                                      onBlur={() => void applyCosigners()}
                                      maxLength={MAX_DISPLAY_NAME_LENGTH}
                                      placeholder="Name (optional)"
                                      disabled={busy}
                                    />
                                  </label>
                                  <label className="field">
                                    <span className="field-label">
                                      {partyLabel} invite email (Mail app only)
                                    </span>
                                    <input
                                      type="email"
                                      inputMode="email"
                                      autoComplete="email"
                                      value={coSignerEmails[index] ?? ''}
                                      onChange={e => {
                                        const value = clampField(
                                          e.target.value,
                                          MAX_SUPPORT_EMAIL_LENGTH,
                                        )
                                        setCoSignerEmails(prev => {
                                          const next = [...prev]
                                          while (next.length <= index) next.push('')
                                          next[index] = value
                                          return next
                                        })
                                      }}
                                      maxLength={MAX_SUPPORT_EMAIL_LENGTH}
                                      placeholder="name@company.com"
                                      disabled={busy}
                                    />
                                  </label>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {FEATURES.emailNotifyUi && requiredSigners > 1 && (
                          <label className="field">
                            <span className="field-label">
                              Email when everyone has signed (optional)
                            </span>
                            <input
                              type="email"
                              value={creatorNotifyEmail}
                              onChange={e => setCreatorNotifyEmail(e.target.value)}
                              onBlur={() => {
                                if (requiredCount(doc) > 1) {
                                  void applyCosigners({ notifyEmail: creatorNotifyEmail })
                                }
                              }}
                              placeholder="you@example.com"
                              autoComplete="email"
                              disabled={busy}
                            />
                            <span className="muted" style={{ fontSize: '0.78rem' }}>
                              We only use this to tell you the agreement is ready to seal. Never
                              required.
                            </span>
                          </label>
                        )}

                        {busy && (
                          <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                            <LoaderCircle
                              className="btn-spinner"
                              size={14}
                              strokeWidth={2.5}
                              style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }}
                            />
                            Updating signatures…
                          </p>
                        )}
                      </div>
                    )}
                  </section>

                  {(requiredCount(doc) > 1 || inviteeSlotCount > 0) && (
                    <>
                      {sharedAck ? (
                        <div className="result-banner result-banner--ok">
                          <Check size={18} strokeWidth={2.5} />
                          Invite sent — waiting for co-signers. You can seal when everyone has
                          signed.
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-lg"
                          onClick={acknowledgeShare}
                        >
                          I&apos;ve shared the invite
                        </button>
                      )}
                      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                        Use each card above to email or share a personal link. Hand off the PDF
                        separately (or via mobile Share when the OS includes the file). This view
                        updates when they sign.
                      </p>
                    </>
                  )}

                  {requiredCount(doc) <= 1 && allSigned(doc) && (
                    <button
                      type="button"
                      className="btn btn-primary btn-lg"
                      disabled={busy || requiredSigners !== requiredCount(doc)}
                      title={
                        requiredSigners !== requiredCount(doc)
                          ? 'Wait for signature settings to update, or set parties back to 1'
                          : undefined
                      }
                      onClick={acknowledgeShare}
                    >
                      Continue to seal
                    </button>
                  )}
                  </>
                  )}

                  {canCancelCurrent && (
                    <button
                      type="button"
                      className={`btn btn-ghost${busy ? ' btn--busy' : ''}`}
                      disabled={busy}
                      onClick={() => void cancelCurrentAgreement()}
                    >
                      {busy ? (
                        <>
                          <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} />
                          Cancelling…
                        </>
                      ) : (
                        <>
                          <Trash2 size={16} strokeWidth={2.25} aria-hidden />
                          Cancel agreement
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {step === 'sign' && (
                <div className="action-stack">
                  {!doc && role === 'signer' && (
                    <>
                      <p className="muted" style={{ margin: 0 }}>
                        Drop the file the creator shared. We match its fingerprint to the
                        agreement (or open the invite link they sent you).
                      </p>
                      <DocumentStage
                        step={step}
                        doc={null}
                        file={signFile}
                        onFileChange={file => void lookupInviteByPdf(file)}
                        accepting
                        disabled={busy}
                      />
                      {busy && (
                        <div className="result-banner result-banner--ok">
                          <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                          Looking up agreement…
                        </div>
                      )}
                    </>
                  )}

                  {doc && (
                    <>
                      <div className="progress-bar-wrap">
                        <div className="progress-bar-meta">
                          <span>
                            Signatures {signedCount(doc)}/{requiredCount(doc)}
                          </span>
                          <span className="muted">{doc.title}</span>
                        </div>
                        <div className="progress-bar-track">
                          <div
                            className="progress-bar-fill"
                            style={{
                              width: `${requiredCount(doc) ? (signedCount(doc) / requiredCount(doc)) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>

                      <PartyList doc={doc} revealNames={revealParticipantPrivate} />

                      {/* Creator invites on the share step (after they sign). Never on invited path. */}
                      {canCancelCurrent && role === 'creator' && (
                        <button
                          type="button"
                          className={`btn btn-ghost${busy ? ' btn--busy' : ''}`}
                          disabled={busy}
                          onClick={() => void cancelCurrentAgreement()}
                        >
                          <Trash2 size={16} strokeWidth={2.25} aria-hidden />
                          Cancel agreement
                        </button>
                      )}

                      {allSigned(doc) ? (
                        <div className="result-banner result-banner--ok">
                          <Check size={18} strokeWidth={2.5} />
                          {role === 'creator'
                            ? requiredCount(doc) <= 1
                              ? 'Signature complete — continue to seal'
                              : 'All parties signed — continue to seal'
                            : requiredCount(doc) <= 1
                              ? 'Signature complete. The creator can seal this on Nimiq.'
                              : 'All parties have signed. The creator can seal this on Nimiq.'}
                        </div>
                      ) : (
                        <>
                          {!account && (
                            <>
                              <button
                                type="button"
                                className={`btn btn-primary${connecting ? ' btn--busy' : ''}`}
                                onClick={requestLogin}
                                disabled={connecting}
                              >
                                {connecting ? (
                                  <>
                                    <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} />
                                    {journeyLoginEntryLabels().busy}
                                  </>
                                ) : (
                                  <>
                                    <NimiqHexagonIcon size={16} />
                                    {journeyLoginEntryLabels().idle}
                                  </>
                                )}
                              </button>
                              {loginNeedsSheet && loginSheetOpen && (
                                <LoginSheet
                                  open
                                  connectMode={connectMode}
                                  connecting={connecting}
                                  walletStatus={walletStatus}
                                  onClose={() => setLoginSheetOpen(false)}
                                  onProceed={connectFromPath}
                                  placement="inline"
                                />
                              )}
                            </>
                          )}

                          {account &&
                            signingResolution &&
                            !signingResolution.ok &&
                            signingResolution.hint === 'pick_person' &&
                            signingResolution.openParties &&
                            signingResolution.openParties.length > 0 && (
                              <section
                                className="signatures-config"
                                aria-labelledby="pick-person-title"
                              >
                                <header className="signatures-config-head">
                                  <h3 id="pick-person-title">Who are you?</h3>
                                  <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                                    Select your name on this agreement. Your wallet will be bound
                                    to that person when you sign. (Or open a personal invite link
                                    that already names you.)
                                  </p>
                                </header>
                                <ul className="field-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                  {signingResolution.openParties.map(p => (
                                    <li key={p.id} style={{ marginBottom: '0.45rem' }}>
                                      <button
                                        type="button"
                                        className="btn btn-secondary"
                                        style={{ width: '100%', justifyContent: 'flex-start' }}
                                        onClick={() => {
                                          setPickedPartyId(p.id)
                                          setLocalError(null)
                                          try {
                                            const url = new URL(window.location.href)
                                            url.searchParams.set('party', p.id)
                                            window.history.replaceState({}, '', url.toString())
                                          } catch {
                                            /* ignore */
                                          }
                                        }}
                                      >
                                        {p.displayName || formatPartyRole(p.role)}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </section>
                            )}

                          {account &&
                            signingResolution &&
                            !signingResolution.ok &&
                            signingResolution.hint !== 'pick_person' && (
                            <div className="result-banner result-banner--ok">
                              {signingResolution.message}
                            </div>
                          )}

                          {account && signingResolution?.ok && pendingParty && (
                            <>
                              <div className="sign-as-banner">
                                Signing as{' '}
                                <strong>
                                  {pendingParty.roleLabel}
                                  {pendingParty.displayName
                                    ? ` · ${pendingParty.displayName}`
                                    : ''}
                                </strong>
                                <span className="muted">
                                  {' '}
                                  ({signedCount(doc) + 1} of {requiredCount(doc)}) with{' '}
                                  {account.shortAddress}
                                  {pendingParty.walletAddress
                                    ? ' · wallet required for this person'
                                    : ''}
                                </span>
                              </div>

                              {!hasVerifiedLocalPdf && (
                                <div className="sign-upload-callout" role="status">
                                  <Upload size={18} strokeWidth={2.25} aria-hidden />
                                  <div>
                                    <strong>Upload your copy of the file</strong>
                                    <p className="muted" style={{ margin: '0.2rem 0 0' }}>
                                      Drop the same file from your computer so we can verify the
                                      document is identical. Required after leaving and returning
                                      to this agreement.
                                    </p>
                                  </div>
                                </div>
                              )}

                              <DocumentStage
                                step={step}
                                doc={doc}
                                file={signFile ?? (hasVerifiedLocalPdf ? pdfFile : null)}
                                onFileChange={setSignFile}
                                accepting={!hasVerifiedLocalPdf}
                                localCopyRequired
                                localCopyMatches={
                                  hasVerifiedLocalPdf
                                    ? true
                                    : !signFile
                                      ? null
                                      : signFileMatches
                                }
                              />

                              {signFile && !signFileMatches && !hasVerifiedLocalPdf && (
                                <div className="result-banner result-banner--bad">
                                  File doesn&apos;t match the fingerprinted file (
                                  <strong>{doc.fileName}</strong>). Drop the same document.
                                </div>
                              )}

                              {hasVerifiedLocalPdf &&
                                FEATURES.pdfAnnotationUi &&
                                planLoadState === 'loading' && (
                                  <div className="result-banner result-banner--ok">
                                    <LoaderCircle
                                      className="btn-spinner"
                                      size={16}
                                      strokeWidth={2.5}
                                    />
                                    Loading placement layout for this document…
                                  </div>
                                )}

                              {(() => {
                                const personSlot = personSlotForParty(pendingParty.id)
                                const myFillableSlots =
                                  constructionPlan?.status === 'locked'
                                    ? constructionPlan.slots.filter(
                                        s =>
                                          s.personSlotIndex === personSlot &&
                                          (s.kind === 'signature' ||
                                            s.kind === 'initial' ||
                                            s.kind === 'name' ||
                                            s.kind === 'text'),
                                      )
                                    : []
                                const pageFieldsRequired =
                                  FEATURES.pdfAnnotationUi &&
                                  constructionPlan?.status === 'locked' &&
                                  myFillableSlots.length > 0
                                const pageFieldsDone =
                                  pageFieldsConfirmed ||
                                  (myFillableSlots.length > 0 &&
                                    myFillableSlots.every(s => filledSlotIds.has(s.id)))
                                const canWalletBind =
                                  hasVerifiedLocalPdf &&
                                  planLoadState !== 'loading' &&
                                  (!pageFieldsRequired || pageFieldsDone)

                                return (
                                  <>
                              {hasVerifiedLocalPdf &&
                                FEATURES.pdfAnnotationUi &&
                                constructionPlan?.status === 'locked' &&
                                (signFile || pdfFile) &&
                                pageFieldsRequired &&
                                !pageFieldsDone && (
                                  <SignerFillView
                                    file={(signFile ?? pdfFile)!}
                                    plan={constructionPlan}
                                    personSlotIndex={personSlot}
                                    disabled={busy}
                                    busy={fillBusy}
                                    filledSlotIds={filledSlotIds}
                                    onSubmit={submitPageFields}
                                  />
                                )}

                              {/* Wallet bind: only after plan load + required page fields */}
                              {canWalletBind && (
                                <>
                                  {pageFieldsDone && pageFieldsRequired && (
                                    <div className="result-banner result-banner--ok">
                                      <Check size={16} strokeWidth={2.5} />
                                      Page fields saved on the document. Bind with your Nimiq wallet
                                      to finish.
                                    </div>
                                  )}

                                  {partyNeedsSignerName(signingResolution.party) && (
                                    <label className="field">
                                      <span className="field-label">Your name</span>
                                      <input
                                        value={signerName}
                                        onChange={e => setSignerName(e.target.value)}
                                        placeholder={`Name for ${formatPartyRole(signingResolution.party.role)}`}
                                      />
                                    </label>
                                  )}

                                  {/* Only show free pad if we didn't already capture ink on the PDF */}
                                  {!sigBlob && (
                                    <>
                                      <SignaturePad
                                        key={sigPadKey}
                                        onChange={setSigBlob}
                                        disabled={busy}
                                      />
                                      {FEATURES.signOnMobile &&
                                        token &&
                                        !isLikelyMobileViewport() && (
                                          <button
                                            type="button"
                                            className="btn btn-secondary sig-on-mobile-btn"
                                            disabled={busy}
                                            onClick={() => setSignOnMobileOpen(true)}
                                          >
                                            Sign on mobile
                                          </button>
                                        )}
                                    </>
                                  )}
                                  {sigBlob && mobileSigPreview && (
                                    <div className="sig-mobile-applied">
                                      <img
                                        className="sig-mobile-applied-img"
                                        src={mobileSigPreview}
                                        alt="Signature from mobile"
                                      />
                                      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                                        Signature from your phone. Continue with wallet sign below.
                                      </p>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        disabled={busy}
                                        onClick={() => {
                                          setSigBlob(null)
                                          if (mobileSigPreview) URL.revokeObjectURL(mobileSigPreview)
                                          setMobileSigPreview(null)
                                          setSigPadKey(k => k + 1)
                                        }}
                                      >
                                        Clear &amp; redraw
                                      </button>
                                    </div>
                                  )}
                                  {sigBlob && pageFieldsDone && pageFieldsRequired && !mobileSigPreview && (
                                    <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                                      Using the signature you drew on the PDF for wallet bind.
                                    </p>
                                  )}

                                  {FEATURES.signOnMobile && token && (
                                    <SignOnMobileModal
                                      open={signOnMobileOpen}
                                      token={token}
                                      documentId={doc.id}
                                      onClose={() => setSignOnMobileOpen(false)}
                                      onSignature={blob => {
                                        setSigBlob(blob)
                                        if (mobileSigPreview) URL.revokeObjectURL(mobileSigPreview)
                                        setMobileSigPreview(URL.createObjectURL(blob))
                                        setSignOnMobileOpen(false)
                                      }}
                                    />
                                  )}

                                  <button
                                    type="button"
                                    className={`btn btn-primary btn-lg${busy ? ' btn--busy' : ''}`}
                                    disabled={
                                      !hasVerifiedLocalPdf ||
                                      !sigBlob ||
                                      (partyNeedsSignerName(signingResolution.party) &&
                                        !signerName.trim()) ||
                                      busy
                                    }
                                    onClick={() => void signAsCurrentUser()}
                                  >
                                    {busy ? (
                                      <>
                                        <LoaderCircle
                                          className="btn-spinner"
                                          size={18}
                                          strokeWidth={2.5}
                                        />
                                        Signing…
                                      </>
                                    ) : (
                                      'Sign with wallet'
                                    )}
                                  </button>
                                  <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                                    {role === 'creator'
                                      ? requiredCount(doc) <= 1
                                        ? 'Wallet sign anchors your identity, then you can seal on Nimiq.'
                                        : 'Wallet sign, then share the invite so co-signers can fill their fields on the same PDF.'
                                      : 'Wallet sign records you as this party on the agreement.'}
                                  </p>
                                </>
                              )}
                                  </>
                                )
                              })()}
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {step === 'seal' && doc && (
                <div className="action-stack">
                  {busy && creditBalance >= 1 ? (
                    <CreditSealProgress
                      message={lockMessage}
                      title={doc.title}
                      fingerprintPreview={doc.fingerprintPreview}
                    />
                  ) : (
                    <>
                      <DocumentStage
                        step={step}
                        doc={doc}
                        file={pdfFile}
                        accepting={false}
                        sealing={busy}
                      />
                      {!doc.directSeal && (
                        <PartyList doc={doc} revealNames={revealParticipantPrivate} />
                      )}
                      {doc.source.signatures.length > 0 && (
                        <SignaturesPanel
                          signatures={doc.source.signatures}
                          parties={doc.source.parties}
                          compact
                          revealPrivate={revealParticipantPrivate}
                          authToken={token}
                        />
                      )}
                      <div className="seal-summary">
                        <p>
                          <strong>{doc.title}</strong>
                        </p>
                        <p className="muted">
                          Fingerprint <code className="mono">{doc.fingerprintPreview}</code>
                        </p>
                        <p className="muted">
                          {doc.directSeal
                            ? 'Direct seal - no signatures required.'
                            : allSigned(doc)
                              ? requiredCount(doc) <= 1
                                ? 'Signature complete.'
                                : `All ${requiredCount(doc)} signatures collected.`
                              : `${signedCount(doc)} of ${requiredCount(doc)} signatures collected — waiting on remaining signers.`}
                        </p>
                      </div>
                      {creditBalance < 1 && (
                        <SealPricingDisplay className="journey-pricing journey-pricing--seal" />
                      )}
                      <CreditsPanel
                        token={token}
                        address={address}
                        nimiq={nimiq}
                        setNimiq={setNimiq}
                        refreshKey={creditsRefresh}
                        compact
                        preferCardPrice
                        balanceOnly={creditBalance >= 1}
                        onBalanceChange={setCreditBalance}
                      />
                      {creditBalance >= 1 ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-lg"
                          disabled={!account || !allSigned(doc)}
                          onClick={() => void sealWithCredit()}
                        >
                          <Lock size={18} strokeWidth={2.25} />
                          Seal on Chain - 1 credit
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`btn btn-primary btn-lg${busy ? ' btn--busy' : ''}`}
                            disabled={busy || !account || !allSigned(doc)}
                            onClick={() => void seal()}
                          >
                            {busy ? (
                              <>
                                <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                                Sealing on Nimiq…
                              </>
                            ) : (
                              <>
                                <Lock size={18} strokeWidth={2.25} />
                                {inNimiqPay || nimiq
                                  ? 'Pay NIM & seal on-chain'
                                  : 'Pay NIM via Hub'}
                              </>
                            )}
                          </button>
                          {!inNimiqPay && !nimiq && (
                            <p className="muted journey-seal-hint" style={{ margin: 0 }}>
                              {isMobileDevice()
                                ? 'Sealing works best inside Nimiq Pay. In the browser, this seal uses Nimiq Hub — keep VeriLock open until you return and the on-chain proof is confirmed.'
                                : 'Sealing redirects to Nimiq Hub in this tab. Keep VeriLock open until you return and the on-chain proof is confirmed. Or buy credits with card (or NIM at half the card rate) above to seal without another wallet payment.'}
                            </p>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {(step === 'verify' || step === 'done') && (
                <div className="action-stack">
                  {step === 'done' && doc && (
                    <div className="done-banner">
                      {doc.sealed ? (
                        <Lock size={18} strokeWidth={2.5} />
                      ) : (
                        <Check size={18} strokeWidth={2.5} />
                      )}
                      <div>
                        <strong>
                          {doc.sealed
                            ? 'Sealed.'
                            : role === 'signer'
                              ? 'Signature recorded.'
                              : 'Complete.'}
                        </strong>
                        <p className="muted">
                          {doc.sealed ? (
                            <>
                              {pdfFile || signFile ? (
                                <>Use <strong>Verify this file</strong> to open the verify path with your file already loaded.</>
                              ) : (
                                <>
                                  Drop any copy of <em>{doc.fileName}</em> to check integrity.
                                </>
                              )}
                              {doc.source.attestation?.explorerUrl ? (
                                <>
                                  {' '}
                                  ·{' '}
                                  <a
                                    className="inline-link"
                                    href={doc.source.attestation.explorerUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    View on explorer
                                  </a>
                                </>
                              ) : null}
                            </>
                          ) : role === 'signer' ? (
                            <>
                              {allSigned(doc) || doc.readyToLock
                                ? 'Your signature is recorded. The creator can seal the fingerprint on Nimiq when ready.'
                                : 'Waiting for remaining signers. Keep your PDF — you can verify anytime after sealing.'}{' '}
                              <em>{doc.fileName}</em>
                            </>
                          ) : (
                            <>
                              Drop any copy of <em>{doc.fileName}</em> to check integrity later.
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  )}

                  {step === 'done' && doc?.sealed && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={openVerifyWithLocalPdf}
                    >
                      <ShieldCheck size={15} strokeWidth={2.25} />
                      {pdfFile || signFile ? 'Verify this file' : 'Go to verify'}
                    </button>
                  )}

                  {doc && !doc.directSeal && (step === 'done' || (step === 'verify' && doc.sealed)) && (
                    <PartyList doc={doc} revealNames={revealParticipantPrivate} />
                  )}
                  {doc &&
                    doc.source.signatures.length > 0 &&
                    (step === 'done' || (step === 'verify' && doc.sealed)) && (
                      <SignaturesPanel
                        signatures={doc.source.signatures}
                        parties={doc.source.parties}
                        revealPrivate={revealParticipantPrivate}
                        authToken={token}
                      />
                    )}

                  <DocumentStage
                    step={step}
                    doc={doc}
                    file={verifyFile}
                    onFileChange={setVerifyFile}
                    accepting
                  />

                  <p className="muted" style={{ margin: 0 }}>
                    We hash the file locally, then look up sealed fingerprints on the server.
                  </p>

                  {verifyOutcome.kind === 'hashing' && (
                    <div className="result-banner result-banner--ok">
                      <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                      Computing fingerprint…
                    </div>
                  )}

                  {verifyOutcome.kind === 'local' && (
                    <div className="verify-result-card">
                      <div className="verify-result-head">
                        <Fingerprint size={18} strokeWidth={2.25} />
                        <strong>Local fingerprint ready</strong>
                      </div>
                      <p className="muted">
                        File: <strong>{verifyOutcome.fileName}</strong> (
                        {formatFileSize(verifyOutcome.fileSize)})
                      </p>
                      <p>
                        Hash preview: <code className="mono">{verifyOutcome.fingerprint}</code>
                      </p>
                      <p className="muted" style={{ marginBottom: 0, fontSize: '0.82rem' }}>
                        Could not reach the server to look up sealed agreements
                        {localError ? ` (${localError})` : ''}. Wait a moment and drop the file
                        again.
                      </p>
                    </div>
                  )}

                  {verifyOutcome.kind === 'lookup' && (
                    <div className="verify-result-card">
                      <div className="verify-result-head">
                        <Fingerprint size={18} strokeWidth={2.25} />
                        <strong>No match on this host</strong>
                      </div>
                      <p>
                        Hash: <code className="mono">{verifyOutcome.fingerprint}</code>
                      </p>
                      <p className="muted" style={{ marginBottom: 0 }}>
                        This fingerprint is not registered here yet (or the agreement was only
                        created on the other VeriLock service).
                      </p>
                    </div>
                  )}

                  {verifyOutcome.kind === 'match' && (
                    <>
                      <div className="result-banner result-banner--ok">
                        <ShieldCheck size={18} strokeWidth={2.5} />
                        <div>
                          <strong>
                            {verifyOutcome.matches.length === 1
                              ? 'Fingerprint matches this agreement'
                              : `Fingerprint matches ${verifyOutcome.matches.length} agreements`}
                          </strong>
                          {verifyOutcome.title ? ` - ${verifyOutcome.title}` : ''}
                          <br />
                          {verifyOutcome.fileName} ·{' '}
                          <code className="mono">{verifyOutcome.fingerprint}</code>
                          {verifyOutcome.explorerUrl ? (
                            <>
                              <br />
                              <a
                                className="inline-link"
                                href={verifyOutcome.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View on-chain attestation
                              </a>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {verifyOutcome.matches.length > 0 ? (
                        <div className="journey-verify-details">
                          <VerifyMatchesPanel
                            matches={verifyOutcome.matches}
                            appUrl={
                              typeof window !== 'undefined' ? window.location.origin : ''
                            }
                            highlightSlug={verifyOutcome.matches[0]?.slug}
                            walletAddress={address}
                            authToken={token}
                          />
                          <div className="journey-verify-actions">
                            {verifyOutcome.matches.map(m => (
                              <button
                                key={m.id}
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => {
                                  window.history.pushState({}, '', `/d/${m.slug}`)
                                  void (async () => {
                                    try {
                                      const { document } = await api.getDocument(m.slug, token)
                                      setActiveFromSeal(document)
                                      setSharedAck(true)
                                      setRole(
                                        document.status === 'locked' ? 'verifier' : 'signer',
                                      )
                                      if (document.status === 'locked') {
                                        setVerifyOutcome(prev =>
                                          prev.kind === 'match'
                                            ? prev
                                            : {
                                                kind: 'match',
                                                fingerprint: shortHash(
                                                  document.finalSha256 ??
                                                    document.originalSha256,
                                                ),
                                                fileName:
                                                  document.originalFilename ?? document.title,
                                                title: document.title,
                                                explorerUrl:
                                                  document.attestation?.explorerUrl,
                                                matches: verifyOutcome.matches,
                                              },
                                        )
                                      }
                                      window.scrollTo({ top: 0, behavior: 'smooth' })
                                    } catch (err) {
                                      setLocalError(
                                        err instanceof Error
                                          ? err.message
                                          : 'Could not open agreement',
                                      )
                                    }
                                  })()
                                }}
                              >
                                Open {m.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="muted" style={{ margin: 0 }}>
                          Match found - loading agreement details failed. Try the document link
                          from the creator, or refresh.
                        </p>
                      )}
                    </>
                  )}

                  {verifyOutcome.kind === 'mismatch' && (
                    <div className="result-banner result-banner--bad">
                      <div>
                        <strong>Mismatch</strong> - {verifyOutcome.fileName} does not match
                        <br />
                        Expected <code className="mono">{verifyOutcome.expected}</code>
                        <br />
                        Got <code className="mono">{verifyOutcome.got}</code>
                      </div>
                    </div>
                  )}

                  {step === 'done' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={startAnotherAgreement}
                    >
                      <RotateCcw size={15} strokeWidth={2.25} />
                      Start another agreement
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      <HowVeriLockWorks
        role={role}
        open={howOpen}
        onToggle={() => setHowOpen(v => !v)}
      />

      {/*
        Portal to body: .lr-view-blend uses transform, which traps position:fixed
        and hid this toast under the scroll container.
      */}
      {inviteToast &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            key={inviteToast.key}
            className="invite-sent-toast"
            role="status"
            aria-live="polite"
          >
            <span className="invite-sent-toast-icon" aria-hidden>
              <MailCheck size={22} strokeWidth={2.25} />
            </span>
            <div className="invite-sent-toast-body">
              <strong>Email sent — PDF not attached</strong>
              <p>
                Send the agreement PDF to{' '}
                <span className="invite-sent-toast-contact">{inviteToast.contactLabel}</span>{' '}
                yourself (email, Messages, Drive…). VeriLock only sends the signing link.
              </p>
            </div>
            <button
              type="button"
              className="invite-sent-toast-dismiss"
              aria-label="Dismiss"
              onClick={() => {
                if (inviteToastTimerRef.current) {
                  clearTimeout(inviteToastTimerRef.current)
                  inviteToastTimerRef.current = null
                }
                setInviteToast(null)
              }}
            >
              <X size={16} strokeWidth={2.25} aria-hidden />
            </button>
          </div>,
          document.body,
        )}

    </div>
  )
}

function PartyList({
  doc,
  revealNames = true,
}: {
  doc: JourneyDoc
  /** When false, hide display names (public share viewers). */
  revealNames?: boolean
}) {
  if (doc.directSeal || doc.parties.length === 0) return null
  return (
    <ul className="party-list">
      {doc.parties.map(p => {
        // Avoid "Creator · NQ… · NQ…" when display name is just the short address.
        const showName =
          revealNames &&
          Boolean(p.displayName) &&
          p.displayName !== p.walletShort &&
          !/^NQ[1-9A-HJ-NP-Z]{2,}…[1-9A-HJ-NP-Z]{4}$/i.test(p.displayName ?? '')
        let statusNote: string | null = null
        if (p.signed) {
          statusNote = p.walletShort
        } else if (p.walletShort) {
          statusNote = `${p.walletShort} · awaiting signature`
        } else {
          statusNote = 'awaiting signature'
        }
        return (
          <li
            key={p.id}
            className={p.signed ? 'party-list-item party-list-item--done' : 'party-list-item'}
          >
            <span className="party-list-check" aria-hidden>
              {p.signed ? <Check size={14} strokeWidth={2.5} /> : null}
            </span>
            <div>
              <strong>{p.roleLabel}</strong>
              {showName ? <span className="muted"> · {p.displayName}</span> : null}
              {statusNote ? <span className="muted"> · {statusNote}</span> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
