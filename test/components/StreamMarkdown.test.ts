import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('shiki', () => ({
  createHighlighter: vi.fn(async () => ({
    codeToHtml: (code: string) => `<pre class="shiki">${code}</pre>`,
    getLoadedLanguages: () => ['javascript'],
  })),
}))

import StreamMarkdown from '../../src/components/StreamMarkdown.vue'

describe('StreamMarkdown', () => {
  it('renders markdown from text', async () => {
    const wrapper = mount(StreamMarkdown, { props: { text: '# Title\n\nbody', status: 'done' } })
    await vi.waitFor(() => expect(wrapper.html()).toContain('<h1>'))
  })

  it('progressively re-renders as text grows, including an unclosed fence', async () => {
    const wrapper = mount(StreamMarkdown, { props: { text: 'Intro', status: 'streaming' } })
    await wrapper.setProps({ text: 'Intro\n\n```js\nconst a' })
    await vi.waitFor(() => expect(wrapper.html()).toContain('<pre'))
  })

  it('renders synchronously on transition to done (no pending frame lost)', async () => {
    const wrapper = mount(StreamMarkdown, { props: { text: 'a', status: 'streaming' } })
    await wrapper.setProps({ text: 'final text', status: 'done' })
    expect(wrapper.text()).toContain('final text')
  })

  it('shows the loading slot while submitted with no text', () => {
    const wrapper = mount(StreamMarkdown, {
      props: { text: '', status: 'submitted' },
      slots: { loading: '<em class="spin">connecting</em>' },
    })
    expect(wrapper.find('.spin').exists()).toBe(true)
  })

  it('shows the error slot alongside partial text on error', () => {
    const wrapper = mount(StreamMarkdown, {
      props: { text: 'partial answer', status: 'error' },
      slots: { error: '<button class="retry-btn">retry</button>' },
    })
    expect(wrapper.find('.retry-btn').exists()).toBe(true)
    expect(wrapper.text()).toContain('partial answer')
  })

  it('does not recreate DOM nodes of settled blocks when the tail grows', async () => {
    const t1 = '# Title\n\nFirst paragraph stays.\n\nSecond para'
    const wrapper = mount(StreamMarkdown, { props: { text: t1, status: 'streaming' } })
    await vi.waitFor(() => expect(wrapper.html()).toContain('<h1>'))

    const before = wrapper.element.querySelector('h1')!
    const beforeP = wrapper.element.querySelector('p')!
    await wrapper.setProps({ text: t1 + 'graph grows.\n\nBrand-new paragraph' })
    await vi.waitFor(() => expect(wrapper.text()).toContain('Brand-new'))

    // the settled heading and first paragraph must be the SAME nodes —
    // full-subtree replacement is the flicker this component must not have
    expect(wrapper.element.querySelector('h1')).toBe(before)
    expect(wrapper.element.querySelector('p')).toBe(beforeP)
  })

  it('escapes hostile markdown', async () => {
    const wrapper = mount(StreamMarkdown, {
      props: { text: '<img src=x onerror=alert(1)>', status: 'done' },
    })
    // the tag is escaped to inert text (&lt;img ...), never rendered as an
    // element — matches the invariant asserted in renderer.test.ts; the
    // literal word "onerror" remains as harmless escaped text
    await vi.waitFor(() => expect(wrapper.html()).not.toContain('<img'))
  })
})
