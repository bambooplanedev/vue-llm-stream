import MarkdownIt from 'markdown-it'
import { stabilizeMarkdown } from '../core/markdown/stabilize.js'

export interface RenderResult {
  html: string
  /**
   * HTML of each top-level block, in order; `blocks.join('') === html`.
   * During streaming, settled entries almost always stay byte-identical
   * between frames so their DOM can be left untouched. The exception is
   * document-wide context arriving late (e.g. a reference-link definition
   * that resolves a link used blocks earlier) — the affected entry changes
   * and must be re-applied, which per-block diffing handles naturally.
   */
  blocks: string[]
  /** Token index of the still-streaming (auto-closed) fence, or null. */
  openFenceIndex: number | null
}

export type HighlightFence = (code: string, lang: string, isOpen: boolean) => string | null

export function createMarkdownRenderer(highlightFence?: HighlightFence) {
  // html: false is non-negotiable — LLM output is attacker-influenced
  const md = new MarkdownIt({ html: false, linkify: true })

  if (highlightFence) {
    md.renderer.rules.fence = (tokenList, idx) => {
      const token = tokenList[idx]!
      const lang = token.info.trim().split(/\s+/)[0] ?? ''
      // the open fence is flagged on the token itself — blocks are rendered
      // separately, so an absolute token index cannot identify it here
      const highlighted = highlightFence(token.content, lang, token.meta?.vlsOpenFence === true)
      if (highlighted !== null) return highlighted
      return `<pre><code>${md.utils.escapeHtml(token.content)}</code></pre>\n`
    }
  }

  return function render(rawText: string): RenderResult {
    const { text, autoClosedFence } = stabilizeMarkdown(rawText)
    const tokens = md.parse(text, {})
    let lastFenceIndex = -1
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i]!.type === 'fence') lastFenceIndex = i
    }
    const openFenceIndex = autoClosedFence && lastFenceIndex >= 0 ? lastFenceIndex : null
    if (openFenceIndex !== null) {
      const token = tokens[openFenceIndex]!
      token.meta = { ...token.meta, vlsOpenFence: true }
    }

    // split into top-level blocks: a block is a run of tokens from nesting
    // depth 0 back to depth 0 (heading_open…heading_close, a fence, a whole
    // list). Rendering per block keeps settled blocks byte-identical across
    // frames so callers can skip their DOM entirely.
    const blocks: string[] = []
    let start = 0
    let depth = 0
    for (let i = 0; i < tokens.length; i++) {
      depth += tokens[i]!.nesting
      if (depth === 0) {
        blocks.push(md.renderer.render(tokens.slice(start, i + 1), md.options, {}))
        start = i + 1
      }
    }
    if (start < tokens.length) blocks.push(md.renderer.render(tokens.slice(start), md.options, {}))

    return { html: blocks.join(''), blocks, openFenceIndex }
  }
}
