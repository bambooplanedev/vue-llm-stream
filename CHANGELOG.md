# Changelog

## 0.1.0

Initial release.

- `useLlmStream` — SSE streaming with abort, pre-first-token auto-retry (exponential backoff, Retry-After), truncation detection, generation-guarded concurrency.
- Providers: `anthropic`, `openaiCompatible` (OpenAI, llama.cpp server, Ollama), `mock`.
- `StreamMarkdown` — token-by-token markdown with auto-closed fences, Shiki highlighting in unclosed code blocks, rAF-throttled rendering.
- `useScrollAnchor` — stick-to-bottom with user-intent detach.
