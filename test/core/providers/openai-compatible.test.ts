import { describe, expect, it } from 'vitest'
import { openaiCompatible } from '../../../src/core/providers/openai-compatible'

const provider = openaiCompatible({ apiKey: 'sk-x', model: 'gpt-4o-mini' })

describe('openaiCompatible.buildRequest', () => {
  it('builds a streaming chat completion request with usage enabled', () => {
    const { body, headers } = provider.buildRequest({ messages: [{ role: 'user', content: 'hi' }] })
    expect(body).toEqual({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(headers).toMatchObject({ authorization: 'Bearer sk-x' })
  })
  it('omits authorization when no apiKey (llama.cpp local)', () => {
    const { headers } = openaiCompatible({ model: 'x' }).buildRequest({ messages: [] })
    expect(headers).not.toHaveProperty('authorization')
  })
})

describe('openaiCompatible parser', () => {
  it('handles role-only first chunk, deltas, finish_reason, usage-only chunk, [DONE]', () => {
    const parse = provider.createEventParser()
    // real traffic shape: first chunk carries only the role
    expect(parse({ data: '{"choices":[{"delta":{"role":"assistant"}}]}' })).toEqual([])
    expect(parse({ data: '{"choices":[{"delta":{"content":"Hel"}}]}' }))
      .toEqual([{ type: 'text-delta', text: 'Hel' }])
    expect(parse({ data: '{"choices":[{"delta":{},"finish_reason":"length"}]}' })).toEqual([])
    // usage-only final chunk has empty choices
    expect(parse({ data: '{"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":7}}' })).toEqual([])
    expect(parse({ data: '[DONE]' })).toEqual([
      { type: 'done', usage: { inputTokens: 3, outputTokens: 7 }, finishReason: 'max_tokens' },
    ])
  })
  it('ignores event-only frames with empty data (proxy heartbeats)', () => {
    const parse = provider.createEventParser()
    expect(parse({ event: 'ping', data: '' })).toEqual([])
  })

  it('maps finish_reason stop', () => {
    const parse = provider.createEventParser()
    parse({ data: '{"choices":[{"delta":{"content":"x"},"finish_reason":null}]}' })
    parse({ data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}' })
    expect(parse({ data: '[DONE]' })).toEqual([{ type: 'done', usage: undefined, finishReason: 'stop' }])
  })
})
