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

export function createShikiHighlight(options: ShikiHighlightOptions): HighlightFence {
  const theme = options.theme ?? 'github-dark'
  let highlighter: Highlighter | null = null
  const cache = new Map<string, string>()

  createHighlighter({ themes: [theme], langs: options.langs ?? DEFAULT_LANGS })
    .then((h) => {
      highlighter = h
      options.onReady?.()
    })
    .catch(() => { /* highlighter unavailable — plain <pre> fallback remains */ })

  return (code, lang, isOpen) => {
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
