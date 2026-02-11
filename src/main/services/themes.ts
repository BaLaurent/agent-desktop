import type { IpcMain } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import fs from 'fs/promises'
import type { ThemeFile } from '../../shared/types'

const THEMES_DIR = join(app.getPath('home'), '.agent-desktop', 'themes')
const BUILTIN_FILENAMES = ['default-dark.css', 'default-light.css']

const DEFAULT_DARK_CSS = `/* Agent Desktop — Default Dark Theme */
:root {
  --color-bg: #1a1a2e;
  --color-surface: #16213e;
  --color-deep: #0f3460;
  --color-primary: #e94560;
  --color-text: #eaeaea;
  --color-text-muted: #a0a0a0;
  --color-accent: #533483;
  --color-success: #00d26a;
  --color-error: #ff4757;
  --color-warning: #ffc107;
  --color-tool: #00bcd4;
  --color-text-contrast: #fff;
  --color-overlay: rgba(0, 0, 0, 0.5);
}
`

const DEFAULT_LIGHT_CSS = `/* Agent Desktop — Default Light Theme */
:root {
  --color-bg: #ffffff;
  --color-surface: #ffffff;
  --color-deep: #e5e7eb;
  --color-primary: #6366f1;
  --color-text: #1f2937;
  --color-text-muted: #6b7280;
  --color-accent: #8b5cf6;
  --color-success: #10b981;
  --color-error: #ef4444;
  --color-warning: #f59e0b;
  --color-tool: #0891b2;
  --color-text-contrast: #fff;
  --color-overlay: rgba(0, 0, 0, 0.3);
}
`

const CHEATSHEET_MD = `# Agent Desktop — Theme Cheatsheet

## CSS Custom Properties

Every theme must define these variables inside \`:root { }\`:

| Variable               | Role                                      | Dark default   | Light default  |
|------------------------|--------------------------------------------|----------------|----------------|
| \`--color-bg\`           | App background                             | \`#1a1a2e\`      | \`#ffffff\`      |
| \`--color-surface\`      | Cards, panels, inputs                      | \`#16213e\`      | \`#ffffff\`      |
| \`--color-deep\`         | Sidebar items, secondary surfaces          | \`#0f3460\`      | \`#e5e7eb\`      |
| \`--color-primary\`      | Buttons, links, active indicators          | \`#e94560\`      | \`#6366f1\`      |
| \`--color-text\`         | Main text                                  | \`#eaeaea\`      | \`#1f2937\`      |
| \`--color-text-muted\`   | Secondary text, placeholders               | \`#a0a0a0\`      | \`#6b7280\`      |
| \`--color-text-contrast\`| Text on colored backgrounds (buttons)      | \`#fff\`         | \`#fff\`         |
| \`--color-accent\`       | Accents, SSE badges                        | \`#533483\`      | \`#8b5cf6\`      |
| \`--color-success\`      | Success states, "On" toggles               | \`#00d26a\`      | \`#10b981\`      |
| \`--color-error\`        | Errors, delete buttons                     | \`#ff4757\`      | \`#ef4444\`      |
| \`--color-warning\`      | Warnings, connecting states                | \`#ffc107\`      | \`#f59e0b\`      |
| \`--color-tool\`         | Tool/info accents, HTTP badges             | \`#00bcd4\`      | \`#0891b2\`      |
| \`--color-overlay\`      | Modal/drag overlay background              | \`rgba(0,0,0,0.5)\` | \`rgba(0,0,0,0.3)\` |

## Tailwind Class Mapping

These Tailwind utility classes map directly to the CSS variables above:

### Backgrounds
| Class          | Maps to                  |
|----------------|--------------------------|
| \`bg-base\`      | \`--color-bg\`             |
| \`bg-surface\`   | \`--color-surface\`        |
| \`bg-deep\`      | \`--color-deep\`           |
| \`bg-primary\`   | \`--color-primary\`        |
| \`bg-accent\`    | \`--color-accent\`         |
| \`bg-success\`   | \`--color-success\`        |
| \`bg-error\`     | \`--color-error\`          |
| \`bg-warning\`   | \`--color-warning\`        |
| \`bg-tool\`      | \`--color-tool\`           |
| \`bg-overlay\`   | \`--color-overlay\`        |

### Text Colors
| Class            | Maps to                    |
|------------------|----------------------------|
| \`text-body\`      | \`--color-text\`             |
| \`text-muted\`     | \`--color-text-muted\`       |
| \`text-contrast\`  | \`--color-text-contrast\`    |
| \`text-primary\`   | \`--color-primary\`          |
| \`text-success\`   | \`--color-success\`          |
| \`text-error\`     | \`--color-error\`            |
| \`text-warning\`   | \`--color-warning\`          |
| \`text-tool\`      | \`--color-tool\`             |

### Borders
| Class              | Maps to                  |
|--------------------|--------------------------|
| \`border-primary\`   | \`--color-primary\`        |
| \`border-muted\`     | \`--color-text-muted\`     |
| \`border-success\`   | \`--color-success\`        |
| \`border-error\`     | \`--color-error\`          |
| \`border-base\`      | \`--color-bg\`             |

## Utility CSS Classes (globals.css)

### Status Blocks (left border + tinted background)
| Class                    | Usage                        |
|--------------------------|------------------------------|
| \`status-block-success\`   | Connected / OK states        |
| \`status-block-error\`     | Error / failure states       |
| \`status-block-warning\`   | Warning / pending states     |
| \`status-block-primary\`   | Informational / prompt blocks|

### Chips & Results
| Class              | Usage                              |
|--------------------|------------------------------------|
| \`chip-success\`     | Subtle "Approved" badge            |
| \`chip-error\`       | Subtle "Denied" badge              |
| \`result-bg-success\`| Light green result panel           |
| \`result-bg-error\`  | Light red result panel             |
| \`bg-primary-tint\`  | 12% primary tint for selections    |

## Common Button Patterns

\`\`\`html
<!-- Primary action -->
<button class="bg-primary text-contrast">Save</button>

<!-- Danger action -->
<button class="bg-error text-contrast">Delete</button>

<!-- Success toggle -->
<button class="bg-success text-contrast">On</button>

<!-- Secondary action -->
<button class="bg-deep text-body">Cancel</button>

<!-- Ghost / muted -->
<button class="bg-surface text-muted">Edit</button>
\`\`\`

## Creating a Theme

1. Create a \`.css\` file in this directory (\`~/.agent-desktop/themes/\`)
2. Define all \`--color-*\` variables inside \`:root { }\`
3. Reload themes in Settings > Appearance
4. Click your theme to activate it

### Minimal Template

\`\`\`css
/* My Custom Theme */
:root {
  --color-bg: #1a1a2e;
  --color-surface: #16213e;
  --color-deep: #0f3460;
  --color-primary: #e94560;
  --color-text: #eaeaea;
  --color-text-muted: #a0a0a0;
  --color-text-contrast: #fff;
  --color-accent: #533483;
  --color-success: #00d26a;
  --color-error: #ff4757;
  --color-warning: #ffc107;
  --color-tool: #00bcd4;
  --color-overlay: rgba(0, 0, 0, 0.5);
}
\`\`\`
`

