/**
 * X Post Ideas — admin table for storing post ideas with source URLs, copy, and dates.
 * Pre-populated with Reddit complaint research data.
 */
import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from './db.js'

// ── Table ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_x_ideas (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL DEFAULT '',
    copy TEXT NOT NULL DEFAULT '',
    idea_date TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

// ── Seed data (Reddit complaint research, 2026) ───────────────────────────

const SEED_IDEAS: Array<{ source_url: string; copy: string; idea_date: string }> = [
  {
    source_url: 'https://www.reddit.com/r/BuyFromEU/comments/1v3o2jm/european_alternatives_to_docusign_2026/',
    copy: 'European businesses actively dumping DocuSign — "its expensive too." 52 upvotes, 50 comments of EU alternatives. The great e-signature exodus from US tech.',
    idea_date: '2026-07-20',
  },
  {
    source_url: 'https://www.reddit.com/r/docusign/comments/1vb6ffq/account_vanished/',
    copy: 'Docusign deleted this person\'s paid account with no warning. "Account Vanished." Partially-signed trust documents gone. Support unreachable because "account doesn\'t exist." Had to get help on Reddit.',
    idea_date: '2026-07-29',
  },
  {
    source_url: 'https://www.reddit.com/r/docusign/comments/1re12ns/advertise_docusign_alternatives_in_this_thread/',
    copy: '"I haven\'t used DocuSign in 3 years and last year went through a big hassle to cancel it. Last month I got another $600 charge on my credit card.. HOW CAN I FOREVER GET RID OF THIS? I\'M RETIRED!"',
    idea_date: '2026-03-20',
  },
  {
    source_url: 'https://www.reddit.com/r/docusign/comments/1n0swxn/thinking_to_build_an_affordable_alternative_to/',
    copy: '"Hate: per envelope cost. They think every agreement brings in income and DocuSign deserves a cut. More often than not, the document is a compliance form which doesn\'t bring in extra profit." Also: web forms charged as separate envelopes from one template.',
    idea_date: '2025-08-25',
  },
  {
    source_url: 'https://www.reddit.com/r/docusign/comments/1vb57k9/issue_signing_on/',
    copy: 'DocuSign outage — free trial user getting errors, AI chatbot says no humans available. "try again later." Official Docusign account confirmed it was a production outage.',
    idea_date: '2026-07-29',
  },
  {
    source_url: 'https://www.reddit.com/r/SaaS/comments/1rebcl5/anyone_know_good_docusign_alternatives_for_small/',
    copy: '"If you just need signatures, DocuSign is overkill on price." 39 comments of people recommending cheaper alternatives. The market is fragmenting fast.',
    idea_date: '2026-02-25',
  },
  {
    source_url: 'https://www.reddit.com/r/CFP/comments/1kgaqzk/tech_stack_deep_dive/',
    copy: 'Financial planning firm lists DocuSign under "Tech we have tried and canceled." Alongside Adobe. Finance professionals dumping legacy e-signature.',
    idea_date: '2026-05-20',
  },
  {
    source_url: 'https://www.reddit.com/r/selfhosted/comments/1j2tf3q/looking_for_a_docusign_alternative_any/',
    copy: '"Looking for a reliable and cost-effective alternative to DocuSign" — 83 comments. Self-hosted community has moved to Docuseal, Documenso, OpenSign. The open-source e-signature movement is real.',
    idea_date: '2026-03-03',
  },
  {
    source_url: 'https://www.reddit.com/r/docusign/comments/1n0swxn/thinking_to_build_an_affordable_alternative_to/',
    copy: '"DocuSign is in bed with more and more organizations that accept no other alternative and force you to buy into DocuSign\'s overrated and overpriced solution." Vendor lock-in complaints.',
    idea_date: '2025-08-25',
  },
  {
    source_url: 'https://www.reddit.com/r/docusign/comments/1re12ns/advertise_docusign_alternatives_in_this_thread/',
    copy: '"DocuSign is very bloated and expensive; most people just need a secure e-signature platform, and that\'s why there are now 300+ vendors offering e-signatures." — from a competitor who works in the space.',
    idea_date: '2026-03-20',
  },
  {
    source_url: 'https://www.reddit.com/r/changemyview/comments/r5548e/cmv_signatures_are_an_antiquated_useless_system/',
    copy: '"Programs like Docusign just let you copy and paste signatures from a given selection of handwriting!" "A 30% failure rate by experts" in signature verification. Signatures are broken — blockchain verification solves this.',
    idea_date: '2021-11-30',
  },
  {
    source_url: 'https://www.reddit.com/r/Questrade/comments/1qlwntt/management_please_read_it_you_are_clueless_about/',
    copy: 'Customer screaming at a brokerage: "You need a full revamp of the documentation part, DocuSign must be everywhere, and documentation friction should be minimal!" Even companies that HAVE DocuSign aren\'t using it right.',
    idea_date: '2026-01-20',
  },
  {
    source_url: 'https://www.reddit.com/r/CRM/comments/1qwgmbk/unpopular_opinion_you_are_overpaying_for/',
    copy: '"The SaaS Trap": Salesforce ($100/mo) + Trello ($60/mo) + DocuSign ($40/mo) + Zapier ($50/mo) = $300+/mo for a slow clunky stack. Custom software now cheaper than generic SaaS. The unbundling is happening.',
    idea_date: '2026-03-05',
  },
  {
    source_url: 'https://www.reddit.com/r/SaaS/comments/1t5ki8k/launching_an_affiliate_program_for_a_fast_growing/',
    copy: 'Signeasy (48K+ businesses, 10+ years, 4.7/5 G2) paying 25% recurring commissions to affiliates targeting DocuSign alternatives. "There\'s a lot of search traffic there." Even the competitors know the search intent.',
    idea_date: '2026-05-05',
  },
]

