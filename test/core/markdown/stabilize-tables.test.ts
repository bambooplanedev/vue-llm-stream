import { describe, expect, it } from 'vitest'
import { stabilizeMarkdown } from '../../../src/core/markdown/stabilize'

const out = (s: string) => stabilizeMarkdown(s).text

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |'

describe('stabilizeMarkdown — tables', () => {
  it('keeps a complete table untouched', () => {
    expect(out(TABLE)).toBe(TABLE)
  })

  it('trims a trailing mid-cell row', () => {
    expect(out(TABLE + '\n| 3 | par')).toBe(TABLE)
  })

  it('keeps a trailing completed row', () => {
    expect(out(TABLE + '\n| 3 | 4 |')).toBe(TABLE + '\n| 3 | 4 |')
  })

  it('does not trim outside table context (a | in prose)', () => {
    expect(out('a | b in prose')).toBe('a | b in prose')
  })

  it('does not trim inside a code fence', () => {
    const doc = '```\n| not | a table\n```\n'
    expect(out(doc)).toBe(doc)
  })

  it('table context ends at a blank line', () => {
    expect(out(TABLE + '\n\nprose | text')).toBe(TABLE + '\n\nprose | text')
  })

  it('does not leak table context across a fenced block', () => {
    const doc = '| x |\n```\ncode\n```\n| --- |\ntrailing | mid'
    expect(out(doc)).toBe(doc)
  })
})
