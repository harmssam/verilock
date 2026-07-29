/**
 * Operator-editable key/value settings (SQLite), used by the admin portal.
 */
import { db } from './db.js'
import { SUPPORT_AUTO_ACK_DEFAULT_BODY } from './supportAutoAckDefault.js'

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

const KEY_SUPPORT_AUTO_ACK_BODY = 'support_auto_ack_body'

export const SUPPORT_AUTO_ACK_MAX_LENGTH = 8000

function getKv(key: string): string | null {
  const row = db.prepare(`SELECT value FROM admin_kv WHERE key = ?`).get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function setKv(key: string, value: string): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO admin_kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, now)
}

function deleteKv(key: string): void {
  db.prepare(`DELETE FROM admin_kv WHERE key = ?`).run(key)
}

/** Built-in copy shipped with the product (reset target). */
export function defaultSupportAutoAckBody(): string {
  return SUPPORT_AUTO_ACK_DEFAULT_BODY
}

/**
 * Effective initial-contact auto-reply body (custom override or built-in default).
 * Placeholders: {{name}}, {{publicId}}, {{subject}}, {{site}}
 */
export function getSupportAutoAckBody(): {
  body: string
  isCustom: boolean
  updatedAt: number | null
} {
  const stored = getKv(KEY_SUPPORT_AUTO_ACK_BODY)
  if (stored != null && stored.trim().length > 0) {
    const row = db
      .prepare(`SELECT updated_at AS updatedAt FROM admin_kv WHERE key = ?`)
      .get(KEY_SUPPORT_AUTO_ACK_BODY) as { updatedAt: number } | undefined
    return {
      body: stored,
      isCustom: true,
      updatedAt: row?.updatedAt ?? null,
    }
  }
  return {
    body: defaultSupportAutoAckBody(),
    isCustom: false,
    updatedAt: null,
  }
}

export function setSupportAutoAckBody(body: string): {
  body: string
  isCustom: boolean
  updatedAt: number | null
} {
  const trimmed = body.trim()
  if (trimmed.length < 8) {
    throw new Error('Message is too short.')
  }
  if (trimmed.length > SUPPORT_AUTO_ACK_MAX_LENGTH) {
    throw new Error(`Message must be at most ${SUPPORT_AUTO_ACK_MAX_LENGTH} characters.`)
  }
  // Empty-after-normalize should not happen; store exact trimmed body.
  setKv(KEY_SUPPORT_AUTO_ACK_BODY, trimmed)
  return getSupportAutoAckBody()
}

/** Clear override and use the built-in default again. */
export function resetSupportAutoAckBody(): {
  body: string
  isCustom: boolean
  updatedAt: number | null
} {
  deleteKv(KEY_SUPPORT_AUTO_ACK_BODY)
  return getSupportAutoAckBody()
}
