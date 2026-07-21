import { describe, expect, it } from 'vitest'
import { anthropic } from '../../../src/core/providers/anthropic'

const provider = anthropic({ apiKey: 'sk-ant', model: 'claude-sonnet-5', maxTokens: 1024 })

describe('anthropic.buildRequest', () => {
  it('extracts system messages into the system field and sets required headers', () => {
    const { body, headers } = provider.buildRequest({
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    })
    expect(body).toEqual({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: 'be brief',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    expect(headers).toMatchObject({
      'x-api-key': 'sk-ant',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
  })
})

describe('anthropic parser', () => {
  it('maps the full event sequence: deltas, thinking, usage on message_delta, done on message_stop', () => {
    const parse = provider.createEventParser()
    expect(parse({ event: 'message_start', data: '{"type":"message_start","message":{"usage":{"input_tokens":9}}}' })).toEqual([])
    expect(parse({ event: 'ping', data: '{"type":"ping"}' })).toEqual([])
    expect(parse({ event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}' }))
      .toEqual([{ type: 'reasoning-delta', text: 'hmm' }])
    expect(parse({ event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}' }))
      .toEqual([{ type: 'text-delta', text: 'Hi' }])
    // tool-use JSON deltas are ignored in 1.0, never rendered as text
    expect(parse({ event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"a\\":"}}' }))
      .toEqual([])
    expect(parse({ event: 'message_delta', data: '{"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":42}}' }))
      .toEqual([])
    expect(parse({ event: 'message_stop', data: '{"type":"message_stop"}' })).toEqual([
      { type: 'done', usage: { inputTokens: 9, outputTokens: 42 }, finishReason: 'max_tokens' },
    ])
  })

  it('ignores event-only frames with empty data (proxy heartbeats)', () => {
    const parse = provider.createEventParser()
    expect(parse({ event: 'ping', data: '' })).toEqual([])
  })

  it('maps in-stream error events with their payload', () => {
    const parse = provider.createEventParser()
    expect(parse({ event: 'error', data: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }))
      .toEqual([{ type: 'error', error: { code: 'overloaded_error', message: 'Overloaded' } }])
  })

  it('maps end_turn to stop', () => {
    const parse = provider.createEventParser()
    parse({ event: 'message_delta', data: '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}' })
    expect(parse({ event: 'message_stop', data: '{"type":"message_stop"}' }))
      .toEqual([{ type: 'done', usage: { inputTokens: undefined, outputTokens: 1 }, finishReason: 'stop' }])
  })
})

describe('anthropic parser — tool calls', () => {
  it('emits start/delta/end for a tool_use block and maps stop_reason tool_use', () => {
    const parse = provider.createEventParser()
    expect(parse({ event: 'content_block_start', data: '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather"}}' }))
      .toEqual([{ type: 'tool-call-start', index: 1, id: 'toolu_1', name: 'get_weather' }])
    expect(parse({ event: 'content_block_delta', data: '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}' }))
      .toEqual([{ type: 'tool-call-delta', index: 1, argsDelta: '{"city":' }])
    expect(parse({ event: 'content_block_delta', data: '{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"Kyiv\\"}"}}' }))
      .toEqual([{ type: 'tool-call-delta', index: 1, argsDelta: '"Kyiv"}' }])
    expect(parse({ event: 'content_block_stop', data: '{"type":"content_block_stop","index":1}' }))
      .toEqual([{ type: 'tool-call-end', index: 1 }])
    parse({ event: 'message_delta', data: '{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}' })
    expect(parse({ event: 'message_stop', data: '{"type":"message_stop"}' }))
      .toEqual([{ type: 'done', usage: { inputTokens: undefined, outputTokens: 5 }, finishReason: 'tool_use' }])
  })

  it('does not emit tool-call-end for a non-tool content_block_stop', () => {
    const parse = provider.createEventParser()
    expect(parse({ event: 'content_block_stop', data: '{"type":"content_block_stop","index":0}' })).toEqual([])
  })

  it('handles interleaved text and two concurrent tool blocks', () => {
    const parse = provider.createEventParser()
    parse({ event: 'content_block_start', data: '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}' })
    expect(parse({ event: 'content_block_delta', data: '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}' }))
      .toEqual([{ type: 'text-delta', text: 'Hi' }])
    expect(parse({ event: 'content_block_start', data: '{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"a","name":"x"}}' }))
      .toEqual([{ type: 'tool-call-start', index: 1, id: 'a', name: 'x' }])
    expect(parse({ event: 'content_block_start', data: '{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"b","name":"y"}}' }))
      .toEqual([{ type: 'tool-call-start', index: 2, id: 'b', name: 'y' }])
    expect(parse({ event: 'content_block_stop', data: '{"type":"content_block_stop","index":1}' })).toEqual([{ type: 'tool-call-end', index: 1 }])
    expect(parse({ event: 'content_block_stop', data: '{"type":"content_block_stop","index":2}' })).toEqual([{ type: 'tool-call-end', index: 2 }])
  })
})

describe('anthropic.buildRequest — tools', () => {
  it('serializes tool defs to input_schema and echoes tool calls/results as content blocks', () => {
    const { body } = provider.buildRequest({
      messages: [
        { role: 'user', content: 'weather?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_1', name: 'get_weather', args: { city: 'Kyiv' } }] },
        { role: 'tool', toolCallId: 'toolu_1', content: '17C' },
      ],
      tools: [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
    })
    expect(body.tools).toEqual([
      { name: 'get_weather', description: 'Get weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } },
    ])
    expect(body.messages).toEqual([
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Kyiv' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '17C' }] },
    ])
  })

  it('omits tools when none are passed and preserves plain string messages', () => {
    const { body } = provider.buildRequest({ messages: [{ role: 'user', content: 'hi' }] })
    expect(body.tools).toBeUndefined()
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })
})
