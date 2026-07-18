import { describe, expect, it } from 'vitest'
import { createSseFrameParser } from '../../src/core/sse'

describe('createSseFrameParser', () => {
  it('parses a simple data frame', () => {
    const p = createSseFrameParser()
    expect(p.push('data: hello\n\n')).toEqual([{ data: 'hello' }])
  })

  it('parses named events', () => {
    const p = createSseFrameParser()
    expect(p.push('event: ping\ndata: {}\n\n')).toEqual([{ event: 'ping', data: '{}' }])
  })

  it('joins multi-line data with newlines', () => {
    const p = createSseFrameParser()
    expect(p.push('data: a\ndata: b\n\n')).toEqual([{ data: 'a\nb' }])
  })

  it('handles a frame split across chunks mid-field', () => {
    const p = createSseFrameParser()
    expect(p.push('data: hel')).toEqual([])
    expect(p.push('lo\n\n')).toEqual([{ data: 'hello' }])
  })

  it('handles CRLF line endings', () => {
    const p = createSseFrameParser()
    expect(p.push('data: a\r\n\r\n')).toEqual([{ data: 'a' }])
  })

  it('ignores comment lines', () => {
    const p = createSseFrameParser()
    expect(p.push(': keep-alive\n\ndata: x\n\n')).toEqual([{ data: 'x' }])
  })

  it('flush() emits a trailing frame without final blank line', () => {
    const p = createSseFrameParser()
    expect(p.push('data: tail\n')).toEqual([])
    expect(p.flush()).toEqual([{ data: 'tail' }])
  })

  it('ignores fields other than event/data', () => {
    const p = createSseFrameParser()
    expect(p.push('id: 7\nretry: 100\ndata: x\n\n')).toEqual([{ data: 'x' }])
  })

  it('strips a leading BOM at stream start', () => {
    const p = createSseFrameParser()
    expect(p.push('﻿data: hello\n\n')).toEqual([{ data: 'hello' }])
  })
})
