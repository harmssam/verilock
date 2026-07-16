/**
 * Local X Post Studio scheduler — fires due jobs via publishItemToX.
 * In-process timer only (dev machine must stay up). Not for production.
 */
import { randomUUID } from 'node:crypto'
import {
  findItemById,
  publishItemToX,
  readState,
  writeStateFile,
  type XPostStateFile,
} from './xPostStudio.js'
import { xApiConfigured } from './xPostTwitter.js'

export type ScheduleJobStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface XPostScheduleJob {
  id: string
  itemId: string
  /** ISO-8601 UTC when the job should fire. */
  scheduledAt: string
  status: ScheduleJobStatus
  withImage: boolean
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  error?: string
  /** Root tweet URL after successful API publish. */
  postedTweetUrl?: string
  lastApiTweetUrl?: string
  manualTweets?: string[]
  username?: string
}

const TICK_MS = Math.max(
  5_000,
  Number(process.env.X_POST_SCHEDULE_TICK_MS ?? 15_000) || 15_000,
)

let timer: ReturnType<typeof setInterval> | null = null
let tickInFlight = false
let publishMutex = false

function jobsFromState(state: XPostStateFile): XPostScheduleJob[] {
  return Array.isArray(state.schedule) ? state.schedule : []
}

function saveJobs(jobs: XPostScheduleJob[]): void {
  const state = readState()
  state.schedule = jobs
  writeStateFile(state)
}

export function listScheduleJobs(opts?: {
  includeTerminal?: boolean
}): XPostScheduleJob[] {
  const all = jobsFromState(readState())
  const sorted = [...all].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  )
  if (opts?.includeTerminal) return sorted
  return sorted.filter(j => j.status === 'pending' || j.status === 'running')
}

export function getScheduleJob(id: string): XPostScheduleJob | null {
  return jobsFromState(readState()).find(j => j.id === id) ?? null
}

export function scheduleStatusSummary(): {
  pending: number
  running: number
  nextAt: string | null
  nextItemId: string | null
  tickMs: number
  workerRunning: boolean
  xApiConfigured: boolean
} {
  const active = listScheduleJobs()
  const pending = active.filter(j => j.status === 'pending')
  const running = active.filter(j => j.status === 'running')
  const next = pending[0] ?? null
  return {
    pending: pending.length,
    running: running.length,
    nextAt: next?.scheduledAt ?? null,
    nextItemId: next?.itemId ?? null,
    tickMs: TICK_MS,
    workerRunning: timer != null,
    xApiConfigured: xApiConfigured(),
  }
}

export function createScheduleJob(input: {
  itemId: string
  scheduledAt: string
  withImage?: boolean
}): XPostScheduleJob {
  const itemId = String(input.itemId || '').trim()
  if (!itemId) throw new Error('itemId required')
  if (!findItemById(itemId)) throw new Error(`Unknown item id: ${itemId}`)
  if (findItemById(itemId)?.kind === 'note') {
    throw new Error('Cannot schedule schedule-notes')
  }

  const at = new Date(input.scheduledAt)
  if (Number.isNaN(at.getTime())) throw new Error('Invalid scheduledAt (use ISO-8601)')
  // Allow small clock skew; reject more than 30s in the past
  if (at.getTime() < Date.now() - 30_000) {
    throw new Error('scheduledAt is in the past')
  }

  const jobs = jobsFromState(readState())
  const clash = jobs.find(
    j =>
      j.itemId === itemId &&
      (j.status === 'pending' || j.status === 'running'),
  )
  if (clash) {
    throw new Error(
      `Item already has a ${clash.status} job at ${clash.scheduledAt} (cancel it first)`,
    )
  }

  const now = new Date().toISOString()
  const job: XPostScheduleJob = {
    id: `sched-${randomUUID().slice(0, 10)}`,
    itemId,
    scheduledAt: at.toISOString(),
    status: 'pending',
    withImage: input.withImage !== false,
    createdAt: now,
    updatedAt: now,
  }
  jobs.push(job)
  saveJobs(jobs)
  console.log(
    `[x-studio schedule] queued ${job.id} item=${job.itemId} at ${job.scheduledAt}`,
  )
  return job
}

