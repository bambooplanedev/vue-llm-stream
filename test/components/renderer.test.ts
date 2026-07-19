import { describe, expect, it } from 'vitest'
import { createMarkdownRenderer } from '../../src/components/renderer'

describe('createMarkdownRenderer', () => {
  const render = createMarkdownRenderer()

  it('renders stabilized markdown (unclosed fence becomes a code block)', () => {
    const { html, openFenceIndex } = render('# Hi\n\n```js\nconst a = 1')
    expect(html).toContain('<h1>')
    expect(html).toContain('<pre>')
    expect(openFenceIndex).not.toBeNull()
  })

  it('openFenceIndex is null for complete documents', () => {
    expect(render('```js\nx\n```\n').openFenceIndex).toBeNull()
  })

  it('never renders raw HTML', () => {
    const { html } = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img') // the tag is escaped to text, never rendered
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img')
  })

  it('does not mangle prose or code mentioning event handlers and URL schemes', () => {
    const { html } = render('Refer to the data: it shows.\n\n```js\nfetch(url, { onload: cb })\n```\n\nUse `javascript:void(0)` carefully.')
    expect(html).toContain('data:')
    expect(html).toContain('onload:')
    expect(html).toContain('javascript:void(0)')
  })

  it('refuses javascript: links', () => {
    const { html } = render('[click](javascript:alert(1))')
    expect(html).not.toContain('href="javascript:')
  })

  it('uses the highlight callback for fences and marks the open one', () => {
    const calls: Array<[string, string, boolean]> = []
    const render2 = createMarkdownRenderer((code, lang, isOpen) => {
      calls.push([code, lang, isOpen])
      return `<pre class="hl">${lang}</pre>`
    })
    const { html } = render2('```js\ndone\n```\n\n```py\nstreaming')
    expect(html).toContain('<pre class="hl">js</pre>')
    expect(calls).toEqual([
      ['done\n', 'js', false],
      ['streaming\n', 'py', true],
    ])
  })

  it('marks the real fence open when auto-closing inside a blockquote — no phantom fence', () => {
    const calls: Array<[string, string, boolean]> = []
    const render2 = createMarkdownRenderer((code, lang, isOpen) => {
      calls.push([code, lang, isOpen])
      return null
    })
    const { html } = render2('> ```js\n> const a = 1')
    expect(calls).toEqual([['const a = 1\n', 'js', true]])
    expect((html.match(/<pre/g) ?? []).length).toBe(1)
  })

  it('splits output into top-level blocks whose concatenation equals html', () => {
    const { html, blocks } = render('# Title\n\nParagraph one.\n\n- a\n- b\n\n```js\nx\n```\n')
    expect(blocks.length).toBe(4) // heading, paragraph, list, fence
    expect(blocks.join('')).toBe(html)
  })

  it('keeps earlier block strings byte-identical as the text grows (stable prefix)', () => {
    const t1 = '# Title\n\nFirst paragraph.\n\n```js\nconst a = 1\n```\n\nSecond para'
    const t2 = t1 + 'graph grows.\n\nAnd a brand-new paragraph'
    const r1 = render(t1)
    const r2 = render(t2)
    // everything before the block that changed must be reusable as-is
    expect(r2.blocks[0]).toBe(r1.blocks[0])
    expect(r2.blocks[1]).toBe(r1.blocks[1])
    expect(r2.blocks[2]).toBe(r1.blocks[2])
    expect(r2.blocks.length).toBe(r1.blocks.length + 1)
  })

  it('open fence stays correctly marked when rendered as a block', () => {
    const calls: Array<[string, boolean]> = []
    const render2 = createMarkdownRenderer((code, _lang, isOpen) => {
      calls.push([code, isOpen])
      return null
    })
    const { blocks } = render2('done text\n\n```js\nstreaming')
    expect(blocks.length).toBe(2)
    expect(calls).toEqual([['streaming\n', true]])
  })

  it('marks the real fence open when auto-closing inside a list item — no phantom fence', () => {
    const calls: Array<[string, string, boolean]> = []
    const render2 = createMarkdownRenderer((code, lang, isOpen) => {
      calls.push([code, lang, isOpen])
      return null
    })
    const { html } = render2('- item\n  ```js\n  const a = 1')
    expect(calls).toEqual([['const a = 1\n', 'js', true]])
    expect((html.match(/<pre/g) ?? []).length).toBe(1)
  })
})
