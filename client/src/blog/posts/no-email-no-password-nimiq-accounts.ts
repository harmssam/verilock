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
  coverAlt:
    'Light mint graphic: crossed-out email and password fields next to a wallet-identity card with a hexagonal V mark, captioned “Your key is the account”',
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
      alt: 'Email and password fields struck through beside a wallet identity card: private key stays on device',
      caption: 'No inbox, no password vault. Your Nimiq wallet key is the account; only the public address is shared.',
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
      text: 'This model aligns with our core promise. Your PDF stays on your device. We calculate a local SHA-256 fingerprint. We do not upload your file. We only lock that fingerprint on the blockchain. Your identity works the same way: proof without a shared secret.',
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
      text: 'Locking With Confidence',
    },
    {
      type: 'p',
      text: 'This architecture ensures your signatures become permanent records. Your wallet creates a signature when you sign a document. We then lock the document fingerprint on the Nimiq blockchain. Anyone can check later whether a copy still matches. No wallet is required for that check.',
    },
    {
      type: 'figure',
      src: verify,
      alt: 'Laptop showing a green verification complete check while a physical wallet sits unused on the desk',
      caption:
        'This check confirms the file still matches the version locked on the blockchain. You do not need a wallet to verify.',
    },
    {
      type: 'p',
      text: 'You own your identity. You own your documents. The blockchain provides the permanent proof. This is the standard for secure agreements.',
    },
    {
      type: 'p',
      text: 'Locking a fingerprint lists at 1000 NIM. Our July promo offers 95% off, reducing the fee to 50 NIM. This offer ends August 1. Visit Pricing for current rates and credit packs.',
    },
  ],
}
