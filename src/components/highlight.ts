import { createHighlighter, type Highlighter } from 'shiki'
import type { HighlightFence } from './renderer.js'

const DEFAULT_LANGS = ['javascript', 'typescript', 'python', 'json', 'bash', 'html', 'css', 'markdown', 'vue']
const CACHE_LIMIT = 50

export interface ShikiHighlightOptions {
  theme?: string
  langs?: string[]
  /** Called once when the lazy highlighter finishes loading — re-render then. */
  onReady?: () => void
}

interface SharedHighlighter {
  highlighter: Highlighter | null
  ready: Promise<void>
  cache: Map<string, string>
}

// one highlighter + memo cache per (theme, langs) tuple — Shiki instances hold
// compiled grammars, so every component with the same config must share one
const shared = new Map<string, SharedHighlighter>()

function getShared(theme: string, langs: string[]): SharedHighlighter {
  const key = `${theme}\u0000${[...langs].sort().join(',')}`
  let entry = shared.get(key)
  if (!entry) {
    const e: SharedHighlighter = { highlighter: null, ready: Promise.resolve(), cache: new Map() }
    e.ready = createHighlighter({ themes: [theme], langs })
      .then((h) => { e.highlighter = h })
      .catch(() => { /* highlighter unavailable — plain <pre> fallback remains */ })
    shared.set(key, e)
    entry = e
  }
  return entry
}

export function createShikiHighlight(options: ShikiHighlightOptions): HighlightFence {
  const theme = options.theme ?? 'github-dark'
  const entry = getShared(theme, options.langs ?? DEFAULT_LANGS)
  const onReady = options.onReady
  if (onReady) {
    // fan-out: every instance gets its own ready callback; if the shared
    // highlighter already loaded this fires on the next microtask
    entry.ready.then(() => { if (entry.highlighter) onReady() })
  }
  const cache = entry.cache

  return (code, lang, isOpen) => {
    const highlighter = entry.highlighter
    if (!highlighter) return null
    const resolved = highlighter.getLoadedLanguages().includes(lang) ? lang : 'text'
    const key = `${resolved}:${code}`
    if (!isOpen) {
      const cached = cache.get(key)
      if (cached !== undefined) {
        cache.delete(key)
        cache.set(key, cached) // LRU touch
        return cached
      }
    }
    const html = highlighter.codeToHtml(code, { lang: resolved, theme })
    if (!isOpen) {
      cache.set(key, html)
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    }
    return html
  }
}
