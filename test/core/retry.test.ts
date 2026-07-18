import { describe, expect, it } from 'vitest'
import { isRetryable, parseRetryAfter, retryDelayMs } from '../../src/core/retry'
import type { LlmStreamError } from '../../src/core/events'

const OPTS = { attempts: 2, baseDelayMs: 500 }
const http = (status: number, retryAfterMs?: number): LlmStreamError =>
  ({ kind: 'http', status, message: 'x', retryAfterMs })

describe('isRetryable', () => {
  it('retries network, 5xx and 429', () => {
    expect(isRetryable({ kind: 'network', cause: null })).toBe(true)
    expect(isRetryable(http(500))).toBe(true)
    expect(isRetryable(http(503))).toBe(true)
    expect(isRetryable(http(429))).toBe(true)
  })
  it('never retries 4xx (except 429), parse, provider, incomplete', () => {
    expect(isRetryable(http(401))).toBe(false)
    expect(isRetryable(http(400))).toBe(false)
    expect(isRetryable({ kind: 'parse', frame: '', cause: null })).toBe(false)
    expect(isRetryable({ kind: 'provider', message: 'x' })).toBe(false)
    expect(isRetryable({ kind: 'incomplete' })).toBe(false)
  })
})

describe('retryDelayMs', () => {
  it('uses exponential backoff with jitter in [0.5, 1) * base * 2^attempt', () => {
    expect(retryDelayMs(0, http(500), OPTS, () => 0)).toBe(250)
    expect(retryDelayMs(1, http(500), OPTS, () => 0)).toBe(500)
    expect(retryDelayMs(1, http(500), OPTS, () => 0.999)).toBeLessThan(1000)
  })
  it('honors Retry-After when present and under the 10s clamp', () => {
    expect(retryDelayMs(0, http(429, 3000), OPTS)).toBe(3000)
  })
  it('fails fast (null) when Retry-After exceeds 10s', () => {
    expect(retryDelayMs(0, http(429, 120_000), OPTS)).toBeNull()
  })
})

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('5')).toBe(5000)
  })
  it('parses HTTP-date relative to now', () => {
    const now = Date.parse('2026-07-18T12:00:00Z')
    expect(parseRetryAfter('Sat, 18 Jul 2026 12:00:04 GMT', now)).toBe(4000)
  })
  it('returns null for garbage', () => {
    expect(parseRetryAfter('soon')).toBeNull()
  })
})
