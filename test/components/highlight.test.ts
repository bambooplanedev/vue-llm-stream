import { beforeEach, describe, expect, it, vi } from 'vitest'

const codeToHtml = vi.fn((code: string) => `<pre class="shiki">${code}</pre>`)
vi.mock('shiki', () => ({
  createHighlighter: vi.fn(async () => ({
    codeToHtml,
    getLoadedLanguages: () => ['javascript', 'python'],
  })),
}))

import { createShikiHighlight } from '../../src/components/highlight'

describe('createShikiHighlight', () => {
  beforeEach(() => codeToHtml.mockClear())

  it('returns null before ready, then highlights after onReady', async () => {
    let ready = false
    const hl = createShikiHighlight({ onReady: () => { ready = true } })
    expect(hl('x', 'javascript', false)).toBeNull()
    await vi.waitFor(() => expect(ready).toBe(true))
    expect(hl('x', 'javascript', false)).toContain('shiki')
  })

  it('falls back to text for unknown or partial languages', async () => {
    const hl = createShikiHighlight({})
    await vi.waitFor(() => expect(hl('x', 'javascript', false)).not.toBeNull())
    hl('x', 'pyt', false) // partial lang name mid-stream
    expect(codeToHtml).toHaveBeenLastCalledWith('x', expect.objectContaining({ lang: 'text' }))
  })

  it('memoizes closed fences, never open ones', async () => {
    const hl = createShikiHighlight({})
    await vi.waitFor(() => expect(hl('a', 'javascript', false)).not.toBeNull())
    codeToHtml.mockClear()
    hl('const x = 1', 'javascript', true)
    hl('const x = 1', 'javascript', true)
    expect(codeToHtml).toHaveBeenCalledTimes(2) // open fence: no cache
    codeToHtml.mockClear()
    hl('const x = 1', 'javascript', false)
    hl('const x = 1', 'javascript', false)
    expect(codeToHtml).toHaveBeenCalledTimes(1) // closed fence: cached
  })

  it('LRU evicts beyond 50 entries', async () => {
    const hl = createShikiHighlight({})
    await vi.waitFor(() => expect(hl('warm', 'javascript', false)).not.toBeNull())
    codeToHtml.mockClear()
    for (let i = 0; i < 51; i++) hl(`code ${i}`, 'javascript', false)
    codeToHtml.mockClear()
    hl('code 0', 'javascript', false) // evicted → re-highlighted
    expect(codeToHtml).toHaveBeenCalledTimes(1)
  })
})
