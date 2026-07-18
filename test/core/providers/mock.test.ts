import { describe, expect, it } from 'vitest'
import { mock } from '../../../src/core/providers/mock'
import { streamRequest } from '../../../src/core/stream'
import type { StreamEvent } from '../../../src/core/events'

async function run(provider = mock({ text: 'one two three', tokensPerSec: 10_000 })) {
  const events: StreamEvent[] = []
  const gen = streamRequest({
    url: 'mock://', body: {}, headers: {}, signal: new AbortController().signal,
    parser: provider.createEventParser(), fetchImpl: provider.fetch,
  })
  for await (const ev of gen) events.push(ev)
  return events
}

describe('mock provider', () => {
  it('streams the text token by token and finishes with done', async () => {
    const events = await run()
    const text = events.filter((e) => e.type === 'text-delta').map((e) => (e as any).text).join('')
    expect(text).toBe('one two three')
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
  })

  it('failure http produces a non-2xx response', async () => {
    await expect(run(mock({ text: 'x', failure: { kind: 'http', status: 503 } })))
      .rejects.toMatchObject({ kind: 'http', status: 503 })
  })

  it('failure truncate produces an incomplete stream error', async () => {
    await expect(run(mock({ text: 'a b c d', tokensPerSec: 10_000, failure: { kind: 'truncate', afterTokens: 2 } })))
      .rejects.toMatchObject({ kind: 'incomplete' })
  })

  it('failure midStreamError yields an in-stream error event', async () => {
    const provider = mock({ text: 'a b', tokensPerSec: 10_000, failure: { kind: 'midStreamError' } })
    // the error event arrives through the stream, then EOF without done → collect manually
    const events: StreamEvent[] = []
    const gen = streamRequest({
      url: 'mock://', body: {}, headers: {}, signal: new AbortController().signal,
      parser: provider.createEventParser(), fetchImpl: provider.fetch,
    })
    await expect((async () => { for await (const ev of gen) events.push(ev) })()).rejects.toBeDefined()
    expect(events).toContainEqual({ type: 'error', error: { message: 'mock mid-stream failure' } })
  })

  it('failOnce fails the first request and succeeds on the second', async () => {
    const provider = mock({ text: 'ok', tokensPerSec: 10_000, failure: { kind: 'http', status: 500 }, failOnce: true })
    await expect(run(provider)).rejects.toMatchObject({ kind: 'http', status: 500 })
    const events = await run(provider)
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' })
  })

  it('preserves leading whitespace in the text', async () => {
    const events = await run(mock({ text: '\nindented start', tokensPerSec: 10_000 }))
    const text = events.filter((e) => e.type === 'text-delta').map((e) => (e as any).text).join('')
    expect(text).toBe('\nindented start')
  })

  it('honors abort during the inter-token delay without emitting another token', async () => {
    const provider = mock({ text: 'a b c', tokensPerSec: 5 }) // 200ms per token
    const ctl = new AbortController()
    const events: StreamEvent[] = []
    const gen = streamRequest({
      url: 'mock://', body: {}, headers: {}, signal: ctl.signal,
      parser: provider.createEventParser(), fetchImpl: provider.fetch,
    })
    const started = Date.now()
    const consume = (async () => { for await (const ev of gen) events.push(ev) })()
    setTimeout(() => ctl.abort(), 20)
    await expect(consume).rejects.toBeDefined()
    expect(Date.now() - started).toBeLessThan(150)
    expect(events).toEqual([])
  })
})
