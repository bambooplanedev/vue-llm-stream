export interface StabilizedMarkdown {
  text: string
  autoClosedFence: boolean
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const PARTIAL_FENCE_RE = /^ {0,3}`{1,2}$/
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

interface FenceState {
  char: string
  len: number
  /** container prefix of the opening line, so the auto-close matches it */
  prefix: string
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

interface InlineState {
  /** length of the backtick run that opened the current code span; 0 = not in code */
  codeTicks: number
  /** stack of open emphasis delimiter runs, e.g. ['**', '*'] */
  stack: string[]
}

const freshInline = (): InlineState => ({ codeTicks: 0, stack: [] })

function scanInlineLine(line: string, st: InlineState): void {
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    // backslash escapes the next character — but only outside code spans,
    // where backslashes are literal
    if (ch === '\\' && st.codeTicks === 0) {
      i += 2
      continue
    }
    if (ch === '`') {
      let n = 1
      while (line[i + n] === '`') n++
      if (st.codeTicks === 0) st.codeTicks = n
      else if (st.codeTicks === n) st.codeTicks = 0
      i += n
      continue
    }
    if (st.codeTicks === 0 && (ch === '*' || ch === '_')) {
      let n = 1
      while (line[i + n] === ch) n++
      const before = i === 0 ? ' ' : line[i - 1]!
      const after = i + n >= line.length ? '' : line[i + n]!
      // CommonMark: `_` cannot open or close emphasis inside a word
      if (ch === '_' && /[A-Za-z0-9_]/.test(before) && /[A-Za-z0-9_]/.test(after)) {
        i += n
        continue
      }
      // CommonMark-lite flanking: opener must be followed by non-space,
      // closer must be preceded by non-space
      const canOpen = after !== '' && !/\s/.test(after)
      const canClose = !/\s/.test(before)
      const run = ch.repeat(Math.min(n, 2))
      const top = st.stack[st.stack.length - 1]
      if (canClose && top === run) st.stack.pop()
      else if (canOpen) st.stack.push(run)
      i += n
      continue
    }
    i++
  }
}

function inlineClosers(st: InlineState): string {
  let closers = ''
  if (st.codeTicks > 0) closers += '`'.repeat(st.codeTicks)
  for (let i = st.stack.length - 1; i >= 0; i--) closers += st.stack[i]
  return closers
}

export function stabilizeMarkdown(input: string): StabilizedMarkdown {
  const lines = input.split('\n')
  let open: FenceState | null = null
  let inline = freshInline()
  let inTable = false
  let prevLineHadPipe = false

  for (const rawLine of lines) {
    const raw = rawLine.replace(/\r$/, '')
    const line = stripContainers(raw)
    const m = FENCE_RE.exec(line)
    if (m) {
      const marks = m[1]!
      if (!open) {
        // a fence opened inside a blockquote/list must be closed with the same
        // container prefix, or the appended fence opens a phantom top-level
        // block; list markers become spaces so the closer continues the item
        const prefix = raw.slice(0, raw.length - line.length)
          .replace(/[-*+]|\d{1,9}[.)]/g, (mk) => ' '.repeat(mk.length))
        open = { char: marks[0]!, len: marks.length, prefix }
      }
      else if (marks[0] === open.char && marks.length >= open.len && m[2]!.trim() === '') open = null
      inline = freshInline() // fence line = paragraph boundary
      inTable = false
      prevLineHadPipe = false
      continue
    }
    if (open) continue // no inline scanning inside code
    if (line.trim() === '') {
      inline = freshInline() // blank line = paragraph boundary
      inTable = false
      prevLineHadPipe = false
      continue
    }
    if (!inTable && prevLineHadPipe && TABLE_DELIM_RE.test(line)) inTable = true
    prevLineHadPipe = line.includes('|')
    scanInlineLine(line, inline)
  }

  let text = input
  // hold back a bare trailing ` or `` — it is a fence arriving byte-by-byte
  if (!input.endsWith('\n') && !open) {
    const last = stripContainers((lines[lines.length - 1] ?? '').replace(/\r$/, ''))
    if (PARTIAL_FENCE_RE.test(last)) {
      text = lines.slice(0, -1).join('\n').replace(/\n$/, '')
      return { text, autoClosedFence: false }
    }
  }

  if (open) {
    text += (text.endsWith('\n') ? '' : '\n') + open.prefix + open.char.repeat(open.len)
    return { text, autoClosedFence: true }
  }

  // drop a trailing mid-cell table row (has `|` but doesn't end with one)
  if (inTable && !input.endsWith('\n')) {
    const last = (lines[lines.length - 1] ?? '').replace(/\r$/, '')
    const trimmed = last.trimEnd()
    if (trimmed.includes('|') && !trimmed.endsWith('|')) {
      text = lines.slice(0, -1).join('\n').replace(/\n+$/, '')
      return { text, autoClosedFence: false }
    }
  }

  const closers = inlineClosers(inline)
  if (closers && !input.endsWith('\n')) text += closers
  return { text, autoClosedFence: false }
}
