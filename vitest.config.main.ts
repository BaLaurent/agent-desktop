import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/shared/**/*.test.ts',
      'src/core/**/*.test.ts',
      'src/extensions/**/*.test.ts',
      'src/headless/**/*.test.ts',
    ],
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 70,
        branches: 60,
      },
    },
  },
})
