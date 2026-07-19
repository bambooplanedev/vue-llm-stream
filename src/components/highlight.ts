import type { Highlighter } from 'shiki'
import type { HighlightFence } from './renderer.js'

// one dynamic import shared by every entry — the module is a single resource,
// and per-entry imports would kick off duplicate loads
let shikiImport: Promise<typeof import('shiki')> | null = null
const loadShiki = () => (shikiImport ??= import('shiki'))

const DEFAULT_LANGS = ['javascript', 'typescript', 'python', 'json', 'bash', 'html', 'css', 'markdown', 'vue']
const DEFAULT_THEMES = { light: 'github-light', dark: 'github-dark' }
const CACHE_LIMIT = 50

export interface ShikiHighlightOptions {
  /** Single fixed theme. Takes precedence over `themes` when set. */
  theme?: string
  /**
   * Light/dark theme pair rendered as CSS variables that follow the color
   * scheme (default: github-light / github-dark, matching theme.css).
   */
  themes?: { light: string; dark: string }
  langs?: string[]
  /** Called once when the lazy highlighter finishes loading — re-render then. */
  onReady?: () => void
}

interface SharedHighlighter {
  highlighter: Highlighter | null
  ready: Promise<void>
  cache: Map<string, string>
}

// one highlighter + memo cache per (themes, langs) tuple — Shiki instances hold
// compiled grammars, so every component with the same config must share one
const shared = new Map<string, SharedHighlighter>()

function getShared(key: string, themeList: string[], langs: string[]): SharedHighlighter {
  let entry = shared.get(key)
  if (!entry) {
    const e: SharedHighlighter = { highlighter: null, ready: Promise.resolve(), cache: new Map() }
    e.ready = loadShiki()
      .then(({ createHighlighter }) => createHighlighter({ themes: themeList, langs }))
      .then((h) => { e.highlighter = h })
      .catch(() => { /* shiki unavailable — plain <pre> fallback remains */ })
    shared.set(key, e)
    entry = e
  }
  return entry
}

export function createShikiHighlight(options: ShikiHighlightOptions): HighlightFence {
  const single = options.theme
  const dual = single ? null : options.themes ?? DEFAULT_THEMES
  const themeList = single ? [single] : [dual!.light, dual!.dark]
  const langs = options.langs ?? DEFAULT_LANGS
  const key = `${single ? 's' : 'd'}:${themeList.join(',')}:${[...langs].sort().join(',')}`
  const entry = getShared(key, themeList, langs)
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
    const cacheKey = `${resolved}:${code}`
    if (!isOpen) {
      const cached = cache.get(cacheKey)
      if (cached !== undefined) {
        cache.delete(cacheKey)
        cache.set(cacheKey, cached) // LRU touch
        return cached
      }
    }
    const html = single
      ? highlighter.codeToHtml(code, { lang: resolved, theme: single })
      : highlighter.codeToHtml(code, { lang: resolved, themes: dual!, defaultColor: false })
    if (!isOpen) {
      cache.set(cacheKey, html)
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    }
    return html
  }
}
