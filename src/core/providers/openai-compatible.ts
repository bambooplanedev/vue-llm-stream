import type { FinishReason, LlmProvider, StreamEvent, Usage } from '../events.js'

export interface OpenAiCompatibleConfig {
  apiKey?: string
  model: string
  headers?: Record<string, string>
  /** Sets stream_options.include_usage (default true; llama.cpp tolerates it). */
  includeUsage?: boolean
}

export function openaiCompatible(config: OpenAiCompatibleConfig): LlmProvider {
  return {
    buildRequest({ messages, tools }) {
      const apiMessages = messages.map((m) => {
        if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
          }
        }
        return m
      })
      return {
        body: {
          model: config.model,
          messages: apiMessages,
          stream: true,
          ...(tools?.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
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
      const openTools = new Set<number>()
      return (frame): StreamEvent[] => {
        if (!frame.data) return [] // event-only heartbeat frames carry no JSON
        if (frame.data === '[DONE]') {
          const ends: StreamEvent[] = [...openTools].map((index) => ({ type: 'tool-call-end', index }))
          openTools.clear()
          return [...ends, { type: 'done', usage, finishReason }]
        }
        const json = JSON.parse(frame.data)
        if (json.error) {
          const err = json.error
          return [{
            type: 'error',
            error: typeof err === 'string' ? { message: err } : { code: err.code ?? err.type, message: err.message ?? 'provider error' },
          }]
        }
        if (json.usage) {
          usage = { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
        }
        const events: StreamEvent[] = []
        const choice = json.choices?.[0]
        if (Array.isArray(choice?.delta?.tool_calls)) {
          for (const tc of choice.delta.tool_calls) {
            if (typeof tc.index !== 'number') continue
            if (!openTools.has(tc.index) && (tc.id || tc.function?.name)) {
              openTools.add(tc.index)
              events.push({ type: 'tool-call-start', index: tc.index, id: tc.id ?? '', name: tc.function?.name ?? '' })
            }
            if (typeof tc.function?.arguments === 'string' && tc.function.arguments.length > 0) {
              events.push({ type: 'tool-call-delta', index: tc.index, argsDelta: tc.function.arguments })
            }
          }
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason === 'length'
            ? 'max_tokens'
            : choice.finish_reason === 'tool_calls'
              ? 'tool_use'
              : 'stop'
          if (choice.finish_reason === 'tool_calls') {
            for (const index of openTools) events.push({ type: 'tool-call-end', index })
            openTools.clear()
          }
        }
        const text = choice?.delta?.content
        if (typeof text === 'string' && text.length > 0) events.push({ type: 'text-delta', text })
        return events
      }
    },
  }
}
