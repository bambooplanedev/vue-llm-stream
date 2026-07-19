import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    typecheck: { enabled: true, checker: 'vue-tsc', include: ['test/**/*.test-d.ts'] },
  },
})
