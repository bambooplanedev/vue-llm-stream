/** Canned assistant reply exercising every rendering feature. */
export const DEMO_REPLY = `## Streaming demo

This reply is **generated locally** by the mock provider — no API key involved.

### A table, streamed row by row

| Feature | Status |
| --- | --- |
| SSE parsing | done |
| Auto-retry | done |
| Scroll anchoring | done |

### Code, highlighted while the fence is still open

\`\`\`typescript
export function greet(name: string): string {
  // Shiki colorizes this block before the closing fence arrives
  return \`Hello, \${name}!\`
}
\`\`\`

1. Nested lists work
   - even the *inner* ones
2. And \`inline code\` too

That's the whole tour — press **Simulate error** to watch auto-retry.`
