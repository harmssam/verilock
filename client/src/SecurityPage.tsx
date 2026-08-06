/**
 * Security & integrity - product-true trust page.
 * No invented certifications or legal “we comply with X” claims.
 */
import {
  Database,
  ExternalLink,
  Fingerprint,
  Link2,
  Shield,
  Wallet,
} from 'lucide-react'
import { useEffect, useId, useState, type MouseEvent } from 'react'
import './SecurityPage.css'

interface SecurityPageProps {
  onCreate?: () => void
  onVerify?: () => void
  onPrivacy?: () => void
}

const TOC = [
  { id: 'model', label: 'The model' },
  { id: 'what-stays-local', label: 'What stays local' },
  { id: 'what-is-locked', label: 'Fingerprint lock' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'on-chain', label: 'On the chain' },
  { id: 'data-backup', label: 'Data backup' },
  { id: 'free-vs-lock', label: 'Free vs lock vs backup' },
  { id: 'verify', label: 'Verification' },
  { id: 'we-store', label: 'What we store' },
  { id: 'we-do-not-claim', label: 'What we do not claim' },
] as const

function PrivacyLink({ onPrivacy }: { onPrivacy?: () => void }) {
  if (onPrivacy) {
    return (
      <button
        type="button"
        className="security-inline-link security-inline-btn"
        onClick={onPrivacy}
      >
        Privacy Policy
      </button>
    )
  }
  return (
    <a className="security-inline-link" href="/privacy">
      Privacy Policy
    </a>
  )
}

