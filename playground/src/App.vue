<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import 'vue-llm-stream/theme.css'
import { useLlmStream, useScrollAnchor, type ChatMessage } from 'vue-llm-stream'
import { anthropic, mock, openaiCompatible } from 'vue-llm-stream/providers'
import { StreamMarkdown } from 'vue-llm-stream/markdown'
import { DEMO_REPLY } from './demo-text'

type Preset = 'mock' | 'openai' | 'anthropic'
const preset = ref<Preset>('mock')
const endpointUrl = ref('')
const apiKey = ref('') // memory-only: never persisted anywhere
const model = ref('')
const simulateError = ref(false)
const errorDemoRun = ref(0)

const provider = computed(() => {
  if (preset.value === 'openai') return openaiCompatible({ apiKey: apiKey.value, model: model.value || 'gpt-4o-mini' })
  if (preset.value === 'anthropic') return anthropic({ apiKey: apiKey.value, model: model.value || 'claude-sonnet-5', maxTokens: 1024 })
  void errorDemoRun.value // each send while simulating errors re-creates the mock
  return mock({
    text: DEMO_REPLY,
    tokensPerSec: 40,
    failure: simulateError.value ? { kind: 'http', status: 503 } : undefined,
    failOnce: true,
  })
})
const url = computed(() => {
  if (preset.value === 'mock') return 'mock://demo'
  if (endpointUrl.value) return endpointUrl.value
  return preset.value === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.anthropic.com/v1/messages'
})

const history = ref<ChatMessage[]>([])
const input = ref('')
const container = ref<HTMLElement | null>(null)

const stream = useLlmStream({ url, provider })
const { isPinned, scrollToBottom } = useScrollAnchor(container)

// One stream instance for the whole chat — never create a composable per
// message; this single instance drives the visible assistant bubble.
async function finish(pending: Promise<string | undefined>) {
  const final = await pending
  if (final !== undefined) {
    history.value.push({ role: 'assistant', content: final })
  } else if (stream.finishReason.value === 'aborted' && stream.text.value) {
    // Stop keeps the partial reply — the streaming bubble unmounts on abort,
    // so move what arrived into history
    history.value.push({ role: 'assistant', content: stream.text.value })
  }
}

async function send() {
  const content = input.value.trim()
  if (!content || stream.isStreaming.value) return
  input.value = ''
  if (simulateError.value) errorDemoRun.value++ // fresh mock → the demo fails every send
  history.value.push({ role: 'user', content })
  await finish(stream.start(history.value))
}

function onComposerKeydown(e: KeyboardEvent) {
  // Enter during IME composition confirms the composition, not the message
  if (!e.isComposing) send()
}

type ColorMode = 'auto' | 'light' | 'dark'
const MODES: ColorMode[] = ['auto', 'light', 'dark']
const MODE_ICONS: Record<ColorMode, string> = { auto: '◑', light: '☀', dark: '☾' }
const colorMode = ref<ColorMode>('auto')

function cycleColorMode() {
  colorMode.value = MODES[(MODES.indexOf(colorMode.value) + 1) % MODES.length]!
}

// forced mode goes on <html> so the page background outside the chat column
// switches too; the vls-* class drives the library theme through the same
// ancestor mechanism. 'auto' clears both — media queries decide.
watchEffect(() => {
  const el = document.documentElement
  el.classList.toggle('pg-light', colorMode.value === 'light')
  el.classList.toggle('vls-light', colorMode.value === 'light')
  el.classList.toggle('pg-dark', colorMode.value === 'dark')
  el.classList.toggle('vls-dark', colorMode.value === 'dark')
})
</script>

<template>
  <main class="page" :class="{ streaming: stream.isStreaming.value }">
    <header class="bar">
      <span class="wordmark">vue-llm-stream</span>
      <select v-model="preset" class="field" aria-label="Provider preset">
        <option value="mock">Mock (no key needed)</option>
        <option value="openai">OpenAI-compatible</option>
        <option value="anthropic">Anthropic</option>
      </select>
      <template v-if="preset !== 'mock'">
        <input v-model="endpointUrl" class="field" placeholder="Endpoint URL (or leave default)" aria-label="Endpoint URL" />
        <input v-model="apiKey" class="field" type="password" placeholder="API key (memory only)" aria-label="API key" />
        <input v-model="model" class="field" placeholder="Model" aria-label="Model" />
        <small v-if="preset === 'openai'" class="hint">llama.cpp: run <code>llama-server -m model.gguf</code> → http://localhost:8080/v1/chat/completions</small>
      </template>
      <label v-else class="sim-error"><input v-model="simulateError" type="checkbox" /> Simulate network error (watch auto-retry)</label>
      <button class="btn mode-toggle" :title="`Color mode: ${colorMode}`" :aria-label="`Color mode: ${colorMode}`" @click="cycleColorMode">
        {{ MODE_ICONS[colorMode] }}
      </button>
    </header>

    <section ref="container" class="chat" role="log" aria-label="Conversation" tabindex="0">
      <article v-for="(m, i) in history" :key="i" :class="m.role">
        <StreamMarkdown v-if="m.role === 'assistant'" :text="m.content" status="done" />
        <p v-else>{{ m.content }}</p>
      </article>
      <article v-if="stream.isStreaming.value || stream.status.value === 'error'" class="assistant">
        <StreamMarkdown :text="stream.text.value" :status="stream.status.value">
          <template #loading>
            <em v-if="stream.retryCount.value > 0">retrying… (attempt {{ stream.retryCount.value }})</em>
            <em v-else>connecting…</em>
          </template>
          <template #error>
            <div class="error-row">
              <span>{{ stream.error.value?.kind === 'incomplete' ? 'Response was cut off.' : 'Something went wrong.' }}</span>
              <button class="btn" @click="finish(stream.regenerate())">Retry</button>
            </div>
          </template>
        </StreamMarkdown>
      </article>
    </section>

    <button v-if="!isPinned" class="btn to-bottom" @click="scrollToBottom">↓ New tokens</button>

    <footer class="composer">
      <input v-model="input" class="field" placeholder="Ask anything…" aria-label="Message" @keydown.enter.exact="onComposerKeydown" />
      <button v-if="stream.isStreaming.value" class="btn" @click="stream.abort()">Stop</button>
      <button v-else class="btn btn-primary" :disabled="!input.trim()" @click="send">Send</button>
    </footer>
  </main>
