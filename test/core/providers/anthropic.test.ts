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
