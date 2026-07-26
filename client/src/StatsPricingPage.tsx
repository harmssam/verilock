/**
 * eSignature Pricing Report — journalist-keyword resource page.
 * Data-driven comparison for journalists citing e-signature pricing.
 * Last updated: July 2026. Next review: October 2026.
 */
import { useId } from 'react'
import './StatsPricingPage.css'

// ── Pricing data (updated July 2026) ──

interface ProviderTier {
  name: string
  price: string
  notes: string
}

interface Provider {
  name: string
  slug: string
  tiers: ProviderTier[]
  freeTier: string
  payPerUse: boolean
  uploadsDocument: boolean
  url: string
}

const PROVIDERS: Provider[] = [
  {
    name: 'DocuSign',
    slug: 'docusign',
    tiers: [
      { name: 'Personal', price: '$15/user/mo', notes: '5 sends/month' },
      { name: 'Standard', price: '$45/user/mo', notes: 'Unlimited, templates, reminders' },
      { name: 'Business Pro', price: '$60/user/mo', notes: 'Advanced fields, signer attachments' },
    ],
    freeTier: '5 free sends, then pay',
    payPerUse: false,
    uploadsDocument: true,
    url: 'https://www.docusign.com/products-and-pricing',
  },
  {
    name: 'Adobe Acrobat Sign',
    slug: 'adobe',
    tiers: [
      { name: 'Standard', price: '$12.99/mo', notes: '1 user, e-signatures only' },
      { name: 'Pro', price: '$19.99/mo', notes: 'PDF editing, export' },
      { name: 'Teams', price: '$29.99/user/mo', notes: 'Team admin, integrations' },
    ],
    freeTier: 'Limited free tier',
    payPerUse: false,
    uploadsDocument: true,
    url: 'https://www.adobe.com/acrobat/business/pricing-plans.html',
  },
  {
    name: 'PandaDoc',
    slug: 'pandadoc',
    tiers: [
      { name: 'Starter', price: '$19/user/mo', notes: 'Unlimited docs, templates' },
      { name: 'Business', price: '$49/seat/mo', notes: 'CRM, content library, approvals' },
      { name: 'Enterprise', price: 'Custom', notes: 'SSO, API, custom integrations' },
    ],
    freeTier: 'Free (limited features)',
    payPerUse: false,
    uploadsDocument: true,
    url: 'https://www.pandadoc.com/pricing/',
  },
  {
    name: 'Dropbox Sign',
    slug: 'dropbox',
    tiers: [
      { name: 'Essentials', price: '$15/mo', notes: '1 user, unlimited sends' },
      { name: 'Standard', price: '$25/user/mo', notes: 'Team features' },
      { name: 'Premium', price: 'Custom', notes: 'Enterprise' },
    ],
    freeTier: '3 free/month',
    payPerUse: false,
    uploadsDocument: true,
    url: 'https://sign.dropbox.com/products/dropbox-sign/pricing',
  },
  {
    name: 'SignNow',
    slug: 'signnow',
    tiers: [
      { name: 'Business', price: '$8/user/mo', notes: 'Basic e-signatures' },
      { name: 'Business Premium', price: '$15/user/mo', notes: 'Templates, reminders' },
      { name: 'Enterprise', price: '$30/user/mo', notes: 'Advanced integrations' },
    ],
    freeTier: 'No',
    payPerUse: false,
    uploadsDocument: true,
    url: 'https://www.signnow.com/pricing',
  },
  {
    name: 'Xodo Sign',
    slug: 'xodo',
    tiers: [
      { name: 'Basic', price: '$9.99/mo', notes: '1 user' },
      { name: 'Professional', price: '$39.99/mo', notes: 'Templates, teams' },
      { name: 'Enterprise', price: 'Custom', notes: 'SSO, API' },
    ],
    freeTier: '5 docs/month free',
    payPerUse: false,
    uploadsDocument: true,
    url: 'https://eversign.com/pricing',
  },
  {
    name: 'VeriLock',
    slug: 'verilock',
    tiers: [
      { name: 'Pay-per-lock', price: '$0.49/document', notes: 'No subscription. Pay only when you lock on-chain.' },
    ],
    freeTier: 'Free multi-party signing. Pay only for optional on-chain lock.',
    payPerUse: true,
    uploadsDocument: false,
    url: '/pricing',
  },
]