export function cancelScheduleJob(id: string): XPostScheduleJob {
  const jobs = jobsFromState(readState())
  const idx = jobs.findIndex(j => j.id === id)
  if (idx < 0) throw new Error('Unknown schedule job')
  const job = jobs[idx]!
  if (job.status === 'running') {
    throw new Error('Cannot cancel a job that is currently publishing')
  }
  if (job.status === 'done' || job.status === 'cancelled') {
    throw new Error(`Job already ${job.status}`)
  }
  const next: XPostScheduleJob = {
    ...job,
    status: 'cancelled',
    updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  }
  jobs[idx] = next
  saveJobs(jobs)
  return next
}

export function rescheduleJob(id: string, scheduledAt: string): XPostScheduleJob {
  const at = new Date(scheduledAt)
  if (Number.isNaN(at.getTime())) throw new Error('Invalid scheduledAt')
  if (at.getTime() < Date.now() - 30_000) {
    throw new Error('scheduledAt is in the past')
  }
  const jobs = jobsFromState(readState())
  const idx = jobs.findIndex(j => j.id === id)
  if (idx < 0) throw new Error('Unknown schedule job')
  const job = jobs[idx]!
  if (job.status !== 'pending') {
    throw new Error(`Only pending jobs can be rescheduled (status=${job.status})`)
  }
  const next: XPostScheduleJob = {
    ...job,
    scheduledAt: at.toISOString(),
    updatedAt: new Date().toISOString(),
    error: undefined,
  }
  jobs[idx] = next
  saveJobs(jobs)
  return next
}

async function runJob(job: XPostScheduleJob): Promise<void> {
  const jobs = jobsFromState(readState())
  const idx = jobs.findIndex(j => j.id === job.id)
  if (idx < 0) return
  if (jobs[idx]!.status !== 'pending') return

  if (!xApiConfigured()) {
    jobs[idx] = {
      ...jobs[idx]!,
      status: 'failed',
      error: 'X API not configured',
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }
    saveJobs(jobs)
    return
  }

  jobs[idx] = {
    ...jobs[idx]!,
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: undefined,
  }
  saveJobs(jobs)

  try {
    const result = await publishItemToX({
      id: job.itemId,
      withImage: job.withImage,
    })
    const done: XPostScheduleJob = {
      ...jobsFromState(readState()).find(j => j.id === job.id)!,
      status: 'done',
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      postedTweetUrl: result.tweets[0]?.url,
      lastApiTweetUrl: result.replyToUrl ?? result.tweets[result.tweets.length - 1]?.url,
      manualTweets: result.manualTweets,
      username: result.username,
    }
    const all = jobsFromState(readState())
    const i = all.findIndex(j => j.id === job.id)
    if (i >= 0) {
      all[i] = done
      saveJobs(all)
    }
    console.log(
      `[x-studio schedule] done ${job.id} → ${done.postedTweetUrl || 'ok'}` +
        (done.manualTweets?.length
          ? ` (+${done.manualTweets.length} manual CTA)`
          : ''),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const all = jobsFromState(readState())
    const i = all.findIndex(j => j.id === job.id)
    if (i >= 0) {
      all[i] = {
        ...all[i]!,
        status: 'failed',
        error: message.slice(0, 500),
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      saveJobs(all)
    }
    console.error(`[x-studio schedule] failed ${job.id}:`, message)
  }
}

export async function tickSchedule(): Promise<void> {
  if (tickInFlight || publishMutex) return
  tickInFlight = true
  try {
    const now = Date.now()
    const due = listScheduleJobs()
      .filter(j => j.status === 'pending' && new Date(j.scheduledAt).getTime() <= now)
      .sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      )
    if (!due.length) return

    // One at a time to avoid X rate / double-spend of credits
    publishMutex = true
    try {
      await runJob(due[0]!)
    } finally {
      publishMutex = false
    }
  } finally {
    tickInFlight = false
  }
}

export function startXPostScheduler(): void {
  if (timer) return
  // Recover stuck "running" jobs after crash
  const jobs = jobsFromState(readState())
  let dirty = false
  for (let i = 0; i < jobs.length; i++) {
    if (jobs[i]!.status === 'running') {
      jobs[i] = {
        ...jobs[i]!,
        status: 'failed',
        error: 'Server restarted while job was running — reschedule to retry',
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      dirty = true
    }
  }
  if (dirty) saveJobs(jobs)

  timer = setInterval(() => {
    void tickSchedule()
  }, TICK_MS)
  // unref so a quiet schedule doesn't keep the process alive alone on some hosts
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    timer.unref()
  }
  console.log(
    `  x-post schedule worker: every ${Math.round(TICK_MS / 1000)}s (local only)`,
  )
  void tickSchedule()
}

export function stopXPostScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