function filenameToName(filename: string): string {
  return filename
    .replace(/\.css$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function validateFilename(filename: string): void {
  if (typeof filename !== 'string') throw new Error('Filename must be a string')
  if (!filename.endsWith('.css')) throw new Error('Filename must end in .css')
  if (filename.length > 200) throw new Error('Filename exceeds 200 characters')
  if (/[/\\]/.test(filename)) throw new Error('Filename must not contain path separators')
  if (filename.includes('..')) throw new Error('Filename must not contain ..')
}

async function readThemeFile(filename: string): Promise<ThemeFile> {
  const css = await fs.readFile(join(THEMES_DIR, filename), 'utf-8')
  return {
    filename,
    name: filenameToName(filename),
    isBuiltin: BUILTIN_FILENAMES.includes(filename),
    css,
  }
}

export async function ensureThemeDir(): Promise<void> {
  await fs.mkdir(THEMES_DIR, { recursive: true })
  for (const [filename, content] of [
    ['default-dark.css', DEFAULT_DARK_CSS],
    ['default-light.css', DEFAULT_LIGHT_CSS],
  ] as const) {
    const filePath = join(THEMES_DIR, filename)
    try {
      await fs.access(filePath)
    } catch {
      await fs.writeFile(filePath, content, 'utf-8')
    }
  }
  // Seed cheatsheet if absent
  const cheatsheetPath = join(THEMES_DIR, 'cheatsheet.md')
  try {
    await fs.access(cheatsheetPath)
  } catch {
    await fs.writeFile(cheatsheetPath, CHEATSHEET_MD, 'utf-8')
  }
}

export function registerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('themes:list', async () => {
    const entries = await fs.readdir(THEMES_DIR)
    const cssFiles = entries.filter((f) => f.endsWith('.css')).sort()
    return Promise.all(cssFiles.map(readThemeFile))
  })

  ipcMain.handle('themes:read', async (_event, filename: string) => {
    validateFilename(filename)
    return readThemeFile(filename)
  })

  ipcMain.handle('themes:create', async (_event, filename: string, css: string) => {
    validateFilename(filename)
    if (typeof css !== 'string') throw new Error('CSS content must be a string')
    const filePath = join(THEMES_DIR, filename)
    try {
      await fs.access(filePath)
      throw new Error(`Theme "${filename}" already exists`)
    } catch (err) {
      if ((err as Error).message.includes('already exists')) throw err
    }
    await fs.writeFile(filePath, css, 'utf-8')
    return readThemeFile(filename)
  })

  ipcMain.handle('themes:save', async (_event, filename: string, css: string) => {
    validateFilename(filename)
    if (typeof css !== 'string') throw new Error('CSS content must be a string')
    if (BUILTIN_FILENAMES.includes(filename)) {
      throw new Error('Cannot modify built-in themes')
    }
    await fs.writeFile(join(THEMES_DIR, filename), css, 'utf-8')
  })

  ipcMain.handle('themes:delete', async (_event, filename: string) => {
    validateFilename(filename)
    if (BUILTIN_FILENAMES.includes(filename)) {
      throw new Error('Cannot delete built-in themes')
    }
    await fs.unlink(join(THEMES_DIR, filename))
  })

  ipcMain.handle('themes:getDir', async () => {
    return THEMES_DIR
  })

  ipcMain.handle('themes:refresh', async () => {
    const entries = await fs.readdir(THEMES_DIR)
    const cssFiles = entries.filter((f) => f.endsWith('.css')).sort()
    return Promise.all(cssFiles.map(readThemeFile))
  })
}
