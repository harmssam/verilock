/**
 * X (Twitter) API v2 helpers for local X Post Studio.
 * OAuth 1.0a user context — never enable publish in production without an explicit opt-in.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

export interface XApiCredentials {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessTokenSecret: string
}

export function readXApiCredentials(): XApiCredentials | null {
  const apiKey = process.env.X_API_KEY?.trim() || process.env.TWITTER_API_KEY?.trim()
  const apiSecret =
    process.env.X_API_SECRET?.trim() ||
    process.env.X_API_KEY_SECRET?.trim() ||
    process.env.TWITTER_API_SECRET?.trim()
  const accessToken =
    process.env.X_ACCESS_TOKEN?.trim() || process.env.TWITTER_ACCESS_TOKEN?.trim()
  const accessTokenSecret =
    process.env.X_ACCESS_TOKEN_SECRET?.trim() ||
    process.env.TWITTER_ACCESS_TOKEN_SECRET?.trim()
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null
  return { apiKey, apiSecret, accessToken, accessTokenSecret }
}

export function xApiConfigured(): boolean {
  return readXApiCredentials() != null
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function oauthHeader(
  method: string,
  url: string,
  extraParams: Record<string, string>,
  creds: XApiCredentials,
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  }
  const all: Record<string, string> = { ...extraParams, ...oauth }
  const paramString = Object.keys(all)
    .sort()
    .map(k => `${percentEncode(k)}=${percentEncode(all[k]!)}`)
    .join('&')
  const base = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join('&')
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`
  const signature = createHmac('sha1', signingKey).update(base).digest('base64')
  oauth.oauth_signature = signature
  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map(k => `${percentEncode(k)}="${percentEncode(oauth[k]!)}"`)
      .join(', ')
  )
}

async function xFetchJson<T>(
  method: string,
  url: string,
  creds: XApiCredentials,
  body?: unknown,
  formParams?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: oauthHeader(method, url, formParams ?? {}, creds),
  }
  let bodyInit: string | undefined
  if (formParams) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    bodyInit = Object.entries(formParams)
      .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
      .join('&')
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    bodyInit = JSON.stringify(body)
  }
  const res = await fetch(url, { method, headers, body: bodyInit })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const errObj = data as {
      detail?: string
      title?: string
      errors?: Array<{ message?: string; detail?: string }>
      error?: string
    } | null
    const msg =
      errObj?.detail ||
      errObj?.title ||
      errObj?.errors?.[0]?.message ||
      errObj?.errors?.[0]?.detail ||
      errObj?.error ||
      text.slice(0, 400) ||
      `HTTP ${res.status}`
    throw new Error(`X API ${res.status}: ${msg}`)
  }
  return data as T
}

export interface XVerifyResult {
  ok: true
  id: string
  username: string
  name: string
}

/** Confirms credentials can act as a user (no tweet created). */
export async function verifyXCredentials(
  creds = readXApiCredentials(),
): Promise<XVerifyResult> {
  if (!creds) throw new Error('X API credentials not configured (need X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET)')
  const data = await xFetchJson<{
    data?: { id: string; username: string; name: string }
  }>('GET', 'https://api.x.com/2/users/me', creds)
  const u = data.data
  if (!u?.id || !u.username) throw new Error('X API verify returned no user')
  return { ok: true, id: u.id, username: u.username, name: u.name }
}

export interface PostedTweet {
  id: string
  text: string
  url: string
}

function tweetUrl(username: string, id: string): string {
  return `https://x.com/${username}/status/${id}`
}

/**
 * Upload media via v1.1 simple upload (images under ~5MB).
 * Returns media_id_string for attaching to a tweet.
 */
export async function uploadXMedia(
  absolutePath: string,
  creds = readXApiCredentials(),
): Promise<string> {
  if (!creds) throw new Error('X API credentials not configured')
  if (!existsSync(absolutePath)) throw new Error('Media file not found: ' + absolutePath)
  const buf = readFileSync(absolutePath)
  if (buf.length > 5 * 1024 * 1024) {
    throw new Error('Image too large for simple upload (max 5MB)')
  }
  const mediaData = buf.toString('base64')
  const url = 'https://upload.twitter.com/1.1/media/upload.json'
  const data = await xFetchJson<{ media_id_string?: string; media_id?: number }>(
    'POST',
    url,
    creds,
    undefined,
    { media_data: mediaData },
  )
  const id = data.media_id_string || (data.media_id != null ? String(data.media_id) : '')
  if (!id) throw new Error('Media upload returned no media_id')
  return id
}

export async function postXTweet(input: {
  text: string
  replyToId?: string
  mediaIds?: string[]
  creds?: XApiCredentials | null
  usernameForUrl?: string
}): Promise<PostedTweet> {
  const creds = input.creds ?? readXApiCredentials()
  if (!creds) throw new Error('X API credentials not configured')
  const text = input.text.trim()
  if (!text) throw new Error('Tweet text is empty')
  if ([...text].length > 280) {
    throw new Error(`Tweet is ${[...text].length} characters (max 280)`)
  }
  const body: {
    text: string
    reply?: { in_reply_to_tweet_id: string }
    media?: { media_ids: string[] }
  } = { text }
  if (input.replyToId) {
    body.reply = { in_reply_to_tweet_id: input.replyToId }
  }
  if (input.mediaIds?.length) {
    body.media = { media_ids: input.mediaIds }
  }
  const data = await xFetchJson<{ data?: { id: string; text: string } }>(
    'POST',
    'https://api.x.com/2/tweets',
    creds,
    body,
  )
  const id = data.data?.id
  if (!id) throw new Error('X API did not return tweet id')
  let username = input.usernameForUrl
  if (!username) {
    try {
      username = (await verifyXCredentials(creds)).username
    } catch {
      username = 'i'
    }
  }
  return {
    id,
    text: data.data?.text ?? text,
    url: tweetUrl(username, id),
  }
}

/** Post a single tweet or a reply chain (thread). Optional media only on the first tweet. */
export async function publishXThread(input: {
  tweets: string[]
  mediaAbsolutePath?: string | null
  creds?: XApiCredentials | null
}): Promise<{ tweets: PostedTweet[]; username: string }> {
  const creds = input.creds ?? readXApiCredentials()
  if (!creds) throw new Error('X API credentials not configured')
  const tweets = input.tweets.map(t => t.trim()).filter(Boolean)
  if (!tweets.length) throw new Error('No tweets to publish')
  for (let i = 0; i < tweets.length; i++) {
    const n = [...tweets[i]!].length
    if (n > 280) {
      throw new Error(`Tweet ${i + 1}/${tweets.length} is ${n} characters (max 280)`)
    }
  }

  const me = await verifyXCredentials(creds)
  let mediaIds: string[] | undefined
  if (input.mediaAbsolutePath) {
    mediaIds = [await uploadXMedia(input.mediaAbsolutePath, creds)]
  }

  const posted: PostedTweet[] = []
  let replyTo: string | undefined
  for (let i = 0; i < tweets.length; i++) {
    const t = await postXTweet({
      text: tweets[i]!,
      replyToId: replyTo,
      mediaIds: i === 0 ? mediaIds : undefined,
      creds,
      usernameForUrl: me.username,
    })
    posted.push(t)
    replyTo = t.id
  }
  return { tweets: posted, username: me.username }
}