</template>

<style>
/* design tokens — light by default; dark follows the OS unless a forced
   pg-light/pg-dark class is set on <html> (the mode toggle) */
:root {
  --pg-bg: #ffffff;
  --pg-surface: #f6f8fa;
  --pg-surface-raised: #ffffff;
  --pg-user-bubble: #ddf4ff;
  --pg-border: #d1d9e0;
  --pg-fg: #1f2328;
  --pg-muted: #59636e;
  --pg-accent: #0969da;
  --pg-accent-hover: #0757ba;
  --pg-accent-fg: #ffffff;
  --pg-danger: #cf222e;
  --pg-shadow: 0 4px 12px rgba(31, 35, 40, 0.12);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not(.pg-light) {
    --pg-bg: #0d1117;
    --pg-surface: #151b23;
    --pg-surface-raised: #1c2330;
    --pg-user-bubble: #121d2f;
    --pg-border: #3d444d;
    --pg-fg: #f0f6fc;
    --pg-muted: #9198a1;
    --pg-accent: #4493f8;
    --pg-accent-hover: #6cabfa;
    --pg-accent-fg: #0d1117;
    --pg-danger: #f85149;
    --pg-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
    color-scheme: dark;
  }
}

:root.pg-dark {
  --pg-bg: #0d1117;
  --pg-surface: #151b23;
  --pg-surface-raised: #1c2330;
  --pg-user-bubble: #121d2f;
  --pg-border: #3d444d;
  --pg-fg: #f0f6fc;
  --pg-muted: #9198a1;
  --pg-accent: #4493f8;
  --pg-accent-hover: #6cabfa;
  --pg-accent-fg: #0d1117;
  --pg-danger: #f85149;
  --pg-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  color-scheme: dark;
}

body {
  margin: 0;
  background: var(--pg-bg);
  color: var(--pg-fg);
  font-family: system-ui, sans-serif;
}

.page {
  max-width: 720px;
  margin: 0 auto;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 0 16px;
}

/* header */
.bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--pg-border);
}

/* the wordmark is the package name — set in the package's own vernacular,
   with a streaming caret that lights up while tokens arrive */
.wordmark {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-weight: 600;
  font-size: 0.95rem;
  margin-right: auto;
}

.wordmark::after {
  content: '▍';
  color: var(--pg-accent);
  opacity: 0.35;
}

.page.streaming .wordmark::after {
  animation: pg-caret 1s steps(2, start) infinite;
}

@keyframes pg-caret {
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .page.streaming .wordmark::after {
    animation: none;
    opacity: 1;
  }
}

.hint {
  flex-basis: 100%;
  color: var(--pg-muted);
}

.sim-error {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--pg-muted);
  font-size: 0.875rem;
  accent-color: var(--pg-accent);
}

/* controls */
.field {
  background: var(--pg-surface-raised);
  color: var(--pg-fg);
  border: 1px solid var(--pg-border);
  border-radius: 8px;
  padding: 8px 12px;
  font: inherit;
  transition: border-color 0.15s;
}

.field:focus-visible {
  outline: 2px solid var(--pg-accent);
  outline-offset: -1px;
  border-color: transparent;
}

.field::placeholder {
  color: var(--pg-muted);
}

.btn {
  background: var(--pg-surface);
  color: var(--pg-fg);
  border: 1px solid var(--pg-border);
  border-radius: 8px;
  padding: 8px 14px;
  font: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.btn:hover {
  border-color: var(--pg-accent);
}

.btn:active {
  background: var(--pg-border);
}

.btn:focus-visible {
  outline: 2px solid var(--pg-accent);
  outline-offset: 1px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
  border-color: var(--pg-border);
}

.btn-primary {
  background: var(--pg-accent);
  border-color: var(--pg-accent);
  color: var(--pg-accent-fg);
}

.btn-primary:hover:not(:disabled) {
  background: var(--pg-accent-hover);
  border-color: var(--pg-accent-hover);
}

.btn-primary:active:not(:disabled) {
  background: var(--pg-accent);
}

.mode-toggle {
  padding: 8px 10px;
  line-height: 1;
}

/* chat */
.chat {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
}

.chat .user p {
  background: var(--pg-user-bubble);
  border-radius: 12px 12px 4px 12px;
  padding: 10px 14px;
  margin: 0 0 0 auto;
  max-width: 80%;
}

.chat .assistant {
  background: var(--pg-surface);
  border-radius: 12px 12px 12px 4px;
  padding: 12px 16px;
  max-width: 95%;
}

.to-bottom {
  position: fixed;
  bottom: 84px;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--pg-surface-raised);
  box-shadow: var(--pg-shadow);
}

.error-row {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--pg-danger);
}

/* composer */
.composer {
  display: flex;
  gap: 8px;
  padding: 12px 0 16px;
  border-top: 1px solid var(--pg-border);
}

.composer .field {
  flex: 1;
}
</style>
