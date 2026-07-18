import type { FinishReason, LlmProvider, Usage } from '../events'

export interface AnthropicConfig {
  apiKey: string
  model: string
  /** Required by the Anthropic API — omitting it is a 400. */
  maxTokens: number
  headers?: Record<string, string>
}

export function anthropic(config: AnthropicConfig): LlmProvider {
  return {
    buildRequest({ messages }) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
      return {
        body: {
          model: config.model,
          max_tokens: config.maxTokens,
          ...(system ? { system } : {}),
          messages: messages.filter((m) => m.role !== 'system'),
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
      return (frame) => {
        const json = JSON.parse(frame.data)
        switch (json.type) {
          case 'message_start':
            usage.inputTokens = json.message?.usage?.input_tokens
            return []
          case 'content_block_delta':
            if (json.delta?.type === 'text_delta') return [{ type: 'text-delta', text: json.delta.text }]
            if (json.delta?.type === 'thinking_delta') return [{ type: 'reasoning-delta', text: json.delta.thinking }]
            return [] // input_json_delta and future delta types: never rendered as text
          case 'message_delta':
            if (json.usage?.output_tokens !== undefined) usage.outputTokens = json.usage.output_tokens
            if (json.delta?.stop_reason) {
              finishReason = json.delta.stop_reason === 'max_tokens' ? 'max_tokens' : 'stop'
            }
            return []
          case 'message_stop':
            return [{ type: 'done', usage: { ...usage }, finishReason }]
          case 'error':
            return [{ type: 'error', error: { code: json.error?.type, message: json.error?.message ?? 'provider error' } }]
          default:
            return [] // ping, content_block_start, content_block_stop, unknown future events
        }
      }
    },
  }
}
