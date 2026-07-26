/**
 * FAQ page — answers to common questions about VeriLock.
 * Linked from the site footer.
 */
import { useId } from 'react'
import './FaqPage.css'

interface FaqItem {
  question: string
  answer: string
}

const FAQS: FaqItem[] = [
  {
    question: 'How is this different from DocuSign?',
    answer:
      'DocuSign uploads your document to their servers. VeriLock fingerprints it in your browser and never touches the file. DocuSign charges $15-60/user/month on subscription. VeriLock: signing is free, locking a permanent proof costs 1 credit. DocuSign\'s proof is a server timestamp they control. VeriLock\'s proof is a blockchain record anyone can verify independently, forever.',
  },
  {
    question: 'Do I need a Nimiq wallet to sign?',
    answer:
      'Yes, to sign. Your Nimiq wallet is your identity — no email, no password, no account to create. To verify a locked document later, no wallet is needed. Anyone can verify.',
  },
  {
    question: 'What happens when I run out of lock credits?',
    answer:
      'Signing stays free and unlimited. You only need credits when you want to lock a permanent blockchain proof. Additional credits are available at the normal rate. Credits never expire.',
  },
  {
    question: 'Where does my document actually live?',
    answer:
      'On your device. Always. We never receive it, store it, or see it. The SHA-256 fingerprint is computed in your browser. Servers keep agreement metadata and that fingerprint string only. The blockchain stores the fingerprint plus wallet addresses and a timestamp.',
  },
  {
    question: 'What integrations does VeriLock have?',
    answer:
      'Nimiq Wallet for signing identity. Stripe for buying credit packs. The Nimiq blockchain for permanent proof anchoring. Beyond that, VeriLock integrates with how you already send files — email, Slack, WhatsApp, shared drives. Since we never touch your document, we don\'t need to be in your stack.',
  },
  {
    question: 'Can I verify a document without a VeriLock account?',
    answer:
      'Yes. Anyone can go to verilock.online, drop a document copy, and check whether it matches a locked proof. No wallet. No login. No account. The verification is open by design.',
  },
  {
    question: 'Is there a subscription I\'m committing to?',
    answer:
      'No. Lock credits are a one-time purchase. Signing is free, always. Credits never expire. When they run out, you can buy more at the normal rate or not. No recurring charge, no auto-renewal trap.',
  },
  {
    question: 'What file types are supported?',
    answer:
      'PDF, PNG, JPEG, and WebP. The document is fingerprinted as-is — whatever format you drop is what gets locked. Print output is PDF.',
  },
]

export function FaqPage() {
  const headingId = useId()

  return (
    <div className="card faq-page" aria-labelledby={headingId}>
      <h2 id={headingId}>FAQ</h2>
      <p className="muted faq-lead">
        Common questions about how VeriLock works, what it costs, and how it compares to other
        e-signature tools.
      </p>

      <dl className="faq-list">
        {FAQS.map((faq, i) => (
          <div key={i} className="faq-item">
            <dt className="faq-question">{faq.question}</dt>
            <dd className="faq-answer">{faq.answer}</dd>
          </div>
        ))}
      </dl>

      <footer className="faq-footer">
        <p className="muted">
          Something not covered?{' '}
          <a href="/support">Send us a message</a> and we'll get back to you.
        </p>
      </footer>
    </div>
  )
}
