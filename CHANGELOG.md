# Changelog

## 0.2.0

### Breaking

- `RetryOptions.attempts` is renamed to `retries`. The value always counted retries after the initial request; the name now says so. Migration: `retry: { attempts: 2 }` → `retry: { retries: 2 }`.
- `LlmProvider.buildRequest` must return `body: Record<string, unknown>` (was `unknown`). Non-object bodies were silently corrupted by the body merge; they are now a compile-time error for adapter authors.
- Default code-block highlighting is now a light/dark pair (`github-light`/`github-dark`) rendered as CSS variables that follow the color scheme, replacing the fixed `github-dark`. Pass `:highlight="{ theme: 'github-dark' }"` to restore the previous look. The dual-theme colors require `vue-llm-stream/theme.css` or equivalent CSS handling of the `--shiki-light`/`--shiki-dark` variables; pass a single `theme` to keep inline-styled output.

### Fixed

- Shiki is loaded with a dynamic import: the optional peer dependency is truly optional, and `highlight: false` never loads or bundles it.
- The `highlight` prop is reactive — changing it after mount rebuilds the highlighter.
- OpenAI-compatible backends that report failures as a `{"error": …}` data frame now surface the server's message instead of a generic `incomplete` error.
- A connection dropped mid-frame is reported as `{ kind: 'incomplete' }` instead of a misleading `parse` error.
- `Retry-After` is honored on 5xx responses, not only 429.
- `useScrollAnchor` no longer re-pins a user who has scrolled up when streamed content briefly shrinks or the window resizes.
- The markdown stabilizer respects backslash escapes (`2 \* 3` no longer flashes italics mid-stream).

### Added

- `UseLlmStreamReturn` exported interface.
- `ShikiHighlightOptions.themes` — light/dark dual-theme rendering.
- `useScrollAnchor` accepts `Ref<HTMLElement | null | undefined>` (the idiomatic `ref<HTMLElement>()`).
- `default` export condition and a `./package.json` export for broader tooling compatibility.
- Release workflow publishing with npm provenance; the playground deploy now waits for green CI.

## 0.1.0

Initial release.

- `useLlmStream` — SSE streaming with abort, pre-first-token auto-retry (exponential backoff, Retry-After), truncation detection, generation-guarded concurrency.
- Providers: `anthropic`, `openaiCompatible` (OpenAI, llama.cpp server, Ollama), `mock`.
- `StreamMarkdown` — token-by-token markdown with auto-closed fences, Shiki highlighting in unclosed code blocks, rAF-throttled rendering.
- `useScrollAnchor` — stick-to-bottom with user-intent detach.
