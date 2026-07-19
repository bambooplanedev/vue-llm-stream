import type { FinishReason, LlmProvider, Usage } from '../events.js'

export interface OpenAiCompatibleConfig {
  apiKey?: string
  model: string
  headers?: Record<string, string>
  /** Sets stream_options.include_usage (default true; llama.cpp tolerates it). */
  includeUsage?: boolean
}

export function openaiCompatible(config: OpenAiCompatibleConfig): LlmProvider {
  return {
    buildRequest({ messages }) {
      return {
        body: {
          model: config.model,
          messages,
          stream: true,
          ...(config.includeUsage !== false ? { stream_options: { include_usage: true } } : {}),
        },
        headers: {
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          ...config.headers,
        },
      }
    },
    createEventParser() {
      let usage: Usage | undefined
      let finishReason: FinishReason = 'unknown'
      return (frame) => {
        if (!frame.data) return [] // event-only heartbeat frames carry no JSON
        if (frame.data === '[DONE]') return [{ type: 'done', usage, finishReason }]
        const json = JSON.parse(frame.data)
        if (json.usage) {
          usage = { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
        }
        const choice = json.choices?.[0]
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason === 'length' ? 'max_tokens' : 'stop'
        }
        const text = choice?.delta?.content
        return typeof text === 'string' && text.length > 0 ? [{ type: 'text-delta', text }] : []
      }
    },
  }
}
