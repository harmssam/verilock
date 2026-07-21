import './PrivacyPolicyPage.css'

export function PrivacyPolicyPage() {
  return (
    <div className="card privacy-policy-page">
      <h2>Privacy Policy</h2>
      <p className="muted privacy-policy-lead">
        VeriLock is built so your document never leaves your device. This policy explains what we do and do not
        collect when you use the service.
      </p>
      <p className="muted privacy-policy-updated">Last updated: July 6, 2026</p>

      <section className="privacy-policy-section">
        <h3>Your documents stay local</h3>
        <p className="muted">
          When you fingerprint, sign, or verify a document, the file is processed entirely in your browser. We
          never upload, store, or host your document content on our servers.
        </p>
      </section>

      <section className="privacy-policy-section">
        <h3>What we store</h3>
        <p className="muted">To run agreements and verification, we store only metadata tied to a document:</p>
        <ul className="privacy-policy-list muted">
          <li>SHA-256 fingerprints of your document (before and after signing, when applicable)</li>
          <li>Document title, type, page count, and optional notes you enter</li>
          <li>Party names, wallet addresses, and signature status</li>
          <li>Drawn signature images you submit when signing</li>
          <li>Blockchain attestation details (transaction hash, lock status)</li>
        </ul>
      </section>

      <section className="privacy-policy-section">
        <h3>Wallet and sessions</h3>
        <p className="muted">
          Connecting a Nimiq wallet creates a short-lived session on our servers. We store your wallet
          address, a server-issued challenge nonce, and a session token so you can create and manage
          agreements. Sessions expire automatically.
        </p>
      </section>

      <section className="privacy-policy-section">
        <h3>Blockchain records</h3>
        <p className="muted">
          When you seal a document, a Nimiq transaction anchors the document fingerprint on-chain. That
          record is public on the Nimiq blockchain and cannot be removed by VeriLock.
        </p>
      </section>

      <section className="privacy-policy-section">
        <h3>Browser storage</h3>
        <p className="muted">
          VeriLock uses your browser&apos;s local and session storage to remember your session, resume
          in-progress seal flows, and save display preferences (such as fiat currency on the pricing page).
          This data stays on your device.
        </p>
      </section>

      <section className="privacy-policy-section">
        <h3>Support contact form</h3>
        <p className="muted">
          If you use the Support page, we receive the name, email, subject, and message you submit so we can
          reply. Messages are delivered by email to VeriLock support. We also apply bot protections (rate
          limits, honeypot checks, and when configured, Cloudflare Turnstile). Do not send document contents
          through this form.
        </p>
      </section>

      <section className="privacy-policy-section">
        <h3>Third-party services</h3>
        <ul className="privacy-policy-list muted">
          <li>
            <strong>Nimiq</strong> — wallet connection, signing, and on-chain attestation via Nimiq Hub and
            Nimiq Pay
          </li>
          <li>
            <strong>Fastspot</strong> — estimated fiat exchange rates shown on the pricing page (fee amounts
            only; no personal data is sent)
          </li>
          <li>
            <strong>Google Fonts</strong> — web fonts loaded from Google&apos;s CDN when you open the app
          </li>
          <li>
            <strong>Resend</strong> — transactional email delivery (optional ready-to-seal notifications and
            support form messages)
          </li>
          <li>
            <strong>Cloudflare Turnstile</strong> — bot protection on the support form when enabled
          </li>
        </ul>
        <p className="muted">We do not use advertising or analytics trackers.</p>
      </section>

      <section className="privacy-policy-section">
        <h3>Deletion</h3>
        <p className="muted">
          Document creators can delete incomplete agreements from the app. Once a document is locked on the
          Nimiq blockchain, the on-chain fingerprint remains public even if server-side metadata is removed.
        </p>
      </section>

      <section className="privacy-policy-section">
        <h3>Changes</h3>
        <p className="muted">
          We may update this policy as the product evolves. The date at the top of this page shows when it
          was last revised.
        </p>
      </section>
    </div>
  )
}