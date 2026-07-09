import {
  Check,
  Fingerprint,
  HelpCircle,
  LoaderCircle,
  Lock,
  RotateCcw,
  Shield,
  ShieldCheck,
  Upload,
  Users,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeAddress } from '../addresses'
import { isDocumentCreator } from '../agreements'
import { api } from '../api'
import { FEATURES } from '../features'
import { clampField, MAX_DISPLAY_NAME_LENGTH, MAX_TITLE_LENGTH } from '../fieldLimits'
import { getPdfPageCount, sha256Hex, shortHash } from '../pdf/hashPdf'
import { prepareSignatureImageUpload } from '../signatureImage'
import { SealPricingDisplay } from '../SealPricingDisplay'
import { ShareInviteCard } from '../ShareInviteCard'
import {
  formatPartyRole,
  partyNeedsSignerName,
  resolveSigningParty,
} from '../signing'
import type { SealDocument, VerifyResult } from '../types'
import { VerifyMatchesPanel } from '../VerifyMatchesPanel'
import { DocumentStage } from './DocumentStage'
import { FeatureRotator } from './FeatureRotator'
import { JourneyAgreements } from './JourneyAgreements'
import {
  clearJourneyIntent,
  resolveJourneyIntent,
  saveJourneyIntent,
  syncIntentToUrl,
} from './journeyIntent'
import { finishJourneyLock, sealJourneyDocument } from './journeySeal'
import { formatFileSize } from './PdfDropZone'
import { SignaturePad } from './SignaturePad'
import { StageRail } from './StageRail'
import { saveHubReturnPath } from '../hubReturnPath'
import {
  allSigned,
  CREATOR_STAGES,
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

async function loadVerifyDetails(slugs: string[]): Promise<VerifyResult[]> {
  const unique = [...new Set(slugs)]
  const details = await Promise.all(unique.map(slug => api.verifyDocument(slug)))
  return details.sort((a, b) => (b.lockedAt ?? b.createdAt) - (a.lockedAt ?? a.createdAt))
}

export function DocumentJourney({ wallet }: DocumentJourneyProps) {
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
  const fileSizeByDocIdRef = useRef<Record<string, number>>({})

  const bumpAgreements = useCallback(() => {
    setAgreementsRefreshKey(k => k + 1)
  }, [])

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

  // Deep-link /d/:slug (invite) or /v/:slug (verify record)
  useEffect(() => {
    if (!bootReady) return
    const docSlug = slugFromPath(window.location.pathname)
    const vSlug = verifySlugFromPath(window.location.pathname)

    if (vSlug) {
      let cancelled = false
      void (async () => {
        try {
          const details = await loadVerifyDetails([vSlug])
          if (cancelled || details.length === 0) return
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
            const { document } = await api.getDocument(vSlug)
            if (!cancelled) setActiveFromSeal(document)
          } catch {
            /* verify record is enough */
          }
        } catch (err) {
          if (!cancelled) {
            setLocalError(err instanceof Error ? err.message : 'Could not open verify link')
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
        const { document } = await api.getDocument(docSlug)
        if (cancelled) return
        setActiveFromSeal(document)
        setSharedAck(true)
        const isCreator =
          address &&
          document.creatorAddress.replace(/\s/g, '').toUpperCase() ===
            address.replace(/\s/g, '').toUpperCase()
        setRole(isCreator ? 'creator' : 'signer')
      } catch (err) {
        if (!cancelled) {
          setLocalError(err instanceof Error ? err.message : 'Could not open agreement link')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bootReady, address, setActiveFromSeal])

  // Hub seal return
  useEffect(() => {
    registerHubLockComplete(async result => {
      try {
        setBusy(true)
        setLockMessage('Finishing seal from Nimiq Hub…')
        const me = await api.me(result.token)
        applySession(result.token, me.address)
        const { document: current } = await api.getDocument(result.docId)
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
          prev.trim()
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
    setRole(null)
    clearJourneyIntent()
    syncIntentToUrl(null)
    setPdfFile(null)
    setPdfHash(null)
    setTitle('')
    setCreatorName('')
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
      const parties = directSeal
        ? []
        : Array.from({ length: extraSigners }, (_, index) => ({
            role: 'signer',
            displayName:
              extraSigners === 1 ? 'Invited signer' : `Invited signer ${index + 1}`,
            required: true,
          }))

      const notifyEmail =
        FEATURES.emailNotifyUi && creatorNotifyEmail.trim()
          ? creatorNotifyEmail.trim()
          : undefined

      const { document, hashWarning } = await api.createDocument(token, {
        title: clampField(title || pdfFile.name.replace(/\.pdf$/i, ''), MAX_TITLE_LENGTH),
        originalFileName: pdfFile.name,
        type: 'other',
        creatorRole: 'creator',
        creatorDisplayName: clampField(creatorName.trim(), MAX_DISPLAY_NAME_LENGTH),
        originalSha256: pdfHash,
        pageCount,
        requiredSignatures: effectiveRequired,
        parties: parties.length > 0 ? parties : undefined,
        ...(notifyEmail ? { creatorNotifyEmail: notifyEmail } : {}),
      })

      if (hashWarning) setLocalError(hashWarning)
      setActiveFromSeal(document, pdfFile.size)
      setSharedAck(false)
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
      setSharedAck(true)
      window.setTimeout(() => setLinkCopied(false), 1800)
    } catch {
      setSharedAck(true)
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
        setLockMessage('All signatures collected - continue to seal.')
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

  const connectFromPath = () => {
    // Stamp intent into URL only when connecting (Hub return needs it).
    if (role) {
      saveJourneyIntent(role)
      syncIntentToUrl(role)
    }
    saveHubReturnPath()
    void connect()
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
            <span className="trust-bar-sub">
              {' '}
              Only a SHA-256 fingerprint is stored / sealed on-chain.
            </span>
          </span>
          <span className={`trust-chevron${privacyOpen ? ' trust-chevron--open' : ''}`} />
        </button>
        {privacyOpen && (
          <div className="trust-bar-detail">
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
        />
      )}

      {step === 'welcome' && (
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
          <SealPricingDisplay className="journey-pricing" />
        </section>
      )}

      {step !== 'welcome' && (
        <>
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
                        ? 'Connect your wallet'
                        : activeStage?.verb ?? 'Continue'}
                </h3>
                <p className="muted action-blurb">
                  {step === 'done' && role === 'signer'
                    ? (activeStage?.blurb ??
                      'Your signature is recorded. When everyone has signed, the agreement is sealed on Nimiq.')
                    : step === 'done'
                      ? 'Keep your PDF. Drop a copy below anytime to verify the fingerprint.'
                      : step === 'connect' && role === 'signer'
                        ? 'Connect first, then match the shared PDF and sign.'
                        : step === 'connect' && role === 'verifier'
                          ? 'Wallet is optional for verify — you can skip connect if you only need to check a PDF.'
                          : step === 'connect'
                            ? 'Step 1 only — prove who you are. Your PDF comes next.'
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
            {lockMessage && !displayError && (
              <div className="result-banner result-banner--ok" role="status">
                {lockMessage}
              </div>
            )}

            <div className="action-dock-body">
              {step === 'connect' && (
                <div className="action-stack">
                  <p className="muted" style={{ margin: 0 }}>
                    Connect with Nimiq Pay (in-app) or Nimiq Hub.
                    {role === 'signer'
                      ? ' After connect you can drop the shared PDF to open the agreement.'
                      : role === 'verifier'
                        ? ' Wallet is optional for verify - connect only if you need it.'
                        : ' After connect, step 2 opens the PDF stage.'}
                  </p>
                  <button
                    type="button"
                    className={`btn btn-primary btn-lg${connecting ? ' btn--busy' : ''}`}
                    onClick={connectFromPath}
                    disabled={connecting}
                  >
                    {connecting ? (
                      <>
                        <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                        Connecting…
                      </>
                    ) : (
                      <>
                        <Wallet size={18} strokeWidth={2.25} />
                        Connect Nimiq wallet
                      </>
                    )}
                  </button>
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
                    <span className="field-label">Your full name</span>
                    <input
                      value={creatorName}
                      onChange={e => setCreatorName(e.target.value)}
                      placeholder="Alex Rivera"
                      autoComplete="name"
                    />
                  </label>
                  {FEATURES.emailNotifyUi && (
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
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Lease - 12 Maple St"
                    />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={directSeal}
                      onChange={e => setDirectSeal(e.target.checked)}
                    />
                    <span>Seal directly - no co-signers</span>
                  </label>
                  {!directSeal && (
                    <label className="field">
                      <span className="field-label">How many parties must sign?</span>
                      <select
                        value={requiredSigners}
                        onChange={e => setRequiredSigners(Number(e.target.value))}
                      >
                        {[1, 2, 3, 4].map(n => (
                          <option key={n} value={n}>
                            {n} {n === 1 ? 'party' : 'parties'} (multi-party when 2+)
                          </option>
                        ))}
                      </select>
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
                  <PartyList doc={doc} />
                  <ShareInviteCard
                    document={doc.source}
                    shareUrl={doc.shareUrl}
                    linkCopied={linkCopied}
                    onCopyLink={() => void copyLink()}
                    embedded
                  />
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => setSharedAck(true)}>
                    I&apos;ve shared - open multi-party signing
                  </button>
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

                      <PartyList doc={doc} />

                      {allSigned(doc) ? (
                        <div className="result-banner result-banner--ok">
                          <Check size={18} strokeWidth={2.5} />
                          All parties signed - continue to seal
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
                              <Wallet size={16} strokeWidth={2.25} />
                              Connect to sign
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
                  <DocumentStage
                    step={step}
                    doc={doc}
                    file={pdfFile}
                    accepting={false}
                    sealing={busy}
                  />
                  {!doc.directSeal && <PartyList doc={doc} />}
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
                        : `All ${requiredCount(doc)} signatures collected.`}
                    </p>
                  </div>
                  <SealPricingDisplay className="journey-pricing journey-pricing--seal" />
                  <button
                    type="button"
                    className={`btn btn-primary btn-lg${busy ? ' btn--busy' : ''}`}
                    disabled={busy || !account}
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
                        Seal fingerprint on-chain
                      </>
                    )}
                  </button>
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
                                    href={doc.source.attestation.explorerUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    view on explorer
                                  </a>
                                </>
                              ) : null}
                              .
                            </>
                          ) : role === 'signer' ? (
                            <>
                              Waiting for remaining signers
                              {allSigned(doc) ? ' and the on-chain seal' : ''}. Keep{' '}
                              <em>{doc.fileName}</em> — you can verify anytime after sealing.
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

      <section className="how-block">
        <button
          type="button"
          className="how-toggle"
          onClick={() => setHowOpen(v => !v)}
          aria-expanded={howOpen}
        >
          <HelpCircle size={18} strokeWidth={2.25} aria-hidden />
          <span>
            <strong>How VeriLock works</strong>
            <span className="muted">
              {role === 'signer'
                ? ' Invited path: connect → sign'
                : role === 'verifier'
                  ? ' Verify path: drop a PDF anytime'
                  : ' Creator path: connect → seal → verify'}
            </span>
          </span>
          <span className={`trust-chevron${howOpen ? ' trust-chevron--open' : ''}`} />
        </button>
        {howOpen && (
          <ol className="how-list">
            {(role ? pathStages : CREATOR_STAGES).map((s, i) => (
              <li key={s.id}>
                <span className="how-num">{i + 1}</span>
                <div>
                  <strong>{s.label}</strong> - {s.blurb}
                  <p className="how-privacy muted">{s.privacyNote}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

    </div>
  )
}

function PartyList({ doc }: { doc: JourneyDoc }) {
  if (doc.directSeal || doc.parties.length === 0) return null
  return (
    <ul className="party-list">
      {doc.parties.map(p => (
        <li key={p.id} className={p.signed ? 'party-list-item party-list-item--done' : 'party-list-item'}>
          <span className="party-list-check" aria-hidden>
            {p.signed ? <Check size={14} strokeWidth={2.5} /> : null}
          </span>
          <div>
            <strong>{p.roleLabel}</strong>
            {p.displayName ? <span className="muted"> · {p.displayName}</span> : null}
            {p.walletShort ? (
              <span className="muted"> · {p.walletShort}</span>
            ) : (
              <span className="muted"> · waiting</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
