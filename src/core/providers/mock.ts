import type { LlmProvider } from '../events.js'

export type MockFailure =
  | { kind: 'http'; status: number }
  | { kind: 'midStreamError' }
  | { kind: 'truncate'; afterTokens: number }

export type MockStep =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; args: Record<string, unknown>; chunkArgs?: number }

export interface MockConfig {
  text?: string
  tokensPerSec?: number
  failure?: MockFailure
  /** Apply the failure only to the first request (demonstrates auto-retry). */
  failOnce?: boolean
  /** Scripted mix of text runs and tool-calls; overrides `text` when present. */
  script?: MockStep[]
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
  const tokens = (config.text ?? '').match(/\s*\S+\s*/g) ?? []
  const delayMs = 1000 / (config.tokensPerSec ?? 30)
  let requestCount = 0

  return {
    buildRequest: () => ({ body: {}, headers: {} }),
    createEventParser() {
      return (frame) => {
        if (frame.event === 'tool-start') {
          const j = JSON.parse(frame.data)
          return [{ type: 'tool-call-start', index: j.index, id: j.id, name: j.name }]
        }
        if (frame.event === 'tool-args') {
          const j = JSON.parse(frame.data)
          return [{ type: 'tool-call-delta', index: j.index, argsDelta: j.argsDelta }]
        }
        if (frame.event === 'tool-end') {
          const j = JSON.parse(frame.data)
          return [{ type: 'tool-call-end', index: j.index }]
        }
        if (frame.event === 'done') return [{ type: 'done', finishReason: JSON.parse(frame.data).finishReason }]
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
          const emitText = async (text: string): Promise<boolean> => {
            for (const token of text.match(/\s*\S+\s*/g) ?? []) {
              await wait(delayMs, signal)
              if (signal?.aborted) {
                c.error(new DOMException('aborted', 'AbortError'))
                return false
              }
              c.enqueue(enc.encode(`data: ${JSON.stringify({ t: token })}\n\n`))
            }
            return true
          }

          if (config.script) {
            let toolIndex = 0
            for (const step of config.script) {
              if (step.type === 'text') {
                if (!(await emitText(step.text))) return
              } else {
                await wait(delayMs, signal)
                if (signal?.aborted) {
                  c.error(new DOMException('aborted', 'AbortError'))
                  return
                }
                const index = toolIndex++
                c.enqueue(enc.encode(`event: tool-start\ndata: ${JSON.stringify({ index, id: step.id, name: step.name })}\n\n`))
                const argsStr = JSON.stringify(step.args)
                const size = Math.max(1, Math.ceil(argsStr.length / (step.chunkArgs ?? 1)))
                for (let i = 0; i < argsStr.length; i += size) {
                  await wait(delayMs, signal)
                  if (signal?.aborted) {
                    c.error(new DOMException('aborted', 'AbortError'))
                    return
                  }
                  c.enqueue(enc.encode(`event: tool-args\ndata: ${JSON.stringify({ index, argsDelta: argsStr.slice(i, i + size) })}\n\n`))
                }
                c.enqueue(enc.encode(`event: tool-end\ndata: ${JSON.stringify({ index })}\n\n`))
              }
            }
            const endedOnTool = config.script.at(-1)?.type === 'tool-call'
            if (endedOnTool) c.enqueue(enc.encode(`event: done\ndata: ${JSON.stringify({ finishReason: 'tool_use' })}\n\n`))
            else c.enqueue(enc.encode('data: [END]\n\n'))
            c.close()
            return
          }

          // ---- existing token path (unchanged) ----
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
