import type { SseFrame, StreamEvent } from './events'
import { createSseFrameParser } from './sse'
import { parseRetryAfter } from './retry'

export interface StreamRequestOptions {
  url: string
  body: unknown
  headers: Record<string, string>
  signal: AbortSignal
  parser: (frame: SseFrame) => StreamEvent[]
  fetchImpl?: typeof globalThis.fetch
}

export async function* streamRequest(opts: StreamRequestOptions): AsyncGenerator<StreamEvent> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  let res: Response
  try {
    res = await fetchImpl(opts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: JSON.stringify(opts.body),
      signal: opts.signal,
    })
  } catch (cause) {
    throw { kind: 'network', cause }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let message = body || `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(body)
      message = parsed?.error?.message ?? parsed?.message ?? message
    } catch { /* body was not JSON — keep raw text */ }
    const retryAfterHeader = res.headers.get('retry-after')
    const retryAfterMs = res.status === 429 && retryAfterHeader
      ? parseRetryAfter(retryAfterHeader) ?? undefined
      : undefined
    throw { kind: 'http', status: res.status, message, body, retryAfterMs }
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    void res.body?.cancel().catch(() => {})
    throw { kind: 'http', status: res.status, message: `expected text/event-stream, got "${contentType}"` }
  }

  if (!res.body) {
    throw { kind: 'http', status: res.status, message: 'response has no body' }
  }

  const decoder = new TextDecoder('utf-8')
  const frames = createSseFrameParser()
  const reader = res.body.getReader()
  let sawDone = false

  const emit = (frameList: SseFrame[]): StreamEvent[] => {
    const out: StreamEvent[] = []
    for (const frame of frameList) {
      let events: StreamEvent[]
      try {
        events = opts.parser(frame)
      } catch (cause) {
        throw { kind: 'parse', frame: frame.data, cause }
      }
      for (const ev of events) {
        if (ev.type === 'done') sawDone = true
        out.push(ev)
      }
    }
    return out
  }

  try {
    while (true) {
      let step: ReadableStreamReadResult<Uint8Array>
      try {
        step = await reader.read()
      } catch (cause) {
        if (opts.signal.aborted) throw cause
        throw { kind: 'network', cause }
      }
      if (step.done) {
        // final flush: trailing partial code point + trailing frame
        yield* emit(frames.push(decoder.decode()))
        yield* emit(frames.flush())
        break
      }
      yield* emit(frames.push(decoder.decode(step.value, { stream: true })))
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  if (!sawDone) throw { kind: 'incomplete' }
}
