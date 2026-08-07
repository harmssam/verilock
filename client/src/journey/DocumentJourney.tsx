import {
  ArrowLeft,
  Check,
  Copy,
  Fingerprint,
  LoaderCircle,
  Lock,
  MailCheck,
  RotateCcw,
  Share2,
  Shield,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { DOCUMENT_FORMATS_LABEL, stripDocumentExtension } from '../pdf/documentKinds'
import {
  documentReadErrorMessage,
  isUnreadableDocumentError,
  readFileBytes,
  STALE_LOCAL_DOCUMENT_MESSAGE,
} from '../pdf/documentRead'
import { getDocumentPageCount } from '../pdf/documentSurface'
import { sha256Hex, shortHash } from '../pdf/hashPdf'
import { prepareSignatureImageUpload } from '../signatureImage'
import { isMobileDevice } from '../nimiq'
import { SealPricingDisplay } from '../SealPricingDisplay'
import { canShareFiles, isValidEmailAddress, shareInviteWithPdf } from '../shareInvite'
import {
  formatPartyRole,
  isPlaceholderPartyName,
  looksLikeAddressLabel,
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
import {
  fileFromCreatePdfDraft,
  loadCreateFormCache,
  loadCreatePdfDraft,
} from './journeyPdfDraft'
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
import { sealJourneyDocumentWithCredit } from './journeySeal'
import { formatFileSize } from './formatFileSize'
import { SignaturePad } from './SignaturePad'
import { SignOnMobileModal } from './SignOnMobileModal'
import { isLikelyMobileViewport } from '../useViewport'
import { StageRail } from './StageRail'
import { CancelAgreementModal } from './CancelAgreementModal'
import { ClaimAgreementModal } from './ClaimAgreementModal'
import { GuestDocumentKeyModal } from './GuestDocumentKeyModal'
import { PlacementEditor } from '../pdf/PlacementEditor'
import { SignedDocumentView } from '../pdf/SignedDocumentView'
import { SignerFillView, type SignerFillResult } from '../pdf/SignerFillView'
import {
  buildFillBatch,
  computePlanRoot,
  emptyPlan,
  lockPlan as lockConstructionPlanLocal,
  peopleNeedingRealNameMessage,
  peopleWithoutSlotsMessage,
  placementContinueBlockedReason,
  unlockPlanLocal,
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
import { clearGuestSession, loadGuestSession, saveGuestSession, type StoredGuestSession } from '../session'
import { journeyPathMeta, type PageMeta } from '../seo'
import {
  allSigned,
  requiredCount,
  signedCount,
  stagesForRole,
  toJourneyDoc,
  walletHasSignedJourneyDoc,
  type JourneyDoc,
  type JourneyStepId,
  type PathRole,
} from './types'
import type { UseJourneyWalletResult } from './useJourneyWallet'

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string
          callback?: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
          size?: 'normal' | 'compact' | 'flexible'
        },
      ) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
  }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let turnstileScriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-verilock-turnstile]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile script failed')), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.defer = true
    script.dataset.verilockTurnstile = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile script failed to load'))
    document.head.appendChild(script)
  })

  return turnstileScriptPromise
}

