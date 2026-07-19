import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export interface ScrollAnchorOptions {
  /** Distance from the bottom (px) still counted as "at bottom". */
  threshold?: number
}

export function useScrollAnchor(
  container: Ref<HTMLElement | null>,
  options: ScrollAnchorOptions = {},
) {
  const threshold = options.threshold ?? 40
  const isPinned = ref(true)
  let programmatic = false
  let ro: ResizeObserver | null = null
  let mo: MutationObserver | null = null
  let attached: HTMLElement | null = null

  const distanceFromBottom = (el: HTMLElement): number =>
    el.scrollHeight - el.scrollTop - el.clientHeight

  // Math.abs: scrollTop is fractional and can overshoot during rubber-banding
  const atBottom = (el: HTMLElement): boolean =>
    Math.abs(distanceFromBottom(el)) < threshold

  function scrollToBottom(): void {
    const el = container.value
    if (!el) return
    const before = el.scrollTop
    programmatic = true
    el.scrollTop = el.scrollHeight
    isPinned.value = true
    // if the assignment didn't actually move anything, no scroll event will
    // fire to clear the flag — clear it now so it doesn't swallow the next
    // genuine user scroll
    if (el.scrollTop === before) programmatic = false
  }

  function onScroll(): void {
    if (programmatic) {
      programmatic = false
      return
    }
    const el = container.value
    if (el && atBottom(el)) isPinned.value = true
  }

  // detach on user *intent* (wheel/touchmove), not on scroll events —
  // content growth moves scroll metrics without any user action
  function onUserIntent(): void {
    const el = container.value
    if (el && !atBottom(el)) isPinned.value = false
  }

  function attach(el: HTMLElement): void {
    if (attached === el) return
    if (attached) detach(attached)
    attached = el
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onUserIntent, { passive: true })
    el.addEventListener('touchmove', onUserIntent, { passive: true })
    if (typeof ResizeObserver !== 'undefined') {
      // re-stick after DOM growth: streaming appends, Shiki upgrades, late fonts
      ro = new ResizeObserver(() => {
        if (isPinned.value) scrollToBottom()
      })
      ro.observe(el)
      for (const child of Array.from(el.children)) ro.observe(child)
    }
    if (typeof MutationObserver !== 'undefined') {
      // observe nodes appended after mount (e.g. streamed chat messages) so
      // their growth is also tracked by the ResizeObserver above
      mo = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            if (node instanceof Element) ro?.observe(node)
          }
        }
        if (isPinned.value) scrollToBottom()
      })
      mo.observe(el, { childList: true })
    }
  }

  function detach(el: HTMLElement): void {
    el.removeEventListener('scroll', onScroll)
    el.removeEventListener('wheel', onUserIntent)
    el.removeEventListener('touchmove', onUserIntent)
    ro?.disconnect()
    ro = null
    mo?.disconnect()
    mo = null
    if (attached === el) attached = null
  }

  watch(container, (el, old) => {
    if (old) detach(old)
    if (el) attach(el)
  })

  onMounted(() => {
    const el = container.value
    if (el && attached !== el) attach(el)
  })

  onBeforeUnmount(() => {
    if (attached) detach(attached)
  })

  return { isPinned, scrollToBottom }
}
