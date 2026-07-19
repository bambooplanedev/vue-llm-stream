import { describe, expectTypeOf, it } from 'vitest'
import { ref, type Ref } from 'vue'
import { useLlmStream, useScrollAnchor, type LlmStreamStatus, type UseLlmStreamReturn } from '../src/index'
import { mock } from '../src/providers'
import type { ChatMessage, LlmProvider, LlmStreamError } from '../src/index'

describe('type surface', () => {
  it('exports the return type as UseLlmStreamReturn', () => {
    const s = useLlmStream({ url: 'x', provider: mock({ text: 'hi' }) })
    expectTypeOf(s).toEqualTypeOf<UseLlmStreamReturn>()
  })

  it('useLlmStream returns the documented shape', () => {
    const s = useLlmStream({ url: 'x', provider: mock({ text: 'hi' }) })
    expectTypeOf(s.text).toEqualTypeOf<Ref<string>>()
    expectTypeOf(s.status).toEqualTypeOf<Ref<LlmStreamStatus>>()
    expectTypeOf(s.start).parameter(0).toEqualTypeOf<string | ChatMessage[]>()
    expectTypeOf(s.start).returns.resolves.toEqualTypeOf<string | undefined>()
    expectTypeOf(s.error).toEqualTypeOf<Ref<LlmStreamError | null>>()
  })

  it('url accepts refs and getters', () => {
    useLlmStream({ url: () => 'computed', provider: mock({ text: 'x' }) })
  })

  it('error union discriminates on kind', () => {
    const e = {} as LlmStreamError
    if (e.kind === 'http') expectTypeOf(e.status).toEqualTypeOf<number>()
    if (e.kind === 'incomplete') expectTypeOf(e).not.toHaveProperty('status')
  })

  it('buildRequest body is a plain object, not unknown', () => {
    expectTypeOf<ReturnType<LlmProvider['buildRequest']>['body']>().toEqualTypeOf<Record<string, unknown>>()
  })

  it('useScrollAnchor accepts the idiomatic ref<HTMLElement>()', () => {
    const el = ref<HTMLElement>()
    useScrollAnchor(el)
  })
})
