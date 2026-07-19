import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { factoryCalls } = vi.hoisted(() => ({ factoryCalls: { count: 0 } }))

// simulate `shiki` not being installed — any attempt to load it fails
vi.mock('shiki', () => { factoryCalls.count++; throw new Error('Cannot find module shiki') })

import StreamMarkdown from '../../src/components/StreamMarkdown.vue'

describe('StreamMarkdown without shiki installed', () => {
  it('renders with highlight: false without ever loading shiki', async () => {
    const wrapper = mount(StreamMarkdown, {
      props: { text: '```js\nconst a = 1\n```', status: 'done', highlight: false },
    })
    await vi.waitFor(() => expect(wrapper.html()).toContain('<pre'))
    expect(factoryCalls.count).toBe(0)
  })

  it('falls back to plain <pre> when shiki fails to load', async () => {
    const wrapper = mount(StreamMarkdown, {
      props: { text: '```js\nconst a = 1\n```', status: 'done' },
    })
    await vi.waitFor(() => expect(wrapper.html()).toContain('<pre'))
  })
})