interface DocumentJourneyProps {
  wallet: UseJourneyWalletResult
  /** Shell pushState navigation epoch - re-read /d/:slug deep links. */
  navEpoch?: number
  /** Per-route document meta for SEO (title, canonical, noindex). */
  onPageMeta?: (meta: PageMeta) => void
  /** Return to home (invalid deep link). */
  onHome?: () => void
  /** Fresh create path after “Start another agreement” (shell remounts journey). */
  onStartCreate?: () => void
  /** Open My agreements (e.g. after free complete). */
  onAgreements?: () => void
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

/**
 * Client-side mirror of `guestPartySubject` (`server/src/guestIdentity.ts`) - the sentinel
 * `signer_address` / viewer subject for a guest co-signer party (`docs/guest-signing-plan.md`
 * Task 5). Kept byte-identical to the server's raw (non-uppercased) form deliberately: every
 * comparison site that matters (`resolveSigningParty`, `isDocumentCreator`, `canDeleteDocument`)
 * already runs both sides through `normalizeAddress()` (a pure `toUpperCase()` transform)
 * before comparing, so the exact casing produced here never actually affects a match - this
 * form is chosen purely so it reads identically to the server helper it mirrors.
 */
function guestPartySubject(partyId: string): string {
  return `guest:party:${partyId}`
}

async function loadVerifyDetails(
  slugs: string[],
  token?: string | null,
): Promise<VerifyResult[]> {
  const unique = [...new Set(slugs)]
  const details = await Promise.all(unique.map(slug => api.verifyDocument(slug, token)))
  return details.sort((a, b) => (b.lockedAt ?? b.createdAt) - (a.lockedAt ?? a.createdAt))
}

/** True when this wallet is creator/party/signer on a verify match (or server revealed details). */
function isPartyToVerifyMatch(
  match: VerifyResult,
  walletAddress: string | null,
): boolean {
  if (match.participantDetailsRevealed === true) return true
  if (!walletAddress) return false
  const me = normalizeAddress(walletAddress)
  if (normalizeAddress(match.creatorAddress) === me) return true
  if (match.signatures.some(s => normalizeAddress(s.signerAddress) === me)) return true
  return match.parties.some(
    p => p.walletAddress && normalizeAddress(p.walletAddress) === me,
  )
}

export function DocumentJourney({
  wallet,
  navEpoch = 0,
  onPageMeta,
  onHome,
  onStartCreate,
  onAgreements,
}: DocumentJourneyProps) {
  const {
    account,
    token,
    address,
    connecting,
    walletStatus,
    error: walletError,
    connect,
    setError,
    nimiq,
    setNimiq,
    applySession,
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
  // Form fields rehydrate from sessionStorage so Hub login remount keeps type/title/etc.
  const [title, setTitle] = useState(() => loadCreateFormCache()?.title ?? '')
  /** Last title we auto-filled from a file name - used so a new file replaces it. */
  const autoTitleFromFileRef = useRef<string | null>(null)
  /** One IDB recovery attempt per dead create-path File (avoids recover loops). */
  const createFileIdbRecoveryAttemptedRef = useRef(false)
  const [creatorName, setCreatorName] = useState(
    () => loadCreateFormCache()?.creatorName ?? '',
  )
  /** Optional ready-to-seal email - collected only when FEATURES.emailNotifyUi is on. */
  const [creatorNotifyEmail, setCreatorNotifyEmail] = useState(
    () => loadCreateFormCache()?.creatorNotifyEmail ?? '',
  )
  /** Last successfully saved ready-to-lock notify address ('' = cleared/none). */
  const [notifyEmailSavedValue, setNotifyEmailSavedValue] = useState<string | null>(null)
  const [notifyEmailBusy, setNotifyEmailBusy] = useState(false)
  const [notifyEmailError, setNotifyEmailError] = useState<string | null>(null)
  const [notifyEmailFlashSaved, setNotifyEmailFlashSaved] = useState(false)
  const notifyEmailFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [docType, setDocType] = useState<DocumentType>(
    () => loadCreateFormCache()?.docType ?? 'contract',
  )
  /** Optional display names for other parties (index 0 = first co-signer). */
  const [coSignerNames, setCoSignerNames] = useState<string[]>([''])
  /** Client-only invite emails for co-signers - prefill Share .eml To; never uploaded with the PDF. */
  const [coSignerEmails, setCoSignerEmails] = useState<string[]>([''])
  /** partyId → draft invite email (stable across reordering / signed filter). */
  const [partyInviteEmails, setPartyInviteEmails] = useState<Record<string, string>>({})
  const [docNotes, setDocNotes] = useState(() => loadCreateFormCache()?.docNotes ?? '')
  /** Draft total parties for share-step Signatures UI (applied via API). */
  const [requiredSigners, setRequiredSigners] = useState(1)
  const [busy, setBusy] = useState(false)
  const [doc, setDoc] = useState<JourneyDoc | null>(null)
  const [sharedAck, setSharedAck] = useState(false)
  /**
   * Guest create success (`docs/guest-signing-plan.md` Task 3) - a non-null value IS
   * the "modal open" state (same nullable-object idiom as `inviteHandoff` below). The
   * raw key only ever lives here, in memory, for this one screen.
   */
  const [guestDocumentKeyModal, setGuestDocumentKeyModal] = useState<{
    documentKey: string
    savedAck: boolean
  } | null>(null)
  /** Turnstile widget for guest document create (same pattern as SupportPage.tsx). */
  const turnstileHostRef = useRef<HTMLDivElement | null>(null)
  const turnstileWidgetIdRef = useRef<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null)
  const [turnstileRequired, setTurnstileRequired] = useState(false)
  const [turnstileReady, setTurnstileReady] = useState(false)
  /**
   * Guest creator session, hydrated from `localStorage` (`docs/guest-signing-plan.md`
   * Task 4). `createGuestDoc` keeps this in sync at create time; the effect below
   * re-reads `localStorage` whenever the loaded document changes so navigating between
   * documents (or a hard refresh landing on a `/d/:slug` deep link) picks up whatever
   * guest session is actually stored for that document - mirrors the wallet session
   * hydration idea in `useJourneyWallet.ts` (`loadSession()` checks), kept intentionally
   * simple here (no boot-gating needed - a stale/missing guest session just means the
   * derived values below fall back to wallet-only behavior).
   */
  const [guestSession, setGuestSession] = useState<StoredGuestSession | null>(() =>
    loadGuestSession(),
  )
  useEffect(() => {
    setGuestSession(loadGuestSession())
  }, [doc?.id])

  // Turnstile: fetch site key + required flag from /api/features
  useEffect(() => {
    let cancelled = false
    void api
      .features()
      .then(f => {
        if (cancelled) return
        const key = f.turnstileSiteKey?.trim() || null
        setTurnstileSiteKey(key)
        setTurnstileRequired(Boolean(f.turnstileRequired && key))
      })
      .catch(() => {
        // Features optional; server still enforces Turnstile when required.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const resetTurnstile = useCallback(() => {
    setTurnstileToken(null)
    const id = turnstileWidgetIdRef.current
    if (id && window.turnstile) {
      try {
        window.turnstile.reset(id)
      } catch {
        // ignore
      }
    }
  }, [])

  // Turnstile: render widget when site key is available
  useEffect(() => {
    if (!turnstileSiteKey || !turnstileHostRef.current) return
    let cancelled = false

    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !turnstileHostRef.current || !window.turnstile) return
        if (turnstileWidgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(turnstileWidgetIdRef.current)
          } catch {
            // ignore
          }
          turnstileWidgetIdRef.current = null
        }
        turnstileHostRef.current.innerHTML = ''
        const widgetId = window.turnstile.render(turnstileHostRef.current, {
          sitekey: turnstileSiteKey,
          theme: 'light',
          size: 'flexible',
          callback: token => {
            if (!cancelled) setTurnstileToken(token)
          },
          'expired-callback': () => {
            if (!cancelled) setTurnstileToken(null)
          },
          'error-callback': () => {
            if (!cancelled) setTurnstileToken(null)
          },
        })
        turnstileWidgetIdRef.current = widgetId
        setTurnstileReady(true)
      })
      .catch(err => {
        console.error('[journey] turnstile load', err)
        if (!cancelled) setTurnstileReady(false)
      })

    return () => {
      cancelled = true
      const id = turnstileWidgetIdRef.current
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id)
        } catch {
          // ignore
        }
      }
      turnstileWidgetIdRef.current = null
    }
  }, [turnstileSiteKey])
  /**
   * Guest session that actually matches the currently-loaded document, ANY role
   * (`docs/guest-signing-plan.md` Task 5 - generalized from the Task 4 creator-only
   * version). A co-signer's redeemed invite session (role `'signer'`) now resolves here
   * too, not just the document's own creator.
   */
  const activeGuestSession = useMemo(
    () => (guestSession && doc && guestSession.documentId === doc.id ? guestSession : null),
    [guestSession, doc],
  )
  /** Non-null only for a matching guest CREATOR session - creator-only actions key off this. */
  const activeGuestCreatorSession = useMemo(
    () => (activeGuestSession?.role === 'creator' ? activeGuestSession : null),
    [activeGuestSession],
  )
  /** Non-null only for a matching guest CO-SIGNER (non-creator, invite-redeemed) session. */
  const activeGuestSignerSession = useMemo(
    () => (activeGuestSession?.role === 'signer' ? activeGuestSession : null),
    [activeGuestSession],
  )
  /**
   * Effective identity for actions genuinely shared between a guest creator and a guest
   * co-signer (sign, submit page fields, load the placement plan, resolve the signing
   * party): a real wallet always takes priority; otherwise fall back to ANY matching
   * guest session, either role. The derived ADDRESS is role-aware: a creator session
   * resolves to `doc.source.creatorAddress` (the `guest:doc:{id}` sentinel, already
   * normalized by the server - see `guestCreatorSubject`), a signer session resolves to
   * `guestPartySubject(partyId)` (the `guest:party:{id}` sentinel). Both sentinels are
   * safe to feed into `isDocumentCreator` / `canDeleteDocument` (`../agreements`) and
   * `resolveSigningParty` (`../signing`), which already compare via `normalizeAddress`
   * - a pure string transform. When there is no matching guest session, both reduce to
   * exactly `token`/`address` (byte-for-byte unchanged wallet behavior).
   */
  const effectiveToken = token || activeGuestSession?.token || null
  const effectiveAddress =
    address ||
    (activeGuestSession
      ? activeGuestSession.role === 'creator'
        ? doc?.source.creatorAddress ?? null
        : guestPartySubject(activeGuestSession.partyId!)
      : null)
  /**
   * Effective identity for CREATOR-ONLY mutations: roster / cosigners / notify-email /
   * cancel-delete / placement lock-unlock. These must NEVER resolve for a co-signer's
   * guest session - a co-signer legitimately holding `effectiveToken` above must not be
   * able to cancel the agreement or rewrite the roster. This is exactly the Task 4
   * `effectiveToken`/`effectiveAddress` pair, renamed (not otherwise changed): it still
   * keys off `activeGuestCreatorSession` only, never the widened `activeGuestSession`.
   */
  const creatorOnlyEffectiveToken = token || activeGuestCreatorSession?.token || null
  const creatorOnlyEffectiveAddress =
    address || (activeGuestCreatorSession ? doc?.source.creatorAddress ?? null : null)
  /**
   * Creator free-complete (all signed): print/done is primary until they choose lock.
   * preferSeal / lock CTAs (“Lock now”, “Retry lock”) set this so seal payment stays front-and-center.
   */
  const [creatorChoseLock, setCreatorChoseLock] = useState(false)
  /** True after the creator has opened the waiting view at least once this session. */
  const [inviteWaitingVisited, setInviteWaitingVisited] = useState(false)
  const [signFile, setSignFile] = useState<File | null>(null)
  const [signHash, setSignHash] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const [sigBlob, setSigBlob] = useState<Blob | null>(null)
  const [sigPadKey, setSigPadKey] = useState(0)
  const [signOnMobileOpen, setSignOnMobileOpen] = useState(false)
  const [mobileSigPreview, setMobileSigPreview] = useState<string | null>(null)
  /** Construction placements (Setup step) - empty slots until lock; then immutable. */
  const [constructionPlan, setConstructionPlan] = useState<ConstructionPlan | null>(null)
  /** idle → loading → ready (has plan) | none (404 / no plan). Avoids draft-seed race. */
  const [planLoadState, setPlanLoadState] = useState<'idle' | 'loading' | 'ready' | 'none'>('idle')
  const [placementLockBusy, setPlacementLockBusy] = useState(false)
  /** Bumps to re-trigger the Setup Continue blocked warning flash animation. */
  const [setupContinueFlashToken, setSetupContinueFlashToken] = useState(0)
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
  /** Transient notes (link copied, share sheet, …) - not the durable email-sent badge. */
  const [inviteSendNote, setInviteSendNote] = useState<Record<string, string>>({})
  /**
   * partyId → last successful invite email (session-persisted so the signers
   * list keeps showing “Invite emailed” after the handoff modal closes).
   */
  const [inviteEmailSent, setInviteEmailSent] = useState<
    Record<string, { email: string; sentAt: number }>
  >({})
  /**
   * partyId → minted personal invite LINK (`docs/guest-signing-plan.md` Task 5 -
   * "Create invite link"). In-memory only for this session - the raw token only ever
   * lives inside `url` itself, same "shown once" spirit as the document key but lower
   * stakes (revocable/rotatable), so no dedicated modal is needed here.
   */
  const [partyLinkInvites, setPartyLinkInvites] = useState<
    Record<string, { url: string; expiresAt: number }>
  >({})
  /** partyId → link-invite mint in flight (separate from `inviteSendBusyId`, the email one). */
  const [linkInviteBusyId, setLinkInviteBusyId] = useState<string | null>(null)
  /**
   * Post-invite handoff help: email or copy-link.
   * Stays open until the user dismisses (no auto-timeout - easy to miss).
   */
  const [inviteHandoff, setInviteHandoff] = useState<{
    key: number
    /** Who / which person this is for (display name). */
    contactLabel: string
    /** Email path vs personal-link copy. */
    mode: 'email' | 'link'
  } | null>(null)
  const inviteHandoffPrimaryRef = useRef<HTMLButtonElement>(null)
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
  /** Creator cancel confirmation (in-progress, no signatures yet). */
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  /**
   * Wallet claim of a guest-owned agreement (`docs/guest-signing-plan.md` Task 6) -
   * "Save to wallet" from either the dock header pill or the free-complete CTA opens
   * this same modal/state, regardless of which one was clicked.
   */
  const [claimModalOpen, setClaimModalOpen] = useState(false)
  const [claimDocumentKeyInput, setClaimDocumentKeyInput] = useState('')
  const [claimBusy, setClaimBusy] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
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
  // Never rewrite the URL here - sticky session + syncIntentToUrl caused ?intent=signer loops.
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
          const { required } = document.signingProgress
          // Solo agreements re-open on share so co-signers can still be added.
          // Do NOT auto-ack multi-party mid-invite - that hides the invite form
          // behind the waiting view before any invites were sent. Waiting view
          // only after explicit “Done inviting”.
          // preferSeal / agreements “seal now” skips share intentionally.
          setSharedAck(preferSeal || required === 0)
          // Lock-now from My agreements opens the paid seal panel; free complete otherwise.
          setCreatorChoseLock(preferSeal || required === 0)
        } else {
          // /d/:slug is the invite path - land on signer flow (connect → sign), not verify.
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

  /** Derived step from agreement progress (source of truth for “how far” we are). */
  const naturalStep = useMemo<JourneyStepId>(() => {
    if (!role) return 'welcome'
    // Verifier: stay on fingerprint until a hash lookup matches a record.
    if (role === 'verifier') {
      return verifyOutcome.kind === 'match' ? 'done' : 'verify'
    }
    // Wallet login is a gate on actions - not a numbered rail step.
    if (role === 'signer') {
      if (!doc) return 'sign'
      // After this wallet has signed, or everyone has finished, show Done.
      // Never route invitees to seal - only the document creator locks.
      if (doc.sealed) return 'done'
      if (walletHasSignedJourneyDoc(doc, address)) return 'done'
      // All slots filled even if this session has no wallet bound yet (reopen / refresh).
      if (allSigned(doc)) return 'done'
      return 'sign'
    }
    // Creator path: add PDF → setup → sign (if organizer is a party) → invite co-signers → seal
    if (!doc) return 'fingerprint'
    if (doc.sealed) return 'done'
    // Only the creator may enter the seal step (never co-signers / invitees).
    if (doc.directSeal) {
      return address && isDocumentCreator(doc.source, address) ? 'seal' : 'done'
    }
    // Construction first (when UI on): freeze placements when continuing past setup.
    // Wait for plan GET before treating as unlocked draft (avoids flash / wrong step).
    if (FEATURES.pdfAnnotationUi && planLoadState === 'loading' && signedCount(doc) === 0) {
      return 'share'
    }
    const needsSetup =
      FEATURES.pdfAnnotationUi &&
      planLoadState !== 'loading' &&
      constructionPlan?.status !== 'locked' &&
      signedCount(doc) === 0
    if (needsSetup) return 'share'

    // Only the *document creator* who chose “not signing” is blocked from open-slot claim.
    // Invitees must still claim open parties.
    const creatorBlocksOpenClaim =
      FEATURES.pdfAnnotationUi &&
      constructionPlan?.status === 'locked' &&
      (constructionPlan.creatorSigningAs == null ||
        constructionPlan.creatorSigningAs === 0) &&
      Boolean(address && isDocumentCreator(doc.source, address))

    // Creator still needs to sign their own party.
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

    // All signatures collected → seal immediately (no bounce back to Setup/invite).
    if (allSigned(doc)) {
      if (address && isDocumentCreator(doc.source, address)) return 'seal'
      return 'done'
    }

    // Waiting on co-signers.
    // Creator who already signed: stay on Sign (invite UI there) so the rail does not jump back to Setup.
    // Organizer-only: invite from the Setup/share step.
    if (
      address &&
      isDocumentCreator(doc.source, address) &&
      walletHasSignedJourneyDoc(doc, address)
    ) {
      return 'sign'
    }
    return 'share'
  }, [
    role,
    doc,
    address,
    constructionPlan?.status,
    constructionPlan?.creatorSigningAs,
    planLoadState,
    verifyOutcome.kind,
  ])

  const pathStages = useMemo(() => stagesForRole(role), [role])

  /**
   * Optional hold on an earlier stage so creators can move backwards to fix mistakes.
   * Cleared when natural progress no longer allows it (e.g. someone signed).
   */
  const [stepHold, setStepHold] = useState<JourneyStepId | null>(null)

  const canHoldStep = useCallback(
    (hold: JourneyStepId, natural: JourneyStepId): boolean => {
      if (role !== 'creator' || !doc || doc.sealed) return false
      const order = pathStages.map(s => s.id)
      const hi = order.indexOf(hold)
      const ni = order.indexOf(natural)
      if (hi < 0 || ni < 0 || hi > ni) return false
      // Fingerprint is finished once the agreement exists - use cancel to start over.
      if (hold === 'fingerprint') return false
      // After the first signature, earlier steps are view-only via natural flow only.
      if (signedCount(doc) > 0 && hold !== natural) return false
      return true
    },
    [role, doc, pathStages],
  )

  const step = useMemo<JourneyStepId>(() => {
    if (stepHold && canHoldStep(stepHold, naturalStep)) return stepHold
    return naturalStep
  }, [stepHold, naturalStep, canHoldStep])

  /**
   * Anchor for “where do I act next?” - stage rail + action dock.
   * Sticky shell header uses scroll-margin-top so the title isn’t hidden under the nav.
   */
  const stepFocusRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number | null>(null)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Scroll the current stage chrome into view (window + sticky-header offset via CSS). */
  const scrollToJourneyAction = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (typeof window === 'undefined') return

    const run = () => {
      const focus = stepFocusRef.current
      if (focus) {
        focus.scrollIntoView({ block: 'start', inline: 'nearest', behavior })
        return
      }
      window.scrollTo({ top: 0, left: 0, behavior })
      window.document.documentElement.scrollTop = 0
      window.document.body.scrollTop = 0
    }

    // Cancel any in-flight scroll scheduling (rapid step changes / double calls).
    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = null
    }
    if (scrollTimerRef.current != null) {
      clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = null
    }

    // Double rAF: wait until React has committed the new step’s DOM.
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null
        run()
        // Late layout (PDF stage / placement editor unmount) - nudge once more.
        scrollTimerRef.current = setTimeout(() => {
          scrollTimerRef.current = null
          run()
        }, 80)
      })
    })
  }, [])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current)
      if (scrollTimerRef.current != null) clearTimeout(scrollTimerRef.current)
    }
  }, [])

  // Keep the viewport on the active stage when advancing or stepping back.
  const prevStepRef = useRef<JourneyStepId | null>(null)
  useLayoutEffect(() => {
    const prev = prevStepRef.current
    prevStepRef.current = step
    // First paint after mount still jumps so deep links / remounts aren’t mid-page.
    if (prev === step) return
    scrollToJourneyAction('auto')
  }, [step, scrollToJourneyAction])

  useEffect(() => {
    if (stepHold && !canHoldStep(stepHold, naturalStep)) {
      setStepHold(null)
    }
  }, [stepHold, naturalStep, canHoldStep])

  const selectJourneyStep = useCallback(
    (id: JourneyStepId) => {
      if (id === naturalStep) {
        setStepHold(null)
      } else if (canHoldStep(id, naturalStep)) {
        setStepHold(id)
      }
      // Rail click: step may already match hold/natural - force scroll anyway.
      scrollToJourneyAction('smooth')
    },
    [naturalStep, canHoldStep, scrollToJourneyAction],
  )

  // Quiet refresh while creator waits for co-signers (invite on Setup or Sign).
  useEffect(() => {
    if (role !== 'creator' || !doc || doc.sealed) return
    if (step !== 'share' && step !== 'sign') return
    if (allSigned(doc)) return
    if (signedCount(doc) === 0 && step === 'sign') return
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

  /**
   * Hydrate “invite emailed” from server party fields (durable), then session cache.
   * Server is source of truth across devices; session helps before next reload.
   */
  useEffect(() => {
    if (!doc?.id) {
      setInviteEmailSent({})
      return
    }
    const next: Record<string, { email: string; sentAt: number }> = {}
    for (const party of doc.parties) {
      const email = party.inviteEmail?.trim()
      if (email) {
        next[party.id] = {
          email,
          sentAt: party.inviteSentAt ?? Date.now(),
        }
      }
    }
    if (Object.keys(next).length === 0 && typeof sessionStorage !== 'undefined') {
      try {
        const raw = sessionStorage.getItem(`verilock-invite-sent:${doc.id}`)
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, { email?: string; sentAt?: number }>
          for (const [partyId, row] of Object.entries(parsed)) {
            if (row?.email && typeof row.email === 'string') {
              next[partyId] = {
                email: row.email,
                sentAt: typeof row.sentAt === 'number' ? row.sentAt : Date.now(),
              }
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    setInviteEmailSent(next)
    if (Object.keys(next).length > 0) {
      const unsigned = doc.parties.filter(x => x.required && !x.signed)
      setPartyInviteEmails(prev => {
        const merged = { ...prev }
        let changed = false
        for (const party of unsigned) {
          const sent = next[party.id]
          if (!sent || merged[party.id]?.trim()) continue
          merged[party.id] = sent.email
          changed = true
        }
        return changed ? merged : prev
      })
      setCoSignerEmails(prev => {
        const emails = [...prev]
        let changed = false
        unsigned.forEach((party, i) => {
          const sent = next[party.id]
          if (!sent) return
          while (emails.length <= i) emails.push('')
          if (!emails[i]?.trim()) {
            emails[i] = sent.email
            changed = true
          }
        })
        return changed ? emails : prev
      })
    }
  }, [
    doc?.id,
    // Stable fingerprint of server invite fields (avoid re-running on new party array refs).
    doc?.parties.map(p => `${p.id}:${p.inviteEmail ?? ''}:${p.inviteSentAt ?? ''}`).join('|'),
  ])

  /** Record a successful invite email and persist for this agreement’s session. */
  const markInviteEmailSent = useCallback(
    (docId: string, partyId: string, email: string, sentAt = Date.now()) => {
      setInviteEmailSent(prev => {
        const next = { ...prev, [partyId]: { email, sentAt } }
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(`verilock-invite-sent:${docId}`, JSON.stringify(next))
          }
        } catch {
          /* private mode / quota */
        }
        return next
      })
    },
    [],
  )

  /** Opaque invite token from email deep link (`?invite=`) — never shown in creator UI. */
  const [stashedInviteToken, setStashedInviteToken] = useState<string | null>(null)
  const [invitePartyFromToken, setInvitePartyFromToken] = useState<string | null>(null)
  /**
   * Personal invite link was revoked/replaced/redeemed/unknown.
   * Shown so invitees do not treat a dead email link as still valid.
   */
  const [inviteLinkInvalid, setInviteLinkInvalid] = useState<string | null>(null)

  /** Max age for a sessionStorage-restored invite token. Short — Hub redirect round-trip only, not days. */
  const INVITE_TOKEN_TTL_MS = 30 * 60 * 1000

  // Capture ?invite= into sessionStorage and strip from the address bar.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const params = new URLSearchParams(window.location.search)
      const fromUrl = params.get('invite')?.trim() || null
      const slug =
        doc?.slug ||
        window.location.pathname.match(/^\/d\/([^/]+)/)?.[1] ||
        null
      const storageKey = slug ? `verilock-invite-token:${slug}` : null

      let token = fromUrl
      if (!token && storageKey) {
        try {
          const raw = sessionStorage.getItem(storageKey)
          if (raw) {
            // Stored as JSON { token, ts } with a short TTL — reject stale restores.
            const parsed = JSON.parse(raw) as { token?: string; ts?: number }
            if (
              typeof parsed.token === 'string' &&
              typeof parsed.ts === 'number' &&
              Date.now() - parsed.ts <= INVITE_TOKEN_TTL_MS
            ) {
              token = parsed.token
            } else {
              sessionStorage.removeItem(storageKey)
            }
          }
        } catch {
          token = null
        }
      }
      if (!token) {
        setStashedInviteToken(null)
        setInvitePartyFromToken(null)
        // Keep inviteLinkInvalid if we already know the link is dead (from this mount).
        return
      }

      // Drop raw token from visible URL (keep other query flags like openPay).
      if (fromUrl) {
        params.delete('invite')
        const qs = params.toString()
        const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
        window.history.replaceState(window.history.state, '', next)
      }

      let cancelled = false
      void api
        .lookupInviteToken(token)
        .then(res => {
          if (cancelled) return
          setStashedInviteToken(token)
          setInvitePartyFromToken(res.partyId)
          setInviteLinkInvalid(null)
          if (storageKey) {
            try {
              sessionStorage.setItem(
                storageKey,
                JSON.stringify({ token, ts: Date.now() }),
              )
            } catch {
              /* private mode */
            }
          }

          /**
           * Guest co-signer auto-redeem (`docs/guest-signing-plan.md` Task 5) - the
           * lookup above only resolves which party this link is for; it does not
           * authenticate anything. A connected wallet always wins (matches the "real
           * wallet wins" principle used everywhere else this session) - only attempt
           * a guest session when there is none. Read the PERSISTED guest session
           * fresh (not the `guestSession` state closure) so this decision is never
           * stale and this effect's deps below don't need to widen for it.
           */
          if (FEATURES.guestSigning && !account) {
            const existing = loadGuestSession()
            const alreadyRedeemed =
              existing &&
              existing.documentId === res.documentId &&
              existing.role === 'signer' &&
              existing.partyId === res.partyId
            if (!alreadyRedeemed) {
              void api
                .redeemInviteAsGuest(token)
                .then(({ session }) => {
                  if (cancelled) return
                  const next: StoredGuestSession = {
                    token: session.token,
                    documentId: res.documentId,
                    partyId: res.partyId,
                    role: 'signer',
                  }
                  saveGuestSession(next)
                  setGuestSession(next)
                })
                .catch((redeemErr: unknown) => {
                  if (cancelled) return
                  // Only surface a hard "invite is dead" banner for the same statuses
                  // the lookup catch below treats that way - a guest-signing-off /
                  // rate-limited failure here should NOT claim the (still valid) link
                  // is dead, since the wallet-era sign path (raw inviteToken) may
                  // still work for this same link. Note: the server also returns 404
                  // (not 403/503) when `GUEST_SIGNING` itself is off server-side
                  // (`guestSigningDisabled`) - exclude that specific message so a
                  // flag mismatch never gets mislabeled as a dead invite.
                  const status =
                    redeemErr && typeof redeemErr === 'object' && 'status' in redeemErr
                      ? Number((redeemErr as { status?: number }).status)
                      : 0
                  const message =
                    redeemErr instanceof Error && redeemErr.message.trim() ? redeemErr.message : ''
                  const guestSigningOff = /guest signing is disabled/i.test(message)
                  if (!guestSigningOff && (status === 410 || status === 404)) {
                    setInviteLinkInvalid(message || 'This invite link is no longer valid.')
                  }
                })
            }
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return
          // Dead personal link: do not keep a revoked token for signing.
          setStashedInviteToken(null)
          setInvitePartyFromToken(null)
          if (storageKey) {
            try {
              sessionStorage.removeItem(storageKey)
            } catch {
              /* ignore */
            }
          }
          const status =
            err && typeof err === 'object' && 'status' in err
              ? Number((err as { status?: number }).status)
              : 0
          const message =
            err instanceof Error && err.message.trim()
              ? err.message
              : 'This invite link is no longer valid.'
          // 410 = revoked/replaced/redeemed/expired; 404 = unknown token.
          if (status === 410 || status === 404 || fromUrl) {
            setInviteLinkInvalid(message)
          }
        })
      return () => {
        cancelled = true
      }
    } catch {
      setStashedInviteToken(null)
      setInvitePartyFromToken(null)
    }
    // `account` re-runs this when a wallet connects after mount (async Hub reconnect
    // can resolve after this effect's first run) so the guest-redeem branch above
    // correctly backs off once a real wallet is present - re-running the (idempotent)
    // lookup call itself is harmless.
  }, [doc?.slug, navEpoch, account])

  // Seed share-step cosigner draft from the live document once per agreement.
  useEffect(() => {
    if (!doc || step !== 'share') return
    const need = Math.max(1, Math.min(10, requiredCount(doc)))
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
    doc && canRevealParticipantDetails(doc.source, effectiveAddress),
  )
  // Cancel/delete is a creator-only action - a co-signer's guest session must never trigger it.
  const canCancelCurrent = Boolean(doc && canDeleteDocument(doc.source, creatorOnlyEffectiveAddress))

  /** Verify path: fingerprint match settled (used to slim header + drop redundant lists). */
  const verifyMatched = verifyOutcome.kind === 'match'
  const verifyPartyMatch = useMemo(() => {
    if (!verifyMatched || verifyOutcome.kind !== 'match') return null
    return (
      verifyOutcome.matches.find(m => isPartyToVerifyMatch(m, address)) ?? null
    )
  }, [verifyMatched, verifyOutcome, address])
  const verifyPartyView = Boolean(verifyMatched && token && verifyPartyMatch)

  const activeStage =
    pathStages.find(s => s.id === step) ??
    (step === 'done' ? pathStages[pathStages.length - 1] ?? null : null)

  const stepIndex = activeStage ? pathStages.findIndex(s => s.id === activeStage.id) : -1

  /** Creator opted out of signing - only blocks *this* wallet, never invitees. */
  const creatorIsOrganizerOnly =
    FEATURES.pdfAnnotationUi &&
    constructionPlan?.status === 'locked' &&
    (constructionPlan.creatorSigningAs == null || constructionPlan.creatorSigningAs === 0) &&
    Boolean(doc && address && isDocumentCreator(doc.source, address))

  /** Creator chose a party and still needs to sign - Setup should not force invite UI. */
  const creatorStillNeedsToSign = Boolean(
    doc &&
      address &&
      isDocumentCreator(doc.source, address) &&
      FEATURES.pdfAnnotationUi &&
      constructionPlan?.status === 'locked' &&
      constructionPlan.creatorSigningAs != null &&
      constructionPlan.creatorSigningAs > 0 &&
      !walletHasSignedJourneyDoc(doc, address) &&
      !allSigned(doc),
  )

  /**
   * Invite co-signers only after setup is locked, and never while the creator
   * still needs to sign their own fields (invites come after their signature).
   */
  const showInvitePhase = Boolean(
    doc &&
      !doc.sealed &&
      !allSigned(doc) &&
      (!FEATURES.pdfAnnotationUi ||
        constructionPlan?.status === 'locked' ||
        signedCount(doc) > 0) &&
      !creatorStillNeedsToSign,
  )

  /**
   * Creator is past their own signature (or organizer-only) and the dock is in
   * the invite / waiting UI on Sign or Setup - used to de-clutter chrome.
   */
  const creatorInviteDock =
    Boolean(doc && showInvitePhase && role === 'creator' && (step === 'share' || step === 'sign'))

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

  /**
   * Quiet “come back when everyone signed” view (after Done inviting).
   * Must match the waiting-panel render predicate so we never hide Sign roster
   * chrome while the waiting panel itself is not on screen.
   */
  const inviteWaitingView = Boolean(
    creatorInviteDock &&
      sharedAck &&
      doc &&
      !allSigned(doc) &&
      (requiredCount(doc) > 1 || inviteeSlotCount > 0),
  )
  /** Active invite-management form (email/link cards) - anything invite-dock that isn’t quiet wait. */
  const inviteManageView = Boolean(creatorInviteDock && !inviteWaitingView)

  /**
   * Setup may re-open field layout until the first signature (design mode or invite dock).
   */
  const canReopenPlacements = Boolean(
    FEATURES.pdfAnnotationUi &&
      step === 'share' &&
      doc &&
      constructionPlan?.status === 'locked' &&
      signedCount(doc) === 0 &&
      // Re-opening field layout is creator-only - a co-signer's guest session must not trigger it.
      creatorOnlyEffectiveAddress &&
      isDocumentCreator(doc.source, creatorOnlyEffectiveAddress),
  )
  /** Full placement editor (PDF stage + people) - not during invite/wait dock. */
  const showSetupPlacementEditor = Boolean(
    FEATURES.pdfAnnotationUi &&
      step === 'share' &&
      doc &&
      (pdfFile || signFile) &&
      constructionPlan &&
      !creatorInviteDock,
  )

  /**
   * Setup Continue is disabled until every person has ≥1 field and name boxes
   * have real names. Surface the reason so a grayed-out button is never silent.
   */
  const setupContinueLayoutBlocked =
    constructionPlan && constructionPlan.status !== 'locked'
      ? placementContinueBlockedReason(constructionPlan)
      : null
  const setupContinueBlockedHint =
    showSetupPlacementEditor && constructionPlan?.status !== 'locked'
      ? placementLockBusy
        ? null
        : !effectiveToken
          ? 'Log in to save the layout.'
          : busy
            ? null
            : setupContinueLayoutBlocked
      : null
  const setupContinueDisabled = Boolean(
    showSetupPlacementEditor &&
      constructionPlan?.status !== 'locked' &&
      (busy || !effectiveToken || placementLockBusy || setupContinueLayoutBlocked),
  )

  /** Disabled buttons don't fire click — wrapper catches the attempt and flashes the hint. */
  const flashSetupContinueBlocked = useCallback(() => {
    if (!setupContinueBlockedHint) return
    setSetupContinueFlashToken(t => t + 1)
  }, [setupContinueBlockedHint])

  /** Legacy soft prefer: /d/:slug?party=<partyId> (open slots only; email-gated needs ?invite=). */
  const preferredPartyFromUrl = useMemo(() => {
    if (typeof window === 'undefined') return null
    try {
      const q = new URLSearchParams(window.location.search).get('party')
      return q?.trim() || null
    } catch {
      return null
    }
  }, [doc?.id, navEpoch])

  /**
   * Priority order (highest first):
   * 1. `activeGuestSignerSession.partyId` - an already-AUTHENTICATED binding (the invite
   *    was redeemed into a guest session server-side, Turnstile/rate-limit checks and all)
   *    for one specific party. Strictly more authoritative than the wallet-era signal
   *    below, which is only a pre-auth lookup hint - wins if the two ever disagree.
   * 2. `invitePartyFromToken` - wallet-era equivalent: the same `?invite=` link, but only
   *    resolved (via `GET /api/invites/lookup`) to a party id, not yet authenticated to it.
   * 3. `pickedPartyId` - manual "Who are you?" pick for an open name-only slot.
   * 4. `preferredPartyFromUrl` - legacy `?party=` soft prefer.
   */
  const effectivePreferredPartyId =
    activeGuestSignerSession?.partyId ||
    invitePartyFromToken ||
    pickedPartyId ||
    preferredPartyFromUrl

  /** Prefer typed name, then create-time name, then a real party label (not placeholders). */
  const resolveSignDisplayName = useCallback(
    (party: { displayName?: string | null }, ...candidates: Array<string | null | undefined>) => {
      for (const raw of candidates) {
        const t = raw?.trim()
        if (t && !isPlaceholderPartyName(t) && !looksLikeAddressLabel(t)) return t
      }
      const partyName = party.displayName?.trim()
      if (
        partyName &&
        !isPlaceholderPartyName(partyName) &&
        !looksLikeAddressLabel(partyName)
      ) {
        return partyName
      }
      return ''
    },
    [],
  )

  const signingResolution =
    doc && effectiveAddress
      ? resolveSigningParty(doc.source, effectiveAddress, {
          allowOpenClaim: !creatorIsOrganizerOnly,
          preferredPartyId: effectivePreferredPartyId,
        })
      : null
  const pendingParty =
    signingResolution?.ok
      ? doc!.parties.find(p => p.id === signingResolution.party.id) ?? null
      : null

  // Prefill sign-step name from create-time name or party label so solo auto-submit can run.
  useEffect(() => {
    if (!signingResolution?.ok || signerName.trim()) return
    if (!partyNeedsSignerName(signingResolution.party)) return
    const next = resolveSignDisplayName(
      signingResolution.party,
      creatorName,
      signingResolution.party.displayName,
    )
    if (next) setSignerName(next)
  }, [signingResolution, signerName, creatorName, resolveSignDisplayName])

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
      // Always apply form fields (including empty) so Hub restore cannot leave
      // defaults like agreement type = contract when the user chose NDA.
      setTitle(m.title)
      setCreatorName(m.creatorName)
      setCreatorNotifyEmail(m.creatorNotifyEmail)
      setDocType(m.docType)
      setDocNotes(m.docNotes)
      if (m.pdfHash) setPdfHash(m.pdfHash)
      else setPdfHash(null)
      if (m.pageCount > 0) setPageCount(m.pageCount)
      else if (!m.pdfHash) setPageCount(0)
    },
    [],
  )

  const ensureCreatorRole = useCallback(() => {
    setRole(prev => prev ?? 'creator')
  }, [])

  const onUnreadableCreateDraft = useCallback((message: string) => {
    setLocalError(message)
  }, [])

  const {
    onFileChange: onCreatePdfFileChange,
    flush: flushCreatePdfDraft,
    clear: clearCreatePdfDraftState,
  } = useCreatePdfDraft({
    // Keep saving after agreement create so refresh can restore the local PDF.
    enabled:
      (role === 'creator' || role == null) &&
      Boolean(pdfFile) &&
      (!doc || Boolean(pdfHash && doc.fingerprint === pdfHash)),
    bootReady,
    // Restore create draft when still pre-doc, or when we reopened /d/ without a file in memory.
    canRestore:
      (role === 'creator' || role == null || role === 'signer') &&
      !pdfFile &&
      !signFile,
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
    onUnreadableDraft: onUnreadableCreateDraft,
  })

  // Hash PDF on select / restore (create path).
  // Dead File handles (common after long mobile backgrounding) are recovered from
  // IndexedDB once; otherwise the draft is cleared so Login is not stuck disabled.
  useEffect(() => {
    if (!pdfFile) {
      setPdfHash(null)
      createFileIdbRecoveryAttemptedRef.current = false
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const buffer = await readFileBytes(pdfFile)
        const hash = await sha256Hex(buffer)
        const pages = await getDocumentPageCount(pdfFile)
        if (cancelled) return
        setPdfHash(hash)
        setPageCount(pages)
        setLocalError(prev => (prev === STALE_LOCAL_DOCUMENT_MESSAGE ? null : prev))
        // Auto-fill title from the file name when empty, or when the field still
        // holds the previous auto-fill (user has not customized it). Always track
        // this file's suggestion so a later replace can detect an untouched title.
        const suggested = clampField(
          stripDocumentExtension(pdfFile.name),
          MAX_TITLE_LENGTH,
        )
        setTitle(prev => {
          const cur = (prev ?? '').trim()
          const lastAuto = autoTitleFromFileRef.current
          const shouldReplace = !cur || cur === lastAuto
          autoTitleFromFileRef.current = suggested
          return shouldReplace ? suggested : prev
        })
      } catch (err) {
        if (cancelled) return

        if (isUnreadableDocumentError(err)) {
          // In-memory File may be the dead input handle; IDB draft can still be good.
          if (!createFileIdbRecoveryAttemptedRef.current) {
            createFileIdbRecoveryAttemptedRef.current = true
            try {
              const draft = await loadCreatePdfDraft()
              if (draft && !cancelled) {
                const recovered = fileFromCreatePdfDraft(draft)
                await readFileBytes(recovered)
                setPdfFile(recovered)
                return
              }
            } catch {
              /* fall through to clear */
            }
          }
          if (cancelled) return
          setLocalError(STALE_LOCAL_DOCUMENT_MESSAGE)
          setPdfHash(null)
          // Clears React file + IndexedDB draft; keeps form field cache.
          onCreatePdfFileChange(null)
          return
        }

        setLocalError(documentReadErrorMessage(err))
        setPdfHash(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfFile, onCreatePdfFileChange])

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
    // Already verified for this file + agreement - skip re-hash churn.
    if (signHash === doc.fingerprint && pdfHash === doc.fingerprint && signFile === pdfFile) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const hash = await sha256Hex(await readFileBytes(signFile))
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
          setLocalError(documentReadErrorMessage(err))
          setSignHash(null)
          if (isUnreadableDocumentError(err)) {
            setSignFile(null)
          }
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

  // After hard-refresh on /d/:slug, rehydrate local PDF from IndexedDB when fingerprint matches.
  useEffect(() => {
    if (!bootReady || !doc?.fingerprint) return
    if (pdfFile || signFile) return
    let cancelled = false
    void (async () => {
      const draft = await loadCreatePdfDraft()
      if (cancelled || !draft?.pdfHash || draft.pdfHash !== doc.fingerprint) return
      try {
        const file = fileFromCreatePdfDraft(draft)
        await readFileBytes(file)
        if (cancelled) return
        setPdfFile(file)
        setSignFile(file)
        setPdfHash(draft.pdfHash)
        setSignHash(draft.pdfHash)
        if (typeof draft.pageCount === 'number' && draft.pageCount > 0) {
          setPageCount(draft.pageCount)
        }
      } catch {
        /* stale handle — drop UI will ask for the file again */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bootReady, doc?.id, doc?.fingerprint, pdfFile, signFile])

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

    // Include session in cache key so connecting as a party re-fetches private details.
    const fileOnlyKey = `${verifyFile.name}:${verifyFile.size}:${verifyFile.lastModified}`
    const fileKey = `${fileOnlyKey}:${token ?? ''}`
    const cached = verifyCacheRef.current
    if (cached?.key === fileKey) {
      setVerifyOutcome(cached.outcome)
      return
    }

    const runId = ++verifyRunIdRef.current
    // Same file, new session: keep match UI while private details upgrade.
    const upgradingAuth =
      cached != null &&
      cached.key.startsWith(`${fileOnlyKey}:`) &&
      cached.outcome.kind === 'match'
    if (!upgradingAuth) {
      setVerifyOutcome({ kind: 'hashing' })
    }
    setLocalError(null)

    void (async () => {
      try {
        const got = await sha256Hex(await readFileBytes(verifyFile))
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
        setLocalError(documentReadErrorMessage(err))
        // Keep a local hash preview so the drop still feels responsive (when bytes open).
        try {
          const got = await sha256Hex(await readFileBytes(verifyFile))
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
    autoTitleFromFileRef.current = null
    setCreatorName('')
    setCreatorNotifyEmail('')
    setNotifyEmailSavedValue(null)
    setNotifyEmailBusy(false)
    setNotifyEmailError(null)
    setNotifyEmailFlashSaved(false)
    if (notifyEmailFlashTimerRef.current) {
      clearTimeout(notifyEmailFlashTimerRef.current)
      notifyEmailFlashTimerRef.current = null
    }
    setDocType('contract')
    setCoSignerNames([''])
    setCoSignerEmails([''])
    setPartyInviteEmails({})
    setDocNotes('')
    setRequiredSigners(1)
    setDoc(null)
    setSharedAck(false)
    setCreatorChoseLock(false)
    setInviteWaitingVisited(false)
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
    setInviteSendBusyId(null)
    setInviteSendNote({})
    setInviteEmailSent({})
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

  /** Leave free-complete / done flow for My agreements (falls back to home). */
  const goToMyAgreements = () => {
    clearJourneyIntent()
    syncIntentToUrl(null)
    setLocalError(null)
    setLockMessage(null)
    setError(null)
    if (onAgreements) {
      onAgreements()
      return
    }
    if (onHome) {
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
    window.history.pushState({}, '', '/agreements')
    clearLocalJourneyState()
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

  const createDoc = async () => {
    if (!token || !pdfFile || !pdfHash) return
    setBusy(true)
    setLocalError(null)
    try {
      // Fingerprint only - parties / who signs are set when placements lock.
      const metadata =
        documentTypeUsesNotes(docType) && docNotes.trim()
          ? { notes: clampField(docNotes.trim(), MAX_DOCUMENT_NOTES_LENGTH) }
          : undefined

      const { document, hashWarning } = await api.createDocument(token, {
        title: clampField(title || stripDocumentExtension(pdfFile.name), MAX_TITLE_LENGTH),
        originalFileName: pdfFile.name,
        type: docType,
        creatorRole: 'creator',
        // Optional organizer label only - not assumed to be Person 1 / a signer.
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
      // Keep IndexedDB local PDF so hard-refresh / Pay remount can rehydrate the file.
      // (Clearing here forced “drop document again” after every deploy refresh.)
      void flushCreatePdfDraft()
      // Step advances to Setup - bring the next actions into view.
      scrollToJourneyAction('auto')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Guest create (`docs/guest-signing-plan.md` Task 3 - locked decision).
   * No wallet/token needed. Direct seal (0 required signatures) is wallet-only
   * by design and out of scope here - this call always sends
   * `requiredSignatures: 1`; enforcing the guest-can't-direct-seal rule for
   * later roster/cosigner edits is a later task's server-side responsibility.
   */
  const createGuestDoc = async () => {
    if (!pdfFile || !pdfHash) return
    // Guest has no wallet address to fall back to as a label - unlike the wallet
    // path's `creatorName.trim() || 'Organizer'`, a real name is required here.
    if (!creatorName.trim()) {
      setLocalError('Your name is required')
      return
    }
    // Turnstile guard — must complete bot check when server requires it.
    if (turnstileRequired && !turnstileToken) {
      setLocalError('Please complete the bot check and try again.')
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      // Fingerprint only - parties / who signs are set when placements lock.
      const metadata =
        documentTypeUsesNotes(docType) && docNotes.trim()
          ? { notes: clampField(docNotes.trim(), MAX_DOCUMENT_NOTES_LENGTH) }
          : undefined

      const { document, documentKey, guestSession, hashWarning } =
        await api.createGuestDocument({
          title: clampField(title || stripDocumentExtension(pdfFile.name), MAX_TITLE_LENGTH),
          originalFileName: pdfFile.name,
          type: docType,
          creatorDisplayName: clampField(creatorName.trim(), MAX_DISPLAY_NAME_LENGTH),
          originalSha256: pdfHash,
          pageCount,
          requiredSignatures: 1,
          ...(metadata ? { metadata } : {}),
          turnstileToken: turnstileToken ?? undefined,
        })

      if (hashWarning) setLocalError(hashWarning)
      setActiveFromSeal(document, pdfFile.size)
      setSharedAck(false)
      setSignFile(pdfFile)
      setSignHash(pdfHash)
      setConstructionPlan(emptyPlan(pdfHash, 2))
      setPageFieldsConfirmed(false)
      // Bearer token for this guest's creator session - localStorage (not
      // sessionStorage), see `client/src/session.ts` for why.
      saveGuestSession({
        token: guestSession.token,
        documentId: document.id,
        partyId: null,
        role: 'creator',
      })
      // Keep React state and localStorage in sync in the same render pass - the
      // `doc?.id`-keyed re-sync effect above would also pick this up next render,
      // but setting it directly here avoids a one-render gap where
      // `activeGuestCreatorSession` is still null right after create.
      setGuestSession({
        token: guestSession.token,
        documentId: document.id,
        partyId: null,
        role: 'creator',
      })
      // Raw key only ever lives in this component's memory - never persisted
      // automatically. The modal is the only place it is shown.
      setGuestDocumentKeyModal({ documentKey, savedAck: false })
      window.history.pushState({}, '', `/d/${document.slug}`)
      // Keep IndexedDB local PDF so hard-refresh / Pay remount can rehydrate the file.
      // (Clearing here forced “drop document again” after every deploy refresh.)
      void flushCreatePdfDraft()
      // Step advances to Setup - bring the next actions into view.
      scrollToJourneyAction('auto')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Create failed')
      resetTurnstile()
    } finally {
      setBusy(false)
    }
  }

  const dismissInviteHandoff = useCallback(() => {
    setInviteHandoff(null)
  }, [])

  const showInviteHandoffHelp = useCallback(
    (contactLabel: string, mode: 'email' | 'link' = 'email') => {
      setInviteHandoff({ key: Date.now(), contactLabel, mode })
    },
    [],
  )

  const copyText = async (
    text: string,
    notePartyId?: string,
    contactLabel?: string,
  ): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      if (notePartyId) {
        setInviteSendNote(prev => ({ ...prev, [notePartyId]: 'Link copied' }))
        // Same file-handoff reminder as after invite email - user must act on it.
        showInviteHandoffHelp(contactLabel?.trim() || 'your co-signer', 'link')
      }
      return true
    } catch {
      setLocalError('Could not copy - select the link and copy it manually.')
      return false
    }
  }

  // Trap focus / Escape while the handoff help dialog is open.
  useEffect(() => {
    if (!inviteHandoff) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        dismissInviteHandoff()
      }
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    window.setTimeout(() => inviteHandoffPrimaryRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [inviteHandoff, dismissInviteHandoff])

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
            [opts.partyId]: 'Opened share sheet (include file when the app allows)',
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
            'Open your personal link (use the exact file the organizer shared with you):',
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
      .getPlacementPlan(doc.fingerprint, effectiveToken, { documentId: doc.id })
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
          setRequiredSigners(Math.max(1, Math.min(10, planPeople.length)))
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
  }, [doc?.id, doc?.fingerprint, effectiveToken])

  /**
   * Seed a draft plan only after we know the server has none (create / setup path).
   * Never overwrite while loading - that forced invitees into “unlocked setup” flash.
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
      // Creator explicitly chose a person slot on Setup
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

  const signAsCurrentUser = useCallback(
    async (opts?: { signatureBlob?: Blob | null; displayName?: string }) => {
      if (!effectiveToken || !doc || !effectiveAddress) return false

      // Prefer explicit sign-step hash; fall back to create-time file still in this session.
      const clientHash =
        signHash && signHash === doc.fingerprint
          ? signHash
          : pdfHash && pdfHash === doc.fingerprint
            ? pdfHash
            : null
      if (!clientHash) {
        setLocalError('Choose the matching document before signing')
        return false
      }

      const creatorOnlyBlock =
        FEATURES.pdfAnnotationUi &&
        constructionPlan?.status === 'locked' &&
        (constructionPlan.creatorSigningAs == null || constructionPlan.creatorSigningAs === 0) &&
        isDocumentCreator(doc.source, effectiveAddress)
      const resolution = resolveSigningParty(doc.source, effectiveAddress, {
        allowOpenClaim: !creatorOnlyBlock,
        preferredPartyId: effectivePreferredPartyId,
      })
      if (!resolution.ok) {
        setLocalError(resolution.message)
        return false
      }
      const myParty = resolution.party
      const nameForSign = resolveSignDisplayName(
        myParty,
        opts?.displayName,
        signerName,
        creatorName,
      )
      const ink = opts?.signatureBlob ?? sigBlob
      if (partyNeedsSignerName(myParty) && !nameForSign) {
        setLocalError('Enter your full name before signing')
        return false
      }
      if (!ink) {
        setLocalError('Draw your signature on the document before submitting')
        return false
      }

      setBusy(true)
      setLocalError(null)
      try {
        const signatureImage = await prepareSignatureImageUpload(ink)
        const { document: signedDoc } = await api.signDocument(effectiveToken, doc.id, {
          partyId: myParty.id,
          signatureType: 'drawn',
          clientSha256: clientHash,
          displayName: partyNeedsSignerName(myParty)
            ? clampField(nameForSign, MAX_DISPLAY_NAME_LENGTH)
            : undefined,
          signatureImage,
          inviteToken: stashedInviteToken || undefined,
        })
        setActiveFromSeal(signedDoc, doc.fileSize)
        // Invite token is one-time for this signature path.
        setStashedInviteToken(null)
        setInvitePartyFromToken(null)
        try {
          if (doc.slug && typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem(`verilock-invite-token:${doc.slug}`)
          }
        } catch {
          /* ignore */
        }
        // Keep the matched file in this session for share / any return to sign.
        // Re-selecting the local file is only needed after a full leave (reload) drops File state.
        setSignerName('')
        setSigBlob(null)
        setSigPadKey(k => k + 1)
        if (mobileSigPreview) {
          URL.revokeObjectURL(mobileSigPreview)
          setMobileSigPreview(null)
        }
        // Invitees stay on the signer path so they never land on seal CTAs.
        if (!isDocumentCreator(signedDoc, effectiveAddress)) {
          setRole('signer')
          saveJourneyIntent('signer')
          setSharedAck(true)
          setLockMessage(null)
        } else {
          // Creator: multi incomplete → keep invite form open (not waiting view yet).
          // Ready-to-lock / solo: ack so we skip waiting-room chrome on seal.
          if (signedDoc.signingProgress.readyToLock) {
            setSharedAck(true)
            // Multi-party free complete: clear banner so free-complete dock is not undercut.
            // Solo / direct-ready still nudge toward optional lock.
            if (signedDoc.signingProgress.required <= 1) {
              setLockMessage(
                'Document complete. Print anytime, or lock on the blockchain for permanent proof.',
              )
            } else {
              setLockMessage(null)
            }
          } else {
            setSharedAck(false)
            setLockMessage(
              'Your signature is recorded. Invite co-signers below. When everyone has signed, print anytime or lock on the blockchain for permanent proof.',
            )
          }
        }
        // Sign form is mid-page; after success the UI swaps to invite/seal/done.
        // Scroll to the stage chrome so the next action is obvious.
        scrollToJourneyAction('auto')
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sign failed'
        setLocalError(message)
        // Slot races / already-signed: pull latest party assignment for a clean retry.
        if (/already signed|claimed this slot|refresh/i.test(message) && doc?.slug) {
          try {
            const { document: latest } = await api.getDocument(doc.slug, effectiveToken)
            setActiveFromSeal(latest, doc.fileSize)
          } catch {
            /* keep prior doc state */
          }
        }
        return false
      } finally {
        setBusy(false)
      }
    },
    [
      effectiveToken,
      doc,
      effectiveAddress,
      signHash,
      pdfHash,
      constructionPlan,
      effectivePreferredPartyId,
      stashedInviteToken,
      signerName,
      creatorName,
      sigBlob,
      mobileSigPreview,
      setActiveFromSeal,
      setRole,
      resolveSignDisplayName,
    ],
  )

  const submitPageFields = useCallback(
    async (result: SignerFillResult) => {
      if (!effectiveToken || !doc || !constructionPlan?.planRoot) {
        throw new Error('Missing session or locked plan')
      }
      if (!effectiveAddress) {
        throw new Error('Connect your wallet before submitting fields')
      }
      const hash = (pdfHash || signHash || doc.fingerprint || '').toLowerCase()
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Document fingerprint missing')

      setFillBusy(true)
      try {
        // Capture ink for the party signature image (no second pad).
        // Prefer vector path raster when present so a bad PNG (e.g. initials) cannot win.
        let inkBlob: Blob | null = null
        if (result.inkPath?.strokes?.length) {
          try {
            const { pathToPngDataUrl } = await import('../signatureHandoff/crypto')
            const url = pathToPngDataUrl(result.inkPath)
            inkBlob = await (await fetch(url)).blob()
          } catch {
            /* try data URL below */
          }
        }
        if (!inkBlob && result.signatureImageDataUrl) {
          try {
            inkBlob = await (await fetch(result.signatureImageDataUrl)).blob()
          } catch {
            /* pad still available as fallback */
          }
        }
        if (inkBlob) setSigBlob(inkBlob)

        const creatorOnlyBlock =
          FEATURES.pdfAnnotationUi &&
          constructionPlan.status === 'locked' &&
          (constructionPlan.creatorSigningAs == null ||
            constructionPlan.creatorSigningAs === 0) &&
          isDocumentCreator(doc.source, effectiveAddress)
        const resolution = resolveSigningParty(doc.source, effectiveAddress, {
          allowOpenClaim: !creatorOnlyBlock,
          preferredPartyId: effectivePreferredPartyId,
        })
        const nameHint = resolution.ok
          ? resolveSignDisplayName(
              resolution.party,
              result.printedName,
              signerName,
              creatorName,
            )
          : (result.printedName || signerName || creatorName).trim()
        if (nameHint && !signerName.trim()) {
          setSignerName(nameHint)
        }

        const finishFieldsAndMaybeAutoSign = async () => {
          setPageFieldsConfirmed(true)
          // On-document ink + resolved party: record the wallet signature immediately
          // (solo and multi-party). Avoids “fields done / 0 signatures” limbo.
          // Explicit Submit remains when ink is missing, name is still needed, or auto-sign fails.
          if (!inkBlob || !resolution.ok) return
          if (partyNeedsSignerName(resolution.party) && !nameHint) return
          // Sign errors are reported via localError; do not retry fill append.
          await signAsCurrentUser({
            signatureBlob: inkBlob,
            displayName: nameHint || undefined,
          })
        }

        if (result.fills.length === 0) {
          await finishFieldsAndMaybeAutoSign()
          return
        }

        const planRoot = constructionPlan.planRoot
        let lastErr: Error | null = null
        // Concurrent signers may race on prevRoot - refresh tip and retry.
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            let known = knownBlobIds
            let batchIndex = 1
            let prev =
              lastBatchRoot ||
              planRoot ||
              '0000000000000000000000000000000000000000000000000000000000000000'
            const live = await api.getPlacementPlan(hash, effectiveToken, { documentId: doc.id })
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
            const saved = await api.appendPlacementFill(effectiveToken, hash, {
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
              documentId: doc.id,
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
            // Separate from fill-retry loop: sign failures must not re-append fills.
            await finishFieldsAndMaybeAutoSign()
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
    [
      effectiveToken,
      doc,
      constructionPlan,
      pdfHash,
      signHash,
      lastBatchRoot,
      knownBlobIds,
      signerName,
      creatorName,
      effectiveAddress,
      effectivePreferredPartyId,
      signAsCurrentUser,
      resolveSignDisplayName,
    ],
  )

  const lockPlacements = useCallback(async () => {
    if (!creatorOnlyEffectiveToken || !doc || !constructionPlan) return
    const hash = (pdfHash || signHash || doc.fingerprint || constructionPlan.pdfSha256).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      setLocalError('Document fingerprint missing - re-open the file.')
      return
    }
    if (constructionPlan.slots.length === 0) {
      setLocalError('Place at least one signature or name box before locking.')
      return
    }
    const missingFields = peopleWithoutSlotsMessage(constructionPlan)
    if (missingFields) {
      setLocalError(missingFields)
      return
    }
    const needNames = peopleNeedingRealNameMessage(constructionPlan)
    if (needNames) {
      setLocalError(needNames)
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
      const saved = await api.savePlacementPlan(creatorOnlyEffectiveToken, {
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

      const { document: rosterDoc } = await api.configureSigningRoster(creatorOnlyEffectiveToken, doc.id, {
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
        `Layout saved · ${saved.slotCount} boxes · ${asLabel} · root ${shortHash(saved.planRoot ?? planRoot)}`,
      )
      setStepHold(null)
      // Step advances to Sign / Invite - scroll to the dock (user was mid-PDF).
      scrollToJourneyAction('auto')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not save placements')
    } finally {
      setPlacementLockBusy(false)
    }
  }, [
    creatorOnlyEffectiveToken,
    doc,
    constructionPlan,
    pdfHash,
    signHash,
    creatorNotifyEmail,
    setActiveFromSeal,
    scrollToJourneyAction,
  ])

  /** Re-open placements for editing (before anyone fills fields or signs). */
  const unlockPlacements = useCallback(async () => {
    if (!creatorOnlyEffectiveToken || !doc || !constructionPlan) return
    if (signedCount(doc) > 0) {
      setLocalError('Placements cannot be changed after someone has signed.')
      return
    }
    const hash = (pdfHash || signHash || doc.fingerprint || constructionPlan.pdfSha256).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      setLocalError('Document fingerprint missing - re-open the file.')
      return
    }
    setPlacementLockBusy(true)
    setPlacementStatus(null)
    setLocalError(null)
    try {
      const saved = await api.savePlacementPlan(creatorOnlyEffectiveToken, {
        originalSha256: hash,
        documentId: doc.id,
        unlock: true,
      })
      const base = unlockPlanLocal(constructionPlan)
      const fromServer = saved.plan
      setConstructionPlan({
        ...base,
        status: 'draft',
        planRoot: undefined,
        lockedAt: undefined,
        ...(fromServer
          ? {
              people: fromServer.people.map(p => ({
                slotIndex: p.slotIndex,
                displayName: p.displayName,
                role: p.role,
                walletAddress: (p as { walletAddress?: string | null }).walletAddress ?? null,
              })),
              slots: (fromServer.slots as PlacementSlot[]) ?? base.slots,
              creatorSigningAs:
                fromServer.creatorSigningAs === undefined
                  ? base.creatorSigningAs
                  : fromServer.creatorSigningAs,
            }
          : {}),
      })
      setLastBatchRoot(null)
      setFilledSlotIds(new Set())
      setKnownBlobIds(new Set())
      setPageFieldsConfirmed(false)
      setSharedAck(false)
      setStepHold(null)
      setPlacementStatus('Placements re-opened - adjust fields, then continue.')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not re-open placements')
    } finally {
      setPlacementLockBusy(false)
    }
  }, [creatorOnlyEffectiveToken, doc, constructionPlan, pdfHash, signHash])

  /**
   * Creator finished inviting - switch to the quiet waiting view (not a second
   * party list). Explicit so we never hide the invite form before invites go out.
   */
  const acknowledgeShare = useCallback(() => {
    setSharedAck(true)
    setInviteWaitingVisited(true)
    scrollToJourneyAction('smooth')
  }, [scrollToJourneyAction])

  /** Leave waiting view to manage invites / notification email (same step). */
  const reopenInviteSetup = useCallback(() => {
    setSharedAck(false)
    scrollToJourneyAction('smooth')
  }, [scrollToJourneyAction])

  /**
   * Persist cosigner count + optional names from the share-step Signatures UI.
   * Called automatically when party count changes or names blur - no Save button.
   * Ready-to-lock notify email is saved separately (see saveNotifyEmail) so it can
   * show explicit “Saved” feedback without the full cosigner busy state.
   */
  const applyCosigners = async (overrides?: {
    requiredSignatures?: number
    coSignerNames?: string[]
  }) => {
    if (!creatorOnlyEffectiveToken || !doc) return
    const total = Math.max(
      1,
      Math.min(10, overrides?.requiredSignatures ?? requiredSigners),
    )
    const names = overrides?.coSignerNames ?? coSignerNames
    setBusy(true)
    setLocalError(null)
    try {
      const others = Math.max(0, total - 1)
      const { document } = await api.configureCosigners(creatorOnlyEffectiveToken, doc.id, {
        requiredSignatures: total,
        coSignerNames: names.slice(0, others).map(n => n.trim()),
      })
      setActiveFromSeal(document, doc.fileSize)
      // Expanding beyond solo: stay on share for invites (sharedAck resets for multi wait).
      if (total > 1) setSharedAck(false)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not update signers')
    } finally {
      setBusy(false)
    }
  }

  /** Save optional “email me when everyone has signed” with visible success feedback. */
  const saveNotifyEmail = async () => {
    if (!creatorOnlyEffectiveToken || !doc || !FEATURES.emailNotifyUi) return
    const raw = creatorNotifyEmail.trim()
    if (raw && !isValidEmailAddress(raw)) {
      setNotifyEmailError('Enter a valid email address')
      setNotifyEmailFlashSaved(false)
      return
    }
    if (requiredCount(doc) <= 1 && requiredSigners <= 1) {
      setNotifyEmailError('Add at least one co-signer before setting a notification email')
      return
    }
    setNotifyEmailBusy(true)
    setNotifyEmailError(null)
    setLocalError(null)
    try {
      const email = raw || null
      await api.setDocumentNotifyEmail(creatorOnlyEffectiveToken, doc.id, email)
      setNotifyEmailSavedValue(raw)
      setCreatorNotifyEmail(raw)
      setNotifyEmailFlashSaved(true)
      if (notifyEmailFlashTimerRef.current) clearTimeout(notifyEmailFlashTimerRef.current)
      notifyEmailFlashTimerRef.current = setTimeout(() => {
        notifyEmailFlashTimerRef.current = null
        setNotifyEmailFlashSaved(false)
      }, 4000)
      // Stay on the invite form - waiting view is explicit via “Done inviting”.
    } catch (err) {
      setNotifyEmailError(
        err instanceof Error ? err.message : 'Could not save notification email',
      )
      setNotifyEmailFlashSaved(false)
    } finally {
      setNotifyEmailBusy(false)
    }
  }

  useEffect(() => {
    return () => {
      if (notifyEmailFlashTimerRef.current) clearTimeout(notifyEmailFlashTimerRef.current)
    }
  }, [])

  /** Creator-only: open cancel confirm (before anyone has signed). */
  const requestCancelCurrentAgreement = () => {
    if (!creatorOnlyEffectiveToken || !doc || !canDeleteDocument(doc.source, creatorOnlyEffectiveAddress)) return
    setCancelError(null)
    setCancelModalOpen(true)
  }

  const closeCancelModal = () => {
    if (cancelBusy) return
    setCancelModalOpen(false)
    setCancelError(null)
  }

  /** Creator-only: cancel after modal confirm. */
  const confirmCancelCurrentAgreement = async () => {
    if (!creatorOnlyEffectiveToken || !doc || !canDeleteDocument(doc.source, creatorOnlyEffectiveAddress)) return
    setCancelBusy(true)
    setBusy(true)
    setCancelError(null)
    setLocalError(null)
    try {
      await api.deleteDocument(creatorOnlyEffectiveToken, doc.id)
      setCancelModalOpen(false)
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
      const message = err instanceof Error ? err.message : 'Could not cancel agreement'
      setCancelError(message)
      setLocalError(message)
    } finally {
      setCancelBusy(false)
      setBusy(false)
    }
  }

  /** Creator-only: open the "Save to wallet" claim modal for the current guest doc. */
  const openClaimModal = useCallback(() => {
    if (!doc || doc.source.authMode !== 'guest') return
    setClaimError(null)
    setClaimDocumentKeyInput('')
    setClaimModalOpen(true)
  }, [doc])

  const closeClaimModal = useCallback(() => {
    if (claimBusy) return
    setClaimModalOpen(false)
    setClaimError(null)
  }, [claimBusy])

  /**
   * Claim requires an actual verified wallet token (`token`, never
   * `creatorOnlyEffectiveToken`) - claim's whole point is adding a wallet identity to a
   * document that does not have one yet, so it cannot be gated behind the guest-session
   * fallback the other creator-only mutations use.
   */
  const confirmClaimDocument = useCallback(async () => {
    if (!doc || !token) return
    const usedGuestSession = Boolean(activeGuestCreatorSession)
    const documentKey = claimDocumentKeyInput.trim()
    if (!usedGuestSession && !documentKey) return
    setClaimBusy(true)
    setClaimError(null)
    try {
      const { document } = await api.claimDocument(
        token,
        doc.id,
        usedGuestSession ? { guestSessionToken: activeGuestCreatorSession!.token } : { documentKey },
      )
      setActiveFromSeal(document, doc.fileSize)
      if (usedGuestSession) {
        // The wallet is now the creator of record - the guest session is no longer the
        // meaningful identity for this document (the underlying DB row is harmless if it
        // lingers). Clear local state directly rather than waiting for the `doc?.id`-keyed
        // re-sync effect so `activeGuestCreatorSession` goes stale immediately.
        clearGuestSession()
        setGuestSession(null)
      }
      setClaimModalOpen(false)
      setClaimDocumentKeyInput('')
      setLockMessage('Saved to your wallet.')
    } catch (err) {
      setClaimError(
        err instanceof Error ? err.message : 'Could not save this agreement to your wallet',
      )
    } finally {
      setClaimBusy(false)
    }
  }, [doc, token, activeGuestCreatorSession, claimDocumentKeyInput, setActiveFromSeal])

  const sealWithCredit = async () => {
    if (!token || !doc) return
    if (!doc.directSeal && !allSigned(doc)) {
      setLocalError(
        `${signedCount(doc)} of ${requiredCount(doc)} signatures collected - remaining signers must sign before locking on the blockchain.`,
      )
      return
    }
    setBusy(true)
    setLocalError(null)
    setLockMessage('Reserving 1 credit - you can leave this page anytime…')
    const result = await sealJourneyDocumentWithCredit({
      token,
      doc: doc.source,
      onProgress: setLockMessage,
    })
    if (result.ok) {
      setActiveFromSeal(result.document, doc.fileSize)
      setLockMessage('Locked forever on Nimiq (1 credit).')
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
    isMobile: isMobileDevice(),
  })
  const loginNeedsSheet = journeyLoginNeedsSheet(connectMode)
  const [loginSheetOpen, setLoginSheetOpen] = useState(false)

  useEffect(() => {
    if (account) setLoginSheetOpen(false)
  }, [account])

  const connectFromPath = async (options?: JourneyConnectRequest) => {
    // Stamp intent into URL only when connecting (Hub return needs it).
    if (role) {
      saveJourneyIntent(role)
      syncIntentToUrl(role)
    }
    saveHubReturnPath()
    // Await the draft flush so IndexedDB is committed before the Hub redirect.
    // Form cache is sync; PDF blob write must finish or the restore has no file.
    if (pdfFile && !doc) await flushCreatePdfDraft()
    void connect(options !== undefined ? options : journeyConnectOptions(connectMode))
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
          'No agreement matches this document on this host. Check you have the exact file, or open the invite link from the creator.',
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
            openError = `"${document.title}" is already locked on the blockchain. Use Verify a document to check integrity.`
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
      setLocalError(err instanceof Error ? err.message : 'Could not look up this document')
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
  // Wallet errors (Hub/Pay) must surface on the path — not only behind the login modal banner.
  const displayError = localError ?? walletError

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
            <strong>Your document never leaves this device.</strong>
            {/* Desktop: keep subtitle on the collapsed row. Mobile: only in expanded detail. */}
            <span className="trust-bar-sub trust-bar-sub--inline">
              {' '}
              Only a SHA-256 fingerprint is stored / locked on-chain.
            </span>
          </span>
          <span className={`trust-chevron${privacyOpen ? ' trust-chevron--open' : ''}`} />
        </button>
        {privacyOpen && (
          <div className="trust-bar-detail">
            <p className="trust-bar-sub trust-bar-sub--detail">
              Only a SHA-256 fingerprint is stored / locked on-chain.
            </p>
            <ul>
              <li>Fingerprinting runs in your browser - bytes stay local.</li>
              <li>Servers keep metadata + hash, not the file.</li>
              <li>On-chain lock records the hash string only.</li>
              <li>Verification re-hashes a local copy - no wallet required.</li>
            </ul>
          </div>
        )}
      </aside>

      {/* Path picker home is owned by App / LandingHome. */}

      {step !== 'welcome' && (
        <>
          {/*
            Scroll target when the rail advances: stage labels + action title/CTAs.
            scroll-margin-top clears the sticky shell header.
          */}
          <div ref={stepFocusRef} className="journey-step-focus">
          {role && (
            <StageRail
              role={role}
              step={step}
              account={Boolean(account)}
              doc={doc}
              onStepSelect={role === 'creator' ? selectJourneyStep : undefined}
              canSelectStep={
                role === 'creator'
                  ? id => id === naturalStep || canHoldStep(id, naturalStep)
                  : undefined
              }
            />
          )}

          <section className="action-dock" aria-live="polite">
            <header className="action-dock-head">
              <div className="journey-toolbar">
                <div className="journey-toolbar-start">
                  <button
                    type="button"
                    className="btn btn-ghost journey-reset"
                    onClick={resetAll}
                    title="Back to home"
                  >
                    <ArrowLeft size={14} strokeWidth={2.25} aria-hidden />
                    Back home
                  </button>
                  {role === 'creator' && (account || activeGuestCreatorSession) && (
                    <span className="journey-role-pill">
                      Creating as {account ? account.shortAddress : 'guest (no wallet)'}
                    </span>
                  )}
                  {/*
                    Persistent claim affordance (`docs/guest-signing-plan.md` Task 6) - any
                    step, as soon as the doc exists and is still guest-owned. Same modal/state
                    as the more prominent free-complete CTA below.
                  */}
                  {role === 'creator' && doc?.source.authMode === 'guest' && (
                    <button
                      type="button"
                      className="btn btn-ghost journey-claim-pill"
                      onClick={openClaimModal}
                    >
                      <Wallet size={13} strokeWidth={2.25} aria-hidden />
                      Save to wallet
                    </button>
                  )}
                  {role === 'signer' && (
                    <span className="journey-role-pill">
                      {account ? `Signing as ${account.shortAddress}` : 'Signing'}
                    </span>
                  )}
                  {role === 'verifier' && (
                    <span className="journey-role-pill">Verifier mode</span>
                  )}
                </div>
                {canCancelCurrent && (
                  <button
                    type="button"
                    className={`btn btn-ghost journey-toolbar-cancel${busy || cancelBusy ? ' btn--busy' : ''}`}
                    disabled={busy || cancelBusy}
                    onClick={requestCancelCurrentAgreement}
                  >
                    {cancelBusy ? (
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
              <div>
                <p className="action-kicker">
                  {step === 'seal' &&
                  doc &&
                  !doc.directSeal &&
                  allSigned(doc) &&
                  !doc.sealed &&
                  !creatorChoseLock
                    ? 'Complete'
                    : step === 'done' && role === 'creator'
                      ? 'Complete'
                      : inviteWaitingView && activeStage && stepIndex >= 0
                        ? `Step ${stepIndex + 1} of ${pathStages.length} · ${activeStage.label} · waiting`
                        : inviteManageView && activeStage && stepIndex >= 0
                          ? `Step ${stepIndex + 1} of ${pathStages.length} · ${activeStage.label} · invites`
                          : activeStage && stepIndex >= 0
                            ? `Step ${stepIndex + 1} of ${pathStages.length} · ${activeStage.label}`
                            : 'Action'}
                </p>
                <h3>
                  {step === 'seal' &&
                  doc &&
                  !doc.directSeal &&
                  allSigned(doc) &&
                  !doc.sealed &&
                  !creatorChoseLock
                    ? 'Document complete'
                    : step === 'done' && role === 'signer'
                      ? doc?.sealed
                        ? 'Agreement locked - your part is done'
                        : doc && allSigned(doc)
                          ? 'Signing complete'
                          : (activeStage?.verb ?? 'Your signature is recorded')
                      : step === 'done' && role === 'creator'
                        ? 'Agreement locked'
                        : role === 'verifier' && verifyMatched
                          ? verifyOutcome.kind === 'match' &&
                            verifyOutcome.matches.some(m => m.status === 'locked')
                            ? 'Match confirmed - locked on Nimiq'
                            : 'Fingerprint matches'
                          : inviteWaitingView
                            ? 'Waiting for co-signers'
                            : inviteManageView
                              ? 'Invite co-signers'
                              : activeStage?.verb ?? 'Continue'}
                </h3>
                <p className="muted action-blurb">
                  {step === 'seal' &&
                  doc &&
                  !doc.directSeal &&
                  allSigned(doc) &&
                  !doc.sealed &&
                  !creatorChoseLock
                    ? 'All signatures are in. Print a signed copy anytime, or lock on the blockchain for permanent proof.'
                    : step === 'done' && role === 'signer'
                      ? doc?.sealed
                        ? 'Your signature is on this agreement. Review parties and recorded ink below. Drop the same file you signed to see the field layout (the PDF never left anyone’s device).'
                        : doc && allSigned(doc)
                          ? 'Everyone has signed. Review the record below, then print a signed copy with the same local file. Locking on the blockchain is optional and does not block print.'
                          : 'Your fields and wallet signature are recorded. Review them below while other parties finish.'
                      : step === 'done' && role === 'creator'
                        ? 'Keep your file. Drop a copy below anytime to verify the fingerprint.'
                        : role === 'verifier' && verifyMatched
                          ? verifyPartyView
                            ? 'Your local file matches. Because you are a party, names and recorded ink are available below.'
                            : 'Your local file matches a VeriLock record. Public lock details are below - names and signatures stay anonymous unless you are an original party.'
                          : inviteWaitingView
                            ? 'Progress updates here as people sign. When everyone is done, print anytime or lock on the blockchain for permanent proof.'
                            : inviteManageView
                              ? 'Send each person a personal link (and the same document file separately - VeriLock never hosts it). When you are finished inviting, return to the waiting view.'
                              : activeStage?.blurb}
                </p>
              </div>
              {activeStage &&
                !inviteWaitingView &&
                !inviteManageView &&
                !(step === 'done' && role === 'creator') && (
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
            {inviteLinkInvalid && !displayError && (
              <div className="result-banner result-banner--bad" role="alert">
                {inviteLinkInvalid} You can still open the agreement with a valid personal link
                from a newer invite email, or ask the organizer to resend.
              </div>
            )}
            {/* Invite dock already explains post-sign state - hide lock flash clutter. */}
            {lockMessage &&
              !displayError &&
              !inviteLinkInvalid &&
              !(step === 'seal' && busy && creditBalance >= 1) &&
              // Free-complete dock already states print/lock options - hide lock-first flash.
              !(
                step === 'seal' &&
                doc &&
                !doc.directSeal &&
                allSigned(doc) &&
                !doc.sealed &&
                !creatorChoseLock
              ) &&
              !creatorInviteDock && (
              <div className="result-banner result-banner--ok" role="status">
                {lockMessage}
              </div>
            )}

            <div className="action-dock-body">
              {step === 'fingerprint' && (
                <div className="action-stack">
                  <header className="signatures-config-head">
                    <h3>Add the document</h3>
                    <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                      No signing on this step. Accepts {DOCUMENT_FORMATS_LABEL}. Fingerprint the
                      file locally, then name people and place their fields on the next screen. You
                      can organize without being a signer.
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
                        <strong>Drop a document</strong> or <strong>Browse files</strong>. The file
                        is opened in your browser only - never sent to VeriLock servers.
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
                          ? '123 Main St - 12-month lease'
                          : docType === 'nda'
                            ? 'Project Falcon - mutual NDA'
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
                      Shown on invite emails (“Alex has requested you sign…”).
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
                        Visible to signers. Do not paste sensitive information or the full contract.
                      </span>
                    </label>
                  )}
                  {/* Turnstile bot check for guest create — rendered only when server has it configured. */}
                  {FEATURES.guestSigning && !account && turnstileSiteKey && (
                    <div className="turnstile-field">
                      <div ref={turnstileHostRef} />
                      {!turnstileReady && (
                        <p className="muted turnstile-loading">Loading bot check…</p>
                      )}
                    </div>
                  )}
                  {/*
                    Dual CTA (`docs/guest-signing-plan.md` Task 3 / locked decision): guests get
                    a free "no wallet" primary path here, demoting wallet login to secondary.
                    Direct seal doesn't apply to this create call - it always sends
                    `requiredSignatures: 1`; direct seal (0 signatures) is chosen later in Setup
                    and stays wallet-only by design (out of scope for this task to enforce
                    client-side - that's the roster/cosigner endpoints' job in a later task).
                    When the flag is off, or once a wallet is connected, this renders identically
                    to the pre-guest-signing markup (else-branch below is a verbatim copy).
                  */}
                  {FEATURES.guestSigning && !account ? (
                    <>
                      {loginNeedsSheet && loginSheetOpen ? (
                        <LoginSheet
                          open
                          connectMode={connectMode}
                          connecting={connecting}
                          walletStatus={walletStatus}
                          error={walletError}
                          showOpenInPay={showOpenInPay}
                          onClose={() => setLoginSheetOpen(false)}
                          onProceed={connectFromPath}
                          onSession={applySession}
                          placement="inline"
                        />
                      ) : (
                        <button
                          type="button"
                          className={`btn btn-primary btn-lg${connecting ? ' btn--busy' : ''}`}
                          disabled={busy || connecting}
                          onClick={requestLogin}
                        >
                          {connecting ? (
                            <>
                              <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                              {journeyLoginEntryLabels().busy}
                            </>
                          ) : (
                            <>
                              <NimiqHexagonIcon size={18} />
                              Login with Nimiq
                            </>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`btn btn-ghost${busy ? ' btn--busy' : ''}`}
                        disabled={!pdfFile || !pdfHash || busy}
                        onClick={() => void createGuestDoc()}
                      >
                        {busy ? (
                          <>
                            <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} />
                            Creating…
                          </>
                        ) : (
                          <>
                            <Fingerprint size={16} strokeWidth={2.25} />
                            Continue as Guest
                          </>
                        )}
                      </button>
                      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                        No account needed. Save your document key after creating so you can get
                        back in later.
                      </p>
                    </>
                  ) : (
                    <>
                      {!account && loginNeedsSheet && loginSheetOpen ? (
                        <LoginSheet
                          open
                          connectMode={connectMode}
                          connecting={connecting}
                          walletStatus={walletStatus}
                          error={walletError}
                          showOpenInPay={showOpenInPay}
                          onClose={() => setLoginSheetOpen(false)}
                          onProceed={connectFromPath}
                          onSession={applySession}
                          placement="inline"
                        />
                      ) : (
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
                      )}
                      {!account && (
                        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                          Login with Nimiq when you are ready to register the fingerprint. Your
                          file never leaves this device.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {step === 'share' && doc && (
                <div className="action-stack">
                  {/*
                    Setup design UI. Once invites/waiting take over (organizer-only stays
                    on step 2), hide the PDF stage so “Waiting for co-signers” is not buried
                    under a locked layout preview. Re-open stays available until first sign.
                  */}
                  {canReopenPlacements && (
                    <div className="journey-setup-continue journey-setup-continue--top">
                      <button
                        type="button"
                        className={`btn btn-secondary${placementLockBusy ? ' btn--busy' : ''}`}
                        disabled={busy || !creatorOnlyEffectiveToken || placementLockBusy}
                        onClick={() => void unlockPlacements()}
                      >
                        {placementLockBusy ? (
                          <>
                            <LoaderCircle
                              className="btn-spinner"
                              size={16}
                              strokeWidth={2.5}
                            />
                            Re-opening…
                          </>
                        ) : (
                          'Back to edit placements'
                        )}
                      </button>
                    </div>
                  )}

                  {showSetupPlacementEditor && constructionPlan && (
                    <section className="journey-pdf-editor" aria-labelledby="setup-pdf-title">
                      <header className="signatures-config-head">
                        <h3 id="setup-pdf-title">
                          {constructionPlan.status === 'locked'
                            ? 'Field layout'
                            : 'Design the document'}
                        </h3>
                        {constructionPlan.status !== 'locked' ? (
                          <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                            Layout design only - place empty signature, initial, and name boxes for each
                            person. You are not signing yet; that happens in the next step.
                          </p>
                        ) : (
                          <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                            Field positions are set. Signing and invites come next (or go back to
                            edit placements first if no one has signed yet).
                          </p>
                        )}
                      </header>
                      <PlacementEditor
                        file={(pdfFile ?? signFile)!}
                        plan={constructionPlan}
                        onChange={next => {
                          setConstructionPlan(next)
                          setRequiredSigners(Math.max(1, Math.min(10, next.people.length)))
                        }}
                        disabled={busy || !effectiveToken}
                        lockBusy={placementLockBusy}
                      />
                      {constructionPlan.status !== 'locked' && (
                        <div className="journey-setup-continue">
                          {/*
                            Disabled <button> does not receive clicks. When blocked, pass
                            pointer events through so the wrap can flash the warning.
                          */}
                          <span
                            className={
                              setupContinueDisabled && setupContinueBlockedHint
                                ? 'journey-setup-continue-cta journey-setup-continue-cta--blocked'
                                : 'journey-setup-continue-cta'
                            }
                            onClick={
                              setupContinueDisabled && setupContinueBlockedHint
                                ? () => flashSetupContinueBlocked()
                                : undefined
                            }
                          >
                            <button
                              type="button"
                              className={`btn btn-primary btn-lg${placementLockBusy ? ' btn--busy' : ''}`}
                              disabled={setupContinueDisabled}
                              title={setupContinueBlockedHint ?? undefined}
                              aria-describedby={
                                setupContinueBlockedHint
                                  ? 'setup-continue-blocked-hint'
                                  : undefined
                              }
                              onClick={() => void lockPlacements()}
                            >
                              {placementLockBusy ? (
                                <>
                                  <LoaderCircle
                                    className="btn-spinner"
                                    size={18}
                                    strokeWidth={2.5}
                                  />
                                  Saving layout…
                                </>
                              ) : (
                                'Continue'
                              )}
                            </button>
                          </span>
                          {setupContinueBlockedHint ? (
                            <p
                              key={setupContinueFlashToken || 'setup-continue-hint'}
                              id="setup-continue-blocked-hint"
                              className={
                                setupContinueFlashToken > 0
                                  ? 'journey-setup-continue-blocked is-flash'
                                  : 'journey-setup-continue-blocked'
                              }
                              role="status"
                            >
                              {setupContinueBlockedHint}
                            </p>
                          ) : (
                            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                              Saves the field layout and moves on - still no signatures collected
                              here. You can come back to edit until someone signs.
                            </p>
                          )}
                        </div>
                      )}
                      {placementStatus && (
                        <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.8rem' }}>
                          {placementStatus}
                        </p>
                      )}
                    </section>
                  )}

                  {/* Status while re-opening from invite dock (editor is unmounted). */}
                  {canReopenPlacements && creatorInviteDock && placementStatus ? (
                    <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                      {placementStatus}
                    </p>
                  ) : null}

                  {FEATURES.pdfAnnotationUi && !pdfFile && !signFile && (
                    <section className="journey-pdf-editor">
                      <p className="muted" style={{ margin: 0 }}>
                        Re-open the same document to set up signature lines (bytes stay local).
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
                                err instanceof Error ? err.message : 'Could not read document',
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
                      {/**
                       * No empty party roster / 0-of-N progress on Sign before anyone has signed.
                       * Creator multi-party progress lives in the invite/waiting dock after
                       * their own signature; Lock / Done steps already list parties + ink.
                       * Solo still gets a quiet doc title above the pad.
                       */}
                      {!inviteWaitingView && requiredCount(doc) <= 1 && !allSigned(doc) && (
                        <p className="solo-sign-doc-title muted">{doc.title}</p>
                      )}

                      {allSigned(doc) ? (
                        <div className="result-banner result-banner--ok">
                          <Check size={18} strokeWidth={2.5} />
                          {role === 'creator'
                            ? requiredCount(doc) <= 1
                              ? 'Document complete. Print a signed copy anytime, or lock on the blockchain for permanent proof.'
                              : 'Document complete - all signatures are in. Print a signed copy anytime, or lock on the blockchain for permanent proof.'
                            : 'Everyone has signed. You can print a signed copy with the same local file you used.'}
                        </div>
                      ) : (
                        <>
                          {!account &&
                            !activeGuestSession &&
                            (loginNeedsSheet && loginSheetOpen ? (
                              <LoginSheet
                                open
                                connectMode={connectMode}
                                connecting={connecting}
                                walletStatus={walletStatus}
                                error={walletError}
                                showOpenInPay={showOpenInPay}
                                onClose={() => setLoginSheetOpen(false)}
                                onProceed={connectFromPath}
                                onSession={applySession}
                                placement="inline"
                              />
                            ) : (
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
                            ))}

                          {(account || activeGuestSession) &&
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
                                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
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

                          {/* Creator invite/wait dock already shows party status - skip duplicate banner. */}
                          {(account || activeGuestSession) &&
                            signingResolution &&
                            !signingResolution.ok &&
                            signingResolution.hint !== 'pick_person' &&
                            !(
                              creatorInviteDock &&
                              (signingResolution.hint === 'already_signed' ||
                                signingResolution.hint === 'complete')
                            ) && (
                            <div className="result-banner result-banner--ok">
                              {signingResolution.message}
                            </div>
                          )}

                          {(account || activeGuestSession) && signingResolution?.ok && pendingParty && (
                            <>
                              {/* Multi only: solo already has identity from the wallet pill + PDF. */}
                              {requiredCount(doc) > 1 && (
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
                                    {account ? account.shortAddress : 'guest (no wallet)'}
                                    {pendingParty.walletAddress
                                      ? ' · wallet required for this person'
                                      : ''}
                                  </span>
                                </div>
                              )}

                              {/*
                                Invitees / return visits need the drop zone. Same-session self-sign
                                already carries the fingerprinted file — do not show a redundant
                                has-file / fingerprinted card above the pad / page fields.
                              */}
                              {!hasVerifiedLocalPdf && (
                                <DocumentStage
                                  step={step}
                                  doc={doc}
                                  file={signFile ?? null}
                                  onFileChange={setSignFile}
                                  accepting
                                  localCopyRequired
                                  localCopyMatches={!signFile ? null : signFileMatches}
                                />
                              )}

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
                                    ? constructionPlan.slots.filter(s => {
                                        if (s.personSlotIndex !== personSlot) return false
                                        if (
                                          s.kind === 'signature' ||
                                          s.kind === 'initial' ||
                                          s.kind === 'name' ||
                                          s.kind === 'text'
                                        ) {
                                          return true
                                        }
                                        // Empty check/X for this person (not creator pre-checked)
                                        if (
                                          s.kind === 'checkmark' ||
                                          s.kind === 'cross'
                                        ) {
                                          return s.lockedContent?.mark !== s.kind
                                        }
                                        return false
                                      })
                                    : []
                                const pageFieldsRequired =
                                  FEATURES.pdfAnnotationUi &&
                                  constructionPlan?.status === 'locked' &&
                                  myFillableSlots.length > 0
                                const pageFieldsDone =
                                  pageFieldsConfirmed ||
                                  (myFillableSlots.length > 0 &&
                                    myFillableSlots.every(s => filledSlotIds.has(s.id)))
                                const canPartySubmit =
                                  hasVerifiedLocalPdf &&
                                  planLoadState !== 'loading' &&
                                  (!pageFieldsRequired || pageFieldsDone)
                                const isMultiParty = requiredCount(doc) > 1
                                const resolvedName = resolveSignDisplayName(
                                  signingResolution.party,
                                  signerName,
                                  creatorName,
                                )
                                const needsNameField =
                                  partyNeedsSignerName(signingResolution.party) &&
                                  !resolvedName
                                // After on-doc fields + ink, party sign runs automatically (solo + multi).
                                const autoRecording =
                                  pageFieldsRequired &&
                                  pageFieldsDone &&
                                  Boolean(sigBlob) &&
                                  !needsNameField &&
                                  (busy || fillBusy)

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
                                    authToken={token}
                                    documentId={doc.id}
                                    solo={requiredCount(doc) <= 1}
                                  />
                                )}

                              {canPartySubmit && autoRecording && (
                                <div className="result-banner result-banner--ok">
                                  <LoaderCircle
                                    className="btn-spinner"
                                    size={16}
                                    strokeWidth={2.5}
                                  />
                                  Recording your signature…
                                </div>
                              )}

                              {/* Party submit only when auto-sign cannot run (no ink, need name, or failed). */}
                              {canPartySubmit && !autoRecording && (
                                <>
                                  {pageFieldsDone && pageFieldsRequired && (
                                    <div className="result-banner result-banner--ok">
                                      <Check size={16} strokeWidth={2.5} />
                                      {needsNameField
                                        ? 'Page fields saved. Enter your name, then submit to record your signature.'
                                        : !sigBlob
                                          ? 'Page fields saved. Draw your signature below, then submit.'
                                          : 'Page fields saved. Submit to record your signature on this agreement.'}
                                    </div>
                                  )}

                                  {partyNeedsSignerName(signingResolution.party) &&
                                    !resolvedName && (
                                    <label className="field">
                                      <span className="field-label">Your name</span>
                                      <input
                                        value={signerName}
                                        onChange={e => setSignerName(e.target.value)}
                                        placeholder={`Name for ${formatPartyRole(signingResolution.party.role)}`}
                                      />
                                    </label>
                                  )}

                                  {/* Free pad only when ink was not captured on the document */}
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
                                        Signature from your phone. Submit below to record it.
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
                                      Using the signature you drew on the document - no need to draw
                                      again.
                                    </p>
                                  )}

                                  {FEATURES.signOnMobile && token && (
                                    <SignOnMobileModal
                                      open={signOnMobileOpen}
                                      token={token}
                                      documentId={doc.id}
                                      onClose={() => setSignOnMobileOpen(false)}
                                      onSignature={result => {
                                        // Party signature image: host synthesizes PNG from vectors if needed.
                                        void (async () => {
                                          let blob = result.blob
                                          if (!blob && result.imageDataUrl) {
                                            try {
                                              blob = await (await fetch(result.imageDataUrl)).blob()
                                            } catch {
                                              blob = null
                                            }
                                          }
                                          if (!blob && result.path?.strokes?.length) {
                                            try {
                                              const { pathToPngDataUrl } = await import(
                                                '../signatureHandoff/crypto'
                                              )
                                              const url = pathToPngDataUrl(result.path)
                                              blob = await (await fetch(url)).blob()
                                            } catch {
                                              blob = null
                                            }
                                          }
                                          if (blob) {
                                            setSigBlob(blob)
                                            if (mobileSigPreview) {
                                              URL.revokeObjectURL(mobileSigPreview)
                                            }
                                            setMobileSigPreview(URL.createObjectURL(blob))
                                          }
                                          setSignOnMobileOpen(false)
                                        })()
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
                                        !resolvedName) ||
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
                                        Submitting…
                                      </>
                                    ) : (
                                      'Submit'
                                    )}
                                  </button>
                                  <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                                    {isMultiParty
                                      ? role === 'creator'
                                        ? 'Records your signature, then you can invite co-signers.'
                                        : 'Records you as this party on the agreement.'
                                      : 'Records you as the signer. Next you can lock on the blockchain.'}
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

              {/* Invite co-signers: Setup (organizer-only) or Sign (after creator signed). */}
              {doc && creatorInviteDock && (
                <div className="action-stack">
                  {/* Waiting room - slim progress only (no PartyList / placement people chrome). */}
                  {inviteWaitingView ? (
                    <section
                      className="invite-waiting"
                      aria-label="Waiting for co-signers"
                    >
                      {notifyEmailSavedValue && notifyEmailSavedValue.trim() !== '' ? (
                        <p className="invite-waiting-notify" role="status">
                          <MailCheck size={16} strokeWidth={2.25} aria-hidden />
                          <span>
                            We&apos;ll email <strong>{notifyEmailSavedValue}</strong> when the
                            last signature lands. You can still return anytime to check progress.
                          </span>
                        </p>
                      ) : (
                        <p className="invite-waiting-notify invite-waiting-notify--muted">
                          Live updates as people sign - leave the tab open or come back later.
                          When everyone has signed, continue to lock on the blockchain.
                        </p>
                      )}

                      {/* Slim count only - no PartyList / placement people chrome while waiting. */}
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
                              width: `${
                                requiredCount(doc)
                                  ? (signedCount(doc) / requiredCount(doc)) * 100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>

                      {(() => {
                        const pending = doc.parties.filter(p => p.required && !p.signed).length
                        const lastInvite = Object.values(inviteEmailSent)
                          .map(r => r.sentAt)
                          .sort((a, b) => b - a)[0]
                        const ago = lastInvite
                          ? Math.max(0, Math.round((Date.now() - lastInvite) / 60000))
                          : null
                        return (
                          <p className="muted invite-waiting-status">
                            {pending > 0
                              ? `${pending} signer${pending === 1 ? '' : 's'} still need to sign.`
                              : 'All signers have signed.'}
                            {lastInvite
                              ? ` Last invite sent ${
                                  ago === 0 ? 'just now' : `${ago}m ago`
                                }.`
                              : ''}
                          </p>
                        )
                      })()}

                      <div className="invite-waiting-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={reopenInviteSetup}
                        >
                          Manage invites
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={reopenInviteSetup}
                        >
                          Resend invites
                        </button>
                        {onHome ? (
                          <button type="button" className="btn btn-ghost" onClick={onHome}>
                            Back to home
                          </button>
                        ) : null}
                      </div>
                      <p className="muted invite-waiting-foot">
                        Need to resend a link? Use <strong>Manage invites</strong> (same step -
                        only this panel changes). Co-signers need the link <em>and</em> the same
                        document file.
                      </p>
                    </section>
                  ) : (
                  <section className="signatures-config" aria-labelledby="signatures-config-title">
                    <header className="signatures-config-head">
                      {inviteWaitingVisited ? (
                        <button
                          type="button"
                          className="btn btn-ghost invite-manage-back"
                          onClick={acknowledgeShare}
                        >
                          <ArrowLeft size={14} strokeWidth={2.25} aria-hidden />
                          Back to waiting view
                        </button>
                      ) : null}
                      <h3 id="signatures-config-title">Send invites</h3>
                      <p className="signatures-config-sub">
                        {step === 'sign'
                          ? 'Your signature is already recorded. Use the cards below for each person who still needs to sign.'
                          : 'Use the cards below for each person who needs to sign.'}
                      </p>
                    </header>

                    {/* Progress + who still needs to sign (after creator signed, or organizer-only). */}
                    {(requiredCount(doc) > 1 || inviteeSlotCount > 0) && (
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
                        <PartyList
                          doc={doc}
                          revealNames={revealParticipantPrivate}
                          inviteEmailByPartyId={inviteEmailSent}
                        />
                      </>
                    )}

                    {role === 'creator' && !doc.sealed && (
                      <div className="signatures-config-form">
                        {/**
                         * Roster count is set on Setup (placement lock) - do not re-ask here.
                         * Only allow changing count before anyone has signed and before the plan
                         * is locked (legacy / edge cases without a frozen layout).
                         */}
                        {!(
                          FEATURES.pdfAnnotationUi && constructionPlan?.status === 'locked'
                        ) &&
                          signedCount(doc) === 0 && (
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
                                })
                                if (n <= 1) {
                                  setNotifyEmailSavedValue(null)
                                  setNotifyEmailError(null)
                                  setNotifyEmailFlashSaved(false)
                                  // Clear server-side ready-to-seal notify (no longer multi-party).
                                  if (FEATURES.emailNotifyUi && token && doc) {
                                    void api
                                      .setDocumentNotifyEmail(token, doc.id, null)
                                      .catch(() => {
                                        /* non-fatal */
                                      })
                                  }
                                }
                              }}
                              disabled={busy}
                            >
                              {Array.from({ length: 10 }, (_, i) => i + 1)
                                .filter(n => n >= Math.max(1, signedCount(doc)))
                                .map(n => (
                                  <option key={n} value={n}>
                                    {n === 1
                                      ? '1 signature (you only - no co-signers)'
                                      : `${n} signatures (you + ${n - 1} other${n - 1 === 1 ? '' : 's'})`}
                                  </option>
                                ))}
                            </select>
                          </label>
                          )}

                        {/*
                          One card per person who still needs to sign: email + Send email +
                          Copy invite link. Not gated on construction-plan lock - that old
                          gate left a dead “Invite detail / Mail app only” form after Setup.
                        */}
                        {doc.parties.filter(p => p.required && !p.signed).length > 0 && (
                          <div className="field-stack">
                            <span className="field-label">
                              {(() => {
                                const c = doc.parties.filter(p => p.required && !p.signed).length
                                return c === 1 ? 'Invite signer' : `Invite ${c} signers`
                              })()}
                            </span>
                            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                              Send email for a private personal link. Or share the general
                              link for slots that are not email-invited. Hand off the PDF
                              file separately, VeriLock never hosts it.
                            </p>
                            {(() => {
                              const base = doc.shareUrl.startsWith('http')
                                ? doc.shareUrl
                                : `${typeof window !== 'undefined' ? window.location.origin : ''}${doc.shareUrl.startsWith('/') ? '' : '/'}${doc.shareUrl}`
                              return (
                                <div className="field-stack share-cosigner-fields">
                                  <code className="share-cosigner-link mono">{base}</code>
                                  <div className="share-cosigner-actions">
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      disabled={busy}
                                      onClick={() =>
                                        void copyText(base, undefined, 'your co-signer')
                                      }
                                    >
                                      <Copy size={16} strokeWidth={2.25} aria-hidden />
                                      Copy general link
                                    </button>
                                    {typeof navigator !== 'undefined' &&
                                      typeof navigator.share === 'function' && (
                                        <button
                                          type="button"
                                          className="btn btn-secondary"
                                          disabled={busy}
                                          onClick={() =>
                                            void sharePersonInvite({
                                              partyId: '_doc',
                                              personName: 'co-signer',
                                              personLink: base,
                                            })
                                          }
                                        >
                                          <Share2 size={16} strokeWidth={2.25} aria-hidden />
                                          Share
                                        </button>
                                      )}
                                  </div>
                                </div>
                              )
                            })()}
                            {doc.parties
                              .filter(p => p.required && !p.signed)
                              .map((p, index) => {
                                const label =
                                  p.displayName?.trim() ||
                                  p.roleLabel ||
                                  `Person ${index + 1}`
                                const emailed = inviteEmailSent[p.id]
                                const emailVal =
                                  partyInviteEmails[p.id] ??
                                  coSignerEmails[index] ??
                                  emailed?.email ??
                                  p.inviteEmail ??
                                  ''
                                const sending = inviteSendBusyId === p.id
                                const note = inviteSendNote[p.id]
                                /** Minted personal link invite (Task 5 "Create invite link"). */
                                const linkInvite = partyLinkInvites[p.id]
                                const linkBusy = linkInviteBusyId === p.id
                                const mintLinkInvite = () => {
                                  if (!creatorOnlyEffectiveToken || !doc) return
                                  if (emailed) {
                                    const ok = window.confirm(
                                      `Creating a link will replace the emailed invite for ${label}. Continue?`,
                                    )
                                    if (!ok) return
                                  }
                                  setLinkInviteBusyId(p.id)
                                  setLocalError(null)
                                  void api
                                    .mintPartyInvite(creatorOnlyEffectiveToken, doc.id, {
                                      partyId: p.id,
                                    })
                                    .then(res => {
                                      setPartyLinkInvites(prev => ({
                                        ...prev,
                                        [p.id]: { url: res.inviteUrl, expiresAt: res.expiresAt },
                                      }))
                                      // Server-side rotation revokes any active email invite for
                                      // this party (Task 5a) - refresh from the server so the
                                      // "Invite sent" badge doesn't keep showing a dead link.
                                      void api
                                        .getDocument(doc.slug, creatorOnlyEffectiveToken)
                                        .then(({ document }) =>
                                          setActiveFromSeal(document, doc.fileSize),
                                        )
                                        .catch(() => {
                                          /* keep local state; next poll reconciles */
                                        })
                                    })
                                    .catch(err => {
                                      setLocalError(
                                        err instanceof Error
                                          ? err.message
                                          : 'Could not create invite link',
                                      )
                                    })
                                    .finally(() => setLinkInviteBusyId(null))
                                }
                                const setPartyEmail = (value: string) => {
                                  setPartyInviteEmails(prev => ({ ...prev, [p.id]: value }))
                                  // Keep legacy array in sync for count-picker edge paths.
                                  setCoSignerEmails(prev => {
                                    const next = [...prev]
                                    while (next.length <= index) next.push('')
                                    next[index] = value
                                    return next
                                  })
                                }
                                return (
                                  <div
                                    key={p.id}
                                    className={[
                                      'field-stack share-cosigner-fields',
                                      emailed ? 'share-cosigner-fields--invited' : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' ')}
                                  >
                                    <div className="share-cosigner-head">
                                      <div className="share-cosigner-title">
                                        {label}
                                        {p.signed ? (
                                          <span className="muted share-cosigner-title-meta">
                                            {' '}
                                            · signed
                                          </span>
                                        ) : null}
                                      </div>
                                      {emailed && !p.signed ? (
                                        <span
                                          className="share-cosigner-sent-badge"
                                          title={`Invite email sent to ${emailed.email}`}
                                        >
                                          <MailCheck size={13} strokeWidth={2.5} aria-hidden />
                                          Invite sent
                                        </span>
                                      ) : null}
                                    </div>
                                    {emailed && !p.signed ? (
                                      <p className="share-cosigner-sent-detail" role="status">
                                        Sent to <strong>{emailed.email}</strong>
                                        {note &&
                                        !note.startsWith('Invite sent') &&
                                        !note.startsWith('Invite resent')
                                          ? ` · ${note}`
                                          : null}
                                        .{' '}
                                        <details style={{ display: 'inline', fontSize: '0.78rem' }}>
                                          <summary style={{ display: 'inline', cursor: 'pointer', color: '#64748b' }}>
                                            More info
                                          </summary>
                                          <span style={{ color: '#64748b' }}>
                                            Their personal signing link is only in that email.
                                            Resending (including to a different address) replaces the
                                            link — the previous email link stops working.
                                          </span>
                                        </details>
                                      </p>
                                    ) : null}
                                    {note &&
                                    (note.startsWith('Invite sent') ||
                                      note.startsWith('Invite resent')) ? (
                                      <p className="share-cosigner-note" role="status">
                                        {note}
                                      </p>
                                    ) : null}
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
                                          setPartyEmail(
                                            clampField(
                                              e.target.value,
                                              MAX_SUPPORT_EMAIL_LENGTH,
                                            ),
                                          )
                                        }}
                                        maxLength={MAX_SUPPORT_EMAIL_LENGTH}
                                        placeholder="name@company.com"
                                        disabled={busy || p.signed || sending}
                                      />
                                    </label>
                                    <div className="share-cosigner-actions">
                                      <button
                                        type="button"
                                        className={`btn ${emailed ? 'btn-secondary' : 'btn-primary'}${sending ? ' btn--busy' : ''}`}
                                        disabled={
                                          busy ||
                                          p.signed ||
                                          sending ||
                                          !creatorOnlyEffectiveToken ||
                                          !emailVal.trim() ||
                                          !emailSendEnabled
                                        }
                                        title={
                                          !emailSendEnabled
                                            ? 'Invite email is off until Resend is enabled on the server'
                                            : emailed
                                              ? `Resend invite to ${emailVal.trim() || emailed.email}`
                                              : undefined
                                        }
                                        onClick={() => {
                                          if (!creatorOnlyEffectiveToken || !doc) return
                                          const to = emailVal.trim()
                                          if (!to) return
                                          // Confirm before replacing an active invite link -
                                          // either a previous email invite, or (Task 5) a
                                          // "Create invite link" link invite for this party.
                                          if (emailed) {
                                            const ok = window.confirm(
                                              `This will invalidate the previous invite link for ${label}. Continue?`,
                                            )
                                            if (!ok) return
                                          } else if (linkInvite) {
                                            const ok = window.confirm(
                                              `Sending an email invite will replace the invite link you created for ${label}. Continue?`,
                                            )
                                            if (!ok) return
                                          }
                                          setInviteSendBusyId(p.id)
                                          setInviteSendNote(prev => {
                                            const next = { ...prev }
                                            delete next[p.id]
                                            return next
                                          })
                                          setLocalError(null)
                                          void api
                                            .sendPartyInviteEmail(creatorOnlyEffectiveToken, doc.id, {
                                              partyId: p.id,
                                              to,
                                            })
                                            .then(res => {
                                              markInviteEmailSent(
                                                doc.id,
                                                p.id,
                                                res.to || to,
                                                res.inviteSentAt,
                                              )
                                              // Server-side rotation revokes the link invite too
                                              // (Task 5a) - drop the now-dead URL from local state.
                                              setPartyLinkInvites(prev => {
                                                if (!(p.id in prev)) return prev
                                                const nextLinks = { ...prev }
                                                delete nextLinks[p.id]
                                                return nextLinks
                                              })
                                              const sentTo = res.to || to
                                              const prev = res.previousEmail?.trim()
                                              const rotated =
                                                (res.previousLinksRevoked ?? 0) > 0
                                              const note =
                                                rotated && prev && prev.toLowerCase() !== sentTo.toLowerCase()
                                                  ? `Invite sent to ${sentTo}. Previous link for ${prev} is no longer valid.`
                                                  : rotated
                                                    ? `Invite resent to ${sentTo}. The previous personal link no longer works.`
                                                    : `Invite sent to ${sentTo}`
                                              setInviteSendNote(prevNotes => ({
                                                ...prevNotes,
                                                [p.id]: note,
                                              }))
                                              showInviteHandoffHelp(label, 'email')
                                              // Refresh so party.inviteEmail is server-backed.
                                              void api
                                                .getDocument(doc.slug, token)
                                                .then(({ document }) =>
                                                  setActiveFromSeal(document, doc.fileSize),
                                                )
                                                .catch(() => {
                                                  /* keep local badge */
                                                })
                                            })
                                            .catch(err => {
                                              const status =
                                                err && typeof err === 'object' && 'status' in err
                                                  ? Number((err as { status?: number }).status)
                                                  : 0
                                              let message = err instanceof Error ? err.message : 'Could not send invite email'
                                              if (status === 429) {
                                                message = 'Too many invites sent. Please wait a minute and try again.'
                                              } else if (status === 503) {
                                                message = 'Email service is temporarily unavailable. Try again in a moment.'
                                              } else if (status === 502) {
                                                message = 'Email provider error. Try again or check the recipient address.'
                                              }
                                              setLocalError(message)
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
                                        ) : emailed ? (
                                          'Resend email'
                                        ) : (
                                          'Send email'
                                        )}
                                      </button>
                                    </div>
                                    {!emailSendEnabled && (
                                      <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
                                        Email send is disabled until Resend is configured on the
                                        server. You can still copy the open document link above.
                                      </p>
                                    )}
                                    {note && !emailed ? (
                                      <p className="share-cosigner-note" role="status">
                                        {note}
                                      </p>
                                    ) : null}
                                    {/*
                                      Guest-signing link invite (`docs/guest-signing-plan.md`
                                      Task 5) - alongside, not replacing, the email option above.
                                      Mutual exclusion with the email invite is by rotation
                                      (server-side) + confirm prompts on both buttons, not by
                                      disabling either one outright.
                                    */}
                                    {FEATURES.guestSigning && !p.signed && (
                                      <div className="field-stack" style={{ marginTop: '0.35rem' }}>
                                        <span className="field-label">Or create an invite link</span>
                                        <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
                                          No wallet needed — the person opens this link and signs
                                          without connecting a wallet.
                                          {emailed
                                            ? ' Creating a link will replace the emailed invite.'
                                            : ''}
                                        </p>
                                        {linkInvite ? (
                                          <>
                                            <code className="share-cosigner-link mono">
                                              {linkInvite.url}
                                            </code>
                                            <div className="share-cosigner-actions">
                                              <button
                                                type="button"
                                                className="btn btn-secondary"
                                                disabled={busy || linkBusy}
                                                onClick={() =>
                                                  void copyText(linkInvite.url, p.id, label)
                                                }
                                              >
                                                <Copy size={16} strokeWidth={2.25} aria-hidden />
                                                Copy link
                                              </button>
                                              {typeof navigator !== 'undefined' &&
                                                typeof navigator.share === 'function' && (
                                                  <button
                                                    type="button"
                                                    className="btn btn-secondary"
                                                    disabled={busy || linkBusy}
                                                    onClick={() =>
                                                      void sharePersonInvite({
                                                        partyId: p.id,
                                                        personName: label,
                                                        personLink: linkInvite.url,
                                                      })
                                                    }
                                                  >
                                                    <Share2 size={16} strokeWidth={2.25} aria-hidden />
                                                    Share
                                                  </button>
                                                )}
                                              <button
                                                type="button"
                                                className={`btn btn-ghost${linkBusy ? ' btn--busy' : ''}`}
                                                disabled={busy || linkBusy || !creatorOnlyEffectiveToken}
                                                title={`This will invalidate the previous invite link for ${label}.`}
                                                onClick={mintLinkInvite}
                                              >
                                                {linkBusy ? (
                                                  <>
                                                    <LoaderCircle
                                                      className="btn-spinner"
                                                      size={16}
                                                      strokeWidth={2.5}
                                                    />
                                                    Recreating…
                                                  </>
                                                ) : (
                                                  'Recreate link'
                                                )}
                                              </button>
                                            </div>
                                          </>
                                        ) : (
                                          <button
                                            type="button"
                                            className={`btn btn-secondary${linkBusy ? ' btn--busy' : ''}`}
                                            disabled={busy || linkBusy || !creatorOnlyEffectiveToken}
                                            onClick={mintLinkInvite}
                                          >
                                            {linkBusy ? (
                                              <>
                                                <LoaderCircle
                                                  className="btn-spinner"
                                                  size={16}
                                                  strokeWidth={2.5}
                                                />
                                                Creating…
                                              </>
                                            ) : (
                                              'Create invite link'
                                            )}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                          </div>
                        )}

                        {FEATURES.emailNotifyUi && requiredSigners > 1 && (
                          <div className="field notify-email-field">
                            <span className="field-label" id="notify-email-label">
                              Email when everyone has signed (optional)
                            </span>
                            <div className="notify-email-row">
                              <input
                                type="email"
                                value={creatorNotifyEmail}
                                onChange={e => {
                                  setCreatorNotifyEmail(e.target.value)
                                  setNotifyEmailError(null)
                                  setNotifyEmailFlashSaved(false)
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    void saveNotifyEmail()
                                  }
                                }}
                                placeholder="you@example.com"
                                autoComplete="email"
                                disabled={busy || notifyEmailBusy}
                                aria-labelledby="notify-email-label"
                                aria-invalid={notifyEmailError ? true : undefined}
                                aria-describedby="notify-email-hint"
                              />
                              <button
                                type="button"
                                className={`btn ${
                                  notifyEmailFlashSaved ||
                                  (notifyEmailSavedValue !== null &&
                                    creatorNotifyEmail.trim() === notifyEmailSavedValue &&
                                    creatorNotifyEmail.trim() !== '')
                                    ? 'btn-secondary'
                                    : 'btn-primary'
                                }${notifyEmailBusy ? ' btn--busy' : ''}`}
                                disabled={
                                  busy ||
                                  notifyEmailBusy ||
                                  // No-op when empty and nothing saved yet
                                  (creatorNotifyEmail.trim() === '' &&
                                    (notifyEmailSavedValue == null ||
                                      notifyEmailSavedValue === '')) ||
                                  // Already saved this exact value
                                  (notifyEmailSavedValue !== null &&
                                    creatorNotifyEmail.trim() === notifyEmailSavedValue &&
                                    !notifyEmailFlashSaved)
                                }
                                onClick={() => void saveNotifyEmail()}
                              >
                                {notifyEmailBusy ? (
                                  <>
                                    <LoaderCircle
                                      className="btn-spinner"
                                      size={16}
                                      strokeWidth={2.5}
                                    />
                                    Saving…
                                  </>
                                ) : notifyEmailFlashSaved ||
                                  (notifyEmailSavedValue !== null &&
                                    creatorNotifyEmail.trim() === notifyEmailSavedValue &&
                                    creatorNotifyEmail.trim() !== '') ? (
                                  <>
                                    <Check size={16} strokeWidth={2.5} aria-hidden />
                                    Saved
                                  </>
                                ) : creatorNotifyEmail.trim() === '' &&
                                  notifyEmailSavedValue ? (
                                  'Clear email'
                                ) : (
                                  'Save email'
                                )}
                              </button>
                            </div>
                            <span id="notify-email-hint" className="muted notify-email-hint">
                              We only use this to tell you when everyone has signed.
                              Never required. Press <strong>Save email</strong> so we store it.
                            </span>
                            {notifyEmailError ? (
                              <p className="notify-email-error" role="alert">
                                {notifyEmailError}
                              </p>
                            ) : null}
                            {notifyEmailFlashSaved &&
                            notifyEmailSavedValue &&
                            notifyEmailSavedValue.trim() !== '' ? (
                              <p className="notify-email-saved" role="status">
                                <Check size={14} strokeWidth={2.5} aria-hidden />
                                Saved - we&apos;ll email{' '}
                                <strong>{notifyEmailSavedValue}</strong> when everyone has signed.
                              </p>
                            ) : null}
                            {!notifyEmailFlashSaved &&
                            notifyEmailSavedValue &&
                            notifyEmailSavedValue.trim() !== '' &&
                            creatorNotifyEmail.trim() === notifyEmailSavedValue ? (
                              <p className="notify-email-saved notify-email-saved--quiet" role="status">
                                <Check size={14} strokeWidth={2.5} aria-hidden />
                                Notification set for <strong>{notifyEmailSavedValue}</strong>
                              </p>
                            ) : null}
                          </div>
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

                    {(requiredCount(doc) > 1 || inviteeSlotCount > 0) && (
                      <div className="invite-setup-finish">
                        <button
                          type="button"
                          className="btn btn-primary btn-lg"
                          onClick={acknowledgeShare}
                        >
                          {inviteWaitingVisited
                            ? 'Return to waiting view'
                            : 'Done inviting - show waiting view'}
                        </button>
                        <p className="muted invite-setup-finish-note">
                          This does not send invites for you - use the cards above first. The
                          waiting view is a quieter screen you can leave open (or leave and
                          return later) while co-signers finish.
                        </p>
                      </div>
                    )}
                  </section>
                  )}
                </div>
              )}

              {step === 'seal' && doc && address && isDocumentCreator(doc.source, address) && (
                <div className="action-stack">
                  {busy && creditBalance >= 1 ? (
                    <CreditSealProgress
                      message={lockMessage}
                      title={doc.title}
                      fingerprintPreview={doc.fingerprintPreview}
                    />
                  ) : !doc.directSeal && allSigned(doc) && !doc.sealed && !creatorChoseLock ? (
                    /* Free complete: print / done primary; lock is optional upgrade */
                    <>
                      <div className="done-banner">
                        <Check size={18} strokeWidth={2.5} />
                        <div>
                          <strong>Document complete</strong>
                          <p className="muted">
                            All signatures are in. Print a signed copy anytime, or lock on the
                            blockchain for permanent proof.
                          </p>
                        </div>
                      </div>
                      <PartyList doc={doc} revealNames={revealParticipantPrivate} />
                      {doc.source.signatures.length > 0 && (
                        <SignaturesPanel
                          signatures={doc.source.signatures}
                          parties={doc.source.parties}
                          compact
                          revealPrivate={revealParticipantPrivate}
                          authToken={effectiveToken}
                          fingerprint={doc.fingerprint}
                          documentId={doc.id}
                        />
                      )}
                      <section
                        className="journey-pdf-editor"
                        aria-labelledby={
                          hasVerifiedLocalPdf
                            ? undefined
                            : 'free-complete-print-title'
                        }
                      >
                        {/*
                          Drop zone only when the local file is not already matched (e.g. re-open
                          agreement later). Same-session self-sign already has the file — skip the
                          fingerprinted card and go straight to the signed preview.
                        */}
                        {!hasVerifiedLocalPdf && (
                          <>
                            <header className="signatures-config-head">
                              <h3 id="free-complete-print-title">Print signed document</h3>
                            </header>
                            <DocumentStage
                              step={step}
                              doc={doc}
                              file={signFile ?? null}
                              onFileChange={file => {
                                setSignFile(file)
                                setSignHash(null)
                                if (!file) setLocalError(null)
                              }}
                              accepting
                              localCopyRequired
                              localCopyMatches={
                                !(signFile || pdfFile)
                                  ? null
                                  : signFileMatches ||
                                    Boolean(pdfFile && pdfHash === doc.fingerprint)
                              }
                              localCopyHint="Drop the same file you fingerprinted so signatures paint on the page, then print. The file stays on this device - nothing is sent to VeriLock."
                            />
                          </>
                        )}
                        {signFile &&
                          !hasVerifiedLocalPdf &&
                          signHash &&
                          signHash !== doc.fingerprint && (
                            <div className="result-banner result-banner--bad">
                              That file does not match this agreement fingerprint. Use{' '}
                              <strong>{doc.fileName}</strong>.
                            </div>
                          )}
                        {hasVerifiedLocalPdf && (signFile || pdfFile) && (
                          <SignedDocumentView
                            className="signed-document-view signed-document-view--primary"
                            file={(signFile ?? pdfFile)!}
                            fingerprint={doc.fingerprint}
                            documentId={doc.id}
                            authToken={effectiveToken}
                            revealPrivate={revealParticipantPrivate}
                            documentAnnotations={doc.source.annotations}
                            signatures={doc.source.signatures}
                            parties={doc.source.parties}
                          />
                        )}
                      </section>
                      <button
                        type="button"
                        className="btn btn-primary btn-lg free-complete-lock-cta"
                        onClick={() => setCreatorChoseLock(true)}
                      >
                        <Lock size={18} strokeWidth={2.5} />
                        Lock on the blockchain
                      </button>
                      <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                        A lock anchors the fingerprint on Nimiq so anyone can verify this document
                        later. Use <strong>Print</strong> above when your local file is matched.
                      </p>
                      <button type="button" className="btn btn-ghost" onClick={goToMyAgreements}>
                        <Check size={15} strokeWidth={2.25} />
                        Done - return to My agreements
                      </button>
                    </>
                  ) : (
                    <>
                      {!doc.directSeal && allSigned(doc) && !doc.sealed && creatorChoseLock && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setCreatorChoseLock(false)}
                          style={{ alignSelf: 'flex-start' }}
                        >
                          <ArrowLeft size={14} strokeWidth={2.25} />
                          Back
                        </button>
                      )}
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
                          authToken={effectiveToken}
                          fingerprint={doc.fingerprint}
                          documentId={doc.id}
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
                            ? 'Direct lock - no signatures required.'
                            : allSigned(doc)
                              ? requiredCount(doc) <= 1
                                ? 'Signature complete.'
                                : `All ${requiredCount(doc)} signatures collected.`
                              : `${signedCount(doc)} of ${requiredCount(doc)} signatures collected - waiting on remaining signers.`}
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
                          Lock on blockchain - 1 credit
                        </button>
                      ) : (
                        <p className="muted journey-seal-hint" style={{ margin: 0 }}>
                          Buy or redeem 1 credit above to lock a permanent proof on Nimiq. Signing
                          stays free - only the on-chain lock spends a credit.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {(step === 'verify' || step === 'done') && (
                <div className="action-stack">
                  {/* Co-signer revisit: show parties, ink, and optional local PDF layout - not a dead-end "verify" screen. */}
                  {step === 'done' && doc && role === 'signer' && (
                    <>
                      <div className="done-banner">
                        {doc.sealed ? (
                          <Lock size={18} strokeWidth={2.5} />
                        ) : (
                          <Check size={18} strokeWidth={2.5} />
                        )}
                        <div>
                          <strong>
                            {doc.sealed
                              ? 'Locked on-chain - you already signed.'
                              : allSigned(doc)
                                ? 'Everyone has signed.'
                                : 'You are done signing.'}
                          </strong>
                          <p className="muted">
                            {doc.sealed ? (
                              <>
                                This agreement is locked on Nimiq. Your wallet signature and page
                                fields are part of the record.{' '}
                                <span className="result-banner-chain">
                                  Anchored on Nimiq
                                  {doc.source.attestation?.explorerUrl ? (
                                    <>
                                      {' · '}
                                      <a
                                        className="inline-link"
                                        href={doc.source.attestation.explorerUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        View on-chain attestation
                                      </a>
                                    </>
                                  ) : null}
                                </span>
                              </>
                            ) : allSigned(doc) || doc.readyToLock ? (
                              <>
                                Your fields and wallet signature are on the record. Print a signed
                                copy anytime with the same local file - no lock required.
                              </>
                            ) : (
                              <>
                                Your fields and wallet signature are recorded. Other parties still
                                need to finish.
                              </>
                            )}{' '}
                            Keep your copy of <em>{doc.fileName}</em>.
                          </p>
                        </div>
                      </div>

                      <PartyList doc={doc} revealNames={revealParticipantPrivate} />

                      {doc.source.signatures.length > 0 ? (
                        <SignaturesPanel
                          signatures={doc.source.signatures}
                          parties={doc.source.parties}
                          revealPrivate={revealParticipantPrivate}
                          authToken={effectiveToken}
                          fingerprint={doc.fingerprint}
                          documentId={doc.id}
                        />
                      ) : (
                        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                          {revealParticipantPrivate
                            ? 'No signature images loaded yet. Try refreshing, or open this agreement again while logged in.'
                            : 'Connect with the wallet you used to sign to unlock names and signature images.'}
                        </p>
                      )}

                      {FEATURES.pdfAnnotationUi && (
                        <section
                          className="journey-pdf-editor"
                          aria-labelledby={
                            hasVerifiedLocalPdf
                              ? undefined
                              : 'signer-review-layout-title'
                          }
                        >
                          {/*
                            Local drop only when returning later without a matched file. After
                            signing in this session the file is already verified — go straight to
                            the signed preview (Print lives on SignedDocumentView).
                          */}
                          {!hasVerifiedLocalPdf && (
                            <>
                              <header className="signatures-config-head">
                                <h3 id="signer-review-layout-title">
                                  {allSigned(doc) || doc.sealed
                                    ? 'Print signed document'
                                    : 'Signed document'}
                                </h3>
                                {(allSigned(doc) || doc.sealed) && (
                                  <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                                    Drop the same file you signed to paint signatures on the page,
                                    then print. Anyone who signed can print - the file stays on
                                    this device.
                                  </p>
                                )}
                              </header>
                              <DocumentStage
                                step={step}
                                doc={doc}
                                file={signFile ?? pdfFile}
                                onFileChange={file => {
                                  setSignFile(file)
                                  setSignHash(null)
                                  if (!file) setLocalError(null)
                                }}
                                accepting
                                disabled={busy}
                                localCopyRequired
                                localCopyMatches={
                                  !(signFile || pdfFile)
                                    ? null
                                    : signFileMatches ||
                                      Boolean(pdfFile && pdfHash === doc.fingerprint)
                                }
                                localCopyHint="Drop the same file you signed to see signatures, initials, and text fields on the page. Read only - the file stays on this device."
                              />
                            </>
                          )}
                          {signFile &&
                            !hasVerifiedLocalPdf &&
                            signHash &&
                            signHash !== doc.fingerprint && (
                              <div className="result-banner result-banner--bad">
                                That file does not match this agreement fingerprint. Use the same
                                document the organizer shared (<strong>{doc.fileName}</strong>).
                              </div>
                            )}
                          {hasVerifiedLocalPdf && (signFile || pdfFile) && (
                            <>
                              {(allSigned(doc) || doc.sealed) && (
                                <header className="signatures-config-head">
                                  <h3 id="signer-print-ready-title">Print signed document</h3>
                                  <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                                    Use <strong>Print</strong> on the preview. Any party with the
                                    matched file can print - locking is optional and separate.
                                  </p>
                                </header>
                              )}
                              <SignedDocumentView
                                className="signed-document-view signed-document-view--primary"
                                file={(signFile ?? pdfFile)!}
                                fingerprint={doc.fingerprint}
                                documentId={doc.id}
                                authToken={effectiveToken}
                                revealPrivate={revealParticipantPrivate}
                                documentAnnotations={doc.source.annotations}
                                signatures={doc.source.signatures}
                                parties={doc.source.parties}
                              />
                            </>
                          )}
                        </section>
                      )}

                      <button type="button" className="btn btn-primary" onClick={resetAll}>
                        Finish
                      </button>
                    </>
                  )}

                  {step === 'done' && doc && role !== 'signer' && (
                    <div className="done-banner">
                      {doc.sealed ? (
                        <Lock size={18} strokeWidth={2.5} />
                      ) : (
                        <Check size={18} strokeWidth={2.5} />
                      )}
                      <div>
                        <strong>{doc.sealed ? 'Locked.' : 'Complete.'}</strong>
                        <p className="muted">
                          {doc.sealed ? (
                            <>
                              Keep your copy of <em>{doc.fileName}</em>. Drop it below anytime to
                              re-check integrity against the on-chain record.
                              <span className="result-banner-chain">
                                {' '}
                                Anchored on Nimiq
                                {doc.source.attestation?.explorerUrl ? (
                                  <>
                                    {' · '}
                                    <a
                                      className="inline-link"
                                      href={doc.source.attestation.explorerUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      View on-chain attestation
                                    </a>
                                  </>
                                ) : null}
                              </span>
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

                  {/*
                    Guest free-complete "lock secondary" (`docs/guest-signing-plan.md` -
                    "Seal / free complete" -> "Lock secondary"). A guest creator never reaches
                    the wallet-gated `step === 'seal'` block above (`naturalStep` only resolves
                    to `seal` when a connected wallet matches `creatorAddress` - guaranteed
                    false pre-claim), so this is the free-complete moment they actually see.
                    Claiming first is the bridge to that richer wallet "Lock now" flow.
                  */}
                  {step === 'done' &&
                    doc &&
                    role === 'creator' &&
                    doc.source.authMode === 'guest' && (
                    <div className="claim-upsell">
                      <div className="claim-upsell-text">
                        <strong>Want to lock this on the blockchain?</strong>
                        <p className="muted">
                          Locking needs a Nimiq wallet. Save this agreement to a wallet to
                          manage it under My agreements and lock it with credits - your
                          existing signatures do not change.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary claim-upsell-cta"
                        onClick={openClaimModal}
                      >
                        <Wallet size={16} strokeWidth={2.25} aria-hidden />
                        Save to Nimiq wallet to lock
                      </button>
                    </div>
                  )}

                  {/*
                    Done (not signer) without a live verify match: party roster only when we
                    are not about to show Recorded signatures (avoids name+address twice).
                  */}
                  {doc &&
                    !doc.directSeal &&
                    role !== 'signer' &&
                    revealParticipantPrivate &&
                    step === 'done' &&
                    !verifyMatched &&
                    doc.source.signatures.length === 0 && (
                      <PartyList doc={doc} revealNames={revealParticipantPrivate} />
                    )}

                  {/* Pre-match sealed doc: one signatures list (not PartyList + panel). */}
                  {doc &&
                    role !== 'signer' &&
                    doc.source.signatures.length > 0 &&
                    (step === 'done' || (step === 'verify' && doc.sealed)) &&
                    !verifyMatched && (
                      <SignaturesPanel
                        signatures={doc.source.signatures}
                        parties={doc.source.parties}
                        revealPrivate={revealParticipantPrivate}
                        authToken={effectiveToken}
                        fingerprint={doc.fingerprint}
                        documentId={doc.id}
                      />
                    )}

                  {/* Drop zone until a party match replaces it with the signed PDF. */}
                  {(step === 'verify' || (step === 'done' && role !== 'signer')) &&
                    !verifyPartyView && (
                    <DocumentStage
                      step={step}
                      doc={doc}
                      file={verifyFile}
                      onFileChange={setVerifyFile}
                      accepting
                    />
                  )}

                  {(step === 'verify' || (step === 'done' && role !== 'signer')) &&
                    !verifyMatched && (
                    <p className="muted" style={{ margin: 0 }}>
                      We hash the file locally, then check VeriLock records and the Nimiq blockchain.
                      Names and signatures stay anonymous unless you are an original party.
                    </p>
                  )}

                  {(step === 'verify' || (step === 'done' && role !== 'signer')) &&
                    verifyOutcome.kind === 'hashing' && (
                    <div className="result-banner result-banner--ok">
                      <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                      Computing fingerprint…
                    </div>
                  )}

                  {(step === 'verify' || (step === 'done' && role !== 'signer')) &&
                    verifyOutcome.kind === 'local' && (
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
                        Could not reach the server to look up locked agreements
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
                      {(() => {
                        const lockedMatch =
                          verifyOutcome.matches.find(m => m.status === 'locked') ??
                          null
                        const anyLocked = Boolean(lockedMatch)
                        const explorer =
                          verifyOutcome.explorerUrl ||
                          lockedMatch?.attestation?.explorerUrl ||
                          null
                        // Header already says match confirmed - keep this banner tight.
                        return (
                          <div
                            className={`result-banner result-banner--ok${
                              anyLocked ? ' result-banner--locked' : ''
                            }`}
                            role="status"
                          >
                            {anyLocked ? (
                              <Lock size={18} strokeWidth={2.5} aria-hidden />
                            ) : (
                              <ShieldCheck size={18} strokeWidth={2.5} aria-hidden />
                            )}
                            <div>
                              {verifyOutcome.title ? (
                                <strong>{verifyOutcome.title}</strong>
                              ) : (
                                <strong>
                                  {anyLocked
                                    ? 'Locked on Nimiq'
                                    : 'Match found (not locked yet)'}
                                </strong>
                              )}
                              <p className="result-banner-meta">
                                <code className="mono">{verifyOutcome.fingerprint}</code>
                                {lockedMatch?.lockedAt
                                  ? ` · ${new Date(lockedMatch.lockedAt).toLocaleString()}`
                                  : null}
                              </p>
                              {anyLocked && (
                                <p className="result-banner-meta result-banner-chain">
                                  <span>Anchored on Nimiq</span>
                                  {explorer ? (
                                    <>
                                      {' · '}
                                      <a
                                        className="inline-link"
                                        href={explorer}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        View on-chain attestation
                                      </a>
                                    </>
                                  ) : null}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })()}

                      {/* Involved party: full PDF with page fields. */}
                      {verifyPartyView &&
                        verifyFile &&
                        verifyPartyMatch &&
                        token &&
                        (() => {
                          const planHash = verifyPartyMatch.originalSha256
                          // Same agreement only by id/slug - never fingerprint (PDF reuse).
                          const sameDoc =
                            doc &&
                            (doc.id === verifyPartyMatch.id ||
                              doc.slug === verifyPartyMatch.slug)
                          const sigs = sameDoc
                            ? doc!.source.signatures
                            : verifyPartyMatch.signatures
                          const partyList = sameDoc
                            ? doc!.source.parties
                            : verifyPartyMatch.parties
                          return (
                            <SignedDocumentView
                              className="signed-document-view signed-document-view--primary"
                              file={verifyFile}
                              fingerprint={planHash}
                              documentId={verifyPartyMatch.id}
                              authToken={token}
                              revealPrivate
                              documentAnnotations={
                                sameDoc ? doc!.source.annotations : null
                              }
                              signatures={sigs}
                              parties={partyList}
                            />
                          )
                        })()}

                      {/* One signatures list for the primary match (not PartyList + panel + matches). */}
                      {(() => {
                        const primary =
                          verifyPartyMatch ??
                          verifyOutcome.matches.find(m => m.status === 'locked') ??
                          verifyOutcome.matches[0] ??
                          null
                        if (!primary || primary.signatures.length === 0) return null
                        // Same agreement only by id/slug - never fingerprint (PDF reuse).
                        const sameDoc =
                          doc &&
                          (doc.id === primary.id || doc.slug === primary.slug)
                        return (
                          <SignaturesPanel
                            signatures={
                              sameDoc ? doc!.source.signatures : primary.signatures
                            }
                            parties={sameDoc ? doc!.source.parties : primary.parties}
                            revealPrivate={
                              Boolean(verifyPartyView) ||
                              canRevealParticipantDetails(primary, address)
                            }
                            authToken={token}
                            fingerprint={primary.originalSha256}
                            documentId={primary.id}
                          />
                        )
                      })()}

                      {verifyPartyView && verifyFile && (
                        <div className="verify-file-bar">
                          <span className="muted verify-file-bar-label">
                            Local file: <strong>{verifyFile.name}</strong>
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setVerifyFile(null)
                              setVerifyOutcome({ kind: 'idle' })
                              verifyCacheRef.current = null
                            }}
                          >
                            Choose a different file
                          </button>
                        </div>
                      )}

                      {/* Multi-match: pick among records. Single match: skip heavy card (banner + sigs enough). */}
                      {verifyOutcome.matches.length > 1 ? (
                        <div className="journey-verify-details">
                          <VerifyMatchesPanel
                            matches={verifyOutcome.matches}
                            appUrl={
                              typeof window !== 'undefined' ? window.location.origin : ''
                            }
                            highlightSlug={verifyOutcome.matches[0]?.slug}
                            walletAddress={address}
                            authToken={token}
                            hideSignatures
                            hideLockedCallout
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
                                      const { document } = await api.getDocument(
                                        m.slug,
                                        token,
                                      )
                                      setActiveFromSeal(document)
                                      setSharedAck(true)
                                      setRole(
                                        document.status === 'locked'
                                          ? 'verifier'
                                          : 'signer',
                                      )
                                      scrollToJourneyAction('smooth')
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
                      ) : null}
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
          </div>
        </>
      )}

      <HowVeriLockWorks
        role={role}
        open={howOpen}
        onToggle={() => setHowOpen(v => !v)}
      />

      <CancelAgreementModal
        document={cancelModalOpen && doc ? doc.source : null}
        busy={cancelBusy}
        error={cancelError}
        onClose={closeCancelModal}
        onConfirm={() => void confirmCancelCurrentAgreement()}
      />

      <GuestDocumentKeyModal
        documentKey={guestDocumentKeyModal?.documentKey ?? null}
        savedAck={guestDocumentKeyModal?.savedAck ?? false}
        onSavedAckChange={checked =>
          setGuestDocumentKeyModal(prev => (prev ? { ...prev, savedAck: checked } : prev))
        }
        documentTitle={doc?.source.title}
        onContinue={() => setGuestDocumentKeyModal(null)}
      />

      <ClaimAgreementModal
        open={claimModalOpen}
        documentTitle={doc?.source.title}
        account={account}
        hasGuestSession={Boolean(activeGuestCreatorSession)}
        documentKeyInput={claimDocumentKeyInput}
        onDocumentKeyInputChange={setClaimDocumentKeyInput}
        busy={claimBusy}
        error={claimError}
        onClose={closeClaimModal}
        onClaim={() => void confirmClaimDocument()}
        connectMode={connectMode}
        connecting={connecting}
        walletStatus={walletStatus}
        walletError={walletError}
        showOpenInPay={showOpenInPay}
        loginNeedsSheet={loginNeedsSheet}
        loginSheetOpen={loginSheetOpen}
        onRequestLogin={requestLogin}
        onCloseLoginSheet={() => setLoginSheetOpen(false)}
        onProceedLogin={connectFromPath}
        onSession={applySession}
      />

      {/*
        Portal to body: .lr-view-blend uses transform, which traps position:fixed.
        No auto-dismiss - stays until Got it (easy to miss when it vanished after ~10s).
      */}
      {inviteHandoff &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            key={inviteHandoff.key}
            className="invite-handoff-modal-layer"
            role="presentation"
          >
            <button
              type="button"
              className="invite-handoff-modal-backdrop"
              aria-label="Close"
              onClick={dismissInviteHandoff}
            />
            <div
              className="invite-handoff-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="invite-handoff-title"
            >
              <header className="invite-handoff-modal-head">
                <span className="invite-handoff-modal-icon" aria-hidden>
                  <MailCheck size={22} strokeWidth={2.25} />
                </span>
                <button
                  type="button"
                  className="invite-handoff-modal-close"
                  aria-label="Close"
                  onClick={dismissInviteHandoff}
                >
                  <X size={18} strokeWidth={2.25} aria-hidden />
                </button>
              </header>
              <h3 id="invite-handoff-title" className="invite-handoff-modal-title">
                {inviteHandoff.mode === 'email'
                  ? 'Email sent - file not attached'
                  : 'Link copied - send the file too'}
              </h3>
              <p className="invite-handoff-modal-body">
                {inviteHandoff.mode === 'email' ? (
                  <>
                    We only emailed the signing link to{' '}
                    <span className="invite-handoff-contact">{inviteHandoff.contactLabel}</span>.
                    VeriLock never attaches or hosts the agreement file.
                  </>
                ) : (
                  <>
                    The personal signing link for{' '}
                    <span className="invite-handoff-contact">{inviteHandoff.contactLabel}</span>{' '}
                    is on your clipboard. Paste it into Messages, email, or chat.
                  </>
                )}
              </p>
              <p className="invite-handoff-modal-body invite-handoff-modal-body--emphasis">
                You still need to send the agreement file to the remaining parties so they can
                open it and sign. Co-signers must use that exact file - the fingerprint has to
                match.
              </p>
              <div className="invite-handoff-modal-actions">
                <button
                  ref={inviteHandoffPrimaryRef}
                  type="button"
                  className="btn btn-primary"
                  onClick={dismissInviteHandoff}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

    </div>
  )
}

function PartyList({
  doc,
  revealNames = true,
  inviteEmailByPartyId,
}: {
  doc: JourneyDoc
  /** When false, hide display names (public share viewers). */
  revealNames?: boolean
  /** partyId → last invite email sent from this browser session. */
  inviteEmailByPartyId?: Record<string, { email: string; sentAt: number }>
}) {
  if (doc.directSeal || doc.parties.length === 0) return null
  return (
    <ul className="party-list" aria-label="Signers">
      {doc.parties.map(p => {
        // Avoid "Creator · NQ… · NQ…" when display name is just the short address.
        const showName =
          revealNames &&
          Boolean(p.displayName) &&
          p.displayName !== p.walletShort &&
          !/^NQ[1-9A-HJ-NP-Z]{2,}…[1-9A-HJ-NP-Z]{4}$/i.test(p.displayName ?? '')
        const invited = !p.signed ? inviteEmailByPartyId?.[p.id] : undefined
        let statusNote: string | null = null
        if (p.signed) {
          statusNote = p.walletShort
        } else if (invited) {
          statusNote = `invite emailed to ${invited.email}`
        } else if (p.walletShort) {
          statusNote = `${p.walletShort} · awaiting signature`
        } else {
          statusNote = 'awaiting signature'
        }
        return (
          <li
            key={p.id}
            className={[
              'party-list-item',
              p.signed ? 'party-list-item--done' : '',
              invited ? 'party-list-item--invited' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="party-list-check" aria-hidden>
              {p.signed ? (
                <Check size={14} strokeWidth={2.5} />
              ) : invited ? (
                <MailCheck size={13} strokeWidth={2.5} />
              ) : null}
            </span>
            <div className="party-list-copy">
              <strong>{p.roleLabel}</strong>
              {showName ? <span className="muted"> · {p.displayName}</span> : null}
              {statusNote ? <span className="muted"> · {statusNote}</span> : null}
              {invited ? (
                <span className="party-list-invite-pill">Invite emailed</span>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
