import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, FilePlus, Home, LoaderCircle, Search } from 'lucide-react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { api } from './api'
import {
  canLockViaPay,
  connectNimiq,
  connectViaHub,
  HUB_REDIRECT_MESSAGE,
  isHubRedirectError,
  isNimiqPayHost,
  peekHubRedirectInUrl,
  isPopupBlockedError,
  popupBlockedHelp,
  probeNimiqPay,
  ensureNimiqProvider,
  sendLockAttestation,
  sendLockAttestationViaHub,
  setSealProgressReporter,
  setupHubRedirectHandlers,
  type BroadcastFallbackFactory,
  signChallenge,
  warmNimiqProvider,
} from './nimiq'
import { pollAttestation } from './pollAttestation'
import { sealError, sealLog, sealWarn } from './sealDebug'
import { shortAddress } from './addresses'
import { buildNimiqExplorerUrl } from './explorer'
import {
  countActionable,
  isCollectingSignatures,
  isSealingPhase,
  isSigningComplete,
} from './agreements'
import { AgreementsPanel } from './AgreementsPanel'
import { SealCard } from './SealCard'
import {
  markSealRedirectStarted,
  resolveHubSealResumeSlug,
  shouldAutoStartSeal,
  shouldShowStaleSealNotice,
  staleSealNoticeFor,
} from './sealFlow'
import {
  clearSealInFlight,
  loadSealInFlight,
  pruneExpiredSealInFlight,
  RPC_ID_SEARCH_PARAM,
  shouldResumeHubSeal,
} from './sealRecovery'
import { clearSession, loadSession, saveSession } from './session'
import { DateField } from './DateField'
import { FilePicker } from './FilePicker'
import { PrivacyNotice } from './PrivacyNotice'
import { NimiqPayOpenPanel } from './NimiqPayOpenPanel'
import { NimiqSealInfo } from './NimiqSealInfo'
import { formatSealFeeNim, getSealPricing } from './sealPricing'
import { SignaturesPanel } from './SignaturesPanel'
import { prepareSignatureImageUpload } from './signatureImage'
import { getPdfPageCount, sha256Hex } from './pdf/hashPdf'
import {
  formatPartyRole,
  isPlaceholderPartyName,
  partyNeedsSignerName,
  resolveSigningParty,
} from './signing'
import type { RentalMetadata, SealDocument, VerifyResult } from './types'
import {
  formatStepLabel,
  resolveCurrentStep,
  resolveRole,
  WorkflowGuide,
  WorkflowNextAction,
  WorkflowProgress,
} from './WorkflowGuide'
import './App.css'

type Screen = 'home' | 'create' | 'document' | 'verify'

const createServerBroadcastFallback: BroadcastFallbackFactory = sessionToken => {
  return async serializedTx => {
    await api.broadcastTransaction(sessionToken, serializedTx)
  }
}

function statusClass(status: string): string {
  if (status === 'locked' || status === 'signed' || status === 'confirmed') return 'status-signed'
  if (status === 'ready_to_lock' || status === 'locking') return 'status-ready'
  return 'status-pending'
}

function documentStatusLabel(doc: SealDocument): string {
  if (doc.status === 'locked' || doc.attestation?.status === 'confirmed') return 'locked'
  if (doc.attestation?.status === 'failed' && doc.status !== 'locked') return 'ready to lock'
  if (doc.status === 'locking' && doc.attestation?.status !== 'confirmed') return 'ready to lock'
  return doc.status
}

function showSealedConfirmation(doc: SealDocument): boolean {
  return doc.attestation?.status === 'confirmed' || doc.status === 'locked'
}

