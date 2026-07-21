import {
  computed, getCurrentScope, onScopeDispose, ref, shallowRef, toValue,
  type ComputedRef, type MaybeRefOrGetter, type Ref,
} from 'vue'
import type { ChatMessage, FinishReason, LlmProvider, LlmStreamError, StreamEvent, ToolDef, Usage } from '../core/events.js'
import { isRetryable, retryDelayMs, type RetryOptions } from '../core/retry.js'
import { streamRequest } from '../core/stream.js'

export type LlmStreamStatus = 'idle' | 'submitted' | 'streaming' | 'done' | 'error'

export interface ToolCallState {
  index: number
  id: string
  name: string
  argsText: string
  args?: unknown
  state: 'streaming' | 'complete'
}

export interface PerCallOptions {
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

export interface UseLlmStreamOptions {
  url: MaybeRefOrGetter<string>
  provider: MaybeRefOrGetter<LlmProvider>
  headers?: MaybeRefOrGetter<Record<string, string> | undefined>
  body?: MaybeRefOrGetter<Record<string, unknown> | undefined>
  fetch?: typeof globalThis.fetch
  retry?: RetryOptions | false
  abortOnUnmount?: boolean
  tools?: MaybeRefOrGetter<ToolDef[] | undefined>
  /** Raw tap: fires BEFORE `text`/`toolCalls`/etc. are updated for this event, so a
   *  handler reading e.g. `toolCalls.value` during a `tool-call-end` still sees the
   *  pre-parse state (args not yet parsed onto the matching entry). */
  onEvent?: (ev: StreamEvent) => void
  onDelta?: (text: string) => void
  onDone?: (text: string) => void
  onError?: (error: LlmStreamError) => void
}

function normalizeStreamError(e: unknown): LlmStreamError {
  if (e && typeof e === 'object' && 'kind' in e) return e as LlmStreamError
  return { kind: 'network', cause: e }
}

/** Abortable sleep; resolves true if the signal fired first. */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(true)
    const timer = setTimeout(() => { cleanup(); resolve(false) }, ms)
    const onAbort = () => { cleanup(); resolve(true) }
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
    signal.addEventListener('abort', onAbort)
  })
}

export interface UseLlmStreamReturn {
  text: Ref<string>
  reasoning: Ref<string>
  toolCalls: Ref<ToolCallState[]>
  status: Ref<LlmStreamStatus>
  isStreaming: ComputedRef<boolean>
  finishReason: Ref<FinishReason | null>
  error: Ref<LlmStreamError | null>
  usage: Ref<Usage | null>
  retryCount: Ref<number>
  start: (input: string | ChatMessage[], opts?: PerCallOptions) => Promise<string | undefined>
  abort: () => void
  regenerate: () => Promise<string | undefined>
}

