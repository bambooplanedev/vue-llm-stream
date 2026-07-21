import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useLlmStream } from '../../src/composables/useLlmStream'
import type { ChatMessage, LlmProvider } from '../../src/core/events'
import { mock } from '../../src/core/providers/mock'

afterEach(() => {
  vi.useRealTimers()
})

function inScope<T>(fn: () => T): { result: T; scope: ReturnType<typeof effectScope> } {
  const scope = effectScope()
  const result = scope.run(fn)!
  return { result, scope }
}

const fast = (text = 'hello world') => mock({ text, tokensPerSec: 100_000 })

describe('useLlmStream', () => {
  it('goes idle → submitted → streaming → done and accumulates text', async () => {
    const { result: s } = inScope(() => useLlmStream({ url: 'mock://', provider: fast() }))
    expect(s.status.value).toBe('idle')
    const promise = s.start('hi')
    expect(s.status.value).toBe('submitted')
    const final = await promise
    expect(s.status.value).toBe('done')
    expect(final).toBe('hello world')
    expect(s.text.value).toBe('hello world')
    expect(s.finishReason.value).toBe('stop')
    expect(s.isStreaming.value).toBe(false)
  })

  it('accepts a bare string and a ChatMessage[]', async () => {
    const { result: s } = inScope(() => useLlmStream({ url: 'mock://', provider: fast('ok') }))
    await s.start([{ role: 'user', content: 'question' }])
    expect(s.text.value).toBe('ok')
  })

  it('never rejects: HTTP 401 lands in error with status "error"', async () => {
    const provider = mock({ text: 'x', failure: { kind: 'http', status: 401 } })
    const { result: s } = inScope(() => useLlmStream({ url: 'mock://', provider }))
    const final = await s.start('hi')
    expect(final).toBeUndefined()
    expect(s.status.value).toBe('error')
    expect(s.error.value).toMatchObject({ kind: 'http', status: 401 })
    expect(s.retryCount.value).toBe(0) // 401 is not retryable
  })

  it('auto-retries a pre-token 500 and succeeds (retryCount visible)', async () => {
    vi.useFakeTimers()
    const provider = mock({ text: 'recovered', tokensPerSec: 100_000, failure: { kind: 'http', status: 500 }, failOnce: true })
    const { result: s } = inScope(() =>
      useLlmStream({ url: 'mock://', provider, retry: { retries: 2, baseDelayMs: 100 } }))
    const promise = s.start('hi')
    await vi.waitFor(() => expect(s.retryCount.value).toBe(1))
    expect(s.status.value).toBe('submitted') // backoff lives inside "submitted"
    await vi.runAllTimersAsync()
    expect(await promise).toBe('recovered')
    vi.useRealTimers()
  })

  it('does NOT retry a truncated stream (token already seen) — surfaces incomplete', async () => {
    const provider = mock({ text: 'a b c d', tokensPerSec: 100_000, failure: { kind: 'truncate', afterTokens: 2 } })
    const { result: s } = inScope(() => useLlmStream({ url: 'mock://', provider }))
    await s.start('hi')
    expect(s.status.value).toBe('error')
    expect(s.error.value).toMatchObject({ kind: 'incomplete' })
    expect(s.text.value).toBe('a b ') // partial text preserved
    expect(s.retryCount.value).toBe(0)
  })

  it('abort resolves to done with finishReason aborted, partial text kept', async () => {
    const provider = mock({ text: 'one two three four five', tokensPerSec: 50 })
    const { result: s } = inScope(() => useLlmStream({ url: 'mock://', provider }))
    const promise = s.start('hi')
    await vi.waitFor(() => expect(s.text.value.length).toBeGreaterThan(0))
    s.abort()
    expect(await promise).toBeUndefined()
    expect(s.status.value).toBe('done')
    expect(s.finishReason.value).toBe('aborted')
    expect(s.error.value).toBeNull()
  })

  it('second start() aborts the first — no interleaved text (generation counter)', async () => {
    const provider = mock({ text: 'aaaa aaaa aaaa aaaa', tokensPerSec: 50 })
    const { result: s } = inScope(() => useLlmStream({ url: 'mock://', provider }))
    const first = s.start('one')
    await vi.waitFor(() => expect(s.text.value.length).toBeGreaterThan(0))
    const second = s.start('two')
    await second
    expect(await first).toBeUndefined()
    expect(s.text.value).toBe('aaaa aaaa aaaa aaaa') // only the second run's text
  })

  it('regenerate re-runs the last input and resets text first', async () => {
    const { result: s } = inScope(() => useLlmStream({ url: 'mock://', provider: fast('fresh') }))
    await s.start('hi')
    s.text.value // 'fresh'
    const final = await s.regenerate()
    expect(final).toBe('fresh')
    expect(s.text.value).toBe('fresh')
  })

  it('aborts on scope dispose', async () => {
    const provider = mock({ text: 'slow slow slow', tokensPerSec: 10 })
    const { result: s, scope } = inScope(() => useLlmStream({ url: 'mock://', provider }))
    const promise = s.start('hi')
    scope.stop()
    expect(await promise).toBeUndefined()
    expect(s.finishReason.value).toBe('aborted')
  })

  it('resolves a getter provider at start() time — swap takes effect', async () => {
    let provider = fast('first')
    const { result: s } = inScope(() => useLlmStream({ url: 'mock://', provider: () => provider }))
    await s.start('hi')
    expect(s.text.value).toBe('first')
    provider = fast('second')
    await s.start('hi')
    expect(s.text.value).toBe('second')
  })

  it('a throwing buildRequest surfaces as a provider error, never retried', async () => {
    const provider: LlmProvider = {
      ...fast(),
      buildRequest: () => { throw new Error('bad config') },
    }
    const { result: s } = inScope(() =>
      useLlmStream({ url: 'mock://', provider, retry: { retries: 2, baseDelayMs: 1 } }))
    const final = await s.start('hi')
    expect(final).toBeUndefined()
    expect(s.status.value).toBe('error')
    expect(s.error.value).toMatchObject({ kind: 'provider' })
    expect(s.retryCount.value).toBe(0)
  })

  it('start() copies the input array so later pushes do not leak into regenerate()', async () => {
    const base = fast('reply')
    const seen: ChatMessage[][] = []
    const provider: LlmProvider = {
      ...base,
      buildRequest: (ctx) => { seen.push([...ctx.messages]); return base.buildRequest(ctx) },
    }
    const { result: s } = inScope(() => useLlmStream({ url: 'mock://', provider }))
    const history: ChatMessage[] = [{ role: 'user', content: 'q' }]
    await s.start(history)
    history.push({ role: 'assistant', content: 'reply' })
    await s.regenerate()
    expect(seen[1]).toEqual([{ role: 'user', content: 'q' }])
  })

  it('resolves reactive url at start() time', async () => {
    let url = 'mock://a'
    const seen: string[] = []
    const provider = fast('ok')
    const wrappedFetch: typeof fetch = (input, init) => {
      seen.push(String(input))
      return provider.fetch!(input, init)
    }
    const { result: s } = inScope(() =>
      useLlmStream({ url: () => url, provider: { ...provider, fetch: undefined }, fetch: wrappedFetch }))
    await s.start('hi')
    url = 'mock://b'
    await s.start('hi')
    expect(seen).toEqual(['mock://a', 'mock://b'])
  })
})

describe('useLlmStream — tool calls', () => {
  it('accumulates tool calls into the toolCalls ref and fires onEvent for every event', async () => {
    const seen: string[] = []
    const provider = mock({
      tokensPerSec: 10_000,
      script: [
        { type: 'text', text: 'hi' },
        { type: 'tool-call', id: 'call_1', name: 'calc', args: { a: 2, b: 3 }, chunkArgs: 4 },
      ],
    })
    const chat = useLlmStream({ url: 'mock://', provider, onEvent: (ev) => seen.push(ev.type) })
    await chat.start('go')
    expect(chat.toolCalls.value).toHaveLength(1)
    expect(chat.toolCalls.value[0]).toMatchObject({ id: 'call_1', name: 'calc', state: 'complete', args: { a: 2, b: 3 } })
    expect(seen).toEqual(expect.arrayContaining(['tool-call-start', 'tool-call-delta', 'tool-call-end', 'done']))
  })

  it('leaves toolCalls empty for a text-only stream', async () => {
    const chat = useLlmStream({ url: 'mock://', provider: mock({ text: 'just text', tokensPerSec: 10_000 }) })
    await chat.start('go')
    expect(chat.text.value).toBe('just text')
    expect(chat.toolCalls.value).toEqual([])
  })
})
