/**
 * Security & integrity - product-true trust page.
 * No invented certifications or legal “we comply with X” claims.
 */
import { Database, Fingerprint, Link2, Shield, Wallet } from 'lucide-react'
import './SecurityPage.css'

interface SecurityPageProps {
  onCreate?: () => void
  onVerify?: () => void
  onPrivacy?: () => void
}

export function SecurityPage({ onCreate, onVerify, onPrivacy }: SecurityPageProps) {
  return (
    <article className="security-page" aria-labelledby="security-title">
      <header className="security-hero">
        <p className="security-eyebrow">Security &amp; integrity</p>
        <h1 id="security-title">How VeriLock protects your document</h1>
        <p className="security-lead">
          VeriLock is built so your file stays on your device, your wallet proves who you are, and
          permanent proof lives on Nimiq: a fingerprint lock by default, with optional on-chain backup
          of signatures and field data. This page explains that model in plain language - not a
          certificate wall.
        </p>
        <p className="security-updated">Last updated: July 25, 2026</p>
      </header>

      <nav className="security-toc" aria-label="On this page">
        <a href="#what-is-locked">What is locked on the blockchain</a>
        <a href="#what-stays-local">What stays local</a>
        <a href="#wallets">Wallets</a>
        <a href="#on-chain">On-chain record</a>
        <a href="#data-backup">On-chain data backup</a>
        <a href="#verify">How verification works</a>
        <a href="#we-store">What we store</a>
        <a href="#we-do-not-claim">What we do not claim</a>
      </nav>

      <div className="security-grid" aria-hidden>
        <div className="security-pill">
          <Fingerprint size={18} strokeWidth={1.75} />
          <span>Local SHA-256</span>
        </div>
        <div className="security-pill">
          <Wallet size={18} strokeWidth={1.75} />
          <span>Wallet identity</span>
        </div>
        <div className="security-pill">
          <Link2 size={18} strokeWidth={1.75} />
          <span>Hash on Nimiq</span>
        </div>
        <div className="security-pill">
          <Database size={18} strokeWidth={1.75} />
          <span>Optional data on-chain</span>
        </div>
        <div className="security-pill">
          <Shield size={18} strokeWidth={1.75} />
          <span>No file upload</span>
        </div>
      </div>

      <section id="what-is-locked" className="security-section">
        <h2>What is locked on the blockchain</h2>
        <p>
          An on-chain lock records the <strong>SHA-256 fingerprint</strong> of the document bytes you
          chose - a fixed-length digest computed in your browser. When parties co-sign, the agreement
          record ties wallet signatures to that fingerprint. Locking on Nimiq anchors the hash so anyone
          can compare a later copy of the file against what was locked.
        </p>
        <p>
          The lock is about <strong>integrity of the bytes</strong> (is this the same file?) and{' '}
          <strong>who signed with which wallet</strong>. It is not a cloud copy of your document. If you
          want signatures and field data to live on Nimiq as well - not only on VeriLock servers - use
          optional <a className="security-inline-link" href="#data-backup">on-chain data backup</a>.
        </p>
      </section>

      <section id="what-stays-local" className="security-section">
        <h2>What never leaves this device</h2>
        <p>
          Fingerprinting, signing, and verification process the document <strong>in your browser</strong>.
          VeriLock does not upload or host your document content. If you share the file with co-signers,
          that handoff is out-of-band (email, chat, AirDrop) - you control who receives the bytes.
        </p>
        <p>
          Even with on-chain data backup, the <strong>PDF or image file itself never goes on-chain</strong>{' '}
          or to our servers - only structured agreement data (signatures, layout, names, wallets, form
          text) can be written to Nimiq when you choose that step.
        </p>
      </section>

      <section id="wallets" className="security-section">
        <h2>What wallets prove</h2>
        <p>
          Connecting a Nimiq wallet proves <strong>control of an address</strong> used as identity for
          create, sign, and optional lock-on-blockchain steps. The wallet does not receive your document
          bytes through VeriLock. Signing records intent from that address against the agreement
          fingerprint, not custody of the file on our servers.
        </p>
      </section>

      <section id="on-chain" className="security-section">
        <h2>What the chain stores</h2>
        <p>
          After a fingerprint lock, Nimiq holds a public transaction that anchors the document hash (and
          related attestation details shown in the app). That record is public and is not something
          VeriLock can erase. By itself, the lock does <strong>not</strong> include the document file or
          your signature drawings.
        </p>
        <p>
          Optionally, after the fingerprint is locked, you can pay credits to write a multi-transaction{' '}
          <strong>data backup</strong> on the same chain - see the next section.
        </p>
      </section>

      <section id="data-backup" className="security-section">
        <h2>On-chain data backup</h2>
        <p>
          Once the fingerprint is locked, you can store agreement overlay data on Nimiq permanently:
          signature images, initials, field layout and text, party names, and wallet addresses. The
          backup is written as a series of public Nimiq transactions tied to the document fingerprint.
        </p>
        <p>
          Anyone who has the PDF (or only its SHA-256 fingerprint) can reconstruct that overlay from the
          public chain - without needing VeriLock servers to stay online. Cost depends on how many
          frames the backup needs (typically a handful of credits); you see the exact amount before you
          confirm.
        </p>
        <p>
          This is public blockchain data by design: it is meant to outlive our app. Do not back up
          secrets you would not put on a public ledger. The original document bytes still stay on devices
          you control.
        </p>
      </section>

      <section id="verify" className="security-section">
        <h2>How anyone verifies</h2>
        <p>
          Verification re-hashes a local copy of the document in the browser and checks it against locked
          fingerprints (via invite link, lookup, or your agreements). <strong>No wallet is required</strong>{' '}
          for a basic integrity check. Matching means the bytes match the locked fingerprint; it does not
          mean VeriLock holds a copy of the file.
        </p>
        <p>
          When data backup is on-chain, verification can also rebuild signatures and fields from Nimiq
          using the document fingerprint - so the full signed agreement can be recovered from the chain
          plus the original file, not only from our servers.
        </p>
        <p>
          Prefer a fully open-source tool that never talks to this site? Use{' '}
          <a
            className="security-inline-link"
            href="https://github.com/clevertech-os/verilock-offline"
            target="_blank"
            rel="noopener noreferrer"
          >
            VeriLock Offline
          </a>{' '}
          - hash on your device and check a Nimiq lock transaction or certificate without uploading the
          file. Source and desktop builds (macOS, Windows, Linux) are on GitHub.
        </p>
      </section>

      <section id="free-vs-lock" className="security-section">
        <h2>Free signing vs on-chain lock vs data backup</h2>
        <p>
          Multi-party signing is free: agreements, wallet signatures, and field layouts live as{' '}
          <strong>metadata on VeriLock servers</strong> so you can invite, complete, print, and reopen from
          My agreements. That free record is not a permanent public proof.
        </p>
        <p>
          <strong>Locking</strong> spends <strong>1 credit</strong> to anchor only the document fingerprint
          on Nimiq - permanent byte integrity anyone can re-check.
        </p>
        <p>
          <strong>On-chain data backup</strong> (after lock) spends additional credits to write
          signatures, names, wallets, and field data on-chain so those details can outlive our servers -
          and so anyone with the PDF fingerprint can reconstruct them from Nimiq. The PDF file itself
          never leaves devices.
        </p>
      </section>

      <section id="we-store" className="security-section">
        <h2>What we store on servers</h2>
        <p>To run agreements and verification we store metadata, not document bodies, for example:</p>
        <ul>
          <li>SHA-256 fingerprints (and related agreement state)</li>
          <li>Title, type, party roles, wallet addresses, and signature status</li>
          <li>Optional notes and signature images you submit when signing</li>
          <li>Session data for wallet login (address, short-lived token)</li>
          <li>Attestation references after locking (e.g. transaction hash)</li>
          <li>Data-backup status and frame references when you choose on-chain archive</li>
        </ul>
        <p>
          Full detail lives in our{' '}
          {onPrivacy ? (
            <button type="button" className="security-inline-link security-inline-btn" onClick={onPrivacy}>
              Privacy Policy
            </button>
          ) : (
            <a className="security-inline-link" href="/privacy">
              Privacy Policy
            </a>
          )}
          .
        </p>
      </section>

      <section id="we-do-not-claim" className="security-section security-section--callout">
        <h2>What we do not claim</h2>
        <p>
          This page describes the product model. It is <strong>not legal advice</strong>, and it does not
          assert that VeriLock is certified under a particular regulation or audit program unless we state
          that separately with evidence.
        </p>
        <ul>
          <li>We do not claim DocuSign-equivalent e-sign product classes (SES / AES / QES) here.</li>
          <li>We do not display SOC 2, ISO, HIPAA, or similar badges without real certifications.</li>
          <li>
            A matching fingerprint proves byte integrity against an on-chain lock; court outcomes depend on
            your jurisdiction and counsel - not on a marketing badge.
          </li>
          <li>
            On-chain data backup makes signature and field data public on Nimiq; it is not private storage
            or encrypted vaulting of your document.
          </li>
        </ul>
      </section>

      <footer className="security-footer-cta">
        <p>Ready to fingerprint a document locally?</p>
        <div className="security-footer-actions">
          {onCreate ? (
            <button type="button" className="security-btn security-btn--primary" onClick={onCreate}>
              Create &amp; sign free
            </button>
          ) : (
            <a className="security-btn security-btn--primary" href="/?intent=creator">
              Create &amp; sign free
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
    </article>
  )
}
