import { describe, expect, it } from 'vitest'
import { stabilizeMarkdown } from '../../../src/core/markdown/stabilize'

describe('stabilizeMarkdown — fences', () => {
  it('leaves complete documents untouched', () => {
    const doc = 'Hello\n\n```js\nconst a = 1\n```\n\nBye\n'
    expect(stabilizeMarkdown(doc)).toEqual({ text: doc, autoClosedFence: false })
  })

  it('closes an unclosed backtick fence', () => {
    expect(stabilizeMarkdown('```python\nprint(1)')).toEqual({
      text: '```python\nprint(1)\n```', autoClosedFence: true,
    })
  })

  it('closes an unclosed tilde fence with matching length', () => {
    expect(stabilizeMarkdown('~~~~\ncode')).toEqual({ text: '~~~~\ncode\n~~~~', autoClosedFence: true })
  })

  it('does not treat a longer closing fence as a new opener', () => {
    const doc = '````\ncode with ``` inside\n````\n'
    expect(stabilizeMarkdown(doc).autoClosedFence).toBe(false)
  })

  it('tracks fences inside blockquotes', () => {
    expect(stabilizeMarkdown('> ```\n> code').autoClosedFence).toBe(true)
  })

  it('tracks fences inside list items', () => {
    expect(stabilizeMarkdown('- item\n  ```js\n  x').autoClosedFence).toBe(true)
  })

  it('holds back a partial trailing fence line (` or ``)', () => {
    expect(stabilizeMarkdown('text\n``').text).toBe('text')
    expect(stabilizeMarkdown('text\n`').text).toBe('text')
  })

  it('does not hold back a complete trailing line ending in backticks', () => {
    expect(stabilizeMarkdown('use `x`').text).toBe('use `x`')
  })

  it('tracks fences in CRLF documents', () => {
    expect(stabilizeMarkdown('```js\r\ncode').autoClosedFence).toBe(true)
    const complete = '```js\r\nx\r\n```\r\n'
    expect(stabilizeMarkdown(complete)).toEqual({ text: complete, autoClosedFence: false })
  })

  it('leaves indented code blocks untouched', () => {
    const doc = '    code line\n    ```\n    still code\n'
    expect(stabilizeMarkdown(doc)).toEqual({ text: doc, autoClosedFence: false })
  })
})
