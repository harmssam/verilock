import {
  Check,
  Fingerprint,
  LoaderCircle,
  Lock,
  RotateCcw,
  Shield,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeAddress } from '../addresses'
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
  MAX_TITLE_LENGTH,
} from '../fieldLimits'
import { getPdfPageCount, sha256Hex, shortHash } from '../pdf/hashPdf'
import { prepareSignatureImageUpload } from '../signatureImage'
import { isMobileDevice } from '../nimiq'
import { SealPricingDisplay } from '../SealPricingDisplay'
import { ShareInviteCard } from '../ShareInviteCard'
import {
  formatPartyRole,
  partyNeedsSignerName,
  resolveSigningParty,
} from '../signing'
import {
  documentTypeUsesNotes,
  type DocumentType,
  type SealDocument,
  type VerifyResult,
} from '../types'
import { VerifyMatchesPanel } from '../VerifyMatchesPanel'
import { DocumentStage } from './DocumentStage'
import { FeatureRotator } from './FeatureRotator'
import { HowVeriLockWorks } from './HowVeriLockWorks'
import { JourneyAgreements } from './JourneyAgreements'
import { NotFoundPage } from './NotFoundPage'
import {
  clearJourneyIntent,
  resolveJourneyIntent,
  saveJourneyIntent,
  syncIntentToUrl,
} from './journeyIntent'
import {
  journeyConnectOptions,
  journeyLoginEntryLabels,
  resolveJourneyConnectMode,
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
import { StageRail } from './StageRail'
import { saveHubReturnPath } from '../hubReturnPath'
import { journeyPathMeta, type PageMeta } from '../seo'
import {
  allSigned,
  nextUnsignedParty,
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
  /** Open full agreements page (header / welcome strip). */
  onOpenAgreements?: () => void
  /** Return to home (invalid deep link). */
  onHome?: () => void
  /**
   * Landing redesign (and any shell that owns the path picker) — skip the
   * in-journey “What are you here to do?” welcome so it does not double with
   * the shell home. Production ExperimentApp leaves this unset.
   */
  suppressWelcome?: boolean
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
  onOpenAgreements,
  onHome,
  suppressWelcome = false,
}: DocumentJourneyProps) {
  const {
    account,
    token,
    address,
    connecting,
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
    walletStatus,
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
  /** Rental only: creator’s party role. */
  const [creatorRole, setCreatorRole] = useState<'landlord' | 'tenant'>('landlord')
  /** Optional display names for other parties (index 0 = first co-signer). */
  const [coSignerNames, setCoSignerNames] = useState<string[]>([''])
  const [docNotes, setDocNotes] = useState('')
  const [directSeal, setDirectSeal] = useState(false)
  const [requiredSigners, setRequiredSigners] = useState(2)
  const [busy, setBusy] = useState(false)
  const [doc, setDoc] = useState<JourneyDoc | null>(null)
  const [sharedAck, setSharedAck] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [signFile, setSignFile] = useState<File | null>(null)
  const [signHash, setSignHash] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const [sigBlob, setSigBlob] = useState<Blob | null>(null)
  const [sigPadKey, setSigPadKey] = useState(0)
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [verifyOutcome, setVerifyOutcome] = useState<VerifyOutcome>({ kind: 'idle' })
  const [howOpen, setHowOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [lockMessage, setLockMessage] = useState<string | null>(null)
  const [agreementsRefreshKey, setAgreementsRefreshKey] = useState(0)
  const [creditBalance, setCreditBalance] = useState(0)
  const [creditsRefresh, setCreditsRefresh] = useState(0)
  /** Deep-link /d/ or /v/ slug that does not resolve on the server. */
  const [missingDeepLink, setMissingDeepLink] = useState<string | null>(null)
  const fileSizeByDocIdRef = useRef<Record<string, number>>({})

  const bumpAgreements = useCallback(() => {
    setAgreementsRefreshKey(k => k + 1)
  }, [])

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

  const openAgreementFromList = useCallback(
    (document: SealDocument, preferSeal = false) => {
      setActiveFromSeal(document)
      setLocalError(null)
      setLockMessage(null)
      setSignFile(null)
      setSignHash(null)
      setSigBlob(null)
      setSigPadKey(k => k + 1)

      const creator = isDocumentCreator(document, address)
      if (creator) {
        setRole('creator')
        saveJourneyIntent('creator')
        syncIntentToUrl('creator')
        // Skip share if signatures already progressing or ready to seal
        const { signed, required, readyToLock } = document.signingProgress
        setSharedAck(
          preferSeal ||
            readyToLock ||
            document.status === 'ready_to_lock' ||
            signed > 0 ||
            required === 0,
        )
      } else {
        setRole('signer')
        saveJourneyIntent('signer')
        syncIntentToUrl('signer')
        setSharedAck(true)
      }

      window.history.pushState({}, '', `/d/${document.slug}`)
    },
    [address, setActiveFromSeal],
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
          const { signed, required, readyToLock } = document.signingProgress
          setSharedAck(
            preferSeal ||
              readyToLock ||
              document.status === 'ready_to_lock' ||
              signed > 0 ||
              required === 0,
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
        bumpAgreements()
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
    if (!account) return 'connect'
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
    if (!doc) return 'fingerprint'
    if (doc.sealed) return 'done'
    if (doc.directSeal || allSigned(doc)) return 'seal'
    if (signedCount(doc) > 0 || sharedAck) return 'sign'
    return 'share'
  }, [role, account, doc, sharedAck, address])

  const pathStages = useMemo(() => stagesForRole(role), [role])

  const revealParticipantPrivate = Boolean(
    doc && canRevealParticipantDetails(doc.source, address),
  )
  const canCancelCurrent = Boolean(doc && canDeleteDocument(doc.source, address))

  const activeStage =
    pathStages.find(s => s.id === step) ??
    (step === 'done' ? pathStages[pathStages.length - 1] ?? null : null)

  const stepIndex = activeStage ? pathStages.findIndex(s => s.id === activeStage.id) : -1

  const signingResolution =
    doc && address ? resolveSigningParty(doc.source, address) : null
  const pendingParty =
    signingResolution?.ok
      ? doc!.parties.find(p => p.id === signingResolution.party.id) ?? nextUnsignedParty(doc!)
      : doc && !doc.directSeal
        ? nextUnsignedParty(doc)
        : null

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
        const pages = await getPdfPageCount(pdfFile)
        if (cancelled) return
        setPdfHash(hash)
        setPageCount(pages)
        setTitle(prev =>
          (prev ?? '').trim()
            ? prev
            : clampField(pdfFile.name.replace(/\.pdf$/i, ''), MAX_TITLE_LENGTH),
        )
      } catch (err) {
        if (!cancelled) {
          setLocalError(err instanceof Error ? err.message : 'Failed to read PDF')
          setPdfHash(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfFile])

  // Hash PDF on select (sign path) + match check
  useEffect(() => {
    if (!signFile || !doc) {
      setSignHash(null)
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
            'This PDF does not match the agreement fingerprint. Use the exact file the creator shared.',
          )
          return
        }
        setLocalError(null)
        setSignHash(hash)
      } catch (err) {
        if (!cancelled) {
          setLocalError(err instanceof Error ? err.message : 'Failed to read PDF')
          setSignHash(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signFile, doc])

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
          details = await loadVerifyDetails(matches.map(m => m.slug))
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
            const { document } = await api.getDocument(openSlug)
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
  }, [verifyFile, setActiveFromSeal])

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
    setPdfFile(null)
    setPdfHash(null)
    setTitle('')
    setCreatorName('')
    setCreatorNotifyEmail('')
    setDocType('contract')
    setCreatorRole('landlord')
    setCoSignerNames([''])
    setDocNotes('')
    setDirectSeal(false)
    setRequiredSigners(2)
    setDoc(null)
    setSharedAck(false)
    setSignFile(null)
    setSignHash(null)
    setSignerName('')
    setSigBlob(null)
    setSigPadKey(k => k + 1)
    setVerifyFile(null)
    setVerifyOutcome({ kind: 'idle' })
    verifyCacheRef.current = null
    verifyRunIdRef.current += 1
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
  }

  const createDoc = async () => {
    if (!token || !pdfFile || !pdfHash) return
    if (!creatorName.trim()) {
      setLocalError('Enter your full name before creating the agreement')
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      const effectiveRequired = directSeal ? 0 : requiredSigners
      const extraSigners = Math.max(0, effectiveRequired - 1)
      // Creator is always a required party; remaining slots are co-signers.
      const parties = directSeal
        ? []
        : Array.from({ length: extraSigners }, (_, index) => {
            const named = coSignerNames[index]?.trim()
            const fallback =
              extraSigners === 1 ? 'Invited signer' : `Invited signer ${index + 1}`
            // Rental: first co-signer is the other role; further parties are generic signers.
            let role = 'signer'
            if (docType === 'rental' && index === 0) {
              role = creatorRole === 'landlord' ? 'tenant' : 'landlord'
            }
            return {
              role,
              displayName: clampField(named || fallback, MAX_DISPLAY_NAME_LENGTH),
              required: true,
            }
          })

      const notifyEmail =
        FEATURES.emailNotifyUi && creatorNotifyEmail.trim()
          ? creatorNotifyEmail.trim()
          : undefined

      const metadata =
        documentTypeUsesNotes(docType) && docNotes.trim()
          ? { notes: clampField(docNotes.trim(), MAX_DOCUMENT_NOTES_LENGTH) }
          : undefined

      const { document, hashWarning } = await api.createDocument(token, {
        title: clampField(title || pdfFile.name.replace(/\.pdf$/i, ''), MAX_TITLE_LENGTH),
        originalFileName: pdfFile.name,
        type: docType,
        creatorRole: docType === 'rental' ? creatorRole : 'creator',
        creatorDisplayName: clampField(creatorName.trim(), MAX_DISPLAY_NAME_LENGTH),
        originalSha256: pdfHash,
        pageCount,
        requiredSignatures: effectiveRequired,
        parties: parties.length > 0 ? parties : undefined,
        ...(metadata ? { metadata } : {}),
        ...(notifyEmail ? { creatorNotifyEmail: notifyEmail } : {}),
      })

      if (hashWarning) setLocalError(hashWarning)
      setActiveFromSeal(document, pdfFile.size)
      setSharedAck(false)
      // Keep create-time PDF available for the creator’s own sign step
      setSignFile(pdfFile)
      setSignHash(pdfHash)
      bumpAgreements()
      window.history.pushState({}, '', `/d/${document.slug}`)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!doc) return
    try {
      await navigator.clipboard.writeText(doc.shareUrl)
      setLinkCopied(true)
      // Do not advance off share — copy alone should not open the sign/PDF step.
      window.setTimeout(() => setLinkCopied(false), 1800)
    } catch {
      setLocalError('Could not copy link — select and copy it manually if needed.')
    }
  }

  /** Leave share step; reuse create PDF so creator is not asked to re-drop it. */
  const continueAfterShare = () => {
    if (pdfFile && pdfHash) {
      setSignFile(pdfFile)
      setSignHash(pdfHash)
    }
    setSharedAck(true)
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
      bumpAgreements()
      window.history.pushState({}, '', '/')
      setLockMessage(null)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not cancel agreement')
    } finally {
      setBusy(false)
    }
  }

  const signAsCurrentUser = async () => {
    if (!token || !doc || !address || !signHash) return

    const resolution = resolveSigningParty(doc.source, address)
    if (!resolution.ok) {
      setLocalError(resolution.message)
      return
    }
    const myParty = resolution.party
    if (partyNeedsSignerName(myParty) && !signerName.trim()) {
      setLocalError('Enter your full name before signing')
      return
    }
    if (signHash !== doc.fingerprint) {
      setLocalError('Choose the matching PDF before signing')
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
      const { document } = await api.signDocument(token, doc.id, {
        partyId: myParty.id,
        signatureType: 'drawn',
        clientSha256: doc.fingerprint,
        displayName: partyNeedsSignerName(myParty)
          ? clampField(signerName.trim(), MAX_DISPLAY_NAME_LENGTH)
          : undefined,
        signatureImage,
      })
      setActiveFromSeal(document, doc.fileSize)
      setSignFile(null)
      setSignHash(null)
      setSignerName('')
      setSigBlob(null)
      setSigPadKey(k => k + 1)
      bumpAgreements()
      if (document.signingProgress.readyToLock) {
        // Only the creator seals — co-signers should not be told to continue to seal.
        if (isDocumentCreator(document, address)) {
          setLockMessage('All signatures collected — continue to seal.')
        } else {
          setLockMessage(
            'All signatures are in. The creator can seal this agreement on the Nimiq blockchain.',
          )
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign failed'
      setLocalError(message)
      // Slot races / already-signed: pull latest party assignment for a clean retry.
      if (/already signed|claimed this slot|refresh/i.test(message) && doc?.slug) {
        try {
          const { document: latest } = await api.getDocument(doc.slug)
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
      bumpAgreements()
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
      bumpAgreements()
      setCreditsRefresh(k => k + 1)
    } else {
      setLocalError(result.message)
      setLockMessage(null)
    }
    setBusy(false)
  }

  const pickRole = (r: PathRole) => {
    setRole(r)
    saveJourneyIntent(r)
    syncIntentToUrl(r)
    setVerifyFile(null)
    setVerifyOutcome({ kind: 'idle' })
    setLocalError(null)
    setLockMessage(null)
    if (r === 'signer') {
      // Invite link (/d/:slug) or PDF hash lookup - no fake demo doc
      if (!slugFromPath(window.location.pathname)) {
        setDoc(null)
        setSignFile(null)
        setSignHash(null)
      }
    } else if (r === 'creator') {
      if (!slugFromPath(window.location.pathname)) {
        setDoc(null)
        setPdfFile(null)
      }
    } else {
      setDoc(null)
    }
  }

  const connectMode = resolveJourneyConnectMode({
    inNimiqPay,
    mobilePayConnect,
    showOpenInPay,
  })

  const connectFromPath = () => {
    // Stamp intent into URL only when connecting (Hub return needs it).
    if (role) {
      saveJourneyIntent(role)
      syncIntentToUrl(role)
    }
    saveHubReturnPath()
    // Single button: Pay-first on mobile, Hub on desktop / after Pay fallback.
    void connect(journeyConnectOptions(connectMode))
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
          const { document } = await api.getDocument(m.slug)
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

      {token && (step === 'welcome' || !doc) && (
        <JourneyAgreements
          token={token}
          address={address}
          refreshKey={agreementsRefreshKey}
          onOpen={document => openAgreementFromList(document, false)}
          onSeal={document => openAgreementFromList(document, true)}
          onViewAll={onOpenAgreements}
        />
      )}

      {step === 'welcome' && !suppressWelcome && (
        <section className="hero-pick">
          <div className="hero-pick-copy">
            <FeatureRotator />
            <h2>What are you here to do?</h2>
            <p className="muted">Choose your role to get started.</p>
          </div>
          <div className="path-cards">
            <button type="button" className="path-card path-card--create" onClick={() => pickRole('creator')}>
              <span className="path-card-icon" aria-hidden>
                <Fingerprint size={22} strokeWidth={2.25} />
              </span>
              <strong>Create &amp; seal</strong>
              <span className="muted">Fingerprint, multi-party sign, lock on Nimiq</span>
            </button>
            <button type="button" className="path-card path-card--sign" onClick={() => pickRole('signer')}>
              <span className="path-card-icon" aria-hidden>
                <Users size={22} strokeWidth={2.25} />
              </span>
              <strong>I was invited</strong>
              <span className="muted">Drop the shared PDF (or open your invite link), then sign</span>
            </button>
            <button type="button" className="path-card path-card--verify" onClick={() => pickRole('verifier')}>
              <span className="path-card-icon" aria-hidden>
                <ShieldCheck size={22} strokeWidth={2.25} />
              </span>
              <strong>Verify a PDF</strong>
              <span className="muted">Drop a file - look up sealed fingerprints</span>
            </button>
          </div>
        </section>
      )}

      {step !== 'welcome' && (
        <>
          {role && (
            <StageRail
              role={role}
              step={step}
              account={Boolean(account)}
              doc={doc}
              sharedAck={sharedAck}
            />
          )}

          <section className="action-dock" aria-live="polite">
            <header className="action-dock-head">
              <div className="journey-toolbar">
                <button
                  type="button"
                  className="btn btn-ghost journey-reset"
                  onClick={resetAll}
                  title="Return to Create / Invited / Verify"
                >
                  <RotateCcw size={14} strokeWidth={2.25} aria-hidden />
                  Start over
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
                      : step === 'connect'
                        ? 'Login'
                        : activeStage?.verb ?? 'Continue'}
                </h3>
                <p className="muted action-blurb">
                  {step === 'done' && role === 'signer'
                    ? (activeStage?.blurb ??
                      'Your signature is recorded. When everyone has signed, the agreement is sealed on Nimiq.')
                    : step === 'done'
                      ? 'Keep your PDF. Drop a copy below anytime to verify the fingerprint.'
                      : step === 'connect' && role === 'signer'
                        ? 'Login with Nimiq first, then match the shared PDF and sign.'
                        : step === 'connect' && role === 'verifier'
                          ? 'Wallet is optional for verify — you can skip login if you only need to check a PDF.'
                          : step === 'connect'
                            ? 'Step 1 only — prove who you are with Nimiq. Your PDF comes next.'
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
              {step === 'connect' && (
                <div className="action-stack">
                  <LoginSheet
                    open
                    connectMode={connectMode}
                    connecting={connecting}
                    walletStatus={walletStatus}
                    onProceed={connectFromPath}
                    placement="inline"
                    showClose={false}
                  />
                </div>
              )}

              {step === 'fingerprint' && (
                <div className="action-stack">
                  <DocumentStage
                    step={step}
                    doc={doc}
                    file={pdfFile}
                    onFileChange={setPdfFile}
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
                        Step 2: <strong>drop a PDF</strong> or <strong>Browse files</strong>.
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
                        if (next === 'rental') setCreatorRole('landlord')
                        if (!documentTypeUsesNotes(next)) setDocNotes('')
                      }}
                    >
                      <option value="rental">Rental agreement</option>
                      <option value="contract">Contract</option>
                      <option value="nda">NDA</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  {docType === 'rental' && (
                    <label className="field">
                      <span className="field-label">You are the</span>
                      <select
                        value={creatorRole}
                        onChange={e =>
                          setCreatorRole(e.target.value as 'landlord' | 'tenant')
                        }
                      >
                        <option value="landlord">Landlord</option>
                        <option value="tenant">Tenant</option>
                      </select>
                    </label>
                  )}
                  <label className="field">
                    <span className="field-label">Your full name</span>
                    <input
                      value={creatorName}
                      onChange={e =>
                        setCreatorName(clampField(e.target.value, MAX_DISPLAY_NAME_LENGTH))
                      }
                      placeholder="Alex Rivera"
                      autoComplete="name"
                      maxLength={MAX_DISPLAY_NAME_LENGTH}
                    />
                  </label>
                  {FEATURES.emailNotifyUi && !directSeal && (
                    <label className="field">
                      <span className="field-label">Email when everyone has signed (optional)</span>
                      <input
                        type="email"
                        value={creatorNotifyEmail}
                        onChange={e => setCreatorNotifyEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                      />
                      <span className="muted" style={{ fontSize: '0.78rem' }}>
                        We only use this to tell you the agreement is ready to seal. Never required.
                      </span>
                    </label>
                  )}
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
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={directSeal}
                      onChange={e => {
                        const checked = e.target.checked
                        setDirectSeal(checked)
                        if (checked) setRequiredSigners(1)
                        else if (requiredSigners < 1) setRequiredSigners(2)
                      }}
                    />
                    <span>Seal directly — no co-signers (hash only)</span>
                  </label>
                  {!directSeal && (
                    <>
                      <label className="field">
                        <span className="field-label">How many parties must sign?</span>
                        <select
                          value={requiredSigners}
                          onChange={e => {
                            const n = Number(e.target.value)
                            setRequiredSigners(n)
                            const others = Math.max(0, n - 1)
                            setCoSignerNames(prev => {
                              const next = prev.slice(0, others)
                              while (next.length < others) next.push('')
                              return next
                            })
                          }}
                        >
                          {[1, 2, 3, 4].map(n => (
                            <option key={n} value={n}>
                              {n} {n === 1 ? 'signature' : 'signatures'} (you
                              {n > 1 ? ` + ${n - 1} other${n - 1 === 1 ? '' : 's'}` : ''})
                            </option>
                          ))}
                        </select>
                      </label>
                      {Math.max(0, requiredSigners - 1) > 0 && (
                        <div className="field-stack">
                          <span className="field-label">
                            Co-signer name{requiredSigners - 1 > 1 ? 's' : ''} (optional)
                          </span>
                          <p className="muted" style={{ margin: '0 0 0.45rem', fontSize: '0.8rem' }}>
                            Leave blank if they will enter their name when they sign.
                          </p>
                          {Array.from({ length: Math.max(0, requiredSigners - 1) }, (_, index) => {
                            const rentalOther =
                              docType === 'rental' && index === 0
                                ? creatorRole === 'landlord'
                                  ? 'Tenant'
                                  : 'Landlord'
                                : null
                            return (
                              <label key={index} className="field">
                                <span className="field-label">
                                  {rentalOther ?? `Party ${index + 2}`} name
                                </span>
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
                                  maxLength={MAX_DISPLAY_NAME_LENGTH}
                                  placeholder={
                                    rentalOther
                                      ? `${rentalOther} full name`
                                      : 'Name (optional)'
                                  }
                                />
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
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
                    className={`btn btn-primary btn-lg${busy ? ' btn--busy' : ''}`}
                    disabled={!pdfFile || !pdfHash || !creatorName.trim() || busy}
                    onClick={() => void createDoc()}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                        Creating…
                      </>
                    ) : (
                      <>
                        <Fingerprint size={18} strokeWidth={2.25} />
                        Fingerprint &amp; continue
                      </>
                    )}
                  </button>
                </div>
              )}

              {step === 'share' && doc && (
                <div className="action-stack">
                  <DocumentStage step={step} doc={doc} file={pdfFile} accepting={false} />
                  <PartyList doc={doc} revealNames={revealParticipantPrivate} />
                  <ShareInviteCard
                    document={doc.source}
                    shareUrl={doc.shareUrl}
                    linkCopied={linkCopied}
                    onCopyLink={() => void copyLink()}
                    pdfFile={pdfFile ?? signFile}
                    embedded
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    onClick={continueAfterShare}
                  >
                    I&apos;ve shared — continue to sign
                  </button>
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
                  <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                    Prefer a ready-made message? Download the email package (link + PDF) or copy
                    the link and send the file yourself. Continue when you are ready to sign as
                    the creator. You can cancel until someone signs.
                  </p>
                </div>
              )}

              {step === 'sign' && (
                <div className="action-stack">
                  {!doc && role === 'signer' && (
                    <>
                      <p className="muted" style={{ margin: 0 }}>
                        Drop the PDF the creator shared. We match its fingerprint to the
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

                      {/* Invite / mailto is creator-only — co-signers (e.g. Tenant 2 of 2) only sign. */}
                      {!allSigned(doc) &&
                        !doc.directSeal &&
                        (role === 'creator' || isDocumentCreator(doc.source, address)) && (
                          <ShareInviteCard
                            document={doc.source}
                            shareUrl={doc.shareUrl}
                            linkCopied={linkCopied}
                            onCopyLink={() => void copyLink()}
                            pdfFile={pdfFile ?? signFile}
                            embedded
                          />
                        )}

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
                            ? 'All parties signed — continue to seal'
                            : 'All parties have signed. The creator can seal this on Nimiq.'}
                        </div>
                      ) : (
                        <>
                          {!account && (
                            <button
                              type="button"
                              className={`btn btn-primary${connecting ? ' btn--busy' : ''}`}
                              onClick={connectFromPath}
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
                          )}

                          {account && signingResolution && !signingResolution.ok && (
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
                                </span>
                              </div>

                              <div className="sign-upload-callout" role="status">
                                <Upload size={18} strokeWidth={2.25} aria-hidden />
                                <div>
                                  <strong>Upload your copy of the PDF</strong>
                                  <p className="muted" style={{ margin: '0.2rem 0 0' }}>
                                    Drop the same PDF from your computer so we can verify the
                                    document is identical.
                                  </p>
                                </div>
                              </div>

                              <DocumentStage
                                step={step}
                                doc={doc}
                                file={signFile}
                                onFileChange={setSignFile}
                                accepting
                                localCopyRequired
                                localCopyMatches={
                                  !signFile ? null : signFileMatches
                                }
                              />

                              {signFile && !signFileMatches && (
                                <div className="result-banner result-banner--bad">
                                  PDF doesn&apos;t match the fingerprinted file (
                                  <strong>{doc.fileName}</strong>). Drop the same document.
                                </div>
                              )}
                              {signFile && signFileMatches && (
                                <div className="result-banner result-banner--ok">
                                  <ShieldCheck size={16} strokeWidth={2.5} />
                                  Local match - same fingerprint as the agreement
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

                              <SignaturePad
                                key={sigPadKey}
                                onChange={setSigBlob}
                                disabled={busy}
                              />

                              <button
                                type="button"
                                className={`btn btn-primary btn-lg${busy ? ' btn--busy' : ''}`}
                                disabled={
                                  !signFile ||
                                  !signFileMatches ||
                                  !sigBlob ||
                                  (partyNeedsSignerName(signingResolution.party) &&
                                    !signerName.trim()) ||
                                  busy
                                }
                                onClick={() => void signAsCurrentUser()}
                              >
                                {busy ? (
                                  <>
                                    <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                                    Signing…
                                  </>
                                ) : (
                                  `Sign as ${pendingParty.roleLabel}`
                                )}
                              </button>
                              <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                                Each co-signer uses their own wallet. After you sign, the next
                                party can open the same invite link or drop this PDF.
                              </p>
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
                              ? `All ${requiredCount(doc)} signatures collected.`
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
                                : 'Sealing redirects to Nimiq Hub in this tab. Keep VeriLock open until you return and the on-chain proof is confirmed. Or buy credits with NIM / card above to seal without another wallet payment.'}
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
                              Drop any copy of <em>{doc.fileName}</em> to check integrity
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
                              .
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
                    We hash the PDF locally, then look up sealed fingerprints on the server.
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
                                      const { document } = await api.getDocument(m.slug)
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
                    <button type="button" className="btn btn-secondary" onClick={resetAll}>
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
