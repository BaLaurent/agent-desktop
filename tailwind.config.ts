import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/renderer/**/*.{ts,tsx}', './src/renderer/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        base: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        deep: 'var(--color-deep)',
        primary: 'var(--color-primary)',
        body: 'var(--color-text)',
        muted: 'var(--color-text-muted)',
        contrast: 'var(--color-text-contrast)',
        accent: 'var(--color-accent)',
        success: 'var(--color-success)',
        error: 'var(--color-error)',
        warning: 'var(--color-warning)',
        tool: 'var(--color-tool)',
        overlay: 'var(--color-overlay)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        base: ['14px', { lineHeight: '1.5' }],
      },
      spacing: {
        '1u': '4px',
        '2u': '8px',
        '3u': '12px',
        '4u': '16px',
        '6u': '24px',
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
      },
    },
  },
  plugins: [],
}

export default config
