import {
  Check,
  Copy,
  Fingerprint,
  HelpCircle,
  Link2,
  LoaderCircle,
  Lock,
  RotateCcw,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DocumentStage } from './DocumentStage'
import { formatFileSize, PdfDropZone } from './PdfDropZone'
import {
  CREATOR_STAGES,
  fakeFingerprint,
  type DemoAccount,
  type DemoDoc,
  type JourneyStepId,
  type PathRole,
} from './types'

interface DocumentJourneyProps {
  account: DemoAccount | null
  connecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}

export function DocumentJourney({
  account,
  connecting,
  onConnect,
  onDisconnect,
}: DocumentJourneyProps) {
  const [role, setRole] = useState<PathRole | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [directSeal, setDirectSeal] = useState(false)
  const [requiredSigners, setRequiredSigners] = useState(2)
  const [busy, setBusy] = useState(false)
  const [doc, setDoc] = useState<DemoDoc | null>(null)
  const [sharedAck, setSharedAck] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [signFile, setSignFile] = useState<File | null>(null)
  const [signerName, setSignerName] = useState('')
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [verifyResult, setVerifyResult] = useState<'idle' | 'match' | 'mismatch'>('idle')
  const [howOpen, setHowOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)

  const step = useMemo<JourneyStepId>(() => {
    if (!role) return 'welcome'
    if (role === 'verifier') return 'verify'
    if (!account) return 'connect'
    if (role === 'signer') {
      if (!doc) return 'sign'
      if (doc.sealed) return 'done'
      return 'sign'
    }
    // creator
    if (!doc) return 'fingerprint'
    if (doc.sealed) return 'done'
    if (doc.directSeal || doc.signed >= doc.required) return 'seal'
    if (doc.signed > 0 || sharedAck) return 'sign'
    return 'share'
  }, [role, account, doc, sharedAck])

  const stageIndex = CREATOR_STAGES.findIndex(s => s.id === step)
  const activeStage =
    CREATOR_STAGES.find(s => s.id === step) ??
    (step === 'done' ? CREATOR_STAGES[CREATOR_STAGES.length - 1] : null)

  useEffect(() => {
    if (!verifyFile || !doc?.sealed) {
      setVerifyResult('idle')
      return
    }
    const match =
      verifyFile.name === doc.fileName || Math.abs(verifyFile.size - doc.fileSize) < 1
    setVerifyResult(match ? 'match' : 'mismatch')
  }, [verifyFile, doc])

  const resetAll = () => {
    setRole(null)
    setPdfFile(null)
    setTitle('')
    setDirectSeal(false)
    setRequiredSigners(2)
    setDoc(null)
    setSharedAck(false)
    setSignFile(null)
    setSignerName('')
    setVerifyFile(null)
    setVerifyResult('idle')
  }

  const createDoc = async () => {
    if (!pdfFile) return
    setBusy(true)
    await wait(700)
    const id = `demo-${Date.now().toString(36)}`
    setDoc({
      id,
      title: title.trim() || pdfFile.name.replace(/\.pdf$/i, ''),
      fileName: pdfFile.name,
      fileSize: pdfFile.size,
      fingerprintPreview: fakeFingerprint(pdfFile.name, pdfFile.size),
      shareUrl: `${window.location.origin}/d/${id}`,
      signed: 0,
      required: directSeal ? 0 : Math.max(1, requiredSigners),
      sealed: false,
      directSeal,
    })
    setSharedAck(false)
    setBusy(false)
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

  const sign = async () => {
    if (!doc || !signFile || !signerName.trim()) return
    setBusy(true)
    await wait(650)
    setDoc(prev =>
      prev ? { ...prev, signed: Math.min(prev.required, prev.signed + 1) } : prev,
    )
    setSignFile(null)
    setSignerName('')
    setBusy(false)
  }

  const seal = async () => {
    if (!doc) return
    setBusy(true)
    await wait(1100)
    setDoc(prev => (prev ? { ...prev, sealed: true } : prev))
    setBusy(false)
  }

  const pickRole = (r: PathRole) => {
    setRole(r)
    if (r === 'signer') {
      // seed a demo invitation so signer path is tryable
      setDoc({
        id: 'invite-demo',
        title: 'Sample lease (invite)',
        fileName: 'lease-sample.pdf',
        fileSize: 248_320,
        fingerprintPreview: fakeFingerprint('lease-sample.pdf', 248_320),
        shareUrl: `${window.location.origin}/d/invite-demo`,
        signed: 0,
        required: 2,
        sealed: false,
        directSeal: false,
      })
    } else {
      setDoc(null)
      setPdfFile(null)
    }
  }

  return (
    <div className="journey">
      {/* Trust + privacy — always visible */}
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
              <li>Fingerprinting runs in your browser — bytes stay local.</li>
              <li>Servers keep metadata + hash, not the file.</li>
              <li>On-chain seal records the hash string only.</li>
              <li>Verification re-hashes a local copy — no wallet required.</li>
            </ul>
          </div>
        )}
      </aside>

      {/* Welcome / path picker */}
      {step === 'welcome' && (
        <section className="hero-pick">
          <div className="hero-pick-copy">
            <p className="hero-kicker">
              <Sparkles size={14} strokeWidth={2.25} aria-hidden />
              Sign together · prove forever
            </p>
            <h2>What are you here to do?</h2>
            <p className="muted">
              Pick a path. The whole flow stays on this screen — drop, share, sign, and seal without
              hopping tabs.
            </p>
          </div>
          <div className="path-cards">
            <button type="button" className="path-card path-card--create" onClick={() => pickRole('creator')}>
              <span className="path-card-icon" aria-hidden>
                <Fingerprint size={22} strokeWidth={2.25} />
              </span>
              <strong>Create &amp; seal</strong>
              <span className="muted">Fingerprint a PDF, collect signatures, lock on Nimiq</span>
            </button>
            <button type="button" className="path-card path-card--sign" onClick={() => pickRole('signer')}>
              <span className="path-card-icon" aria-hidden>
                <Users size={22} strokeWidth={2.25} />
              </span>
              <strong>I was invited</strong>
              <span className="muted">Open a share link, verify the PDF, sign with your wallet</span>
            </button>
            <button type="button" className="path-card path-card--verify" onClick={() => pickRole('verifier')}>
              <span className="path-card-icon" aria-hidden>
                <ShieldCheck size={22} strokeWidth={2.25} />
              </span>
              <strong>Verify a PDF</strong>
              <span className="muted">Check integrity anytime — no account needed</span>
            </button>
          </div>
        </section>
      )}

      {step !== 'welcome' && (
        <>
          <div className="journey-toolbar">
            <button type="button" className="btn btn-ghost journey-reset" onClick={resetAll}>
              <RotateCcw size={14} strokeWidth={2.25} aria-hidden />
              Change path
            </button>
            {account && role === 'creator' && (
              <span className="journey-role-pill">Creating as {account.shortAddress}</span>
            )}
            {role === 'signer' && <span className="journey-role-pill">Signing as guest</span>}
            {role === 'verifier' && <span className="journey-role-pill">Verifier mode</span>}
          </div>

          {/* Visual stage + rail */}
          <div className="journey-stage-grid">
            <DocumentStage
              step={step}
              doc={doc}
              pdfName={pdfFile?.name ?? null}
              sealing={busy && step === 'seal'}
            />

            {role === 'creator' && (
              <nav className="stage-rail" aria-label="Agreement journey">
                {CREATOR_STAGES.map((s, i) => {
                  const current = s.id === step || (step === 'done' && s.id === 'verify')
                  const isDone = (() => {
                    if (step === 'done') return true
                    if (!account && s.id === 'connect') return false
                    if (account && s.id === 'connect') return step !== 'connect'
                    if (doc && ['connect', 'fingerprint'].includes(s.id)) return true
                    if (doc && s.id === 'share' && (sharedAck || doc.signed > 0 || doc.directSeal))
                      return true
                    if (doc && s.id === 'sign' && (doc.directSeal || doc.signed >= doc.required))
                      return true
                    if (doc?.sealed && (s.id === 'seal' || s.id === 'verify')) return s.id === 'seal'
                    return false
                  })()
                  return (
                    <div
                      key={s.id}
                      className={[
                        'stage-rail-item',
                        current ? 'stage-rail-item--current' : '',
                        isDone && !current ? 'stage-rail-item--done' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <span className="stage-rail-dot">
                        {isDone && !current ? <Check size={12} strokeWidth={2.5} /> : i + 1}
                      </span>
                      <span className="stage-rail-label">{s.label}</span>
                    </div>
                  )
                })}
              </nav>
            )}
          </div>

          {/* Focused action panel */}
          <section className="action-dock" aria-live="polite">
            <header className="action-dock-head">
              <div>
                <p className="action-kicker">
                  {step === 'done'
                    ? 'Complete'
                    : activeStage
                      ? `Step · ${activeStage.label}`
                      : 'Action'}
                </p>
                <h3>
                  {step === 'done'
                    ? 'Agreement sealed'
                    : step === 'connect'
                      ? 'Connect your wallet'
                      : activeStage?.verb ?? 'Continue'}
                </h3>
                <p className="muted action-blurb">
                  {step === 'done'
                    ? 'Keep your PDF. Share the verify link so anyone can check the fingerprint.'
                    : activeStage?.blurb}
                </p>
              </div>
              {activeStage && step !== 'done' && (
                <p className="action-privacy">
                  <Shield size={14} strokeWidth={2.25} aria-hidden />
                  {activeStage.privacyNote}
                </p>
              )}
            </header>

            <div className="action-dock-body">
              {step === 'connect' && (
                <div className="action-stack">
                  <p className="muted" style={{ margin: 0 }}>
                    Demo wallet — use the account menu (top right) anytime to copy address or
                    disconnect.
                  </p>
                  <button
                    type="button"
                    className={`btn btn-primary btn-lg${connecting ? ' btn--busy' : ''}`}
                    onClick={onConnect}
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
                  <PdfDropZone
                    file={pdfFile}
                    onChange={setPdfFile}
                    size="hero"
                    label="Drop your PDF onto the stage"
                    hint="or browse — hashed locally, never uploaded"
                  />
                  <label className="field">
                    <span className="field-label">Title (optional)</span>
                    <input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Lease — 12 Maple St"
                    />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={directSeal}
                      onChange={e => setDirectSeal(e.target.checked)}
                    />
                    <span>Seal directly — no co-signers (already signed / solo)</span>
                  </label>
                  {!directSeal && (
                    <label className="field">
                      <span className="field-label">Required signers</span>
                      <select
                        value={requiredSigners}
                        onChange={e => setRequiredSigners(Number(e.target.value))}
                      >
                        {[1, 2, 3, 4].map(n => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    className={`btn btn-primary btn-lg${busy ? ' btn--busy' : ''}`}
                    disabled={!pdfFile || busy}
                    onClick={() => void createDoc()}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                        Fingerprinting…
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
                  <div className="share-box">
                    <div className="share-box-url">
                      <Link2 size={16} strokeWidth={2.25} aria-hidden />
                      <code>{doc.shareUrl}</code>
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={() => void copyLink()}>
                      <Copy size={15} strokeWidth={2.25} />
                      {linkCopied ? 'Copied!' : 'Copy link'}
                    </button>
                  </div>
                  <p className="share-tip muted">
                    <Share2 size={15} strokeWidth={2.25} aria-hidden />
                    Also send <strong>{doc.fileName}</strong> ({formatFileSize(doc.fileSize)}) via
                    email or AirDrop — signers need the same file.
                  </p>
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => setSharedAck(true)}>
                    I&apos;ve shared — go to signing
                  </button>
                </div>
              )}

              {step === 'sign' && doc && (
                <div className="action-stack">
                  <div className="progress-bar-wrap">
                    <div className="progress-bar-meta">
                      <span>
                        Signatures {doc.signed}/{doc.required}
                      </span>
                      <span className="muted">{doc.title}</span>
                    </div>
                    <div className="progress-bar-track">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${doc.required ? (doc.signed / doc.required) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  {!account && role === 'signer' && (
                    <button
                      type="button"
                      className={`btn btn-primary${connecting ? ' btn--busy' : ''}`}
                      onClick={onConnect}
                      disabled={connecting}
                    >
                      <Wallet size={16} strokeWidth={2.25} />
                      Connect to sign
                    </button>
                  )}
                  {(account || role === 'creator') && (
                    <>
                      <PdfDropZone
                        file={signFile}
                        onChange={setSignFile}
                        label="Drop the same PDF to verify match"
                        hint="local check against the fingerprinted file"
                      />
                      <label className="field">
                        <span className="field-label">Your name</span>
                        <input
                          value={signerName}
                          onChange={e => setSignerName(e.target.value)}
                          placeholder="Display name on the agreement"
                        />
                      </label>
                      <button
                        type="button"
                        className={`btn btn-primary btn-lg${busy ? ' btn--busy' : ''}`}
                        disabled={!signFile || !signerName.trim() || busy || !account}
                        onClick={() => void sign()}
                      >
                        {busy ? (
                          <>
                            <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} />
                            Signing…
                          </>
                        ) : (
                          'Sign agreement'
                        )}
                      </button>
                      {!account && (
                        <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                          Connect wallet (header) to enable signing.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {step === 'seal' && doc && (
                <div className="action-stack">
                  <div className="seal-summary">
                    <p>
                      <strong>{doc.title}</strong>
                    </p>
                    <p className="muted">
                      Fingerprint <code className="mono">{doc.fingerprintPreview}</code>
                    </p>
                    <p className="muted">
                      {doc.directSeal
                        ? 'Direct seal — no signatures required.'
                        : `All ${doc.required} signatures collected.`}
                    </p>
                  </div>
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
                      <Lock size={18} strokeWidth={2.5} />
                      <div>
                        <strong>Sealed.</strong>
                        <p className="muted">
                          Anyone can verify <em>{doc.fileName}</em> by dropping a copy below.
                        </p>
                      </div>
                    </div>
                  )}
                  {role === 'verifier' && !doc && (
                    <p className="muted" style={{ margin: 0 }}>
                      In production you&apos;d look up a doc ID. Here, create a sealed agreement first
                      (or finish a create path) to try a match — or drop any PDF to see the local
                      fingerprint flow.
                    </p>
                  )}
                  <PdfDropZone
                    file={verifyFile}
                    onChange={f => {
                      setVerifyFile(f)
                      if (f && !doc?.sealed && role === 'verifier') {
                        // solo verify demo: show "local fingerprint" success
                        setVerifyResult('match')
                      }
                    }}
                    size="hero"
                    label="Drop PDF to verify"
                    hint="fingerprints locally — no upload, no wallet"
                  />
                  {verifyResult === 'match' && (
                    <div className="result-banner result-banner--ok">
                      <ShieldCheck size={18} strokeWidth={2.5} />
                      {doc?.sealed
                        ? 'Match — this copy matches the sealed fingerprint'
                        : 'Local fingerprint ready (demo) — in production this checks a sealed record'}
                    </div>
                  )}
                  {verifyResult === 'mismatch' && (
                    <div className="result-banner result-banner--bad">
                      Mismatch — this file does not match the sealed document
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

      {/* How it works — always available */}
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
            <span className="muted"> Six beats from connect → verify</span>
          </span>
          <span className={`trust-chevron${howOpen ? ' trust-chevron--open' : ''}`} />
        </button>
        {howOpen && (
          <ol className="how-list">
            {CREATOR_STAGES.map((s, i) => (
              <li key={s.id}>
                <span className="how-num">{i + 1}</span>
                <div>
                  <strong>{s.label}</strong> — {s.blurb}
                  <p className="how-privacy muted">{s.privacyNote}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {account && (
        <p className="account-hint muted">
          Signed in as <strong>{account.shortAddress}</strong> — use the account menu to disconnect.
          <button type="button" className="text-btn" onClick={onDisconnect}>
            Log out
          </button>
        </p>
      )}
    </div>
  )
}

function wait(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}