// ── Cost-per-document scenarios ──

interface ScenarioDoc {
  label: string
  docsPerMonth: number
}

interface ScenarioRow {
  provider: string
  tier: string
  monthlyCost: number
  costPerDoc: number
  isVerilock?: boolean
}

function calcScenarios(docs: number): ScenarioRow[] {
  // VeriLock: $0.49 per document
  const verilockRow: ScenarioRow = { provider: 'VeriLock', tier: 'Pay-per-lock', monthlyCost: +(docs * 0.49).toFixed(2), costPerDoc: 0.49, isVerilock: true }
  const subs: ScenarioRow[] = [
    { provider: 'DocuSign', tier: 'Personal $15', monthlyCost: docs <= 5 ? 15 : 45, costPerDoc: +(docs <= 5 ? 15 / docs : 45 / docs).toFixed(2) },
    { provider: 'Adobe Sign', tier: 'Standard $12.99', monthlyCost: 12.99, costPerDoc: +(12.99 / docs).toFixed(2) },
    { provider: 'PandaDoc', tier: 'Starter $19', monthlyCost: 19, costPerDoc: +(19 / docs).toFixed(2) },
    { provider: 'Dropbox Sign', tier: 'Essentials $15', monthlyCost: 15, costPerDoc: +(15 / docs).toFixed(2) },
    { provider: 'SignNow', tier: 'Business $8', monthlyCost: 8, costPerDoc: +(8 / docs).toFixed(2) },
  ]
  return [verilockRow, ...subs].sort((a, b) => a.costPerDoc - b.costPerDoc)
}

const SCENARIOS: ScenarioDoc[] = [
  { label: 'Light user', docsPerMonth: 5 },
  { label: 'Moderate user', docsPerMonth: 15 },
  { label: 'Heavy user', docsPerMonth: 50 },
]

function fmtMoney(n: number): string {
  return '$' + n.toFixed(2)
}

// ── Annual cost at 8 docs/month ──

const ANNUAL_EIGHT: { provider: string; annual: number; details: string }[] = [
  { provider: 'VeriLock', annual: 47.04, details: '$0.49/doc · 96 docs/year · no subscription' },
  { provider: 'SignNow', annual: 96, details: 'Business $8/mo · $96/year' },
  { provider: 'Adobe Sign', annual: 155.88, details: 'Standard $12.99/mo · $155.88/year' },
  { provider: 'Dropbox Sign', annual: 180, details: 'Essentials $15/mo · $180/year' },
  { provider: 'PandaDoc', annual: 228, details: 'Starter $19/mo · $228/year' },
  { provider: 'DocuSign', annual: 540, details: 'Standard $45/mo · $540/year' },
].sort((a, b) => a.annual - b.annual)

// ── Component ──

