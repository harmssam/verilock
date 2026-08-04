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

// ── OpenCode Go API ───────────────────────────────────────────────────────

const KEY_OPENCODE_API_KEY = 'opencode_api_key'

export type OpenCodeKeySource = 'database' | 'environment'

export interface OpenCodeConfigStatus {
  /** True when an effective API key is available (DB or env). */
  configured: boolean
  /** Where the effective key comes from. */
  source: OpenCodeKeySource | null
  /** Masked preview of the effective key; never the full secret. */
  maskedToken: string | null
  /** When the DB-stored key was last updated (ms). Null if not from database. */
  updatedAt: number | null
  /** True when a DB override exists (even if env is also set). */
  hasDatabaseOverride: boolean
  /** True when OPENCODE_API_KEY is set in the process environment. */
  hasEnvironmentKey: boolean
  /** Model hints from env (display only). */
  model: string | null
  modelFallback: string | null
}

function maskSecret(value: string): string {
  const v = value.trim()
  if (v.length === 0) return ''
  if (v.length <= 8) return '••••••••'
  return `${v.slice(0, 3)}…${v.slice(-4)}`
}

function envOpenCodeApiKey(): string | null {
  const raw = process.env.OPENCODE_API_KEY?.trim()
  return raw && raw.length > 0 ? raw : null
}

/**
 * Effective OpenCode Go / Zen API key for server-side use.
 * Prefer admin-saved (SQLite) override; fall back to OPENCODE_API_KEY env.
 */
export function getOpenCodeApiKey(): string | null {
  const stored = getKv(KEY_OPENCODE_API_KEY)
  if (stored != null && stored.trim().length > 0) return stored.trim()
  return envOpenCodeApiKey()
}

/** Status for the admin config UI — never returns the raw token. */
export function getOpenCodeConfigStatus(): OpenCodeConfigStatus {
  const stored = getKv(KEY_OPENCODE_API_KEY)
  const hasDatabaseOverride = stored != null && stored.trim().length > 0
  const envKey = envOpenCodeApiKey()
  const hasEnvironmentKey = envKey != null

  let source: OpenCodeKeySource | null = null
  let effective: string | null = null
  let updatedAt: number | null = null

  if (hasDatabaseOverride) {
    source = 'database'
    effective = stored!.trim()
    const row = db
      .prepare(`SELECT updated_at AS updatedAt FROM admin_kv WHERE key = ?`)
      .get(KEY_OPENCODE_API_KEY) as { updatedAt: number } | undefined
    updatedAt = row?.updatedAt ?? null
  } else if (envKey) {
    source = 'environment'
    effective = envKey
  }

  const model = process.env.OPENCODE_MODEL?.trim() || null
  const modelFallback = process.env.OPENCODE_MODEL_FALLBACK?.trim() || null

  return {
    configured: effective != null,
    source,
    maskedToken: effective ? maskSecret(effective) : null,
    updatedAt,
    hasDatabaseOverride,
    hasEnvironmentKey,
    model,
    modelFallback,
  }
}

export function setOpenCodeApiKey(apiKey: string): OpenCodeConfigStatus {
  const trimmed = apiKey.trim()
  if (trimmed.length < 8) {
    throw new Error('API key is too short.')
  }
  if (trimmed.length > 512) {
    throw new Error('API key must be at most 512 characters.')
  }
  setKv(KEY_OPENCODE_API_KEY, trimmed)
  return getOpenCodeConfigStatus()
}

/** Remove the admin-saved key so the env var (if any) is used again. */
export function clearOpenCodeApiKey(): OpenCodeConfigStatus {
  deleteKv(KEY_OPENCODE_API_KEY)
  return getOpenCodeConfigStatus()
}

// ── Grok Imagine proxy ────────────────────────────────────────────────────

const KEY_IMAGINE_PROXY_URL = 'imagine_proxy_url'
const KEY_IMAGINE_PROXY_TOKEN = 'imagine_proxy_token'

export interface ImagineProxyConfigStatus {
  configured: boolean
  source: OpenCodeKeySource | null
  proxyUrl: string | null
  maskedToken: string | null
  tokenConfigured: boolean
  updatedAt: number | null
  hasDatabaseOverride: boolean
  hasEnvironmentUrl: boolean
  hasEnvironmentToken: boolean
}

