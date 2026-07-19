import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  base: '/vue-llm-stream/', // GitHub Pages project path
  plugins: [vue()],
  resolve: {
    alias: {
      'vue-llm-stream/providers': fileURLToPath(new URL('../src/providers.ts', import.meta.url)),
      'vue-llm-stream/markdown': fileURLToPath(new URL('../src/markdown.ts', import.meta.url)),
      'vue-llm-stream': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
})
