import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/renderer/**/*.test.{ts,tsx}'],
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
    setupFiles: ['src/renderer/__tests__/setup.ts'],
    css: false,
    passWithNoTests: true,
  },
})
