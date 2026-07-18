import { describe, expect, it } from 'vitest'
import { streamRequest } from '../../src/core/stream'
import type { SseFrame, StreamEvent } from '../../src/core/events'

function sseResponse(chunks: (string | Uint8Array)[], init?: ResponseInit): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(typeof chunk === 'string' ? enc.encode(chunk) : chunk)
      c.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  })
}

// echo parser: data "END" → done, otherwise → text-delta
const echoParser = (frame: SseFrame): StreamEvent[] =>
  frame.data === 'END' ? [{ type: 'done' }] : [{ type: 'text-delta', text: frame.data }]

async function collect(res: Response, parser = echoParser) {
  const events: StreamEvent[] = []
  const gen = streamRequest({
    url: 'http://x/', body: {}, headers: {}, signal: new AbortController().signal,
    parser, fetchImpl: async () => res,
  })
  for await (const ev of gen) events.push(ev)
  return events
}

describe('streamRequest', () => {
  it('yields parsed events and finishes on done', async () => {
    const events = await collect(sseResponse(['data: a\n\n', 'data: b\n\ndata: END\n\n']))
    expect(events).toEqual([
      { type: 'text-delta', text: 'a' },
      { type: 'text-delta', text: 'b' },
      { type: 'done' },
    ])
  })

  it('throws {kind:"http"} with provider message on non-2xx JSON body', async () => {
    const res = new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 })
    await expect(collect(res)).rejects.toMatchObject({ kind: 'http', status: 401, message: 'invalid api key' })
  })

  it('attaches retryAfterMs on 429', async () => {
    const res = new Response('{}', { status: 429, headers: { 'retry-after': '3' } })
    await expect(collect(res)).rejects.toMatchObject({ kind: 'http', status: 429, retryAfterMs: 3000 })
  })

  it('throws {kind:"http"} on 200 with wrong content-type', async () => {
    const res = new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
    await expect(collect(res)).rejects.toMatchObject({ kind: 'http', status: 200 })
  })

  it('throws {kind:"incomplete"} on clean EOF without a done event', async () => {
    await expect(collect(sseResponse(['data: partial\n\n']))).rejects.toMatchObject({ kind: 'incomplete' })
  })

  it('decodes a 4-byte emoji split across two chunks', async () => {
    const bytes = new TextEncoder().encode('data: 🚀\n\ndata: END\n\n')
    const events = await collect(sseResponse([bytes.slice(0, 8), bytes.slice(8)]))
    expect(events[0]).toEqual({ type: 'text-delta', text: '🚀' })
  })

  it('wraps parser exceptions as {kind:"parse"}', async () => {
    const throwing = () => { throw new SyntaxError('bad json') }
    await expect(collect(sseResponse(['data: x\n\n']), throwing)).rejects.toMatchObject({ kind: 'parse' })
  })

  it('wraps fetch rejection as {kind:"network"}', async () => {
    const gen = streamRequest({
      url: 'http://x/', body: {}, headers: {}, signal: new AbortController().signal,
      parser: echoParser, fetchImpl: async () => { throw new TypeError('Failed to fetch') },
    })
    await expect((async () => { for await (const _ of gen) {} })()).rejects.toMatchObject({ kind: 'network' })
  })

  it('throws {kind:"http"} when a 2xx SSE response has no body', async () => {
    const res = new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    await expect(collect(res)).rejects.toMatchObject({ kind: 'http', status: 200 })
  })

  it('cancels the underlying stream when the consumer stops early', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: a\n\ndata: b\n\n'))
      },
      cancel() { cancelled = true },
    })
    const res = new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const gen = streamRequest({
      url: 'http://x/', body: {}, headers: {}, signal: new AbortController().signal,
      parser: echoParser, fetchImpl: async () => res,
    })
    for await (const _ of gen) break
    expect(cancelled).toBe(true)
  })
})
