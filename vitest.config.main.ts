import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
    passWithNoTests: true,
  },
})
