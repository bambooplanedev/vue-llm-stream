import type { ChatMessage, FinishReason, StreamEvent, ToolCall, ToolDef } from '../../src/core/events'

// new event variants compile
const _s: StreamEvent = { type: 'tool-call-start', index: 0, id: 't1', name: 'calc' }
const _d: StreamEvent = { type: 'tool-call-delta', index: 0, argsDelta: '{"a":' }
const _e: StreamEvent = { type: 'tool-call-end', index: 0 }
const _fr: FinishReason = 'tool_use'

// tool definition + call shapes
const _td: ToolDef = { name: 'calc', parameters: { type: 'object' } }
const _tc: ToolCall = { id: 't1', name: 'calc', args: { a: 1 } }

// richer messages, and the v0.2 shapes still valid
const _m1: ChatMessage = { role: 'user', content: 'hi' }
const _m2: ChatMessage = { role: 'assistant', content: '', toolCalls: [_tc] }
const _m3: ChatMessage = { role: 'tool', toolCallId: 't1', content: '2' }
const _m4: ChatMessage = { role: 'assistant', content: 'plain' }

void [_s, _d, _e, _fr, _td, _tc, _m1, _m2, _m3, _m4]
