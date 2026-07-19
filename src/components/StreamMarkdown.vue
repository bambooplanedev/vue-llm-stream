<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import type { LlmStreamStatus } from '../composables/useLlmStream.js'
import { createMarkdownRenderer } from './renderer.js'
import { createShikiHighlight, type ShikiHighlightOptions } from './highlight.js'

const props = withDefaults(defineProps<{
  text: string
  status?: LlmStreamStatus
  highlight?: Omit<ShikiHighlightOptions, 'onReady'> | false
}>(), {
  status: 'idle',
  highlight: () => ({}),
})

const html = ref('')
let rafId = 0

const highlightFence = props.highlight === false
  ? undefined
  : createShikiHighlight({ ...props.highlight, onReady: () => scheduleRender(true) })
const render = createMarkdownRenderer(highlightFence)

function renderNow(): void {
  rafId = 0
  html.value = render(props.text).html
}

function scheduleRender(immediate = false): void {
  const canRaf = typeof requestAnimationFrame === 'function'
    && typeof document !== 'undefined' && !document.hidden
  if (immediate || !canRaf) {
    if (rafId && canRaf) cancelAnimationFrame(rafId)
    renderNow()
    return
  }
  if (!rafId) rafId = requestAnimationFrame(renderNow)
}

watch(() => props.text, () => scheduleRender(), { immediate: true })
watch(() => props.status, (s) => {
  // flush the pending frame — rAF does not fire in hidden tabs and the
  // final content must not wait for a refocus; `immediate` also covers
  // mounting directly into a done/error state (e.g. SSR-hydrated or
  // restored history) where there is no prior status to transition from
  if (s === 'done' || s === 'error') scheduleRender(true)
}, { immediate: true })
onUnmounted(() => {
  if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
})
</script>

<template>
  <div class="vls-stream-markdown">
    <slot v-if="status === 'submitted' && !text" name="loading" />
    <!-- eslint-disable-next-line vue/no-v-html — markdown-it output with html:false -->
    <div v-else class="vls-content" v-html="html" />
    <slot v-if="status === 'error'" name="error" />
  </div>
</template>
