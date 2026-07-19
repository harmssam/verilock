import { postSignal, pollSignals, type SignalMessage } from './signalingClient'
import type { SigHandoffRole } from './types'

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

const POLL_MS = 1000

export type PeerSession = {
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  stop: () => void
}

type HostOptions = {
  sessionId: string
  hostToken: string
  onChannel: (channel: RTCDataChannel) => void
  onStatus?: (s: 'connecting' | 'connected' | 'failed') => void
  onError?: (err: Error) => void
}

type GuestOptions = {
  sessionId: string
  onChannel: (channel: RTCDataChannel) => void
  onStatus?: (s: 'connecting' | 'connected' | 'failed') => void
  onError?: (err: Error) => void
}

function isIceCandidateInit(v: unknown): v is RTCIceCandidateInit {
  return Boolean(v && typeof v === 'object' && 'candidate' in (v as object))
}

/**
 * Desktop host: create offer + datachannel, exchange signals until connected.
 */
export function startHostPeer(opts: HostOptions): PeerSession {
  const pc = new RTCPeerConnection(RTC_CONFIG)
  const channel = pc.createDataChannel('sig-ink', { ordered: true })
  let stopped = false
  let lastId = 0
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  const pendingRemoteIce: RTCIceCandidateInit[] = []
  let remoteSet = false

  opts.onChannel(channel)
  opts.onStatus?.('connecting')

  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState
    if (s === 'connected' || s === 'completed') opts.onStatus?.('connected')
    if (s === 'failed' || s === 'disconnected') {
      // Let fallback handle; only mark failed on hard fail
      if (s === 'failed') opts.onStatus?.('failed')
    }
  }

  pc.onicecandidate = ev => {
    if (stopped || !ev.candidate) return
    void postSignal(
      opts.sessionId,
      { from: 'host', type: 'ice', payload: ev.candidate.toJSON() },
      opts.hostToken,
    ).catch(() => {
      /* ignore transient */
    })
  }

  const applyRemoteIce = async () => {
    if (!remoteSet) return
    while (pendingRemoteIce.length) {
      const c = pendingRemoteIce.shift()!
      try {
        await pc.addIceCandidate(c)
      } catch {
        /* ignore stale */
      }
    }
  }

  const handleMessages = async (messages: SignalMessage[]) => {
    for (const m of messages) {
      lastId = Math.max(lastId, m.id)
      if (m.from !== 'guest') continue
      if (m.type === 'answer' && m.payload && typeof m.payload === 'object') {
        const desc = m.payload as RTCSessionDescriptionInit
        if (!pc.currentRemoteDescription) {
          await pc.setRemoteDescription(desc)
          remoteSet = true
          await applyRemoteIce()
        }
      } else if (m.type === 'ice' && isIceCandidateInit(m.payload)) {
        if (remoteSet) {
          try {
            await pc.addIceCandidate(m.payload)
          } catch {
            /* ignore */
          }
        } else {
          pendingRemoteIce.push(m.payload)
        }
      }
    }
  }

  const poll = async () => {
    if (stopped) return
    try {
      const res = await pollSignals(opts.sessionId, lastId)
      if (stopped) return
      if (res.status === 'expired' || res.status === 'completed') {
        opts.onStatus?.('failed')
        return
      }
      await handleMessages(res.messages)
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error('Signal poll failed'))
    }
    if (!stopped) pollTimer = setTimeout(() => void poll(), POLL_MS)
  }

  void (async () => {
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await postSignal(
        opts.sessionId,
        { from: 'host', type: 'offer', payload: pc.localDescription },
        opts.hostToken,
      )
      void poll()
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error('Could not create offer'))
      opts.onStatus?.('failed')
    }
  })()

  return {
    pc,
    channel,
    stop: () => {
      stopped = true
      if (pollTimer) clearTimeout(pollTimer)
      try {
        channel.close()
      } catch {
        /* ignore */
      }
      try {
        pc.close()
      } catch {
        /* ignore */
      }
    },
  }
}

/**
 * Mobile guest: wait for offer, answer, open datachannel from host.
 */
export function startGuestPeer(opts: GuestOptions): PeerSession {
  const pc = new RTCPeerConnection(RTC_CONFIG)
  let channel: RTCDataChannel | null = null
  let stopped = false
  let lastId = 0
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  const pendingRemoteIce: RTCIceCandidateInit[] = []
  let remoteSet = false
  let answered = false

  opts.onStatus?.('connecting')

  pc.ondatachannel = ev => {
    channel = ev.channel
    opts.onChannel(ev.channel)
  }

  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState
    if (s === 'connected' || s === 'completed') opts.onStatus?.('connected')
    if (s === 'failed') opts.onStatus?.('failed')
  }

  pc.onicecandidate = ev => {
    if (stopped || !ev.candidate) return
    void postSignal(opts.sessionId, {
      from: 'guest',
      type: 'ice',
      payload: ev.candidate.toJSON(),
    }).catch(() => {
      /* ignore */
    })
  }

  const applyRemoteIce = async () => {
    if (!remoteSet) return
    while (pendingRemoteIce.length) {
      const c = pendingRemoteIce.shift()!
      try {
        await pc.addIceCandidate(c)
      } catch {
        /* ignore */
      }
    }
  }

  const handleMessages = async (messages: SignalMessage[]) => {
    for (const m of messages) {
      lastId = Math.max(lastId, m.id)
      if (m.from !== 'host') continue
      if (m.type === 'offer' && m.payload && typeof m.payload === 'object' && !answered) {
        answered = true
        await pc.setRemoteDescription(m.payload as RTCSessionDescriptionInit)
        remoteSet = true
        await applyRemoteIce()
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await postSignal(opts.sessionId, {
          from: 'guest',
          type: 'answer',
          payload: pc.localDescription,
        })
      } else if (m.type === 'ice' && isIceCandidateInit(m.payload)) {
        if (remoteSet) {
          try {
            await pc.addIceCandidate(m.payload)
          } catch {
            /* ignore */
          }
        } else {
          pendingRemoteIce.push(m.payload)
        }
      }
    }
  }

  const poll = async () => {
    if (stopped) return
    try {
      const res = await pollSignals(opts.sessionId, lastId)
      if (stopped) return
      if (res.status === 'expired' || res.status === 'completed') {
        opts.onStatus?.('failed')
        return
      }
      await handleMessages(res.messages)
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error('Signal poll failed'))
    }
    if (!stopped) pollTimer = setTimeout(() => void poll(), POLL_MS)
  }

  void poll()

  return {
    pc,
    get channel() {
      return channel
    },
    stop: () => {
      stopped = true
      if (pollTimer) clearTimeout(pollTimer)
      try {
        channel?.close()
      } catch {
        /* ignore */
      }
      try {
        pc.close()
      } catch {
        /* ignore */
      }
    },
  }
}

export function waitForChannelOpen(channel: RTCDataChannel, timeoutMs = 12_000): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup()
      reject(new Error('Data channel timed out'))
    }, timeoutMs)
    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Data channel error'))
    }
    const cleanup = () => {
      clearTimeout(t)
      channel.removeEventListener('open', onOpen)
      channel.removeEventListener('error', onError)
    }
    channel.addEventListener('open', onOpen)
    channel.addEventListener('error', onError)
  })
}

export function sendOnChannel(channel: RTCDataChannel, data: string): void {
  if (channel.readyState !== 'open') throw new Error('Channel not open')
  channel.send(data)
}

export type { SigHandoffRole }
