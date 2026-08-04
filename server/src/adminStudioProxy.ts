/**
 * Reverse-proxy content-studio into the VeriLock admin surface.
 *
 * Browser stays on verilock.online (admin cookie). This service reaches
 * content-studio over Railway private networking and injects BLOG_STUDIO_TOKEN.
 *
 * Env:
 *   CONTENT_STUDIO_URL   e.g. http://content-studio.railway.internal:3002
 *   CONTENT_STUDIO_TOKEN same secret as content-studio BLOG_STUDIO_TOKEN
 */
import type { Express, NextFunction, Request, Response } from 'express'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'

export function contentStudioConfigured(): boolean {
  return Boolean(process.env.CONTENT_STUDIO_URL?.trim())
}

export function contentStudioPublicFeatures() {
  return {
    studioProxyEnabled: contentStudioConfigured(),
  }
}

/** Server-to-server call into content-studio (injects studio token). */
export async function contentStudioFetch(
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const base = studioBaseUrl()
  if (!base) {
    return { ok: false, status: 0, json: null, text: 'CONTENT_STUDIO_URL unset' }
  }
  const token = studioToken()
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const method = init?.method ?? 'GET'
  const controller = new AbortController()
  const timeoutMs = init?.timeoutMs ?? 15_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    if (token) {
      headers['x-blog-studio-token'] = token
      headers['x-studio-token'] = token
    }
    let body: string | undefined
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.body)
    }
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { ok: res.ok, status: res.status, json, text }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, json: null, text: message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Push OpenCode API key to content-studio (blog LLM). Returns null if studio
 * is not configured; otherwise status payload or error detail.
 */
export async function syncOpenCodeKeyToStudio(
  action: { apiKey: string } | { clear: true },
): Promise<{ synced: boolean; detail?: string; studio?: Record<string, unknown> }> {
  if (!contentStudioConfigured()) {
    return { synced: false, detail: 'Content studio not configured (CONTENT_STUDIO_URL unset)' }
  }
  const body = 'clear' in action && action.clear ? { clear: true } : action
  const result = await contentStudioFetch('/api/blog-studio/config/opencode', {
    method: 'PUT',
    body,
  })
  if (!result.ok) {
    return {
      synced: false,
      detail: `Studio HTTP ${result.status}: ${result.text.slice(0, 200)}`,
    }
  }
  return {
    synced: true,
    studio: (result.json && typeof result.json === 'object'
      ? (result.json as Record<string, unknown>)
      : undefined),
  }
}

export async function fetchOpenCodeStatusFromStudio(): Promise<{
  ok: boolean
  status?: Record<string, unknown>
  detail?: string
}> {
  if (!contentStudioConfigured()) {
    return { ok: false, detail: 'Content studio not configured' }
  }
  const result = await contentStudioFetch('/api/blog-studio/config/opencode')
  if (!result.ok) {
    return { ok: false, detail: `Studio HTTP ${result.status}: ${result.text.slice(0, 200)}` }
  }
  if (result.json && typeof result.json === 'object') {
    return { ok: true, status: result.json as Record<string, unknown> }
  }
  return { ok: false, detail: 'Invalid studio response' }
}

export async function syncImagineProxyToStudio(
  action:
    | { proxyUrl?: string; proxyToken?: string }
    | { clear: true },
): Promise<{ synced: boolean; detail?: string; studio?: Record<string, unknown> }> {
  if (!contentStudioConfigured()) {
    return { synced: false, detail: 'Content studio not configured (CONTENT_STUDIO_URL unset)' }
  }
  const body = 'clear' in action && action.clear ? { clear: true } : action
  const result = await contentStudioFetch('/api/blog-studio/config/imagine-proxy', {
    method: 'PUT',
    body,
  })
  if (!result.ok) {
    return {
      synced: false,
      detail: `Studio HTTP ${result.status}: ${result.text.slice(0, 200)}`,
    }
  }
  return {
    synced: true,
    studio:
      result.json && typeof result.json === 'object'
        ? (result.json as Record<string, unknown>)
        : undefined,
  }
}

export async function fetchImagineProxyStatusFromStudio(): Promise<{
  ok: boolean
  status?: Record<string, unknown>
  detail?: string
}> {
  if (!contentStudioConfigured()) {
    return { ok: false, detail: 'Content studio not configured' }
  }
  const result = await contentStudioFetch('/api/blog-studio/config/imagine-proxy')
  if (!result.ok) {
    return { ok: false, detail: `Studio HTTP ${result.status}: ${result.text.slice(0, 200)}` }
  }
  if (result.json && typeof result.json === 'object') {
    return { ok: true, status: result.json as Record<string, unknown> }
  }
  return { ok: false, detail: 'Invalid studio response' }
}

function studioBaseUrl(): string | null {
  const raw = process.env.CONTENT_STUDIO_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

function studioToken(): string {
  return (
    process.env.CONTENT_STUDIO_TOKEN?.trim() ||
    process.env.BLOG_STUDIO_TOKEN?.trim() ||
    ''
  )
}

/** Paths we forward to content-studio (exact prefix match). */
const PROXY_PREFIXES = [
  '/blog-studio',
  '/x-studio',
  '/x-post-studio',
  '/api/blog-studio',
  '/api/x-studio',
  '/api/studio',
  // Studio image previews (store media + monorepo public blog assets)
  '/media',
  '/blog',
]

function matchesStudioPath(path: string): boolean {
  return PROXY_PREFIXES.some(
    p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'),
  )
}

function hopByHopHeaders(): Set<string> {
  return new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'host',
    'content-length',
  ])
}

