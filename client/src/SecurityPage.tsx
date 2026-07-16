/**
 * Security & integrity — product-true trust page.
 * No invented certifications or legal “we comply with X” claims.
 */
import { Fingerprint, Link2, Shield, Wallet } from 'lucide-react'
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
        <h1 id="security-title">How VeriLock protects your PDF</h1>
        <p className="security-lead">
          VeriLock is built so your file stays on your device, your wallet proves who you are, and only a
          fingerprint is anchored on Nimiq. This page explains that model in plain language — not a
          certificate wall.
        </p>
        <p className="security-updated">Last updated: July 15, 2026</p>
      </header>

      <nav className="security-toc" aria-label="On this page">
        <a href="#what-is-sealed">What is sealed</a>
        <a href="#what-stays-local">What stays local</a>
        <a href="#wallets">Wallets</a>
        <a href="#on-chain">On-chain record</a>
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
          <Shield size={18} strokeWidth={1.75} />
          <span>No PDF upload</span>
        </div>
      </div>

      <section id="what-is-sealed" className="security-section">
        <h2>What is sealed</h2>
        <p>
          A seal records the <strong>SHA-256 fingerprint</strong> of the PDF bytes you chose — a fixed-length
          digest computed in your browser. When parties co-sign, the agreement record ties wallet
          signatures to that fingerprint. Sealing on Nimiq anchors the hash so anyone can compare a later
          copy of the file against what was locked.
        </p>
        <p>
          The seal is about <strong>integrity of the bytes</strong> (is this the same file?) and{' '}
          <strong>who signed with which wallet</strong>. It is not a cloud copy of your document.
        </p>
      </section>

      <section id="what-stays-local" className="security-section">
        <h2>What never leaves this device</h2>
        <p>
          Fingerprinting, signing, and verification process the PDF <strong>in your browser</strong>. VeriLock
          does not upload or host your PDF content. If you share the file with co-signers, that handoff is
          out-of-band (email, chat, AirDrop) — you control who receives the bytes.
        </p>
      </section>

      <section id="wallets" className="security-section">
        <h2>What wallets prove</h2>
        <p>
          Connecting a Nimiq wallet proves <strong>control of an address</strong> used as identity for
          create, sign, and seal steps. The wallet does not receive your PDF bytes through VeriLock. Signing
          records intent from that address against the agreement fingerprint, not custody of the file on our
          servers.
        </p>
      </section>

      <section id="on-chain" className="security-section">
        <h2>What the chain stores</h2>
        <p>
          A sealed agreement results in a Nimiq transaction that anchors the document fingerprint (and related
          attestation details shown in the app). That on-chain record is public on Nimiq and is not something
          VeriLock can erase. It does <strong>not</strong> include the PDF itself.
        </p>
      </section>

      <section id="verify" className="security-section">
        <h2>How anyone verifies</h2>
        <p>
          Verification re-hashes a local copy of the PDF in the browser and checks it against sealed
          fingerprints (via invite link, lookup, or your agreements). <strong>No wallet is required</strong>{' '}
          for a basic integrity check. Matching means the bytes match the sealed fingerprint; it does not
          mean VeriLock holds a copy of the file.
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
          <li>Attestation references after seal (e.g. transaction hash)</li>
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
            A matching fingerprint proves byte integrity against a seal; court outcomes depend on your
            jurisdiction and counsel — not on a marketing badge.
          </li>
        </ul>
      </section>

      <footer className="security-footer-cta">
        <p>Ready to fingerprint a PDF locally?</p>
        <div className="security-footer-actions">
          {onCreate ? (
            <button type="button" className="security-btn security-btn--primary" onClick={onCreate}>
              Create &amp; seal
            </button>
          ) : (
            <a className="security-btn security-btn--primary" href="/?intent=creator">
              Create &amp; seal
            </a>
          )}
          {onVerify ? (
            <button type="button" className="security-btn security-btn--ghost" onClick={onVerify}>
              Verify a PDF
            </button>
          ) : (
            <a className="security-btn security-btn--ghost" href="/?intent=verifier">
              Verify a PDF
            </a>
          )}
        </div>
      </footer>
    </article>
  )
}