export function useLlmStream(options: UseLlmStreamOptions): UseLlmStreamReturn {
  const text = ref('')
  const reasoning = ref('')
  const toolCalls = ref<ToolCallState[]>([])
  const status = ref<LlmStreamStatus>('idle')
  const error = shallowRef<LlmStreamError | null>(null)
  const usage = shallowRef<Usage | null>(null)
  const finishReason = ref<FinishReason | null>(null)
  const retryCount = ref(0)
  const isStreaming = computed(() => status.value === 'submitted' || status.value === 'streaming')

  let generation = 0
  let controller: AbortController | null = null
  let lastInput: ChatMessage[] | null = null
  let lastPerCall: PerCallOptions | undefined

  function abort(): void {
    controller?.abort()
  }

  if (options.abortOnUnmount !== false && getCurrentScope()) {
    onScopeDispose(abort)
  }

  async function start(input: string | ChatMessage[], perCall?: PerCallOptions): Promise<string | undefined> {
    // copy the array — regenerate() must not see messages pushed after start()
    const messages: ChatMessage[] =
      typeof input === 'string' ? [{ role: 'user', content: input }] : [...input]
    lastInput = messages
    lastPerCall = perCall

    const gen = ++generation
    controller?.abort()
    const ctl = new AbortController()
    controller = ctl

    text.value = ''
    reasoning.value = ''
    toolCalls.value = []
    error.value = null
    usage.value = null
    finishReason.value = null
    retryCount.value = 0
    status.value = 'submitted'

    const retryOpts = options.retry === false
      ? null
      : { retries: 2, baseDelayMs: 500, ...options.retry }
    let attempt = 0
    let sawToken = false

    const finishAborted = (): undefined => {
      if (gen !== generation) return undefined
      finishReason.value = 'aborted'
      status.value = 'done'
      return undefined
    }

    while (true) {
      const provider = toValue(options.provider)
      // a throwing buildRequest is deterministic misconfiguration, not a
      // transient network failure — surface it without burning the retry budget
      let req: ReturnType<LlmProvider['buildRequest']>
      try {
        req = provider.buildRequest({ messages, tools: toValue(options.tools) })
      } catch (e) {
        const err: LlmStreamError = {
          kind: 'provider',
          message: e instanceof Error ? e.message : String(e),
        }
        error.value = err
        status.value = 'error'
        options.onError?.(err)
        return undefined
      }
      try {
        for await (const ev of streamRequest({
          url: toValue(options.url),
          body: { ...req.body, ...toValue(options.body), ...perCall?.body },
          headers: { ...req.headers, ...toValue(options.headers), ...perCall?.headers },
          signal: ctl.signal,
          parser: provider.createEventParser(),
          fetchImpl: provider.fetch ?? options.fetch,
        })) {
          if (gen !== generation) return undefined
          options.onEvent?.(ev)
          switch (ev.type) {
            case 'text-delta':
              sawToken = true
              status.value = 'streaming'
              text.value += ev.text
              options.onDelta?.(ev.text)
              break
            case 'reasoning-delta':
              sawToken = true
              status.value = 'streaming'
              reasoning.value += ev.text
              break
            case 'tool-call-start':
              sawToken = true
              status.value = 'streaming'
              toolCalls.value.push({ index: ev.index, id: ev.id, name: ev.name, argsText: '', state: 'streaming' })
              break
            case 'tool-call-delta': {
              const tc = toolCalls.value.find((t) => t.index === ev.index)
              if (tc) tc.argsText += ev.argsDelta
              break
            }
            case 'tool-call-end': {
              const tc = toolCalls.value.find((t) => t.index === ev.index)
              if (tc) {
                tc.state = 'complete'
                try { tc.args = JSON.parse(tc.argsText) } catch { /* incomplete/invalid JSON: keep argsText, leave args undefined */ }
              }
              break
            }
            case 'done':
              usage.value = ev.usage ?? null
              finishReason.value = ev.finishReason ?? 'unknown'
              break
            case 'error':
              throw { kind: 'provider', code: ev.error.code, message: ev.error.message } satisfies LlmStreamError
          }
        }
        if (gen !== generation) return undefined
        status.value = 'done'
        options.onDone?.(text.value)
        return text.value
      } catch (e) {
        if (gen !== generation) return undefined
        // classify abort by the signal, never by exception type
        if (ctl.signal.aborted) return finishAborted()
        const err = normalizeStreamError(e)
        if (retryOpts && !sawToken && attempt < retryOpts.retries && isRetryable(err)) {
          const delay = retryDelayMs(attempt, err, retryOpts)
          if (delay !== null) {
            attempt++
            retryCount.value = attempt
            const aborted = await sleep(delay, ctl.signal)
            if (aborted) return finishAborted()
            if (gen !== generation) return undefined
            continue
          }
        }
        error.value = err
        status.value = 'error'
        options.onError?.(err)
        return undefined
      }
    }
  }

  function regenerate(): Promise<string | undefined> {
    if (!lastInput) return Promise.resolve(undefined)
    return start(lastInput, lastPerCall)
  }

  return {
    text, reasoning, toolCalls, status, isStreaming, finishReason, error, usage, retryCount,
    start, abort, regenerate,
  }
}
