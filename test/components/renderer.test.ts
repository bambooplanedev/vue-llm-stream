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
})
