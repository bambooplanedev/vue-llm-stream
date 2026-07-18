import { describe, expect, it } from 'vitest'
import { stabilizeMarkdown } from '../../../src/core/markdown/stabilize'

const out = (s: string) => stabilizeMarkdown(s).text

describe('stabilizeMarkdown — inline', () => {
  it('closes an open bold span', () => {
    expect(out('This is **important stu')).toBe('This is **important stu**')
  })

  it('closes an open italic span', () => {
    expect(out('some *emphasi')).toBe('some *emphasi*')
  })

  it('closes an open inline code span', () => {
    expect(out('call `fetch(')).toBe('call `fetch(`')
  })

  it('does NOT close a space-surrounded asterisk (3 * 4)', () => {
    expect(out('3 * 4 = 12')).toBe('3 * 4 = 12')
  })

  it('does NOT touch ** inside an inline code span (`**kwargs`)', () => {
    expect(out('use `**kwargs` here')).toBe('use `**kwargs` here')
  })

  it('does NOT touch markers inside a fenced code block', () => {
    const doc = '```python\ndef f(**kwargs):\n    pass\n```\n'
    expect(out(doc)).toBe(doc)
  })

  it('does not close emphasis left open in an earlier, completed paragraph', () => {
    expect(out('broken **para\n\nnew text')).toBe('broken **para\n\nnew text')
  })

  it('appends no inline closers while a fence is open', () => {
    expect(out('**bold intro\n\n```js\ncode')).toBe('**bold intro\n\n```js\ncode\n```')
  })

  it('matched pairs need no closers', () => {
    expect(out('a **b** and `c` done')).toBe('a **b** and `c` done')
  })

  it('a bare trailing ** (nothing after it) is left alone', () => {
    expect(out('text **')).toBe('text **')
  })

  it('does not close intraword underscores (api_key)', () => {
    expect(out('The api_key variable is set')).toBe('The api_key variable is set')
    expect(out('call file_name.py now')).toBe('call file_name.py now')
  })

  it('still closes genuine underscore emphasis', () => {
    expect(out('some _emphasi')).toBe('some _emphasi_')
  })
})
