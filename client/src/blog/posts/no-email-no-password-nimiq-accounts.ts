import type { BlogPost } from '../types'

const cover = '/blog/no-email-no-password-nimiq-accounts.jpg'
const verify = '/blog/no-email-no-password-nimiq-accounts-verify.jpg'

export const post: BlogPost = {
  slug: 'no-email-no-password-nimiq-accounts',
  title: 'No Email, No Password: How VeriLock Accounts Work',
  description:
    'VeriLock replaces email and passwords with Nimiq wallet keys. Learn how this cryptographic approach secures your identity and keeps data on your device.',
  date: '2026-07-19',
  tags: ['guide', 'privacy'],
  coverImage: cover,
  coverAlt: 'Matte charcoal hardware key fob on a mint-washed desk with teal network nodes and fading login-button silhouettes, representing passwordless VeriLock identity',
  relatedSlugs: [
    'how-verilock-works',
    'what-is-verilock',
    'blockchain-pdf-signature-verification',
  ],
    body: [
    {
      type: 'p',
      text: 'Your email inbox is a security liability. Passwords are frequently compromised. VeriLock removes these vulnerabilities entirely. There is no sign in with Google. There is no Microsoft account. We store no email addresses on our servers. Your account exists solely as a cryptographic key pair.',
    },
    {
      type: 'p',
      text: 'This key pair lives on the Nimiq network. It is the actual mechanism that grants access. When you connect your wallet, you prove ownership of your identity. You do not share secrets. You simply verify your presence.',
    },
    {
      type: 'h2',
      text: 'The Key Is The Account',
    },
    {
      type: 'p',
      text: 'Traditional logins rely on centralized databases. You give a copy of your credentials to a provider. They keep a record of who you are. If that record is breached, your identity is at risk.',
    },
    {
      type: 'p',
      text: 'Blockchain accounts function like a digital signature lock. You hold the private key. It stays on your device. The network only sees the public address. You never transmit your private key. You sign a challenge to prove ownership. This verifies who you are without revealing your secret.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Diagram showing a private key stored locally while a public address connects to the network',
      caption: 'Your private key stays on your device. Only the public address interacts with the network.',
    },
    {
      type: 'h2',
      text: 'Why Remove Email and Passwords?',
    },
    {
      type: 'p',
      text: 'We removed these options to enforce security and privacy. Email inboxes are frequent targets. Passwords are often weak or reused. Eliminating them removes the attack surface.',
    },
    {
      type: 'ul',
      items: [
        'No central database of emails to steal',
        'No passwords to reset or forget',
        'No SMS codes to intercept',
        'Full control remains with the user',
      ],
    },
    {
      type: 'p',
      text: 'This model aligns with our core promise. Your PDF stays on your device. We calculate a local SHA-256 fingerprint. We do not upload your file. We only seal the hash on the blockchain. Your identity operates with the same permanence.',
    },
    {
      type: 'h2',
      text: 'How To Access Your History',
    },
    {
      type: 'p',
      text: 'Connect the same wallet to return. The system reads your public address. It instantly loads the agreement history associated with that address. There is no waiting for an email link. There is no two-factor delay.',
    },
    {
      type: 'note',
      text: 'Losing your wallet seed phrase means losing access to your account history. There is no password reset button. Guard your keys carefully.',
    },
    {
      type: 'quote',
      text: 'Trust is mathematical, not institutional. You verify the signature, not the company.',
      cite: 'VeriLock Team',
    },
    {
      type: 'h2',
      text: 'Sealing With Confidence',
    },
    {
      type: 'p',
      text: 'This architecture ensures your signatures become permanent records. Your wallet creates a signature when you sign a document. We then place a seal on the Nimiq blockchain. Anyone can verify the integrity later. They can re-hash the candidate PDF against the sealed record. Verification does not require a wallet.',
    },
    {
      type: 'figure',
      src: verify,
      alt: 'Verification tool displaying a green checkmark next to a document hash',
      caption: 'Verification confirms the file has not changed since the seal was created.',
    },
    {
      type: 'p',
      text: 'You own your identity. You own your documents. The blockchain provides the permanent proof. This is the standard for secure agreements.',
    },
    {
      type: 'p',
      text: 'Seals list at 1000 NIM each. Our July promo offers 95% off, reducing the fee to 50 NIM. This offer ends August 1. Visit Pricing for current rates and credit packs.',
    },
  ],
}