export function SecurityPage({ onCreate, onVerify, onPrivacy }: SecurityPageProps) {
  const tocLabelId = useId()
  const [activeId, setActiveId] = useState<string>(TOC[0].id)

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const nodes = TOC.map(item => document.getElementById(item.id)).filter(
      (el): el is HTMLElement => el != null,
    )
    if (nodes.length === 0) return

    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        const top = visible[0]
        if (top?.target?.id) setActiveId(top.target.id)
      },
      {
        // Offset sticky shell header + leave room so active section tracks scroll.
        rootMargin: '-20% 0px -55% 0px',
        threshold: [0, 0.15, 0.35, 0.6],
      },
    )
    for (const n of nodes) observer.observe(n)

    // Honor deep links on load.
    const hash = window.location.hash.replace(/^#/, '')
    if (hash && TOC.some(t => t.id === hash)) {
      setActiveId(hash)
      const el = document.getElementById(hash)
      if (el) {
        el.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'start',
        })
      }
    }

    return () => observer.disconnect()
  }, [])

  const onTocClick = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    })
    setActiveId(id)
    window.history.replaceState(null, '', `#${id}`)
  }

  return (
    <article className="security-page" aria-labelledby="security-title">
      <header className="security-hero">
        <p className="security-eyebrow">Security &amp; integrity</p>
        <h1 id="security-title">How VeriLock protects your document</h1>
        <p className="security-lead">
          Your file stays on your device. Your wallet proves who you are. Permanent proof
          lives on Nimiq—a fingerprint lock by default, with optional public backup of
          signatures and fields. Plain product truth, not a certificate wall.
        </p>
        <p className="security-updated">Last updated: July 25, 2026</p>
      </header>

      <div className="security-layout">
        <nav className="security-toc" aria-labelledby={tocLabelId}>
          <p id={tocLabelId} className="security-toc-title">
            On this page
          </p>
          <ol className="security-toc-list">
            {TOC.map(item => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={
                    activeId === item.id
                      ? 'security-toc-link security-toc-link--active'
                      : 'security-toc-link'
                  }
                  aria-current={activeId === item.id ? 'location' : undefined}
                  onClick={onTocClick(item.id)}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="security-main">
          <section id="model" className="security-section security-section--flush">
            <h2>The model in one glance</h2>
            <p className="security-deck">
              Three layers work together. Only you move the PDF. We never host the file.
            </p>
            <div className="security-pillars" role="list">
              <div className="security-pillar" role="listitem">
                <span className="security-pillar-icon" aria-hidden>
                  <Fingerprint size={20} strokeWidth={1.75} />
                </span>
                <h3>Local fingerprint</h3>
                <p>SHA-256 of your exact bytes, computed in the browser.</p>
              </div>
              <div className="security-pillar" role="listitem">
                <span className="security-pillar-icon" aria-hidden>
                  <Wallet size={20} strokeWidth={1.75} />
                </span>
                <h3>Wallet identity</h3>
                <p>Nimiq address proves control—not custody of the document.</p>
              </div>
              <div className="security-pillar" role="listitem">
                <span className="security-pillar-icon" aria-hidden>
                  <Link2 size={20} strokeWidth={1.75} />
                </span>
                <h3>Hash on Nimiq</h3>
                <p>Optional lock anchors the fingerprint so anyone can re-check it.</p>
              </div>
              <div className="security-pillar" role="listitem">
                <span className="security-pillar-icon" aria-hidden>
                  <Database size={20} strokeWidth={1.75} />
                </span>
                <h3>Optional data on-chain</h3>
                <p>Signatures and fields can join the public ledger after lock.</p>
              </div>
              <div className="security-pillar" role="listitem">
                <span className="security-pillar-icon" aria-hidden>
                  <Shield size={20} strokeWidth={1.75} />
                </span>
                <h3>No file upload</h3>
                <p>PDF and image bytes stay on devices you control.</p>
              </div>
            </div>
          </section>

          <section id="what-stays-local" className="security-section">
            <h2>What never leaves this device</h2>
            <p className="security-deck">
              Fingerprinting, signing, and verification all run <strong>in your browser</strong>.
            </p>
            <ul className="security-bullets">
              <li>
                VeriLock does <strong>not</strong> upload or host document content.
              </li>
              <li>
                Sharing the file with co-signers is out-of-band (email, chat, AirDrop)—you
                choose who gets the bytes.
              </li>
              <li>
                Even with data backup, the <strong>PDF or image never goes on-chain</strong> or
                to our servers—only structured agreement data can, if you opt in.
              </li>
            </ul>
          </section>

          <section id="what-is-locked" className="security-section">
            <h2>What a fingerprint lock means</h2>
            <p>
              An on-chain lock records the <strong>SHA-256 fingerprint</strong> of the document
              bytes you chose—a fixed-length digest computed locally. Co-signers attach wallet
              signatures to that fingerprint. Locking on Nimiq anchors the hash so a later copy
              can be compared against what was locked.
            </p>
            <div className="security-split" role="list">
              <div className="security-split-card security-split-card--yes" role="listitem">
                <h3>Proves</h3>
                <ul>
                  <li>Byte integrity—is this the same file?</li>
                  <li>Who signed with which wallet</li>
                </ul>
              </div>
              <div className="security-split-card security-split-card--no" role="listitem">
                <h3>Does not mean</h3>
                <ul>
                  <li>We hold a cloud copy of your document</li>
                  <li>Signature drawings live on-chain by default</li>
                </ul>
              </div>
            </div>
            <p className="security-note">
              Want signatures and fields on Nimiq too? See{' '}
              <a className="security-inline-link" href="#data-backup" onClick={onTocClick('data-backup')}>
                on-chain data backup
              </a>
              .
            </p>
          </section>

          <section id="wallets" className="security-section">
            <h2>What wallets prove</h2>
            <p>
              Connecting a Nimiq wallet proves <strong>control of an address</strong>—identity for
              create, sign, and optional lock. The wallet never receives your document bytes through
              VeriLock. Signing records intent from that address against the agreement fingerprint,
              not file custody on our servers.
            </p>
            <p>
              Free signing does not require a wallet at all. A guest signature is intent plus a
              one-time capability token—the document key you're shown once at creation, or a personal
              invite link—not a Nimiq-key-bound cryptographic proof. It's a weaker guarantee than a
              wallet signature: anyone holding that link or key can act as that party. Connecting a
              wallet is what upgrades an agreement to on-chain-locked, wallet-address-attributed proof.
            </p>
          </section>

          <section id="on-chain" className="security-section">
            <h2>What the chain stores by default</h2>
            <p>
              After a fingerprint lock, Nimiq holds a <strong>public transaction</strong> that
              anchors the document hash (and related attestation details shown in the app). VeriLock
              cannot erase that record.
            </p>
            <p>
              Alone, the lock does <strong>not</strong> include the document file or signature
              drawings. Optional data backup (next) is a separate, paid step after lock.
            </p>
          </section>

          <section id="data-backup" className="security-section">
            <h2>On-chain data backup</h2>
            <p className="security-deck">
              After lock, you can write agreement overlay data to Nimiq permanently—so it can
              outlive our servers.
            </p>
            <ul className="security-bullets">
              <li>Signature images, initials, field layout and text</li>
              <li>Party names and wallet addresses</li>
              <li>Written as public multi-tx frames tied to the document fingerprint</li>
            </ul>
            <p>
              Anyone with the PDF—or only its SHA-256—can reconstruct that overlay from the public
              chain, without VeriLock online. Cost scales with frame count; you see the exact credit
              amount before confirm.
            </p>
            <aside className="security-callout" role="note">
              <strong>Public by design.</strong> Nimiq is a public ledger. Treat backup as permanent
              disclosure—not private vaulting. Never put secrets you would not publish. The original
              document bytes still stay on devices you control.
            </aside>
          </section>

          <section id="free-vs-lock" className="security-section security-section--flush">
            <h2>Free signing vs lock vs data backup</h2>
            <p className="security-deck">
              Same agreement path, three different permanence levels.
            </p>
            <div className="security-compare" role="table" aria-label="Signing, lock, and data backup">
              <div className="security-compare-row security-compare-row--head" role="row">
                <span role="columnheader"> </span>
                <span role="columnheader">Free signing</span>
                <span role="columnheader">Fingerprint lock</span>
                <span role="columnheader">Data backup</span>
              </div>
              <div className="security-compare-row" role="row">
                <span className="security-compare-label" role="rowheader">
                  Cost
                </span>
                <span role="cell">Free</span>
                <span role="cell">1 credit</span>
                <span role="cell">Extra credits (by size)</span>
              </div>
              <div className="security-compare-row" role="row">
                <span className="security-compare-label" role="rowheader">
                  Where
                </span>
                <span role="cell">VeriLock servers</span>
                <span role="cell">Nimiq (public)</span>
                <span role="cell">Nimiq (public)</span>
              </div>
              <div className="security-compare-row" role="row">
                <span className="security-compare-label" role="rowheader">
                  What
                </span>
                <span role="cell">Metadata, parties, fields, signatures for the workflow</span>
                <span role="cell">Document fingerprint only</span>
                <span role="cell">Signatures, names, wallets, field data</span>
              </div>
              <div className="security-compare-row" role="row">
                <span className="security-compare-label" role="rowheader">
                  Permanence
                </span>
                <span role="cell">App workflow—not permanent public proof</span>
                <span role="cell">Permanent byte integrity</span>
                <span role="cell">Permanent overlay; reconstructable from fingerprint</span>
              </div>
              <div className="security-compare-row" role="row">
                <span className="security-compare-label" role="rowheader">
                  PDF on our servers?
                </span>
                <span role="cell">Never</span>
                <span role="cell">Never</span>
                <span role="cell">Never</span>
              </div>
            </div>
          </section>

          <section id="verify" className="security-section">
            <h2>How anyone verifies</h2>
            <ol className="security-steps">
              <li>
                <strong>Re-hash locally.</strong> Your browser hashes a copy of the file—nothing
                uploads for the integrity check.
              </li>
              <li>
                <strong>Compare to a lock.</strong> Match against invite link, lookup, or My
                agreements. <strong>No wallet required</strong> for a basic check.
              </li>
              <li>
                <strong>Match means same bytes</strong> as the locked fingerprint—not that we store
                the file.
              </li>
            </ol>
            <p>
              With on-chain data backup, verification can also rebuild signatures and fields from
              Nimiq using the fingerprint—so the signed agreement can be recovered from chain +
              original file, not only from our servers.
            </p>
            <p>
              Prefer a fully open-source tool that never talks to this site?{' '}
              <a
                className="security-inline-link"
                href="https://github.com/clevertech-os/verilock-offline"
                target="_blank"
                rel="noopener noreferrer"
              >
                VeriLock Offline
                <ExternalLink size={13} strokeWidth={2.25} className="security-ext-icon" aria-hidden />
              </a>{' '}
              hashes on your device and checks a Nimiq lock or certificate. Source and desktop builds
              (macOS, Windows, Linux) are on GitHub.
            </p>
          </section>

          <section id="we-store" className="security-section">
            <h2>What we store on servers</h2>
            <p className="security-deck">
              Metadata to run agreements—not document bodies.
            </p>
            <ul className="security-bullets">
              <li>SHA-256 fingerprints and agreement state</li>
              <li>Title, type, party roles, wallet addresses, signature status</li>
              <li>Optional notes and signature images you submit when signing</li>
              <li>Session data for wallet login (address, short-lived token)</li>
              <li>Attestation references after locking (e.g. transaction hash)</li>
              <li>Data-backup status and frame references when you archive on-chain</li>
            </ul>
            <p>
              Full detail lives in our <PrivacyLink onPrivacy={onPrivacy} />.
            </p>
          </section>

          <section id="we-do-not-claim" className="security-section security-section--callout">
            <h2>What we do not claim</h2>
            <p>
              This page describes the product model. It is <strong>not legal advice</strong>, and it
              does not assert certifications or audit programs unless we state that separately with
              evidence.
            </p>
            <ul className="security-bullets">
              <li>
                We do not claim DocuSign-equivalent e-sign product classes (SES / AES / QES) here.
              </li>
              <li>
                We do not display SOC 2, ISO, HIPAA, or similar badges without real certifications.
              </li>
              <li>
                A matching fingerprint proves byte integrity against an on-chain lock; court outcomes
                depend on your jurisdiction and counsel—not a marketing badge.
              </li>
              <li>
                On-chain data backup is public ledger data—not private storage or encrypted vaulting
                of your document.
              </li>
            </ul>
          </section>

          <footer className="security-footer-cta">
            <p>Ready to fingerprint a document locally?</p>
            <div className="security-footer-actions">
              {onCreate ? (
                <button type="button" className="security-btn security-btn--primary" onClick={onCreate}>
                  Create &amp; invite free
                </button>
              ) : (
                <a className="security-btn security-btn--primary" href="/?intent=creator">
                  Create &amp; invite free
                </a>
              )}
              {onVerify ? (
                <button type="button" className="security-btn security-btn--ghost" onClick={onVerify}>
                  Verify a document
                </button>
              ) : (
                <a className="security-btn security-btn--ghost" href="/?intent=verifier">
                  Verify a document
                </a>
              )}
            </div>
          </footer>
        </div>
      </div>
    </article>
  )
}
