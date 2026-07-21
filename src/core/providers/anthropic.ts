import type { FinishReason, LlmProvider, Usage } from '../events.js'

export interface AnthropicConfig {
  apiKey: string
  model: string
  /** Required by the Anthropic API — omitting it is a 400. */
  maxTokens: number
  headers?: Record<string, string>
}

export function anthropic(config: AnthropicConfig): LlmProvider {
  return {
    buildRequest({ messages, tools }) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
      // Anthropic requires every tool_result for a turn to live in ONE user message
      // and roles to strictly alternate — consecutive `tool` messages (parallel
      // tool calls resolved in sequence) are coalesced into a single user turn,
      // one tool_result block per message, rather than one user message each.
      const apiMessages: Record<string, unknown>[] = []
      let openToolResultBlocks: Record<string, unknown>[] | null = null
      for (const m of messages) {
        if (m.role === 'system') continue
        if (m.role === 'tool') {
          const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
          if (openToolResultBlocks) {
            openToolResultBlocks.push(block)
          } else {
            openToolResultBlocks = [block]
            apiMessages.push({ role: 'user', content: openToolResultBlocks })
          }
          continue
        }
        openToolResultBlocks = null
        if (m.role === 'assistant' && m.toolCalls?.length) {
          apiMessages.push({
            role: 'assistant',
            content: [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} })),
            ],
          })
          continue
        }
        apiMessages.push({ role: m.role, content: m.content })
      }
      return {
        body: {
          model: config.model,
          max_tokens: config.maxTokens,
          ...(system ? { system } : {}),
          messages: apiMessages,
          ...(tools?.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
          stream: true,
        },
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          // Direct browser calls are a development convenience; production
          // traffic belongs behind your own proxy speaking the same format.
          'anthropic-dangerous-direct-browser-access': 'true',
          ...config.headers,
        },
      }
    },
    createEventParser() {
      const usage: Usage = {}
      let finishReason: FinishReason = 'unknown'
      const toolIndices = new Set<number>()
      return (frame) => {
        if (!frame.data) return [] // event-only heartbeat frames carry no JSON
        const json = JSON.parse(frame.data)
        switch (json.type) {
          case 'message_start':
            usage.inputTokens = json.message?.usage?.input_tokens
            return []
          case 'content_block_start':
            if (json.content_block?.type === 'tool_use') {
              toolIndices.add(json.index)
              return [{ type: 'tool-call-start', index: json.index, id: json.content_block.id, name: json.content_block.name }]
            }
            return []
          case 'content_block_delta':
            if (json.delta?.type === 'text_delta') return [{ type: 'text-delta', text: json.delta.text }]
            if (json.delta?.type === 'thinking_delta') return [{ type: 'reasoning-delta', text: json.delta.thinking }]
            if (json.delta?.type === 'input_json_delta' && toolIndices.has(json.index)) return [{ type: 'tool-call-delta', index: json.index, argsDelta: json.delta.partial_json }]
            return []
          case 'content_block_stop':
            return toolIndices.has(json.index) ? [{ type: 'tool-call-end', index: json.index }] : []
          case 'message_delta':
            if (json.usage?.output_tokens !== undefined) usage.outputTokens = json.usage.output_tokens
            if (json.delta?.stop_reason) {
              finishReason = json.delta.stop_reason === 'max_tokens'
                ? 'max_tokens'
                : json.delta.stop_reason === 'tool_use'
                  ? 'tool_use'
                  : 'stop'
            }
            return []
          case 'message_stop':
            return [{ type: 'done', usage: { ...usage }, finishReason }]
          case 'error':
            return [{ type: 'error', error: { code: json.error?.type, message: json.error?.message ?? 'provider error' } }]
          default:
            return [] // ping, unknown future events
        }
      }
    },
  }
}
