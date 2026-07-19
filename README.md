# vue-llm-stream

*Streaming LLM responses for Vue 3 — SSE parsing, resilient retries, and token-by-token markdown rendering with live syntax highlighting.*

[![npm version](https://img.shields.io/npm/v/vue-llm-stream.svg)](https://www.npmjs.com/package/vue-llm-stream)
[![bundle size](https://deno.bundlejs.com/badge?q=vue-llm-stream)](https://bundlejs.com/?q=vue-llm-stream)
[![CI](https://github.com/bambooplanedev/vue-llm-stream/actions/workflows/ci.yml/badge.svg)](https://github.com/bambooplanedev/vue-llm-stream/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vue-llm-stream.svg)](LICENSE)

<!-- provenance badge appears here after the first `npm publish` -->

<!-- ![demo](docs/demo.gif) -->

<!-- GIF is recorded from playground/ running the mock provider (simulate-error checkbox on, to show auto-retry). This is a manual capture step — do not fabricate the file. Uncomment the image line above once docs/demo.gif exists. -->

[Live playground](https://bambooplanedev.github.io/vue-llm-stream/)

## What is vue-llm-stream?

Piping an SSE response straight into innerHTML and re-parsing the whole thing on every token works, until a code fence lands half-open mid-frame, or the connection drops and the empty response looks like a normal answer instead of a failure. `vue-llm-stream` packages the three parts of a streaming chat UI that are easy to get wrong on your own: an incremental SSE transport that treats a truncated stream as an error, a retry layer that knows the difference between "resend the request" and "silently eat a broken answer," and a markdown renderer that keeps still-open fences and emphasis visually stable while more text arrives. Bring your own endpoint — Anthropic, OpenAI-compatible, llama.cpp, Ollama, or a mock for tests — and get a `text` ref, a `status`, and a `<StreamMarkdown>` component that renders it.

## Features

- Provider-agnostic: ships adapters for Anthropic, OpenAI-compatible APIs (OpenAI, llama.cpp, Ollama), and a `mock` provider for tests and demos.
- Spec-compliant incremental SSE parser — handles frames split across chunk boundaries.
- Truncation detection: a connection that closes without a terminal event is surfaced as `{ kind: 'incomplete' }`, not a finished answer.
- Markdown stabilization while streaming — auto-closes dangling code fences, balances emphasis (`*`/`_`/`` ` ``), and drops mid-cell table rows so the DOM never flashes broken markup.
- Shiki highlighting inside still-open code blocks, lazy-loaded on first render and memoized per closed block.
- Abort support plus pre-first-token auto-retry with exponential backoff and `Retry-After` handling.
- `useScrollAnchor` — pins a chat log to the bottom while it grows, releases on user scroll.
- Fully typed, ESM-only, zero runtime dependencies in the core.

<details>
<summary><strong>Table of contents</strong></summary>

- [Install](#install)
- [Quick start](#quick-start)
- [Providers](#providers)
  - [Anthropic](#anthropic)
  - [OpenAI-compatible](#openai-compatible)
  - [Mock](#mock)
  - [Writing a custom adapter](#writing-a-custom-adapter)
- [API reference](#api-reference)
- [Theming](#theming)
- [Streaming markdown: how stabilization works](#streaming-markdown-how-stabilization-works)
- [Error handling & retries](#error-handling--retries)
- [Recipes](#recipes)
  - [Build a chat](#build-a-chat)
  - [Custom rendering](#custom-rendering)
- [FAQ](#faq)
- [Development](#development)
- [License](#license)

</details>

## Install

```bash
npm i vue-llm-stream markdown-it shiki
```

`markdown-it` and `shiki` are peer dependencies used only by the `vue-llm-stream/markdown` subpath. If you're rendering plain text or wiring up your own renderer, the headless install is enough:

```bash
npm i vue-llm-stream
```

## Quick start

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useLlmStream } from 'vue-llm-stream'
import { mock } from 'vue-llm-stream/providers'
import { StreamMarkdown } from 'vue-llm-stream/markdown'

const stream = useLlmStream({
  url: 'mock://demo',
  provider: mock({
    text: '# Hello\n\nThis is **streamed markdown**, rendered token by token.',
    tokensPerSec: 40,
  }),
})

// start() opens a fetch stream — keep it out of SSR render
onMounted(() => stream.start('Say hello'))
</script>

<template>
  <StreamMarkdown :text="stream.text.value" :status="stream.status.value" />
  <button v-if="stream.isStreaming.value" @click="stream.abort()">Stop</button>
</template>
```

No API key, no network call — the `mock` provider streams the given text at a configurable rate. Swap it for `anthropic` or `openaiCompatible` below once you're pointing at a real endpoint.

## Providers

### Anthropic

```ts
import { anthropic } from 'vue-llm-stream/providers'

const provider = anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  model: 'claude-sonnet-5',
  maxTokens: 1024, // required by the Anthropic API — omitting it is a 400
})
```

`anthropic` sets `anthropic-dangerous-direct-browser-access: true` so the example above works straight from the browser. That header is a development convenience — production traffic belongs behind your own endpoint that holds the real API key and forwards the request in the same format.

### OpenAI-compatible

Works with OpenAI, llama.cpp's server, and Ollama — anything that speaks the `/v1/chat/completions` SSE format.

```ts
import { openaiCompatible } from 'vue-llm-stream/providers'

const provider = openaiCompatible({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  model: 'gpt-4o-mini',
})
```

llama.cpp: run `llama-server -m model.gguf`, then point `url` at `http://localhost:8080/v1/chat/completions` with `openaiCompatible({ model: 'model.gguf' })` (no `apiKey` needed for a local server).

Ollama: `ollama serve` exposes the same shape at `http://localhost:11434/v1/chat/completions` — use the pulled model's tag as `model`.

### Mock

```ts
import { mock } from 'vue-llm-stream/providers'

const provider = mock({
  text: 'Full reply text, split into tokens automatically.',
  tokensPerSec: 40,
  failure: { kind: 'http', status: 503 }, // or { kind: 'midStreamError' } / { kind: 'truncate', afterTokens: 5 }
  failOnce: true, // fail only the first request — demonstrates auto-retry
})
```

Use it for demos, Storybook, and tests that shouldn't hit a real API.

### Writing a custom adapter

Any provider is a plain object matching `LlmProvider`:

```ts
interface LlmProvider {
  buildRequest(ctx: { messages: ChatMessage[] }): { body: unknown; headers: Record<string, string> }
  createEventParser(): (frame: SseFrame) => StreamEvent[]
  /** Optional fetch override — used by the mock provider to avoid the network. */
  fetch?: typeof globalThis.fetch
}
```

`buildRequest` shapes the outgoing request; `createEventParser` returns a per-request closure that turns each parsed SSE frame into zero or more `StreamEvent`s (`text-delta`, `reasoning-delta`, `done`, `error`). The closure closes over per-stream state (usage totals, finish reason) so it must be created fresh for every call.

## API reference

### `useLlmStream(options)`

| Option | Type | Notes |
| --- | --- | --- |
| `url` | `MaybeRefOrGetter<string>` | Reactive — can change between calls. |
| `provider` | `MaybeRefOrGetter<LlmProvider>` | Reactive — resolved fresh at each `start()` and retry attempt. See [Providers](#providers). |
| `headers?` | `MaybeRefOrGetter<Record<string, string> \| undefined>` | Merged over the provider's headers. |
| `body?` | `MaybeRefOrGetter<Record<string, unknown> \| undefined>` | Merged over the provider's body. |
| `fetch?` | `typeof globalThis.fetch` | Override for testing or custom transports. |
| `retry?` | `RetryOptions \| false` | `{ attempts?: number; baseDelayMs?: number }`, default `{ attempts: 2, baseDelayMs: 500 }`. `false` disables retries. |
| `abortOnUnmount?` | `boolean` | Default `true` — aborts the in-flight request when the component scope is disposed. |
| `onDelta?` | `(text: string) => void` | Called per text delta. |
| `onDone?` | `(text: string) => void` | Called once, with the final text. |
| `onError?` | `(error: LlmStreamError) => void` | Called once, on terminal failure. |

| Return | Type | Notes |
| --- | --- | --- |
| `text` | `Ref<string>` | Accumulated response text. |
| `reasoning` | `Ref<string>` | Accumulated reasoning/thinking text, if the provider emits it. |
| `status` | `Ref<'idle' \| 'submitted' \| 'streaming' \| 'done' \| 'error'>` | |
| `isStreaming` | `ComputedRef<boolean>` | `true` for `'submitted'` and `'streaming'`. |
| `finishReason` | `Ref<'stop' \| 'max_tokens' \| 'aborted' \| 'unknown' \| null>` | |
| `error` | `Ref<LlmStreamError \| null>` | See [Error handling & retries](#error-handling--retries). |
| `usage` | `Ref<Usage \| null>` | `{ inputTokens?: number; outputTokens?: number }`. |
| `retryCount` | `Ref<number>` | Number of retry attempts made for the current call. |
| `start` | `(input: string \| ChatMessage[], opts?: PerCallOptions) => Promise<string \| undefined>` | Resolves with the final text, or `undefined` on abort/error. |
| `abort` | `() => void` | Aborts the current call. |
| `regenerate` | `() => Promise<string \| undefined>` | Re-runs `start` with the last input and last per-call options. |

### `<StreamMarkdown>`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `text` | `string` | — | Raw markdown, typically `stream.text.value`. |
| `status?` | `LlmStreamStatus` | `'idle'` | Drives the `#loading`/`#error` slots and forces a flush on `'done'`/`'error'`. |
| `highlight?` | `Omit<ShikiHighlightOptions, 'onReady'> \| false` | `{}` | `{ theme?: string; langs?: string[] }`. `false` disables Shiki (plain `<pre><code>`). |

| Slot | Rendered when |
| --- | --- |
| `#loading` | `status === 'submitted'` and no text has arrived yet. |
| `#error` | `status === 'error'` (rendered alongside whatever text already arrived). |

When rendering a live stream, always pass `status` — the `'done'`/`'error'` transition flushes the final frame synchronously, which otherwise waits for the next animation frame (and, in a hidden tab, for the next refocus).

### `useScrollAnchor(container, options?)`

| Argument | Type | Default | Notes |
| --- | --- | --- | --- |
| `container` | `Ref<HTMLElement \| null>` | — | First positional argument: the scrollable element. |
| `options.threshold?` | `number` | `40` | Distance from the bottom (px) still counted as "at bottom". |

| Return | Type | Notes |
| --- | --- | --- |
| `isPinned` | `Ref<boolean>` | `true` while auto-scroll is active. |
| `scrollToBottom` | `() => void` | Scrolls to the bottom and re-pins. |

## Theming

`<StreamMarkdown>` ships unstyled by default. The default theme is an opt-in stylesheet:

```ts
import 'vue-llm-stream/theme.css'
```

It styles everything the renderer can emit — headings, lists, tables, blockquotes, inline code, and code blocks — and follows the system color scheme. Force a scheme with a class on the component or any ancestor:

```html
<StreamMarkdown class="vls-dark" :text="text" :status="status" />
```

If the component sits on a surface with a fixed background (a light chat bubble, say), force the matching scheme — otherwise a dark-mode OS gets light text on your light surface.

Every visual decision is a CSS custom property, so a custom theme is a stylesheet that re-declares variables — no JavaScript involved:

```css
/* my-theme.css — loaded after vue-llm-stream/theme.css */
.vls-stream-markdown {
  --vls-link: #7c3aed;
  --vls-code-bg: #16161e;
  --vls-radius: 12px;
  --vls-mono: 'JetBrains Mono', monospace;
}
```

| Variable | Controls |
| --- | --- |
| `--vls-fg` / `--vls-muted` | Body and secondary text color. |
| `--vls-link` | Link color. |
| `--vls-border` | Table and rule borders. |
| `--vls-code-bg` / `--vls-code-fg` | Code-block background and text (pre-highlight and plain fallback; Shiki paints its own colors once loaded). |
| `--vls-inline-code-bg` | Inline `code` chip background. |
| `--vls-blockquote-border` | Blockquote accent. |
| `--vls-table-header-bg` | Table header background. |
| `--vls-radius` | Code-block corner radius. |
| `--vls-font` / `--vls-mono` / `--vls-font-size` / `--vls-line-height` | Typography. |
| `--vls-block-gap` | Vertical rhythm between blocks. |

The code inside fences is colored by Shiki, configured separately via the `highlight` prop (`:highlight="{ theme: 'vitesse-dark' }"`) — pick a Shiki theme that matches your CSS theme. All selectors are scoped under `.vls-` classes, so importing the theme never restyles the host app.

## Streaming markdown: how stabilization works

Markdown is re-parsed from the accumulated text on every frame, but the raw, partial text is never handed to `markdown-it` directly. A stabilization pass runs first and rewrites the tail so it always parses as complete markdown.

Before (raw, mid-stream):

````
Here's the fix:

```js
function greet(name) {
  return `Hi, ${name}`
````

After (stabilized for this frame's render — a closing fence is appended, and the renderer marks this fence as "open" so Shiki still highlights it):

````
Here's the fix:

```js
function greet(name) {
  return `Hi, ${name}`
```
````

The same pass balances unterminated `*`/`_`/`` ` `` runs and drops a table row that's still mid-cell, so a half-typed `**bold` or a row ending in `| 4` never renders as broken markup for a frame or two before the next token arrives.

**Known limitations:** setext headings (`Title\n===`) aren't detected as still-forming; reference-style links (`[text][ref]`) split across their inline and definition halves can render incorrectly until both halves have arrived; and exotic nesting (tables inside lists inside blockquotes, several levels deep) can confuse the fence/table tracker.

**Scaling note:** v1.0 re-parses the full accumulated text on every frame, with highlighting memoized per closed code block. That's fine well past typical chat-message lengths, but the documented path for very long streams is block-level stabilization — freeze blocks once they're provably closed and re-parse only the active tail. It's deferred because closure detection across tables and nested lists, not the re-parse cost itself, is where the current bugs live; solving that properly is a prerequisite for block freezing, not an incremental change on top of it.

## Error handling & retries

- Retries only on network errors, HTTP 5xx, and HTTP 429 — nothing else is treated as transient.
- Never retries once a token has been received: a stream that breaks mid-response can't be resumed, so it surfaces as `error.value = { kind: 'incomplete' }` with whatever text already arrived kept in `text.value`.
- Never retries after a user-initiated `abort()` — that always resolves as `finishReason.value === 'aborted'`, not an error.
- A 429 with a `Retry-After` header (seconds or HTTP-date) is honored up to a 10s clamp; anything longer is treated as non-retryable.
- Without a server-provided delay, backoff is exponential from `retry.baseDelayMs` (default 500ms, equal jitter — each delay lands between 50% and 100% of the exponential step), for `retry.attempts` attempts (default 2).
- `regenerate()` restarts the whole call from scratch with the last input — it is not part of the retry loop and has its own fresh attempt budget.

## Recipes

### Build a chat

```ts
const history = ref<ChatMessage[]>([])
const stream = useLlmStream({ url, provider })

async function send(content: string) {
  if (!content || stream.isStreaming.value) return
  history.value.push({ role: 'user', content })
  const final = await stream.start(history.value)
  if (final !== undefined) {
    history.value.push({ role: 'assistant', content: final })
  } else if (stream.finishReason.value === 'aborted' && stream.text.value) {
    // Stop keeps the partial reply: the streaming bubble unmounts on abort,
    // so move what arrived into history instead of dropping it.
    history.value.push({ role: 'assistant', content: stream.text.value })
  }
}
```

One `useLlmStream` instance drives the whole conversation — don't create a new one per message. Pass the entire `history` array to `start()` each time; it becomes the request's `messages`.

### Custom rendering

```vue
<StreamMarkdown :text="stream.text.value" :status="stream.status.value" :highlight="false">
  <template #loading>
    <em>{{ stream.retryCount.value > 0 ? `retrying… (attempt ${stream.retryCount.value})` : 'connecting…' }}</em>
  </template>
  <template #error>
    <button @click="stream.regenerate()">Retry</button>
  </template>
</StreamMarkdown>
```

`highlight: false` skips loading Shiki entirely and falls back to plain `<pre><code>` — useful when you already highlight elsewhere, or don't need it.

## FAQ

**Why not the Vercel AI SDK?** This is a Vue-native rendering and transport layer for your own endpoints — no framework lock-in, no assumption you're using a particular backend or hosting provider. Bring any SSE-compatible API.

**Bundle size?** The core (`useLlmStream`, `useScrollAnchor`) has zero runtime dependencies. Shiki and markdown-it are only pulled in if you import `vue-llm-stream/markdown`, and Shiki loads lazily on first render.

**SSR / Nuxt?** All state is plain Vue refs, so components render fine on the server. `start()` calls `fetch` and reads a stream — it's client-only; call it from `onMounted` or a user interaction, not during SSR render.

## Development

```bash
npm install
npm run test
npm run play
```

## License

MIT © [bambooplanedev](https://github.com/bambooplanedev) — see [LICENSE](LICENSE).
