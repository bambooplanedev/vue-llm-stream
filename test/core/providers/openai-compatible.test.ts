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

  it('turns a top-level error payload into an error event', () => {
    const parse = openaiCompatible({ model: 'm' }).createEventParser()
    const events = parse({ data: '{"error":{"message":"rate limited","code":"rate_limit_exceeded"}}' })
    expect(events).toEqual([
      { type: 'error', error: { code: 'rate_limit_exceeded', message: 'rate limited' } },
    ])
  })

  it('falls back to error.type as code and a default message', () => {
    const parse = openaiCompatible({ model: 'm' }).createEventParser()
    expect(parse({ data: '{"error":{"type":"invalid_request_error"}}' })).toEqual([
      { type: 'error', error: { code: 'invalid_request_error', message: 'provider error' } },
    ])
  })

  it('surfaces a string-shaped error payload as the message', () => {
    const parse = openaiCompatible({ model: 'm' }).createEventParser()
    const events = parse({ data: '{"error":"quota exceeded"}' })
    expect(events).toEqual([{ type: 'error', error: { message: 'quota exceeded' } }])
  })
})

describe('openai-compatible.buildRequest — tools', () => {
  it('serializes tool defs and tool call/result messages to OpenAI wire format', () => {
    const p = openaiCompatible({ apiKey: 'sk', model: 'gpt-4o' })
    const { body } = p.buildRequest({
      messages: [
        { role: 'user', content: 'weather?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'get_weather', args: { city: 'Kyiv' } }] },
        { role: 'tool', toolCallId: 'call_1', content: '17C' },
      ],
      tools: [{ name: 'get_weather', parameters: { type: 'object' } }],
    })
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'get_weather', description: undefined, parameters: { type: 'object' } } },
    ])
    expect(body.messages).toEqual([
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Kyiv"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '17C' },
    ])
  })
})

describe('openai-compatible parser — tool calls', () => {
  const p = openaiCompatible({ model: 'gpt-4o-mini' })
  it('emits start, arg deltas, and end on finish_reason tool_calls', () => {
    const parse = p.createEventParser()
    expect(parse({ data: '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]}}]}' }))
      .toEqual([{ type: 'tool-call-start', index: 0, id: 'call_1', name: 'get_weather' }])
    expect(parse({ data: '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}}]}' }))
      .toEqual([{ type: 'tool-call-delta', index: 0, argsDelta: '{"city":' }])
    expect(parse({ data: '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Kyiv\\"}"}}]}}]}' }))
      .toEqual([{ type: 'tool-call-delta', index: 0, argsDelta: '"Kyiv"}' }])
    expect(parse({ data: '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}' }))
      .toEqual([{ type: 'tool-call-end', index: 0 }])
    expect(parse({ data: '[DONE]' })).toEqual([{ type: 'done', usage: undefined, finishReason: 'tool_use' }])
  })

  it('flushes open tool calls at [DONE] when finish_reason was absent', () => {
    const parse = p.createEventParser()
    parse({ data: '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"n","arguments":"{}"}}]}}]}' })
    expect(parse({ data: '[DONE]' }))
      .toEqual([{ type: 'tool-call-end', index: 0 }, { type: 'done', usage: undefined, finishReason: 'unknown' }])
  })

  it('handles two concurrent tool calls in one frame', () => {
    const parse = p.createEventParser()
    expect(parse({ data: '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"a","arguments":""}},{"index":1,"id":"c1","function":{"name":"b","arguments":""}}]}}]}' }))
      .toEqual([
        { type: 'tool-call-start', index: 0, id: 'c0', name: 'a' },
        { type: 'tool-call-start', index: 1, id: 'c1', name: 'b' },
      ])
  })
})
