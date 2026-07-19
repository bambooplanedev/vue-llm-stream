<script setup lang="ts">
import { computed, ref } from 'vue'
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

const provider = computed(() => {
  if (preset.value === 'openai') return openaiCompatible({ apiKey: apiKey.value, model: model.value || 'gpt-4o-mini' })
  if (preset.value === 'anthropic') return anthropic({ apiKey: apiKey.value, model: model.value || 'claude-sonnet-5', maxTokens: 1024 })
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

const stream = useLlmStream({ url, provider: provider.value })
const { isPinned, scrollToBottom } = useScrollAnchor(container)

// One stream instance for the whole chat — never create a composable per
// message; this single instance drives the visible assistant bubble.
async function send() {
  const content = input.value.trim()
  if (!content || stream.isStreaming.value) return
  input.value = ''
  history.value.push({ role: 'user', content })
  const final = await stream.start(history.value)
  if (final !== undefined) {
    history.value.push({ role: 'assistant', content: final })
  } else if (stream.finishReason.value === 'aborted' && stream.text.value) {
    // Stop keeps the partial reply — the streaming bubble unmounts on abort,
    // so move what arrived into history
    history.value.push({ role: 'assistant', content: stream.text.value })
  }
}
</script>

<template>
  <main class="page">
    <header class="bar">
      <strong>vue-llm-stream</strong>
      <select v-model="preset">
        <option value="mock">Mock (no key needed)</option>
        <option value="openai">OpenAI-compatible</option>
        <option value="anthropic">Anthropic</option>
      </select>
      <template v-if="preset !== 'mock'">
        <input v-model="endpointUrl" placeholder="Endpoint URL (or leave default)" />
        <input v-model="apiKey" type="password" placeholder="API key (memory only)" />
        <input v-model="model" placeholder="Model" />
        <small v-if="preset === 'openai'">llama.cpp: run <code>llama-server -m model.gguf</code> → http://localhost:8080/v1/chat/completions</small>
      </template>
      <label v-else><input v-model="simulateError" type="checkbox" /> Simulate network error (watch auto-retry)</label>
    </header>

    <section ref="container" class="chat">
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
              <button @click="stream.regenerate()">Retry</button>
            </div>
          </template>
        </StreamMarkdown>
      </article>
    </section>

    <button v-if="!isPinned" class="to-bottom" @click="scrollToBottom">↓ New tokens</button>

    <footer class="composer">
      <input v-model="input" placeholder="Ask anything…" @keydown.enter="send" />
      <button v-if="stream.isStreaming.value" @click="stream.abort()">Stop</button>
      <button v-else @click="send">Send</button>
    </footer>
  </main>
</template>

<style>
/* minimal, timeboxed styling — flex column, chat scroll area, sticky composer */
.page { max-width: 720px; margin: 0 auto; height: 100dvh; display: flex; flex-direction: column; font-family: system-ui, sans-serif; }
.bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 12px 0; }
.chat { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 8px 0; }
.chat .user p { background: #e8f0fe; border-radius: 12px; padding: 8px 12px; margin-left: auto; max-width: 80%; }
.chat .assistant { background: #f6f6f6; border-radius: 12px; padding: 8px 12px; max-width: 95%; }
.composer { display: flex; gap: 8px; padding: 12px 0; }
.composer input { flex: 1; padding: 10px; }
.to-bottom { position: fixed; bottom: 84px; left: 50%; transform: translateX(-50%); }
.error-row { display: flex; gap: 8px; align-items: center; color: #b00020; }
pre { overflow-x: auto; border-radius: 8px; padding: 12px; }
</style>
