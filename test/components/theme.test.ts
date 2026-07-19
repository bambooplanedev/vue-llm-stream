import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/theme.css', 'utf8')

// the theme is an opt-in global stylesheet — every rule must be scoped under
// a .vls- class so importing it can never restyle the host application
describe('theme.css', () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // hoist the contents of @-rule blocks (media queries) to the top level so
  // their selectors are scanned too — the naive regex below skips over
  // anything nested inside `@media … { … }` otherwise
  const flattened = withoutComments.replace(
    /@[\w-]+[^{]*\{([\s\S]*?)\n\}/g,
    (_m, inner: string) => inner,
  )
  const selectors = [...flattened.matchAll(/(^|})\s*([^{}@]+?)\s*\{/g)]
    .map((m) => m[2]!.trim())
    .filter(Boolean)

  it('has rules to check', () => {
    expect(selectors.length).toBeGreaterThan(10)
  })

  it('scopes every selector under a .vls- class', () => {
    for (const group of selectors) {
      for (const selector of group.split(',')) {
        expect(selector.trim(), `unscoped selector: "${selector.trim()}"`).toMatch(/\.vls-/)
      }
    }
  })

  it('uses only prefixed custom properties', () => {
    const customProps = [...withoutComments.matchAll(/--[\w-]+(?=\s*:)/g)].map((m) => m[0])
    expect(customProps.length).toBeGreaterThan(5)
    for (const prop of customProps) expect(prop).toMatch(/^--vls-/)
  })

  it('provides a dark scheme via media query and forced class overrides', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain('.vls-dark')
    expect(css).toContain('.vls-light')
  })
})