const seedCount = db.prepare('SELECT COUNT(*) as n FROM admin_x_ideas').get() as { n: number }
if (seedCount.n === 0) {
  const now = Date.now()
  const insert = db.prepare(
    'INSERT INTO admin_x_ideas (id, source_url, copy, idea_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const tx = db.transaction(() => {
    for (const idea of SEED_IDEAS) {
      insert.run(randomUUID(), idea.source_url, idea.copy, idea.idea_date, now, now)
    }
  })
  tx()
  console.log(`[admin-x-ideas] seeded ${SEED_IDEAS.length} ideas`)
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface XIdea {
  id: string
  source_url: string
  copy: string
  idea_date: string
  created_at: number
  updated_at: number
}

export interface XIdeaInput {
  source_url?: string
  copy?: string
  idea_date?: string
}

// ── CRUD ───────────────────────────────────────────────────────────────────

function listIdeas(): XIdea[] {
  return db.prepare('SELECT * FROM admin_x_ideas ORDER BY created_at DESC').all() as XIdea[]
}

function getIdea(id: string): XIdea | undefined {
  return db.prepare('SELECT * FROM admin_x_ideas WHERE id = ?').get(id) as XIdea | undefined
}

function createIdea(input: XIdeaInput): XIdea {
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO admin_x_ideas (id, source_url, copy, idea_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, input.source_url?.trim() ?? '', input.copy?.trim() ?? '', input.idea_date?.trim() ?? '', now, now)
  return getIdea(id)!
}

function updateIdea(id: string, input: XIdeaInput): XIdea | undefined {
  const existing = getIdea(id)
  if (!existing) return undefined
  const now = Date.now()
  db.prepare(
    'UPDATE admin_x_ideas SET source_url = ?, copy = ?, idea_date = ?, updated_at = ? WHERE id = ?',
  ).run(
    input.source_url?.trim() ?? existing.source_url,
    input.copy?.trim() ?? existing.copy,
    input.idea_date?.trim() ?? existing.idea_date,
    now,
    id,
  )
  return getIdea(id)
}

function deleteIdea(id: string): boolean {
  const result = db.prepare('DELETE FROM admin_x_ideas WHERE id = ?').run(id)
  return result.changes > 0
}

// ── Route helpers ──────────────────────────────────────────────────────────

function paramId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

// ── Route registration ─────────────────────────────────────────────────────

export function attachAdminXIdeasRoutes(
  app: { get: Function; post: Function; patch: Function; delete: Function },
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void,
): void {
  // List all
  app.get('/api/admin/x-ideas', requireAdmin, (_req: Request, res: Response) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json({ ideas: listIdeas() })
    } catch (err) {
      console.error('[admin] x-ideas list', err)
      res.status(500).json({ error: 'Could not load X ideas.' })
    }
  })

  // Create
  app.post('/api/admin/x-ideas', requireAdmin, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as XIdeaInput
      if (!body.copy?.trim()) {
        res.status(400).json({ error: 'Copy text is required.' })
        return
      }
      const idea = createIdea(body)
      res.status(201).json({ idea })
    } catch (err) {
      console.error('[admin] x-ideas create', err)
      res.status(500).json({ error: 'Could not create idea.' })
    }
  })

  // Update
  app.patch('/api/admin/x-ideas/:id', requireAdmin, (req: Request, res: Response) => {
    try {
      const id = paramId(req.params.id)
      const body = (req.body ?? {}) as XIdeaInput
      const idea = updateIdea(id, body)
      if (!idea) {
        res.status(404).json({ error: 'Idea not found.' })
        return
      }
      res.json({ idea })
    } catch (err) {
      console.error('[admin] x-ideas update', err)
      res.status(500).json({ error: 'Could not update idea.' })
    }
  })

  // Delete
  app.delete('/api/admin/x-ideas/:id', requireAdmin, (req: Request, res: Response) => {
    try {
      const id = paramId(req.params.id)
      const ok = deleteIdea(id)
      if (!ok) {
        res.status(404).json({ error: 'Idea not found.' })
        return
      }
      res.json({ ok: true })
    } catch (err) {
      console.error('[admin] x-ideas delete', err)
      res.status(500).json({ error: 'Could not delete idea.' })
    }
  })
}
