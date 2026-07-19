import type { LlmStreamError } from './events.js'

export interface RetryOptions {
  /** Number of retries after the initial request (default 2). The first request is not counted. */
  retries?: number
  baseDelayMs?: number
}

const RETRY_AFTER_CLAMP_MS = 10_000

export function isRetryable(error: LlmStreamError): boolean {
  if (error.kind === 'network') return true
  if (error.kind === 'http') return error.status >= 500 || error.status === 429
  return false
}

export function retryDelayMs(
  attempt: number,
  error: LlmStreamError,
  opts: Required<RetryOptions>,
  random: () => number = Math.random,
): number | null {
  if (error.kind === 'http' && error.retryAfterMs !== undefined) {
    if (error.retryAfterMs > RETRY_AFTER_CLAMP_MS) return null
    return error.retryAfterMs
  }
  const exp = opts.baseDelayMs * 2 ** attempt
  return Math.floor(exp * (0.5 + random() * 0.5))
}

export function parseRetryAfter(value: string, now: number = Date.now()): number | null {
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - now)
}