/**
 * Attach reverse proxy. `requireAdmin` must send 401 JSON for API and redirect
 * HTML navigations to /admin when unauthenticated.
 */
export function attachAdminStudioProxy(
  app: Express,
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void,
): void {
  const base = studioBaseUrl()
  if (!base) {
    console.log('  admin studio proxy: off (CONTENT_STUDIO_URL unset)')
    return
  }

  const token = studioToken()
  if (!token) {
    console.warn(
      '  admin studio proxy: CONTENT_STUDIO_URL set but CONTENT_STUDIO_TOKEN empty — studio will 403',
    )
  }

  const handler = (req: Request, res: Response): void => {
    void proxyRequest(req, res, base, token)
  }

  // Mount once with a filter so we do not catch unrelated routes.
  app.use((req, res, next) => {
    if (!matchesStudioPath(req.path)) {
      next()
      return
    }
    requireAdmin(req, res, (err?: unknown) => {
      if (err) {
        next(err)
        return
      }
      handler(req, res)
    })
  })

  console.log(`  admin studio proxy: ${base} (admin-only)`)
}

async function proxyRequest(
  req: Request,
  res: Response,
  base: string,
  token: string,
): Promise<void> {
  let target: URL
  try {
    const pathAndQuery = req.originalUrl || req.url
    target = new URL(pathAndQuery, base.endsWith('/') ? base : base + '/')
  } catch {
    res.status(500).json({ error: 'Invalid CONTENT_STUDIO_URL' })
    return
  }

  const isHttps = target.protocol === 'https:'
  const lib = isHttps ? httpsRequest : httpRequest
  const skip = hopByHopHeaders()

  const headers: Record<string, string | string[] | undefined> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (skip.has(key.toLowerCase())) continue
    // Drop browser cookies — studio auth is the injected token only.
    if (key.toLowerCase() === 'cookie') continue
    headers[key] = value
  }
  if (token) {
    headers['x-blog-studio-token'] = token
    headers['x-studio-token'] = token
  }
  headers['host'] = target.host
  // Prefer identity encoding so we can stream without decompress issues.
  headers['accept-encoding'] = 'identity'

  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: target.pathname + target.search,
    method: req.method,
    headers,
    timeout: 10 * 60_000,
  }

  const upstream = lib(options, upstreamRes => {
    res.status(upstreamRes.statusCode || 502)
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (!value) continue
      if (skip.has(key.toLowerCase())) continue
      // Allow embedding from our admin SPA on the same origin (iframe).
      if (key.toLowerCase() === 'x-frame-options') continue
      if (key.toLowerCase() === 'content-security-policy') continue
      res.setHeader(key, value)
    }
    upstreamRes.pipe(res)
  })

  upstream.on('timeout', () => {
    upstream.destroy()
    if (!res.headersSent) res.status(504).json({ error: 'Content studio timed out' })
  })

  upstream.on('error', err => {
    console.error('[admin-studio-proxy]', err.message)
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Content studio unreachable',
        detail: err.message,
      })
    }
  })

  // Binary studio uploads (images) must stream raw bytes — never JSON.stringify.
  const contentType = String(req.headers['content-type'] || '').toLowerCase()
  const isBinaryUpload =
    contentType.startsWith('image/') ||
    contentType.includes('application/octet-stream') ||
    contentType.includes('multipart/')

  const reqBody = (req as Request & { body?: unknown }).body

  // Prefer streaming when the body has not been fully buffered as a JS value.
  if (
    isBinaryUpload ||
    (req.readable && !req.readableEnded && (reqBody === undefined || reqBody === null))
  ) {
    if (!req.readableEnded && req.readable) {
      req.pipe(upstream)
      return
    }
  }

  if (reqBody == null || reqBody === undefined) {
    upstream.end()
    return
  }

  if (Buffer.isBuffer(reqBody)) {
    upstream.end(reqBody)
    return
  }
  // Node sometimes exposes Buffer-like { type: 'Buffer', data: number[] }
  if (
    typeof reqBody === 'object' &&
    reqBody !== null &&
    (reqBody as { type?: string }).type === 'Buffer' &&
    Array.isArray((reqBody as { data?: unknown }).data)
  ) {
    upstream.end(Buffer.from((reqBody as { data: number[] }).data))
    return
  }
  if (typeof reqBody === 'string') {
    upstream.end(reqBody)
    return
  }
  if (isBinaryUpload) {
    // Do not corrupt image bytes as JSON
    console.error(
      '[admin-studio-proxy] binary upload body was not a Buffer; refusing JSON re-encode',
      contentType,
    )
    if (!res.headersSent) {
      res.status(400).json({
        error: 'Binary upload body was consumed incorrectly by the proxy',
      })
    }
    upstream.destroy()
    return
  }
  // JSON parsed by express.json middleware
  const json = JSON.stringify(reqBody)
  if (!headers['content-type']) {
    upstream.setHeader('content-type', 'application/json')
  }
  upstream.end(json)
}
