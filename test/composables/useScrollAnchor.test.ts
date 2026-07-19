import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useScrollAnchor } from '../../src/composables/useScrollAnchor'

// happy-dom reports zero layout metrics — fake them
function fakeMetrics(el: HTMLElement, m: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  Object.defineProperty(el, 'scrollHeight', { value: m.scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: m.clientHeight, configurable: true })
  let top = m.scrollTop ?? 0
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = v },
  })
}

function build() {
  const container = ref<HTMLElement | null>(null)
  let anchor!: ReturnType<typeof useScrollAnchor>
  const Comp = defineComponent({
    setup() {
      anchor = useScrollAnchor(container, { threshold: 40 })
      return () => h('div', { ref: container }, [h('div', 'content')])
    },
  })
  const wrapper = mount(Comp)
  const el = container.value!
  fakeMetrics(el, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 }) // exactly at bottom
  return { wrapper, el, anchor: () => anchor }
}

// happy-dom has no real ResizeObserver/MutationObserver — install recording stubs
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  callback: ResizeObserverCallback
  observed: Element[] = []
  constructor(cb: ResizeObserverCallback) {
    this.callback = cb
    FakeResizeObserver.instances.push(this)
  }
  observe(target: Element) { this.observed.push(target) }
  unobserve(target: Element) { this.observed = this.observed.filter((t) => t !== target) }
  disconnect() { this.observed = [] }
}

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = []
  callback: MutationCallback
  constructor(cb: MutationCallback) {
    this.callback = cb
    FakeMutationObserver.instances.push(this)
  }
  observe() {}
  disconnect() {}
  takeRecords(): MutationRecord[] { return [] }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeResizeObserver.instances = []
  FakeMutationObserver.instances = []
})

describe('useScrollAnchor', () => {
  it('starts pinned and scrollToBottom pins to scrollHeight', () => {
    const { el, anchor } = build()
    expect(anchor().isPinned.value).toBe(true)
    anchor().scrollToBottom()
    expect(el.scrollTop).toBe(1000)
  })

  it('unpins on upward user intent (wheel) away from bottom', async () => {
    const { el, anchor } = build()
    el.scrollTop = 100 // user scrolled up
    el.dispatchEvent(new Event('wheel'))
    expect(anchor().isPinned.value).toBe(false)
  })

  it('re-pins when a scroll lands back at bottom', () => {
    const { el, anchor } = build()
    el.scrollTop = 100
    el.dispatchEvent(new Event('wheel'))
    expect(anchor().isPinned.value).toBe(false)
    el.scrollTop = 590 // within 40px threshold of 600
    el.dispatchEvent(new Event('scroll'))
    expect(anchor().isPinned.value).toBe(true)
  })

  it('ignores the scroll event caused by its own scrollToBottom', () => {
    const { el, anchor } = build()
    el.scrollTop = 100
    el.dispatchEvent(new Event('wheel'))
    anchor().scrollToBottom()
    // programmatic scroll fires a scroll event — must not be treated as user intent
    el.dispatchEvent(new Event('scroll'))
    expect(anchor().isPinned.value).toBe(true)
  })

  it('tolerates fractional/rubber-banded scrollTop (negative distance)', () => {
    const { el, anchor } = build()
    el.scrollTop = 620 // overshoot past bottom (iOS bounce)
    el.dispatchEvent(new Event('scroll'))
    expect(anchor().isPinned.value).toBe(true)
  })

  it('observes newly added child nodes and re-sticks on their growth while pinned', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
    vi.stubGlobal('MutationObserver', FakeMutationObserver as unknown as typeof MutationObserver)

    const { el, anchor } = build()
    expect(anchor().isPinned.value).toBe(true)

    const ro = FakeResizeObserver.instances[0]!
    const mo = FakeMutationObserver.instances[0]!
    expect(ro).toBeTruthy()
    expect(mo).toBeTruthy()

    const child = document.createElement('div')
    el.appendChild(child)
    mo.callback([{ addedNodes: [child] } as unknown as MutationRecord], mo as unknown as MutationObserver)

    expect(ro.observed).toContain(child)

    // simulate the streamed content growing the container (fixed-height overflow:auto chat)
    fakeMetrics(el, { scrollHeight: 1500, clientHeight: 400, scrollTop: el.scrollTop })
    ro.callback([] as unknown as ResizeObserverEntry[], ro as unknown as ResizeObserver)

    expect(el.scrollTop).toBe(1500) // re-stuck while pinned
  })

  it('does not let a movement-free scrollToBottom swallow the next scroll', () => {
    const { el, anchor } = build()
    el.scrollTop = 1000
    anchor().scrollToBottom()              // no movement — flag must self-clear
    el.dispatchEvent(new Event('wheel'))   // intent away from bottom → unpin
    expect(anchor().isPinned.value).toBe(false)
    el.scrollTop = 590
    el.dispatchEvent(new Event('scroll'))  // genuine scroll back near bottom
    expect(anchor().isPinned.value).toBe(true)
  })

  it('attaches listeners even when the container ref is only set after mount', async () => {
    const container = ref<HTMLElement | null>(null)
    const show = ref(false)
    let anchor!: ReturnType<typeof useScrollAnchor>
    const Comp = defineComponent({
      setup() {
        anchor = useScrollAnchor(container, { threshold: 40 })
        return () =>
          show.value
            ? h('div', { ref: container }, [h('div', 'content')])
            : h('div')
      },
    })
    mount(Comp)
    expect(container.value).toBeNull()

    show.value = true
    await nextTick()
    const el = container.value!
    fakeMetrics(el, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 })

    el.dispatchEvent(new Event('wheel'))
    expect(anchor.isPinned.value).toBe(false)
  })

  it('attaches exactly one observer pair on standard mount and disconnects it on unmount', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
    vi.stubGlobal('MutationObserver', FakeMutationObserver as unknown as typeof MutationObserver)
    FakeResizeObserver.instances = []
    FakeMutationObserver.instances = []

    const { wrapper } = build()

    // Collect all observer instances created so far
    const allRO = [...FakeResizeObserver.instances]
    const allMO = [...FakeMutationObserver.instances]

    // exactly 1 ResizeObserver and 1 MutationObserver should be created
    expect(allRO).toHaveLength(1)
    expect(allMO).toHaveLength(1)

    // track disconnect calls on all instances (even if more are created later)
    const roDisconnectCalls: FakeResizeObserver[] = []
    const moDisconnectCalls: FakeMutationObserver[] = []

    for (const ro of allRO) {
      ro.disconnect = vi.fn(() => { roDisconnectCalls.push(ro) })
    }
    for (const mo of allMO) {
      mo.disconnect = vi.fn(() => { moDisconnectCalls.push(mo) })
    }

    wrapper.unmount()

    // all created observers should be disconnected
    expect(roDisconnectCalls).toHaveLength(allRO.length)
    expect(moDisconnectCalls).toHaveLength(allMO.length)
  })
})