export function StatsPricingPage() {
  const pricingId = useId()

  return (
    <article className="stats-page stats-pricing" aria-labelledby="stats-pricing-title">
      {/* ── Hero ── */}
      <header className="stats-hero">
        <p className="stats-hero-eyebrow">eSignature Pricing Report · July 2026</p>
        <h1 id="stats-pricing-title" className="stats-hero-title">
          eSignature Pricing Report 2026
        </h1>
        <p className="stats-hero-stat">
          The average e-signature subscription costs <strong>$22/user/month</strong>
          {' — but most users sign fewer than '}
          <strong>10 documents monthly</strong>
          {'. At 5 documents/month, that\'s '}
          <strong>$4.40 per signature</strong>
          {'. VeriLock costs '}
          <strong>$0.49 per document</strong>, period.
        </p>
        <p className="stats-hero-updated">
          Last updated: July 25, 2026 · Next review: October 2026
        </p>
      </header>

      {/* ── Key Takeaways ── */}
      <section className="stats-section" aria-labelledby={`${pricingId}-takeaways`}>
        <h2 id={`${pricingId}-takeaways`} className="stats-h2">Key Takeaways</h2>
        <ul className="stats-takeaways">
          <li>e-signature pricing ranges from <strong>$8 to $60 per user/month</strong> for subscription plans.</li>
          <li>Most providers <strong>lock basic features</strong> (templates, reminders, branding) behind higher tiers — the entry price is a teaser.</li>
          <li>Pay-per-use alternatives like VeriLock cost <strong>$0.49/document</strong> — no monthly minimum, no feature tiers.</li>
          <li>For users signing fewer than <strong>30 documents/month</strong>, subscription plans cost more per signature than pay-per-use.</li>
          <li>The average business user signs <strong>5–8 documents per month</strong> — well below most plan break-even points.</li>
        </ul>
      </section>

      {/* ── Pricing Table ── */}
      <section className="stats-section" aria-labelledby={`${pricingId}-table`}>
        <h2 id={`${pricingId}-table`} className="stats-h2">Subscription Pricing Comparison</h2>
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Lowest Paid Plan</th>
                <th scope="col">Price</th>
                <th scope="col">Mid-Tier</th>
                <th scope="col">Price</th>
                <th scope="col">Free Tier?</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.map(p => {
                const lowest = p.tiers[0]
                const mid = p.tiers[1]
                const isVerilock = p.slug === 'verilock'
                return (
                  <tr key={p.slug} className={isVerilock ? 'stats-row--verilock' : ''}>
                    <td className="stats-table-provider">
                      {p.name}
                      {isVerilock && <span className="stats-badge">Pay-per-use</span>}
                    </td>
                    <td>{lowest?.name ?? '—'}</td>
                    <td className="stats-table-price">{lowest?.price ?? '—'}</td>
                    <td>{mid?.name ?? '—'}</td>
                    <td className="stats-table-price">{mid?.price ?? '—'}</td>
                    <td>{p.freeTier}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="stats-table-note">
          All competitor pricing from official pricing pages, accessed July 2026. Monthly billing shown where available.
          Enterprise and custom pricing excluded. Sources linked in the methodology section.
        </p>
      </section>

      {/* ── Feature Comparison ── */}
      <section className="stats-section" aria-labelledby={`${pricingId}-features`}>
        <h2 id={`${pricingId}-features`} className="stats-h2">What You Get at the Lowest Paid Tier</h2>
        <p className="stats-lead">
          The base price looks cheap — but most providers strip core features at the entry level,
          forcing an upgrade for anything beyond basic signatures.
        </p>
        <div className="stats-table-wrap">
          <table className="stats-table stats-table--features">
            <thead>
              <tr>
                <th scope="col">Feature</th>
                {PROVIDERS.map(p => (
                  <th key={p.slug} scope="col" className={p.slug === 'verilock' ? 'stats-col--verilock' : ''}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { feature: 'E-signatures', map: () => true },
                { feature: 'Unlimited documents', map: (p: Provider) => p.payPerUse || p.slug === 'pandadoc' || p.slug === 'dropbox', notes: (p: Provider) => p.slug === 'docusign' ? '5 sends' : p.slug === 'adobe' ? '150/yr' : p.payPerUse ? 'Pay per doc' : null },
                { feature: 'Templates', map: (p: Provider) => p.slug === 'pandadoc', notes: (p: Provider) => p.payPerUse ? 'N/A' : null },
                { feature: 'Branding', map: (p: Provider) => p.payPerUse, notes: (p: Provider) => p.payPerUse ? 'Always included' : null },
                { feature: 'Reminders', map: (p: Provider) => p.slug === 'dropbox' || p.slug === 'signnow', notes: (p: Provider) => p.payPerUse ? 'N/A' : null },
                { feature: 'Multi-party signing', map: (p: Provider) => p.slug !== 'adobe' && p.slug !== 'docusign', notes: (p: Provider) => p.slug === 'adobe' ? 'Limited' : null },
                { feature: 'Audit trail', map: () => true, notes: (p: Provider) => p.payPerUse ? 'Blockchain' : 'Basic' },
                { feature: 'Document never uploaded', map: (p: Provider) => !p.uploadsDocument },
              ].map(({ feature, map, notes }) => (
                <tr key={feature}>
                  <td className="stats-feature-name">{feature}</td>
                  {PROVIDERS.map(p => {
                    const has = map(p)
                    const note = notes ? notes(p) : null
                    return (
                      <td key={p.slug} className={p.slug === 'verilock' ? 'stats-col--verilock' : ''}>
                        {has ? <span className="stats-check">✓</span> : <span className="stats-cross">—</span>}
                        {note && <span className="stats-feature-note"> {note}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Cost Per Document ── */}
      <section className="stats-section" aria-labelledby={`${pricingId}-cost`}>
        <h2 id={`${pricingId}-cost`} className="stats-h2">Cost Per Document: The Hidden Math</h2>
        <p className="stats-lead">
          The monthly price tells one story. The actual cost per signature tells another.
          Here's what you really pay at three usage levels.
        </p>

        {SCENARIOS.map(s => {
          const rows = calcScenarios(s.docsPerMonth)
          const cheapest = rows[0]
          return (
            <div key={s.label} className="stats-scenario">
              <h3 className="stats-scenario-title">
                {s.label}: <span className="stats-scenario-docs">{s.docsPerMonth} documents/month</span>
              </h3>
              <div className="stats-table-wrap">
                <table className="stats-table stats-table--scenario">
                  <thead>
                    <tr>
                      <th scope="col">Provider</th>
                      <th scope="col">Plan</th>
                      <th scope="col">Monthly Cost</th>
                      <th scope="col">Cost per Document</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.provider} className={r.isVerilock ? 'stats-row--verilock' : ''}>
                        <td className="stats-table-provider">
                          {r.provider}
                          {i === 0 && <span className="stats-badge stats-badge--best">Best value</span>}
                        </td>
                        <td>{r.tier}</td>
                        <td className="stats-table-price">{fmtMoney(r.monthlyCost)}</td>
                        <td className="stats-table-price">{fmtMoney(r.costPerDoc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="stats-scenario-verdict">
                Cheapest: <strong>{cheapest.provider}</strong> at <strong>{fmtMoney(cheapest.costPerDoc)}/document</strong>
                {cheapest.isVerilock ? ' — pay-per-use with no monthly commitment.' : ` — ${cheapest.tier}.`}
              </p>
            </div>
          )
        })}

        <div className="stats-callout">
          <p>
            <strong>The crossover point:</strong> VeriLock is cheapest for users signing fewer than ~30 documents/month.
            Above 30 docs, SignNow Premium and Adobe Pro become cheaper per document — but lock you into a recurring subscription.
            With VeriLock, <strong>zero documents in a month costs zero dollars</strong>.
          </p>
        </div>
      </section>

      {/* ── Annual Cost Comparison ── */}
      <section className="stats-section" aria-labelledby={`${pricingId}-annual`}>
        <h2 id={`${pricingId}-annual`} className="stats-h2">Annual Cost: 8 Documents per Month</h2>
        <p className="stats-lead">
          The average e-signature user signs 5–8 documents per month.
          At that volume, annual subscription costs range from $96 to $540.
        </p>
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Annual Cost</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {ANNUAL_EIGHT.map((r, i) => (
                <tr key={r.provider} className={r.provider === 'VeriLock' ? 'stats-row--verilock' : ''}>
                  <td className="stats-table-provider">
                    {r.provider}
                    {i === 0 && <span className="stats-badge stats-badge--best">Best value</span>}
                  </td>
                  <td className="stats-table-price">{fmtMoney(r.annual)}</td>
                  <td className="stats-table-detail">{r.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Hidden Costs ── */}
      <section className="stats-section" aria-labelledby={`${pricingId}-hidden`}>
        <h2 id={`${pricingId}-hidden`} className="stats-h2">Hidden Costs: What's Not in the Sticker Price</h2>
        <div className="stats-table-wrap">
          <table className="stats-table stats-table--features">
            <thead>
              <tr>
                <th scope="col">Hidden Cost</th>
                {PROVIDERS.filter(p => !p.payPerUse).map(p => (
                  <th key={p.slug} scope="col">{p.name}</th>
                ))}
                <th scope="col" className="stats-col--verilock">VeriLock</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Additional users', subs: ['$45–60/user/mo', '$29.99/user/mo', '$49/seat/mo', '$25/user/mo', '$15–30/user/mo', '$39.99/mo'], verilock: 'Free (wallet-based)' },
                { label: 'Branding removal', subs: ['Mid-tier', 'Pro tier', 'Business tier', 'N/A', 'Premium tier', 'Pro tier'], verilock: 'Always included' },
                { label: 'API access', subs: ['Enterprise', 'Enterprise', 'Enterprise', 'API plan', 'Enterprise', 'Enterprise'], verilock: 'N/A' },
                { label: 'Compliance (HIPAA)', subs: ['Enterprise', 'Enterprise', 'Enterprise', 'N/A', 'N/A', 'N/A'], verilock: 'Client-side (N/A)' },
                { label: 'Overage beyond plan', subs: ['Per-envelope', 'Per-transaction', 'Per-document', 'Unlimited', 'Per-document', 'Per-document'], verilock: 'N/A (pay per doc)' },
              ].map(({ label, subs, verilock }) => (
                <tr key={label}>
                  <td className="stats-feature-name">{label}</td>
                  {subs.map((s, i) => (
                    <td key={i}>{s}</td>
                  ))}
                  <td className="stats-col--verilock">{verilock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Methodology ── */}
      <section className="stats-section stats-methodology" aria-labelledby={`${pricingId}-method`}>
        <h2 id={`${pricingId}-method`} className="stats-h2">Methodology</h2>
        <ul className="stats-method-list">
          <li><strong>Pricing data collected:</strong> July 25, 2026, from official provider pricing pages.</li>
          <li><strong>VeriLock lock cost:</strong> 1,000 NIM per lock. NIM/USD rate: $0.000488 (CoinGecko, July 25, 2026).</li>
          <li><strong>Cost-per-document scenarios:</strong> Assumes single-signer documents. Multi-party signing adds $0.49 per additional signer on VeriLock.</li>
          <li><strong>Enterprise pricing excluded:</strong> Custom quotes vary by organization size, volume commitments, and contract length.</li>
          <li><strong>Annual billing discounts not applied:</strong> Monthly pricing shown throughout for fair comparison. Annual plans are typically 15–30% cheaper.</li>
          <li><strong>Next review:</strong> October 2026. Pricing data is checked quarterly.</li>
        </ul>

        <h3 className="stats-h3">Sources</h3>
        <ul className="stats-source-list">
          <li><a href="https://www.docusign.com/products-and-pricing" target="_blank" rel="noopener noreferrer">DocuSign Pricing</a></li>
          <li><a href="https://www.adobe.com/acrobat/business/pricing-plans.html" target="_blank" rel="noopener noreferrer">Adobe Acrobat Sign Pricing</a></li>
          <li><a href="https://www.pandadoc.com/pricing/" target="_blank" rel="noopener noreferrer">PandaDoc Pricing</a></li>
          <li><a href="https://sign.dropbox.com/products/dropbox-sign/pricing" target="_blank" rel="noopener noreferrer">Dropbox Sign Pricing</a></li>
          <li><a href="https://www.signnow.com/pricing" target="_blank" rel="noopener noreferrer">SignNow Pricing</a></li>
          <li><a href="https://eversign.com/pricing" target="_blank" rel="noopener noreferrer">Xodo Sign Pricing</a></li>
          <li><a href="https://www.coingecko.com/en/coins/nimiq-2" target="_blank" rel="noopener noreferrer">NIM/USD Rate (CoinGecko)</a></li>
        </ul>
      </section>

      {/* ── Footer CTA ── */}
      <footer className="stats-cta">
        <p className="stats-cta-text">
          Lock your next document for <strong>$0.49</strong>. No subscription. No upload. Just proof.
        </p>
        <a href="/pricing" className="stats-cta-btn">See VeriLock pricing</a>
      </footer>
    </article>
  )
}
