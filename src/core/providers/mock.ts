import type { LlmProvider } from '../events.js'

export type MockFailure =
  | { kind: 'http'; status: number }
  | { kind: 'midStreamError' }
  | { kind: 'truncate'; afterTokens: number }

export interface MockConfig {
  text: string
  tokensPerSec?: number
  failure?: MockFailure
  /** Apply the failure only to the first request (demonstrates auto-retry). */
  failOnce?: boolean
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish)
  })

export function mock(config: MockConfig): LlmProvider {
  const tokens = config.text.match(/\s*\S+\s*/g) ?? []
  const delayMs = 1000 / (config.tokensPerSec ?? 30)
  let requestCount = 0

  return {
    buildRequest: () => ({ body: {}, headers: {} }),
    createEventParser() {
      return (frame) => {
        if (frame.data === '[END]') return [{ type: 'done', finishReason: 'stop' }]
        if (frame.event === 'error') return [{ type: 'error', error: JSON.parse(frame.data) }]
        return [{ type: 'text-delta', text: JSON.parse(frame.data).t }]
      }
    },
    fetch: async (_url, init) => {
      requestCount++
      const failure = config.failOnce && requestCount > 1 ? undefined : config.failure
      if (failure?.kind === 'http') {
        return new Response(JSON.stringify({ error: { message: 'mock http failure' } }), { status: failure.status })
      }
      const enc = new TextEncoder()
      const signal = init?.signal ?? undefined
      const stream = new ReadableStream<Uint8Array>({
        async start(c) {
          let i = 0
          for (const token of tokens) {
            await wait(delayMs, signal)
            if (signal?.aborted) {
              c.error(new DOMException('aborted', 'AbortError'))
              return
            }
            if (failure?.kind === 'truncate' && i >= failure.afterTokens) {
              c.close() // clean EOF, no terminal event → streamRequest raises "incomplete"
              return
            }
            c.enqueue(enc.encode(`data: ${JSON.stringify({ t: token })}\n\n`))
            i++
          }
          if (failure?.kind === 'midStreamError') {
            c.enqueue(enc.encode('event: error\ndata: {"message":"mock mid-stream failure"}\n\n'))
          } else {
            c.enqueue(enc.encode('data: [END]\n\n'))
          }
          c.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    },
  }
}