function scrollToSealedConfirmation(): void {
  requestAnimationFrame(() => {
    document.getElementById('sealed-confirmation')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function SignaturePad({ onChange }: { onChange: (blob: Blob | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * 2
    canvas.height = rect.height * 2
    ctx.scale(2, 2)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true
    const ctx = canvasRef.current?.getContext('2d')
    const p = point(e)
    ctx?.beginPath()
    ctx?.moveTo(p.x, p.y)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    const p = point(e)
    ctx?.lineTo(p.x, p.y)
    ctx?.stroke()
  }

  const end = () => {
    drawing.current = false
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(blob => onChange(blob), 'image/png')
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    onChange(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="signature-pad"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <button type="button" className="btn btn-ghost" onClick={clear} style={{ marginTop: '0.5rem' }}>
        Clear signature
      </button>
    </div>
  )
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [token, setToken] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [nimiq, setNimiq] = useState<NimiqProvider | null>(null)
  const [documents, setDocuments] = useState<SealDocument[]>([])
  const [activeDoc, setActiveDoc] = useState<SealDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inNimiqPay, setInNimiqPay] = useState(false)

  const [showOpenInPay, setShowOpenInPay] = useState(false)
  const [walletStatus, setWalletStatus] = useState<string | null>(null)


  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState('rental')
  const [myRole, setMyRole] = useState<'landlord' | 'tenant' | 'signer'>('landlord')
  const [myName, setMyName] = useState('')
  const [requiredSignatures, setRequiredSignatures] = useState(2)
  const [tenantName, setTenantName] = useState('')
  const [propertyAddress, setPropertyAddress] = useState('')
  const [monthlyRent, setMonthlyRent] = useState('')
  const [deposit, setDeposit] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfHash, setPdfHash] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createFormKey, setCreateFormKey] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [sigBlob, setSigBlob] = useState<Blob | null>(null)
  const [signPdfFile, setSignPdfFile] = useState<File | null>(null)
  const [signPdfHash, setSignPdfHash] = useState<string | null>(null)
  const [signPdfLoading, setSignPdfLoading] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [lockMessage, setLockMessage] = useState<string | null>(null)
  const [lockError, setLockError] = useState<string | null>(null)

  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [verifyHash, setVerifyHash] = useState<string | null>(null)
  const [verifyResult, setVerifyResult] = useState<{
    message: string
    tone: 'success' | 'warn' | 'neutral'
  } | null>(null)
  const [verifySlug, setVerifySlug] = useState('')
  const [verifyDetail, setVerifyDetail] = useState<VerifyResult | null>(null)
  const [shareLinkCopied, setShareLinkCopied] = useState(false)

  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const seedSignPdfHashRef = useRef<string | null>(null)
  const autoLockAttemptedRef = useRef<Set<string>>(new Set())
  const pendingCreateScrollRef = useRef(false)
  const pendingSealSlugRef = useRef<string | null>(null)
  const sealInFlightRef = useRef(false)
  const workflowRole = resolveRole({
    hasWallet: Boolean(token),
    address,
    activeDoc,
    screen,
  })
  const workflowStep = resolveCurrentStep({
    hasWallet: Boolean(token),
    address,
    activeDoc,
    screen,
  })
  const isCreatorOnDoc =
    workflowRole === 'creator' && screen === 'document' && activeDoc !== null
  const isInvitedSigner = workflowRole === 'signer' && screen === 'document' && activeDoc !== null



  useEffect(() => {
    const seeded = seedSignPdfHashRef.current
    if (seeded && activeDoc?.originalSha256 === seeded) {
      setSignPdfHash(seeded)
      seedSignPdfHashRef.current = null
      setSignPdfFile(null)
      setSignPdfLoading(false)
      setSigBlob(null)
      return
    }
    setSignPdfFile(null)
    setSignPdfHash(null)
    setSignPdfLoading(false)
    setSigBlob(null)
  }, [activeDoc?.id, activeDoc?.originalSha256])

  useEffect(() => {
    if (!activeDoc || !address) {
      setSignerName('')
      return
    }
    const resolution = resolveSigningParty(activeDoc, address)
    if (!resolution.ok || !partyNeedsSignerName(resolution.party)) {
      setSignerName('')
      return
    }
    setSignerName(
      isPlaceholderPartyName(resolution.party.displayName) ? '' : resolution.party.displayName,
    )
  }, [activeDoc?.id, activeDoc?.parties, address])

  const refreshMe = useCallback(async (sessionToken: string) => {
    const me = await api.me(sessionToken)
    setDocuments(me.documents)
    setAddress(me.address)
    saveSession({ token: sessionToken, address: me.address })
    return me
  }, [])

  const applySession = useCallback((sessionToken: string, userAddress: string) => {
    setToken(sessionToken)
    setAddress(userAddress)
    saveSession({ token: sessionToken, address: userAddress })
  }, [])

  const resetCreateForm = useCallback(() => {
    setTitle('')
    setDocType('rental')
    setMyRole('landlord')
    setMyName('')
    setRequiredSignatures(2)
    setTenantName('')
    setPropertyAddress('')
    setMonthlyRent('')
    setDeposit('')
    setStartDate('')
    setEndDate('')
    setPdfFile(null)
    setPdfHash(null)
    setPageCount(1)
    setPdfLoading(false)
    setCreating(false)
    setCreateFormKey(key => key + 1)
  }, [])

  const documentShareUrl = activeDoc ? `${appUrl}/d/${activeDoc.slug}` : ''

  const copyDocumentShareLink = useCallback(async () => {
    if (!documentShareUrl) return
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(documentShareUrl)
    }
    setShareLinkCopied(true)
    window.setTimeout(() => setShareLinkCopied(false), 2500)
  }, [documentShareUrl])

  const goToCreate = useCallback(() => {
    if (!token) return
    resetCreateForm()
    setScreen('create')
    window.history.pushState({}, '', '/')
    pendingCreateScrollRef.current = true
  }, [token, resetCreateForm])

  useEffect(() => {
    if (screen !== 'create' || !pendingCreateScrollRef.current) return
    pendingCreateScrollRef.current = false
    requestAnimationFrame(() => {
      document.getElementById('create-agreement')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [screen, createFormKey])

  const loadDocument = async (idOrSlug: string) => {
    setBusy(true)
    setError(null)
    try {
      const { document } = await api.getDocument(idOrSlug)
      setActiveDoc(document)
      setScreen('document')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document')
    } finally {
      setBusy(false)
    }
  }

  const openDocument = (slug: string) => {
    void loadDocument(slug)
    window.history.pushState({}, '', `/d/${slug}`)
  }

  const goHome = useCallback(() => {
    setScreen('home')
    if (token) void refreshMe(token)
  }, [token, refreshMe])

  const actionableAgreementCount = countActionable(documents, address)

  const connectWallet = async (options?: { useRedirect?: boolean; usePopup?: boolean }) => {
    setBusy(true)
    setError(null)
    setShowOpenInPay(false)
    setWalletStatus(null)
    try {
      const payHost = isNimiqPayHost()
      setWalletStatus(
        payHost
          ? 'Waiting for Nimiq Pay wallet… approve the dialog when it appears.'
          : 'Connecting…',
      )

      // window.nimiq may lag behind window.nimiqPay inside the Nimiq Pay WebView.
      const inPay = payHost || (await probeNimiqPay(payHost ? 30_000 : 10_000))
      setInNimiqPay(inPay || payHost)

      if (!inPay) {
        if (payHost) {
          throw new Error(
            'Nimiq Pay wallet is still loading. Wait a few seconds, then tap Connect wallet again.',
          )
        }

        const preferRedirect = options?.useRedirect ?? !options?.usePopup
        if (preferRedirect) {
          setWalletStatus('Redirecting to Nimiq Hub…')
          await connectViaHub(async addr => api.challenge(addr), { preferRedirect: true })
          return
        }

        try {
          setWalletStatus('Opening Nimiq Hub… allow pop-ups if prompted.')
          const result = await connectViaHub(async addr => api.challenge(addr))
          const verified = await api.verify(result.token, {
            publicKey: result.publicKey,
            signature: result.signature,
            authScheme: 'hub',
          })
          applySession(result.token, verified.address)
          await refreshMe(result.token)
          setWalletStatus('Wallet connected.')
          return
        } catch (hubErr) {
          if (isPopupBlockedError(hubErr)) {
            setShowOpenInPay(true)
            throw new Error(popupBlockedHelp())
          }
          throw hubErr
        }
      }

      setWalletStatus('Approve account access in Nimiq Pay…')
      const { nimiq: provider, address: addr } = await connectNimiq()
      const { token: sessionToken, nonce } = await api.challenge(addr)
      setWalletStatus('Approve the login signature in Nimiq Pay…')
      const { publicKey, signature } = await signChallenge(provider, nonce)
      const verified = await api.verify(sessionToken, { publicKey, signature, authScheme: 'pay' })
      setNimiq(provider)
      applySession(sessionToken, verified.address)
      await refreshMe(sessionToken)
      setWalletStatus('Wallet connected.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Wallet connection failed'
      if (isHubRedirectError(err)) {
        setError(null)
        setWalletStatus(HUB_REDIRECT_MESSAGE)
        return
      }
      setError(message)
      setWalletStatus(null)
    } finally {
      setBusy(false)
    }
  }

  const onPdfSelected = async (file: File | null) => {
    setPdfFile(file)
    setPdfHash(null)
    if (!file) {
      setPdfLoading(false)
      return
    }
    setPdfLoading(true)
    setError(null)
    try {
      const buffer = await file.arrayBuffer()
      const hash = await sha256Hex(buffer)
      const pages = await getPdfPageCount(file)
      setPdfHash(hash)
      setPageCount(pages)
      if (!title.trim()) {
        setTitle(file.name.replace(/\.pdf$/i, ''))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  const onSignPdfSelected = async (file: File | null) => {
    setSignPdfFile(file)
    setSignPdfHash(null)
    if (!file || !activeDoc) {
      setSignPdfLoading(false)
      return
    }
    setSignPdfLoading(true)
    setError(null)
    try {
      const hash = await sha256Hex(await file.arrayBuffer())
      if (hash !== activeDoc.originalSha256) {
        setError(
          'This PDF does not match the agreement fingerprint. Use the exact file the creator shared.',
        )
        setSignPdfHash(null)
        return
      }
      setSignPdfHash(hash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read PDF')
    } finally {
      setSignPdfLoading(false)
    }
  }

  const createAgreement = async () => {
    if (!token || !pdfFile || !pdfHash || pdfLoading || creating) return
    if (!myName.trim()) {
      setError('Enter your full name before creating the agreement')
      return
    }
    setBusy(true)
    setCreating(true)
    setError(null)
    try {
      const creatorRole = docType === 'rental' ? myRole : 'signer'
      const otherRole =
        docType === 'rental'
          ? myRole === 'landlord'
            ? 'tenant'
            : 'landlord'
          : 'signer'
      const otherDefaultName = (index: number, total: number) => {
        if (otherRole === 'tenant') {
          return total === 1 ? 'Invited tenant' : `Invited tenant ${index + 1}`
        }
        if (otherRole === 'landlord') {
          return total === 1 ? 'Invited landlord' : `Invited landlord ${index + 1}`
        }
        return total === 1 ? 'Invited signer' : `Invited signer ${index + 1}`
      }
      const extraSigners = Math.max(0, requiredSignatures - 1)
      const parties = Array.from({ length: extraSigners }, (_, index) => ({
        role: otherRole,
        displayName:
          index === 0 && tenantName.trim()
            ? tenantName.trim()
            : otherDefaultName(index, extraSigners),
        required: true,
      }))
      let metadata: RentalMetadata | undefined
      if (docType === 'rental') {
        const rental: RentalMetadata = {
          propertyAddress: propertyAddress.trim() || undefined,
          monthlyRent: monthlyRent.trim() || undefined,
          deposit: deposit.trim() || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        }
        if (Object.values(rental).some(Boolean)) {
          metadata = rental
        }
      }
      const { document } = await api.createDocument(token, {
        title: title || pdfFile.name.replace(/\.pdf$/i, ''),
        originalFileName: pdfFile.name,
        type: docType,
        creatorRole,
        creatorDisplayName: myName.trim(),
        originalSha256: pdfHash,
        pageCount,
        requiredSignatures,
        parties: parties.length > 0 ? parties : undefined,
        metadata,
      })
      seedSignPdfHashRef.current = pdfHash
      resetCreateForm()
      setActiveDoc(document)
      setScreen('document')
      window.history.pushState({}, '', `/d/${document.slug}`)
      await refreshMe(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setCreating(false)
      setBusy(false)
    }
  }

  const signAsCurrentUser = async () => {
    if (!token || !activeDoc || !address) return
    const resolution = resolveSigningParty(activeDoc, address)

    if (!resolution.ok) {
      setError(resolution.message)
      if (resolution.hint === 'already_signed' || resolution.hint === 'complete') {
        void loadDocument(activeDoc.slug)
      }
      return
    }

    const myParty = resolution.party

    if (partyNeedsSignerName(myParty) && !signerName.trim()) {
      setError('Enter your full name before signing')
      return
    }

    if (!signPdfHash || signPdfHash !== activeDoc.originalSha256) {
      setError('Choose the matching PDF on your computer before signing')
      return
    }

    setBusy(true)
    setError(null)
    try {
      let signatureImage: string | undefined
      if (sigBlob) {
        signatureImage = await prepareSignatureImageUpload(sigBlob)
      }

      const { document } = await api.signDocument(token, activeDoc.id, {
        partyId: myParty.id,
        signatureType: sigBlob ? 'drawn' : 'typed',
        clientSha256: activeDoc.originalSha256,
        displayName: partyNeedsSignerName(myParty) ? signerName.trim() : undefined,
        signatureImage,
      })
      setSigBlob(null)
      setActiveDoc(document)
      await refreshMe(token)
      if (
        document.signingProgress.readyToLock &&
        document.status !== 'locked' &&
        document.status !== 'locking' &&
        !sealInFlightRef.current
      ) {
        setLockMessage('All signatures collected — tap Seal agreement when you are ready.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign failed')
    } finally {
      setBusy(false)
    }
  }

  const recoverSealAfterError = useCallback(async (docId?: string) => {
    const targetId = docId ?? activeDoc?.id
    if (!targetId) return
    try {
      const { document } = await api.getDocument(targetId)
      setActiveDoc(document)
    } catch (err) {
      sealWarn('recoverSealAfterError:failed', err)
    }
  }, [activeDoc?.id])

  const finishLock = async (docId: string, txHash: string, sessionToken: string) => {
    sealLog('finishLock:submitAttestation', { docId, txHash })
    await api.submitAttestation(sessionToken, docId, txHash)
    setLockMessage('Waiting for block confirmation…')
    sealLog('finishLock:pollAttestation', { txHash })
    await pollAttestation({
      token: sessionToken,
      txHash,
      onStatus: s => {
        sealLog('finishLock:attestationStatus', s)
        setLockMessage(s.status === 'pending' ? 'Confirming on-chain…' : 'Confirmed!')
      },
    })
    const { document } = await api.getDocument(docId)
    setActiveDoc(document)
    const me = await refreshMe(sessionToken)
    setDocuments(me.documents.map(d => (d.id === document.id ? document : d)))
    setScreen('document')
    window.history.replaceState({}, '', `/d/${document.slug}`)
    clearSealInFlight()
    setLockError(null)
    setBusy(false)
    setLockMessage('Agreement locked on the Nimiq blockchain.')
    sealLog('finishLock:complete', { docId, status: document.status })
    scrollToSealedConfirmation()
  }

  const lockDocument = async (options?: { useRedirect?: boolean; preferPopup?: boolean }) => {
    if (peekHubRedirectInUrl()) {
      sealWarn('lockDocument:skipped (hub redirect response in URL)')
      return
    }
    if (sealInFlightRef.current) {
      sealWarn('lockDocument:skipped (already in flight)')
      return
    }
    if (!token || !activeDoc || !address) {
      sealWarn('lockDocument:skipped (missing session)', {
        hasToken: Boolean(token),
        hasDoc: Boolean(activeDoc),
        hasAddress: Boolean(address),
      })
      return
    }

    sealInFlightRef.current = true
    const finalHash = activeDoc.finalSha256 ?? activeDoc.originalSha256
    setBusy(true)
    setError(null)
    setLockError(null)
    setLockMessage(
      activeDoc.attestation?.status === 'failed'
        ? 'Starting a new seal attempt…'
        : 'Preparing lock…',
    )
    let redirecting = false

    sealLog('lockDocument:start', {
      docId: activeDoc.id,
      slug: activeDoc.slug,
      status: activeDoc.status,
      finalHash,
      options,
    })

    try {
      sealLog('lockDocument:prepareLock')
      await api.prepareLock(token, activeDoc.id, finalHash)

      const usePay = await canLockViaPay(nimiq)
      sealLog('lockDocument:walletPath', { usePay, hasNimiq: Boolean(nimiq) })
      let txHash: string

      if (usePay) {
        const provider = await ensureNimiqProvider(nimiq)
        setNimiq(provider)
        setLockMessage(`Confirm the ${formatSealFeeNim(getSealPricing().feeNim)} seal transaction in Nimiq Pay…`)
        txHash = await sendLockAttestation(provider, address, activeDoc.id, finalHash)
      } else {
        const preferRedirect =
          options?.useRedirect ?? (options?.preferPopup ? false : !isNimiqPayHost())
        if (preferRedirect) {
          saveSession({ token, address })
          markSealRedirectStarted({
            slug: activeDoc.slug,
            docId: activeDoc.id,
            token,
            address,
          })
        }
        setLockMessage(
          preferRedirect
            ? 'Redirecting to Nimiq Hub…'
            : `Hub popup opened — confirm the ${formatSealFeeNim(getSealPricing().feeNim)} seal transaction there. Keep this tab open.`,
        )
        sealLog('lockDocument:hubSign', { preferRedirect, address })
        txHash = await sendLockAttestationViaHub(address, activeDoc.id, finalHash, {
          preferRedirect,
          token,
          broadcastFallback: createServerBroadcastFallback(token),
        })
      }

      sealLog('lockDocument:txSigned', { txHash })
      setLockMessage('Submitting on-chain proof…')
      await api.beginLock(token, activeDoc.id)
      await finishLock(activeDoc.id, txHash, token)
    } catch (err) {
      if (isHubRedirectError(err)) {
        redirecting = true
        setLockError(null)
        setLockMessage(HUB_REDIRECT_MESSAGE)
        sealLog('lockDocument:redirectingToHub')
        return
      }
      const message = err instanceof Error ? err.message : 'Lock failed'
      sealError('lockDocument:failed', err)
      if (isPopupBlockedError(err)) {
        setShowOpenInPay(true)
        setLockError(message)
        setLockMessage('Popup blocked — use Open Hub (full page) below.')
      } else {
        setError(message)
        setLockError(message)
        setLockMessage(
          `Seal interrupted: ${message}. Your signatures are still saved — tap Retry seal to continue.`,
        )
        await recoverSealAfterError(activeDoc?.id)
      }
    } finally {
      if (!redirecting) {
        sealInFlightRef.current = false
        setBusy(false)
        sealLog('lockDocument:done', { redirecting })
      }
    }
  }

  const triggerSeal = async (slug?: string) => {
    if (!token || !address || sealInFlightRef.current || busy) return
    const targetSlug = slug ?? activeDoc?.slug
    if (!targetSlug) return

    if (activeDoc?.slug !== targetSlug) {
      pendingSealSlugRef.current = targetSlug
      openDocument(targetSlug)
      return
    }

    autoLockAttemptedRef.current.delete(activeDoc.id)
    await lockDocument()
  }

  useEffect(() => {
    if (!activeDoc || !pendingSealSlugRef.current) return
    if (activeDoc.slug !== pendingSealSlugRef.current) return
    if (!token || !address || busy || sealInFlightRef.current) return
    if (peekHubRedirectInUrl()) return
    pendingSealSlugRef.current = null
    autoLockAttemptedRef.current.delete(activeDoc.id)
    void lockDocument()
  }, [activeDoc?.id, activeDoc?.slug, token, address, busy])

  useEffect(() => {
    if (!activeDoc || !token || !address) return
    if (!shouldShowStaleSealNotice(activeDoc, busy, sealInFlightRef.current)) return

    sealLog('boot:staleSealInFlight', {
      seal: loadSealInFlight(),
      docStatus: activeDoc.status,
    })
    setLockError(null)
    setLockMessage(staleSealNoticeFor(activeDoc))
  }, [activeDoc?.id, activeDoc?.slug, activeDoc?.status, token, address, busy])

  useEffect(() => {
    if (!activeDoc || !token || !address) return
    if (
      !shouldAutoStartSeal({
        doc: activeDoc,
        address,
        busy,
        sealInFlight: sealInFlightRef.current,
        alreadyAttempted: autoLockAttemptedRef.current.has(activeDoc.id),
      })
    ) {
      return
    }

    autoLockAttemptedRef.current.add(activeDoc.id)
    sealLog('autoLock:start', { docId: activeDoc.id, slug: activeDoc.slug })
    void lockDocument()
  }, [
    activeDoc?.id,
    activeDoc?.slug,
    activeDoc?.status,
    activeDoc?.signingProgress.readyToLock,
    activeDoc?.attestation?.status,
    token,
    address,
    busy,
  ])

  useEffect(() => {
    setSealProgressReporter(message => setLockMessage(message))
    return () => setSealProgressReporter(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    let redirectLockHandled = false
    let hubLockCompletion: Promise<void> | null = null

    const boot = async () => {
      if (isNimiqPayHost()) {
        setInNimiqPay(true)
        warmNimiqProvider()
      }

      probeNimiqPay(isNimiqPayHost() ? 15_000 : 5_000).then(detected => {
        if (cancelled) return
        const inPay = detected || isNimiqPayHost()
        setInNimiqPay(inPay)
        if (inPay && window.nimiq) {
          setNimiq(window.nimiq)
        }
      })

      const stored = loadSession()
      if (stored) {
        setToken(stored.token)
        setAddress(stored.address)
      }

      pruneExpiredSealInFlight()
      const sealInFlightAtBoot = loadSealInFlight()
      const hubReturnPending = shouldResumeHubSeal()
      const resumeSlug = resolveHubSealResumeSlug(window.location.pathname, sealInFlightAtBoot)
      sealLog('boot:start', {
        path: window.location.pathname,
        href: window.location.href,
        referrer: document.referrer || '(empty)',
        hasStoredSession: Boolean(stored),
        sealInFlight: sealInFlightAtBoot,
        hubReturnPending,
        rpcId: new URLSearchParams(window.location.search).get('rpcId'),
      })

      // Process Hub hash before any replaceState — wiping the URL loses the redirect response.
      const hubRedirectSetup = await setupHubRedirectHandlers(
        async addr => api.challenge(addr),
        async result => {
          try {
            const verified = await api.verify(result.token, {
              publicKey: result.publicKey,
              signature: result.signature,
              authScheme: 'hub',
            })
            applySession(result.token, verified.address)
            await refreshMe(result.token)
            setError(null)
            setWalletStatus('Wallet connected.')
          } catch (err) {
            clearSession()
            setToken(null)
            setAddress(null)
            setError(err instanceof Error ? err.message : 'Hub redirect login failed')
          } finally {
            setBusy(false)
          }
        },
        err => {
          setError(err.message)
          setBusy(false)
        },
        async lockResult => {
          sealLog('hubRedirect:lockComplete', lockResult)
          try {
            sealInFlightRef.current = true
            setBusy(true)
            setLockError(null)
            setToken(lockResult.token)
            sealLog('hubRedirect:restoreSession')
            const me = await api.me(lockResult.token)
            if (cancelled) return
            applySession(lockResult.token, me.address)
            setDocuments(me.documents)
            sealLog('hubRedirect:loadDocument', { docId: lockResult.docId })
            const { document } = await api.getDocument(lockResult.docId)
            if (cancelled) return
            setActiveDoc(document)
            setScreen('document')
            window.history.replaceState({}, '', `/d/${document.slug}`)
            sealLog('hubRedirect:beginLock', { docId: lockResult.docId })
            await api.beginLock(lockResult.token, lockResult.docId)
            sealLog('hubRedirect:finishLock', { docId: lockResult.docId, txHash: lockResult.txHash })
            await finishLock(lockResult.docId, lockResult.txHash, lockResult.token)
            setError(null)
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Hub redirect lock failed'
            sealError('hubRedirect:lockCompleteFailed', err)
            setError(message)
            setLockError(message)
            setLockMessage(
              `Seal interrupted: ${message}. Your signatures are still saved — tap Retry seal to continue.`,
            )
            await recoverSealAfterError(lockResult.docId)
            clearSealInFlight()
            autoLockAttemptedRef.current.add(lockResult.docId)
          } finally {
            sealInFlightRef.current = false
            setBusy(false)
          }
        },
        async err => {
          sealError('hubRedirect:lockError', err)
          const failedDocId = loadSealInFlight()?.docId ?? sealInFlightAtBoot?.docId
          clearSealInFlight()
          if (failedDocId) {
            autoLockAttemptedRef.current.add(failedDocId)
          }
          setError(err.message)
          setLockError(err.message)
          setLockMessage(
            `Seal interrupted: ${err.message}. Your signatures are still saved — tap Retry seal to continue.`,
          )
          await recoverSealAfterError(failedDocId)
          sealInFlightRef.current = false
          setBusy(false)
        },
        createServerBroadcastFallback,
      )
      redirectLockHandled = hubRedirectSetup.redirectHandled
      hubLockCompletion = hubRedirectSetup.lockCompletion

      sealLog('boot:hubHandlersReady', {
        redirectLockHandled,
        awaitingLockCompletion: Boolean(hubLockCompletion),
      })

      if (cancelled) return

      const hydrateHubReturnDocument = async (seal: NonNullable<typeof sealInFlightAtBoot>) => {
        setScreen('document')
        applySession(seal.token, seal.address)
        setToken(seal.token)
        setAddress(seal.address)
        sealInFlightRef.current = true
        setBusy(true)
        setLockError(null)
        setLockMessage('Completing seal after Hub…')
        try {
          const { document } = await api.getDocument(seal.slug)
          if (!cancelled) setActiveDoc(document)
        } catch (err) {
          sealWarn('boot:hubReturnHydrateFailed', err)
        }
      }

      if (hubLockCompletion && sealInFlightAtBoot) {
        await hydrateHubReturnDocument(sealInFlightAtBoot)
        try {
          await hubLockCompletion
          sealLog('boot:hubLockCompletionDone', { slug: sealInFlightAtBoot.slug })
        } catch (err) {
          sealWarn('boot:hubLockCompletionFailed', err)
        }
        return
      }

      const hasRedirectPayload =
        peekHubRedirectInUrl() ||
        new URLSearchParams(window.location.search).has(RPC_ID_SEARCH_PARAM)
      if (sealInFlightAtBoot && !hasRedirectPayload && !hubLockCompletion) {
        sealLog('boot:clearedOrphanSealInFlight', { slug: sealInFlightAtBoot.slug })
        clearSealInFlight()
      }

      if (resumeSlug) {
        setScreen('document')
        if (!redirectLockHandled) {
          setLockMessage('Completing seal after Hub…')
        }
        try {
          const { document: doc } = await api.getDocument(resumeSlug)
          if (!cancelled) setActiveDoc(doc)
        } catch (err) {
          sealWarn('boot:hubReturnLoadDocumentFailed', err)
        }
      }

      if (redirectLockHandled && hubReturnPending) {
        sealLog('boot:hubReturnFinishing', { slug: sealInFlightAtBoot?.slug })
        return
      }

      if (hubReturnPending) {
        sealInFlightRef.current = false
        setBusy(false)
        setLockMessage(
          'Hub returned but the seal response was not processed. Tap Retry seal to try again.',
        )
      }

      const sessionToken = loadSession()?.token ?? stored?.token ?? null
      if (sessionToken) {
        try {
          const me = await api.me(sessionToken)
          if (cancelled) return
          applySession(sessionToken, me.address)
          setDocuments(me.documents)
        } catch {
          clearSession()
          setToken(null)
          setAddress(null)
          setDocuments([])
        }
      }

      if (cancelled) return

      const path = window.location.pathname
      const docMatch = path.match(/^\/d\/([^/]+)/)
      const verifyMatch = path.match(/^\/v\/([^/]+)/)
      if (docMatch) {
        setScreen('document')
        void loadDocument(docMatch[1]!)
      } else if (verifyMatch) {
        setScreen('verify')
        setVerifySlug(verifyMatch[1]!)
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
    // Mount-only bootstrap — hub redirect + session restore
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runVerifyUpload = async () => {
    if (!verifyFile) return
    setBusy(true)
    setError(null)
    setVerifyResult(null)
    setVerifyDetail(null)
    try {
      const hash = await sha256Hex(await verifyFile.arrayBuffer())
      setVerifyHash(hash)
      const { matches } = await api.verifyHash(hash)
      if (matches.length === 0) {
        setVerifyResult({
          message: 'No registered document matches this PDF hash.',
          tone: 'neutral',
        })
      } else {
        const locked = matches.filter(m => m.status === 'locked')
        const describeMatch = (match: (typeof matches)[number]) => {
          const name = match.originalFilename ?? match.title
          return match.originalFilename && match.originalFilename !== match.title
            ? `"${match.title}" (${match.originalFilename})`
            : `"${name}"`
        }
        setVerifyResult(
          locked.length > 0
            ? {
                message: `Match found — ${describeMatch(locked[0]!)} is locked on-chain.`,
                tone: 'success',
              }
            : {
                message: `Hash matches ${describeMatch(matches[0]!)} but document is not locked yet.`,
                tone: 'warn',
              },
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verify failed')
    } finally {
      setBusy(false)
    }
  }

  const runVerifySlug = async () => {
    if (!verifySlug) return
    setBusy(true)
    setError(null)
    setVerifyDetail(null)
    try {
      const result = await api.verifyDocument(verifySlug)
      setVerifyDetail(result)
      setVerifyHash(result.finalSha256 ?? result.originalSha256)
      const verifyLabel =
        result.originalFilename && result.originalFilename !== result.title
          ? `"${result.title}" (${result.originalFilename})`
          : `"${result.originalFilename ?? result.title}"`
      setVerifyResult(
        result.status === 'locked'
          ? {
              message: `${verifyLabel} locked at ${result.lockedAt ? new Date(result.lockedAt).toLocaleString() : 'unknown'}`,
              tone: 'success',
            }
          : {
              message: `Document ${verifyLabel} — status: ${result.status}`,
              tone: 'neutral',
            },
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verify failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img
            className="brand-mark"
            src="/verilock-logo-96.png"
            alt=""
            width={48}
            height={48}
            decoding="async"
          />
          <div className="brand-text">
            <h1>VeriLock</h1>
            <p>Sign it. Lock it. Prove it. Your PDF stays on your device.</p>
          </div>
        </div>
        {address ? (
          <span className="wallet-pill">
            {address.slice(0, 8)}…{address.slice(-4)}
          </span>
        ) : (
          <button className="btn btn-primary" onClick={() => void connectWallet()} disabled={busy}>
            Connect wallet
          </button>
        )}
      </header>

      <PrivacyNotice />

      <div className="tabs">
        <button className={`tab ${screen === 'home' ? 'active' : ''}`} onClick={() => goHome()}>
          <Home className="tab-icon" size={16} strokeWidth={2.25} aria-hidden />
          Home
          {actionableAgreementCount > 0 && (
            <span className="tab-badge" aria-label={`${actionableAgreementCount} agreements need action`}>
              {actionableAgreementCount}
            </span>
          )}
        </button>
        <button
          className={`tab ${screen === 'create' ? 'active' : ''}`}
          onClick={() => goToCreate()}
          disabled={!token}
          title={!token ? 'Connect your Nimiq wallet first' : undefined}
        >
          <FilePlus className="tab-icon" size={16} strokeWidth={2.25} aria-hidden />
          New
        </button>
        <button className={`tab ${screen === 'verify' ? 'active' : ''}`} onClick={() => setScreen('verify')}>
          <Search className="tab-icon" size={16} strokeWidth={2.25} aria-hidden />
          Verify
        </button>
      </div>

      {!token && screen !== 'verify' && (
        <p className="tab-hint">
          {isInvitedSigner
            ? 'Connect wallet to sign this agreement.'
            : 'Connect wallet first to unlock New agreement.'}
        </p>
      )}

      {screen === 'home' ? (
        <>
          <WorkflowGuide
            hasWallet={Boolean(token)}
            address={address}
            activeDoc={activeDoc}
            screen={screen}
          />
          <NimiqSealInfo />
        </>
      ) : screen !== 'document' ? (
        <>
          <WorkflowProgress current={workflowStep} role={workflowRole} />
          <WorkflowGuide
            hasWallet={Boolean(token)}
            address={address}
            activeDoc={activeDoc}
            screen={screen}
            compact
          />
        </>
      ) : null}

      {screen !== 'home' && screen !== 'document' && (
        <WorkflowNextAction
          hasWallet={Boolean(token)}
          address={address}
          activeDoc={activeDoc}
          screen={screen}
          onConnect={() => void connectWallet()}
          onGoCreate={goToCreate}
        />
      )}

      {walletStatus && <p className="wallet-status">{walletStatus}</p>}
      {error && <p className="error">{error}</p>}

      {!address && !inNimiqPay && !isNimiqPayHost() && (
        <div className="card banner-pay">
          <h2>Connect with Nimiq Pay or Hub</h2>
          <NimiqPayOpenPanel
            appUrl={appUrl}
            showHubFallback
            busy={busy}
            onHubRedirect={() => void connectWallet({ useRedirect: true })}
          />
        </div>
      )}

      {showOpenInPay && (
        <div className="card banner-popup">
          <h2>Pop-up blocked</h2>
          <p className="muted">Use Nimiq Pay on your phone, or continue with Hub redirect.</p>
          <NimiqPayOpenPanel
            appUrl={appUrl}
            compact
            showHubFallback
            busy={busy}
            onHubRedirect={() => void connectWallet({ useRedirect: true })}
          />
        </div>
      )}

      {screen === 'home' && (
        <>
          {!token ? (
            <div className="card">
              <h2>Your agreements</h2>
              <p className="muted">Connect wallet to view and manage your agreements.</p>
            </div>
          ) : (
            <AgreementsPanel
              documents={documents}
              address={address}
              activeDocId={activeDoc?.id}
              onOpen={openDocument}
              onSeal={slug => void triggerSeal(slug)}
              onCreateNew={goToCreate}
            />
          )}
        </>
      )}

      {token && screen === 'create' && documents.length > 0 && (
        <AgreementsPanel
          documents={documents}
          address={address}
          activeDocId={activeDoc?.id}
          compact
          onOpen={openDocument}
          onSeal={slug => void triggerSeal(slug)}
          onCreateNew={goToCreate}
        />
      )}

      {screen === 'create' && token && (
        <div id="create-agreement" className="card create-agreement-card">
          <h2>Create agreement</h2>
          <p className="screen-step-label">
            {formatStepLabel({ role: 'creator', current: 'create', subtitle: 'Fingerprint locally' })}
          </p>
          <PrivacyNotice variant="inline" />
          <p className="muted">
            Choose your lease or contract PDF on this computer. The file is fingerprinted in your browser
            and never uploaded. After you create the agreement, share the link and send the same PDF file
            to other signers yourself (email, AirDrop, etc.).
          </p>
          <div className="field">
            <label>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="123 Main St — 12-month lease" />
          </div>
          <div className="field">
            <label>Type</label>
            <select
              value={docType}
              onChange={e => {
                const nextType = e.target.value
                setDocType(nextType)
                setMyRole(nextType === 'rental' ? 'landlord' : 'signer')
              }}
            >
              <option value="rental">Rental agreement</option>
              <option value="contract">Contract</option>
              <option value="other">Other</option>
            </select>
          </div>
          {docType === 'rental' ? (
            <div className="field">
              <label>You are the</label>
              <select
                value={myRole === 'signer' ? 'landlord' : myRole}
                onChange={e => setMyRole(e.target.value as 'landlord' | 'tenant')}
              >
                <option value="landlord">Landlord</option>
                <option value="tenant">Tenant</option>
              </select>
              <span className="muted">Your role in this lease — you still sign as one required party.</span>
            </div>
          ) : (
            <p className="muted">You&apos;ll sign as a party on this agreement.</p>
          )}
          <div className="field">
            <label>Your full name</label>
            <input
              value={myName}
              onChange={e => setMyName(e.target.value)}
              placeholder="e.g. Alex Morgan"
              autoComplete="name"
            />
          </div>
          <div className="field">
            <label>Signatures required</label>
            <select
              value={requiredSignatures}
              onChange={e => setRequiredSignatures(Number(e.target.value))}
            >
              {Array.from({ length: 10 }, (_, index) => {
                const count = index + 1
                return (
                  <option key={count} value={count}>
                    {count} {count === 1 ? 'signature' : 'signatures'} (you + {Math.max(0, count - 1)} other
                    {count - 1 === 1 ? '' : 's'})
                  </option>
                )
              })}
            </select>
            <span className="muted">
              Includes your signature. When all required signatures are in, sealing starts automatically.
            </span>
          </div>
          <div className="field">
            <label>
              {docType === 'rental'
                ? myRole === 'landlord'
                  ? 'Tenant name (optional)'
                  : 'Landlord name (optional)'
                : 'Other party name (optional)'}
            </label>
            <input
              value={tenantName}
              onChange={e => setTenantName(e.target.value)}
              placeholder="Leave blank — they enter their name when signing"
            />
          </div>
          {docType === 'rental' && (
            <>
              <div className="field">
                <label>Property address</label>
                <input
                  value={propertyAddress}
                  onChange={e => setPropertyAddress(e.target.value)}
                  placeholder="123 Main St, Apt 4B"
                />
              </div>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Monthly rent</label>
                  <input value={monthlyRent} onChange={e => setMonthlyRent(e.target.value)} placeholder="$1,200" />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Deposit</label>
                  <input value={deposit} onChange={e => setDeposit(e.target.value)} placeholder="$1,200" />
                </div>
              </div>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Start date</label>
                  <DateField
                    value={startDate}
                    placeholder="Lease start"
                    max={endDate || undefined}
                    onChange={next => {
                      setStartDate(next)
                      if (endDate && next && endDate < next) setEndDate('')
                    }}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>End date</label>
                  <DateField
                    value={endDate}
                    placeholder="Lease end"
                    min={startDate || undefined}
                    onChange={setEndDate}
                  />
                </div>
              </div>
            </>
          )}
          <div className="field">
            <label>PDF file</label>
            <FilePicker
              key={createFormKey}
              accept="application/pdf"
              file={pdfFile}
              emptyLabel="Select PDF to seal"
              disabled={pdfLoading || creating}
              onChange={file => void onPdfSelected(file)}
            />
            {pdfLoading && <span className="muted">Fingerprinting PDF on your device…</span>}
          </div>
          {pdfHash && (
            <div className="field">
              <label>Document fingerprint (SHA-256)</label>
              <div className="hash-chip">{pdfHash}</div>
              <span className="muted">{pageCount} page(s)</span>
            </div>
          )}
          <button
            className="btn btn-primary"
            disabled={!pdfHash || pdfLoading || creating || !myName.trim()}
            onClick={() => void createAgreement()}
          >
            {creating ? 'Creating…' : 'Create agreement'}
          </button>
        </div>
      )}

      {screen === 'document' && !activeDoc && busy && (
        <div className="card seal-card seal-card--active">
          <div className="seal-card-header">
            <div className="seal-card-icon seal-card-icon--spin">
              <LoaderCircle size={22} strokeWidth={2.25} aria-hidden />
            </div>
            <div>
              <h2>Completing seal after Hub…</h2>
              <p className="muted seal-card-subtitle">
                {lockMessage ?? 'Processing your signed transaction and waiting for confirmation.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {screen === 'document' && activeDoc && (
        <>
          {!token && (
            <div className="card banner-sign">
              <h2>Sign this agreement</h2>
              <p className="muted">
                You opened a shared agreement. Connect your Nimiq wallet, then choose the PDF the creator
                sent you on your computer. It stays local — we only check that its fingerprint matches.
              </p>
              <button className="btn btn-primary" onClick={() => void connectWallet()} disabled={busy}>
                Connect wallet to sign
              </button>
            </div>
          )}

          {isCreatorOnDoc && isCollectingSignatures(activeDoc) && (
            <div className="card share-card">
              <h2>Invite signers</h2>
              <p className="muted">
                {activeDoc.signingProgress.signed}/{activeDoc.signingProgress.required} signed — send
                this link and the PDF file (from your computer) to anyone who still needs to sign. The PDF
                is never hosted by VeriLock.
              </p>
              <div className="hash-chip">{documentShareUrl}</div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: '0.75rem' }}
                onClick={() => void copyDocumentShareLink()}
              >
                {shareLinkCopied ? 'Link copied' : 'Copy link'}
              </button>
            </div>
          )}

          <div className="card">
            <h2>{activeDoc.title}</h2>
            {activeDoc.originalFilename && (
              <p className="document-filename">
                <span className="document-filename-label">PDF file</span>
                <span className="document-filename-value">{activeDoc.originalFilename}</span>
              </p>
            )}
            <p className="muted">
              Status:{' '}
              <span className={`status-badge ${statusClass(documentStatusLabel(activeDoc))}`}>
                {documentStatusLabel(activeDoc).replace(/_/g, ' ')}
              </span>
            </p>
            <div className="field">
              <label>SHA-256</label>
              <div className="hash-chip">{activeDoc.originalSha256}</div>
            </div>
            {activeDoc.type === 'rental' && activeDoc.metadata && (
              <div className="rental-summary">
                {(activeDoc.metadata as RentalMetadata).propertyAddress && (
                  <p className="muted">{(activeDoc.metadata as RentalMetadata).propertyAddress}</p>
                )}
                <p className="muted">
                  {[
                    (activeDoc.metadata as RentalMetadata).monthlyRent &&
                      `Rent: ${(activeDoc.metadata as RentalMetadata).monthlyRent}`,
                    (activeDoc.metadata as RentalMetadata).deposit &&
                      `Deposit: ${(activeDoc.metadata as RentalMetadata).deposit}`,
                    (activeDoc.metadata as RentalMetadata).startDate &&
                      `From: ${(activeDoc.metadata as RentalMetadata).startDate}`,
                    (activeDoc.metadata as RentalMetadata).endDate &&
                      `To: ${(activeDoc.metadata as RentalMetadata).endDate}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            )}
            <p className="muted">
              Signatures: {activeDoc.signingProgress.signed}/{activeDoc.signingProgress.required}
              {isSigningComplete(activeDoc) && activeDoc.status !== 'locked' && (
                <span className="all-signed-note"> · All signatures collected</span>
              )}
            </p>
            <ul className="party-list">
              {activeDoc.parties.map(party => (
                <li key={party.id} className="party-item">
                  <span>
                    {party.displayName}{' '}
                    <span className="muted">({formatPartyRole(party.role)})</span>
                  </span>
                  <span className={`status-badge ${statusClass(party.status)}`}>{party.status}</span>
                </li>
              ))}
            </ul>
            {activeDoc.signatures.length > 0 && (
              <SignaturesPanel
                signatures={activeDoc.signatures}
                parties={activeDoc.parties}
                compact={activeDoc.status !== 'locked'}
              />
            )}
          </div>

          {activeDoc.status !== 'locked' && token && address && (() => {
            const resolution = resolveSigningParty(activeDoc, address)
            const sealing = isSealingPhase(activeDoc)

            if (sealing) {
              if (isCreatorOnDoc) {
                return null
              }

              if (!resolution.ok) {
                return (
                  <div className="card verify-ok">
                    <h2>{activeDoc.status === 'locking' ? 'Sealing on-chain' : 'All signed'}</h2>
                    <p className="muted">
                      {activeDoc.status === 'locking'
                        ? lockMessage ||
                          'Confirm the transaction in your wallet, or wait for block confirmation…'
                        : 'Everyone has signed. The agreement will be sealed on-chain shortly — no further action needed from you.'}
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => void loadDocument(activeDoc.slug)}
                    >
                      Refresh status
                    </button>
                  </div>
                )
              }

              return null
            }

            if (!resolution.ok) {
              const waitingForOthers =
                resolution.hint === 'already_signed' &&
                activeDoc.signingProgress.signed < activeDoc.signingProgress.required
              return (
                <div className="card sign-status-card">
                  <h2>Sign</h2>
                  <p className="muted">{resolution.message}</p>
                  {waitingForOthers && isCreatorOnDoc && (
                    <div className="sign-status-share">
                      <p className="muted">
                        {activeDoc.signingProgress.signed}/{activeDoc.signingProgress.required} signed — copy
                        the link and send the PDF to anyone who still needs to sign:
                      </p>
                      <div className="hash-chip">{documentShareUrl}</div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ marginTop: '0.75rem' }}
                        onClick={() => void copyDocumentShareLink()}
                      >
                        {shareLinkCopied ? 'Link copied' : 'Copy link'}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => void loadDocument(activeDoc.slug)}
                  >
                    Refresh document
                  </button>
                </div>
              )
            }
            const needsName = partyNeedsSignerName(resolution.party)
            const pdfVerified = signPdfHash === activeDoc.originalSha256
            return (
              <div className="card">
                <h2>Sign</h2>
                <p className="screen-step-label">
                  {formatStepLabel({
                    role: workflowRole,
                    current: 'sign',
                    subtitle: pdfVerified ? 'Draw signature' : 'Verify PDF',
                  })}
                </p>
                <p className="muted">
                  {`You are signing as the ${formatPartyRole(resolution.party.role)} with wallet ${shortAddress(address)}.`}{' '}
                  Choose the PDF on your computer, confirm it matches the fingerprint, then draw your
                  signature. The file never leaves your device.
                </p>
                <div className="field">
                  <label>Your copy of the PDF (stays on your computer)</label>
                  <FilePicker
                    accept="application/pdf"
                    file={signPdfFile}
                    emptyLabel="Choose PDF to verify"
                    disabled={signPdfLoading || busy}
                    onChange={file => void onSignPdfSelected(file)}
                  />
                  {signPdfLoading && (
                    <span className="muted">Fingerprinting PDF on your device…</span>
                  )}
                  {pdfVerified && (
                    <p className="verify-feedback verify-feedback--success" style={{ marginTop: '0.5rem' }}>
                      <CircleCheck className="verify-feedback-icon" size={18} strokeWidth={2.25} aria-hidden />
                      {signPdfFile
                        ? 'PDF matches this agreement.'
                        : 'Fingerprint verified on this device — you can sign now.'}
                    </p>
                  )}
                </div>
                {needsName && (
                  <div className="field">
                    <label>Your full name</label>
                    <input
                      value={signerName}
                      onChange={e => setSignerName(e.target.value)}
                      placeholder="e.g. Alex Tenant"
                      autoComplete="name"
                      disabled={!pdfVerified}
                    />
                  </div>
                )}
                {pdfVerified && <SignaturePad onChange={setSigBlob} />}
                <div className="row" style={{ marginTop: '0.75rem' }}>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !pdfVerified || (needsName && !signerName.trim())}
                    onClick={() => void signAsCurrentUser()}
                  >
                    Sign agreement
                  </button>
                </div>
              </div>
            )
          })()}

          {isCreatorOnDoc &&
            isSealingPhase(activeDoc) &&
            activeDoc.status !== 'locked' &&
            token &&
            address && (
            <SealCard
              document={activeDoc}
              appUrl={appUrl}
              busy={busy}
              lockMessage={lockMessage}
              lockError={lockError}
              inNimiqPay={inNimiqPay}
              hasNimiqProvider={Boolean(nimiq)}
              showOpenInPay={showOpenInPay}
              onSeal={() => void triggerSeal()}
              onSealPopup={() => void lockDocument({ preferPopup: true })}
            />
          )}

          {showSealedConfirmation(activeDoc) && activeDoc.attestation && (
            <div id="sealed-confirmation" className="card verify-ok">
              <h2>Sealed on-chain</h2>
              <p className="muted">
                {activeDoc.lockedAt
                  ? `Locked ${new Date(activeDoc.lockedAt).toLocaleString()}.`
                  : 'Transaction confirmed on the Nimiq blockchain.'}
              </p>
              <div className="field">
                <label>On-chain payload</label>
                <div className="hash-chip">{activeDoc.attestation.payload}</div>
              </div>
              <div className="field">
                <label>Transaction</label>
                <div className="hash-chip">{activeDoc.attestation.txHash}</div>
              </div>
              <div className="row" style={{ marginTop: '0.75rem' }}>
                <a
                  className="btn btn-secondary"
                  href={buildNimiqExplorerUrl(activeDoc.attestation.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Nimiq Watch
                </a>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void api.certificate(activeDoc.slug).then(cert => {
                    const blob = new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${activeDoc.slug}-certificate.json`
                    a.click()
                    URL.revokeObjectURL(url)
                  })}
                >
                  Certificate JSON
                </button>
              </div>
            </div>
          )}

          {(activeDoc.status === 'locked' || activeDoc.attestation?.status === 'confirmed') && (
            <div className="card">
              <h2>Verify link</h2>
              <p className="screen-step-label">
                {formatStepLabel({
                  role: workflowRole,
                  current: workflowRole === 'signer' ? 'done' : 'verify',
                  subtitle: 'Verify anytime',
                })}
              </p>
              <p className="muted">
                Keep your PDF copy safe on your computer. Anyone can fingerprint their file on the Verify tab
                to confirm it matches the sealed hash — verification also happens locally.
              </p>
              <div className="hash-chip">{window.location.origin}/v/{activeDoc.slug}</div>
            </div>
          )}
        </>
      )}

      {screen === 'verify' && (
        <div className="card">
          <h2>Verify a document</h2>
          <p className="screen-step-label">
            {formatStepLabel({ role: 'verifier', current: 'verify', subtitle: 'Verify anytime' })}
          </p>
          <PrivacyNotice variant="inline" />
          <p className="muted">
            No wallet needed. Choose a PDF on your computer to fingerprint it locally and check it matches
            a locked agreement, or look up a document by ID. The file is never sent to our servers.
          </p>
          <div className="field">
            <label>PDF on your computer</label>
            <FilePicker
              accept="application/pdf"
              file={verifyFile}
              emptyLabel="Choose PDF on your computer"
              disabled={busy}
              onChange={setVerifyFile}
            />
          </div>
          <button className="btn btn-secondary" disabled={!verifyFile || busy} onClick={() => void runVerifyUpload()}>
            Verify fingerprint locally
          </button>

          <div className="field" style={{ marginTop: '1.25rem' }}>
            <label>Or enter document slug / ID</label>
            <input value={verifySlug} onChange={e => setVerifySlug(e.target.value)} placeholder="abc123def456" />
          </div>
          <button className="btn btn-secondary" disabled={!verifySlug || busy} onClick={() => void runVerifySlug()}>
            Lookup document
          </button>

          {verifyHash && (
            <div className="field" style={{ marginTop: '1rem' }}>
              <label>Computed / stored hash</label>
              <div className="hash-chip">{verifyHash}</div>
            </div>
          )}
          {verifyResult && (
            <p className={`verify-feedback verify-feedback--${verifyResult.tone}`}>
              {verifyResult.tone === 'success' && (
                <CircleCheck className="verify-feedback-icon" size={18} strokeWidth={2.25} aria-hidden />
              )}
              {verifyResult.tone === 'warn' && (
                <CircleAlert className="verify-feedback-icon" size={18} strokeWidth={2.25} aria-hidden />
              )}
              {verifyResult.message}
            </p>
          )}
          {verifyDetail?.originalFilename && (
            <p className="document-filename" style={{ marginTop: '1rem' }}>
              <span className="document-filename-label">PDF file</span>
              <span className="document-filename-value">{verifyDetail.originalFilename}</span>
            </p>
          )}
          {verifyDetail && verifyDetail.signatures.length > 0 && (
            <SignaturesPanel
              signatures={verifyDetail.signatures}
              parties={verifyDetail.parties}
            />
          )}
        </div>
      )}
    </div>
  )
}