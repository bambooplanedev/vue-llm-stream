import MarkdownIt from 'markdown-it'
import { stabilizeMarkdown } from '../core/markdown/stabilize.js'

export interface RenderResult {
  html: string
  /** Token index of the still-streaming (auto-closed) fence, or null. */
  openFenceIndex: number | null
}

export type HighlightFence = (code: string, lang: string, isOpen: boolean) => string | null

export function createMarkdownRenderer(highlightFence?: HighlightFence) {
  // html: false is non-negotiable — LLM output is attacker-influenced
  const md = new MarkdownIt({ html: false, linkify: true })

  return function render(rawText: string): RenderResult {
    const { text, autoClosedFence } = stabilizeMarkdown(rawText)
    const tokens = md.parse(text, {})
    let lastFenceIndex = -1
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i]!.type === 'fence') lastFenceIndex = i
    }
    const openFenceIndex = autoClosedFence && lastFenceIndex >= 0 ? lastFenceIndex : null

    if (highlightFence) {
      md.renderer.rules.fence = (tokenList, idx, opts, _env, self) => {
        const token = tokenList[idx]!
        const lang = token.info.trim().split(/\s+/)[0] ?? ''
        const highlighted = highlightFence(token.content, lang, idx === openFenceIndex)
        if (highlighted !== null) return highlighted
        return `<pre><code>${md.utils.escapeHtml(token.content)}</code></pre>\n`
      }
    }

    return { html: md.renderer.render(tokens, md.options, {}), openFenceIndex }
  }
}
