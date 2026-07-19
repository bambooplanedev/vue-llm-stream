import {
  computed, getCurrentScope, onScopeDispose, ref, shallowRef, toValue,
  type ComputedRef, type MaybeRefOrGetter, type Ref,
} from 'vue'
import type { ChatMessage, FinishReason, LlmProvider, LlmStreamError, Usage } from '../core/events.js'
import { isRetryable, retryDelayMs, type RetryOptions } from '../core/retry.js'
import { streamRequest } from '../core/stream.js'

export type LlmStreamStatus = 'idle' | 'submitted' | 'streaming' | 'done' | 'error'

export interface PerCallOptions {
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

export interface UseLlmStreamOptions {
  url: MaybeRefOrGetter<string>
  provider: LlmProvider
  headers?: MaybeRefOrGetter<Record<string, string> | undefined>
  body?: MaybeRefOrGetter<Record<string, unknown> | undefined>
  fetch?: typeof globalThis.fetch
  retry?: RetryOptions | false
  abortOnUnmount?: boolean
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

export function useLlmStream(options: UseLlmStreamOptions) {
  const text = ref('')
  const reasoning = ref('')
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
    const messages: ChatMessage[] =
      typeof input === 'string' ? [{ role: 'user', content: input }] : input
    lastInput = messages
    lastPerCall = perCall

    const gen = ++generation
    controller?.abort()
    const ctl = new AbortController()
    controller = ctl

    text.value = ''
    reasoning.value = ''
    error.value = null
    usage.value = null
    finishReason.value = null
    retryCount.value = 0
    status.value = 'submitted'

    const retryOpts = options.retry === false
      ? null
      : { attempts: 2, baseDelayMs: 500, ...options.retry }
    let attempt = 0
    let sawToken = false

    const finishAborted = (): undefined => {
      if (gen !== generation) return undefined
      finishReason.value = 'aborted'
      status.value = 'done'
      return undefined
    }

    while (true) {
      try {
        const req = options.provider.buildRequest({ messages })
        for await (const ev of streamRequest({
          url: toValue(options.url),
          body: { ...(req.body as Record<string, unknown>), ...toValue(options.body), ...perCall?.body },
          headers: { ...req.headers, ...toValue(options.headers), ...perCall?.headers },
          signal: ctl.signal,
          parser: options.provider.createEventParser(),
          fetchImpl: options.provider.fetch ?? options.fetch,
        })) {
          if (gen !== generation) return undefined
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
        if (retryOpts && !sawToken && attempt < retryOpts.attempts && isRetryable(err)) {
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
    text, reasoning, status, isStreaming, finishReason, error, usage, retryCount,
    start, abort, regenerate,
  } as {
    text: Ref<string>; reasoning: Ref<string>
    status: Ref<LlmStreamStatus>; isStreaming: ComputedRef<boolean>
    finishReason: Ref<FinishReason | null>; error: Ref<LlmStreamError | null>
    usage: Ref<Usage | null>; retryCount: Ref<number>
    start: (input: string | ChatMessage[], opts?: PerCallOptions) => Promise<string | undefined>
    abort: () => void
    regenerate: () => Promise<string | undefined>
  }
}
