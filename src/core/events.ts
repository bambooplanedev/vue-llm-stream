export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface Usage {
  inputTokens?: number
  outputTokens?: number
}

export type FinishReason = 'stop' | 'max_tokens' | 'aborted' | 'unknown'

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
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
  buildRequest(ctx: { messages: ChatMessage[] }): { body: unknown; headers: Record<string, string> }
  createEventParser(): (frame: SseFrame) => StreamEvent[]
  /** Optional fetch override — used by the mock provider to avoid the network. */
  fetch?: typeof globalThis.fetch
}
