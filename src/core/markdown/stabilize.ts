export interface StabilizedMarkdown {
  text: string
  autoClosedFence: boolean
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const PARTIAL_FENCE_RE = /^ {0,3}`{1,2}$/

interface FenceState {
  char: string
  len: number
}

/** Strip blockquote/list container prefixes so nested fences are tracked. */
function stripContainers(line: string): string {
  let prev = ''
  while (prev !== line) {
    prev = line
    line = line.replace(/^ {0,3}> ?/, '')
    line = line.replace(/^ {0,7}(?:[-*+]|\d{1,9}[.)]) +/, '')
  }
  // list-continuation indent: up to 3 spaces; 4+ means an indented code block
  return line.replace(/^ {1,3}(?=\S)/, '')
}

export function stabilizeMarkdown(input: string): StabilizedMarkdown {
  const lines = input.split('\n')
  let open: FenceState | null = null

  for (const rawLine of lines) {
    const line = stripContainers(rawLine.replace(/\r$/, ''))
    const m = FENCE_RE.exec(line)
    if (!m) continue
    const marks = m[1]!
    if (!open) {
      open = { char: marks[0]!, len: marks.length }
    } else if (marks[0] === open.char && marks.length >= open.len && m[2]!.trim() === '') {
      open = null
    }
  }

  let text = input
  // hold back a bare trailing ` or `` — it is a fence arriving byte-by-byte
  if (!input.endsWith('\n') && !open) {
    const last = stripContainers((lines[lines.length - 1] ?? '').replace(/\r$/, ''))
    if (PARTIAL_FENCE_RE.test(last)) {
      text = lines.slice(0, -1).join('\n').replace(/\n$/, '')
    }
  }

  if (open) {
    text += (text.endsWith('\n') ? '' : '\n') + open.char.repeat(open.len)
    return { text, autoClosedFence: true }
  }
  return { text, autoClosedFence: false }
}