function envImagineProxyUrl(): string | null {
  const raw = (
    process.env.IMAGINE_PROXY_URL ||
    process.env.GROK_IMAGINE_PROXY_URL ||
    ''
  ).trim()
  return raw ? raw.replace(/\/+$/, '') : null
}

function envImagineProxyToken(): string | null {
  const raw =
    process.env.IMAGINE_PROXY_TOKEN?.trim() ||
    process.env.GROK_IMAGINE_PROXY_TOKEN?.trim() ||
    ''
  return raw || null
}

function normalizeProxyUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

export function getImagineProxyConfigStatus(): ImagineProxyConfigStatus {
  const storedUrl = getKv(KEY_IMAGINE_PROXY_URL)
  const storedToken = getKv(KEY_IMAGINE_PROXY_TOKEN)
  const fileUrl = storedUrl?.trim() ? normalizeProxyUrl(storedUrl) : null
  const fileToken = storedToken?.trim() || null
  const hasDatabaseOverride = Boolean(fileUrl || fileToken)

  const envUrl = envImagineProxyUrl()
  const envToken = envImagineProxyToken()

  let source: OpenCodeKeySource | null = null
  let proxyUrl: string | null = null
  let token: string | null = null
  let updatedAt: number | null = null

  if (hasDatabaseOverride) {
    source = 'database'
    proxyUrl = fileUrl || envUrl
    token = fileToken || envToken
    const row = db
      .prepare(
        `SELECT MAX(updated_at) AS updatedAt FROM admin_kv WHERE key IN (?, ?)`,
      )
      .get(KEY_IMAGINE_PROXY_URL, KEY_IMAGINE_PROXY_TOKEN) as
      | { updatedAt: number | null }
      | undefined
    updatedAt = row?.updatedAt ?? null
  } else if (envUrl) {
    source = 'environment'
    proxyUrl = envUrl
    token = envToken
  }

  return {
    configured: Boolean(proxyUrl),
    source,
    proxyUrl,
    maskedToken: token ? maskSecret(token) : null,
    tokenConfigured: Boolean(token),
    updatedAt,
    hasDatabaseOverride,
    hasEnvironmentUrl: envUrl != null,
    hasEnvironmentToken: envToken != null,
  }
}

export function setImagineProxyConfig(input: {
  proxyUrl?: string
  proxyToken?: string
}): ImagineProxyConfigStatus {
  const currentUrl = getKv(KEY_IMAGINE_PROXY_URL)?.trim() || ''
  const currentToken = getKv(KEY_IMAGINE_PROXY_TOKEN)?.trim() || ''

  let nextUrl =
    input.proxyUrl !== undefined ? normalizeProxyUrl(input.proxyUrl) : currentUrl
  let nextToken =
    input.proxyToken !== undefined ? input.proxyToken.trim() : currentToken

  if (nextUrl) {
    try {
      const u = new URL(nextUrl)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error('Proxy URL must be http or https.')
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('http')) throw err
      throw new Error('Invalid proxy URL.')
    }
  }

  if (nextToken.length > 512) {
    throw new Error('Proxy token must be at most 512 characters.')
  }

  if (!nextUrl && !nextToken) {
    return clearImagineProxyConfig()
  }
  if (!nextUrl) {
    throw new Error('proxyUrl is required when saving Imagine proxy settings.')
  }

  setKv(KEY_IMAGINE_PROXY_URL, nextUrl)
  if (input.proxyToken !== undefined) {
    if (nextToken) setKv(KEY_IMAGINE_PROXY_TOKEN, nextToken)
    else deleteKv(KEY_IMAGINE_PROXY_TOKEN)
  }
  return getImagineProxyConfigStatus()
}

export function clearImagineProxyConfig(): ImagineProxyConfigStatus {
  deleteKv(KEY_IMAGINE_PROXY_URL)
  deleteKv(KEY_IMAGINE_PROXY_TOKEN)
  return getImagineProxyConfigStatus()
}

/** Effective values for server-side use / studio sync. */
export function getImagineProxyEffective(): {
  proxyUrl: string | null
  proxyToken: string | null
} {
  const status = getImagineProxyConfigStatus()
  const storedUrl = getKv(KEY_IMAGINE_PROXY_URL)?.trim()
  const storedToken = getKv(KEY_IMAGINE_PROXY_TOKEN)?.trim()
  return {
    proxyUrl: storedUrl ? normalizeProxyUrl(storedUrl) : status.proxyUrl,
    proxyToken: storedToken || envImagineProxyToken(),
  }
}
