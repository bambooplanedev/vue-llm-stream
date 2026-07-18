import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: {
        index: 'src/index.ts',
        providers: 'src/providers.ts',
        markdown: 'src/markdown.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['vue', 'markdown-it', 'shiki'],
    },
  },
})
