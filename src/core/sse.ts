import type { SseFrame } from './events'


// Incremental SSE frame parser. Provider agnostic.

export function createSseFrameParser() {
  let buffer = ''

  function parseBlock(block: string): SseFrame | null {
    let event: string | undefined
    const data: string[] = []
    for (const rawLine of block.split(/\r?\n/)) {
      if (rawLine === '' || rawLine.startsWith(':')) continue
      const colon = rawLine.indexOf(':')
      const field = colon === -1 ? rawLine : rawLine.slice(0, colon)
      let value = colon === -1 ? '' : rawLine.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    if (data.length === 0 && event === undefined) return null
    return event === undefined ? { data: data.join('\n') } : { event, data: data.join('\n') }
  }

  return {
    push(chunk: string): SseFrame[] {
      if (buffer === '' && chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1)
      buffer += chunk
      const frames: SseFrame[] = []
      let match: RegExpMatchArray | null
      // a frame ends at a blank line (LF or CRLF)
      while ((match = buffer.match(/\r?\n\r?\n/))) {
        const end = match.index! + match[0].length
        const frame = parseBlock(buffer.slice(0, end))
        buffer = buffer.slice(end)
        if (frame) frames.push(frame)
      }
      return frames
    },
    flush(): SseFrame[] {
      if (buffer.trim() === '') return []
      const frame = parseBlock(buffer)
      buffer = ''
      return frame ? [frame] : []
    },
  }
}
