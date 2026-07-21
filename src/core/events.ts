export interface ToolDef {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface Usage {
  inputTokens?: number
  outputTokens?: number
}

export type FinishReason = 'stop' | 'max_tokens' | 'tool_use' | 'aborted' | 'unknown'

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call-start'; index: number; id: string; name: string }
  | { type: 'tool-call-delta'; index: number; argsDelta: string }
  | { type: 'tool-call-end'; index: number }
  | { type: 'done'; usage?: Usage; finishReason?: FinishReason }
  | { type: 'error'; error: { code?: string; message: string } }

export type LlmStreamError =
  | { kind: 'http'; status: number; message: string; body?: string; retryAfterMs?: number }
  | { kind: 'network'; cause: unknown }
  | { kind: 'parse'; frame: string; cause: unknown }
  | { kind: 'incomplete' }
  | { kind: 'provider'; code?: string; message: string }

export interface SseFrame {
  event?: string
  data: string
}

export interface LlmProvider {
  buildRequest(ctx: { messages: ChatMessage[]; tools?: ToolDef[] }): { body: Record<string, unknown>; headers: Record<string, string> }
  createEventParser(): (frame: SseFrame) => StreamEvent[]
  /** Optional fetch override — used by the mock provider to avoid the network. */
  fetch?: typeof globalThis.fetch
}
