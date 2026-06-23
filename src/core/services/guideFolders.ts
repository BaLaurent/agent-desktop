import type Database from 'better-sqlite3'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getMacrosDir } from '../handlers/commands'
import { getFunctionsDir } from './variableResolver/customLoader'
import { createLogger, errToCtx } from '../utils/logger'

const log = createLogger('guideFolders')

type GuideType = 'macros' | 'functions' | 'themes'

interface GuideSeed {
  guideType: GuideType
  name: string
  dir: string
  guideMarkdown: string
}

// Les répertoires viennent des résolveurs propriétaires (DRY). Exception thèmes :
// le dir thèmes est résolu côté electron (main/services/themes.ts via app.getPath),
// la ThemesService (core) le reçoit par injection — pas de résolveur core.
// ponytail: même connaissance que le câblage electron, ré-énoncée pour le runtime core.
const THEMES_DIR = join(homedir(), '.agent-desktop', 'themes')

const GUIDE_SEEDS: GuideSeed[] = [
  {
    guideType: 'macros',
    name: 'Macros',
    dir: getMacrosDir(),
    guideMarkdown: `# Macros

A **macro** is a sequence of messages you replay in one shot by typing \`/name\` in the chat.

> 💡 **Easiest way:** just ask me to create or edit a macro ("create a macro that…") — I'll write the file myself. The rest explains the format if you'd rather do it by hand.

This folder points to \`~/.agent-desktop/macros/\` (its working directory). Each macro is a \`.json\` file:

\`\`\`json
{
  "description": "Run the code review",
  "messages": ["Analyze the current diff", "Propose fixes"]
}
\`\`\`

- File name = command name (\`review.json\` → \`/review\`). Letters, digits, \`-\`, \`_\`.
- \`messages\`: non-empty array, sent in a burst.

You can also manage your macros in **Settings → Macros**. This guide folder is deletable; recreate it from **Settings → General**.`,
  },
  {
    guideType: 'functions',
    name: 'Functions',
    dir: getFunctionsDir(),
    guideMarkdown: `# Functions

A **function** is a dynamic variable you insert into your prompts: it runs and its result replaces the call.

> 💡 **Easiest way:** just ask me to create or edit a function ("create a function that…") — I'll write the file myself. The rest explains the format if you'd rather do it by hand.

This folder points to \`~/.agent-desktop/functions/\`. Each function is a \`.ts\` file exporting a default function:

\`\`\`ts
/** Returns today's date */
export default async function () {
  return new Date().toISOString().slice(0, 10)
}
\`\`\`

- File name = variable name.
- The \`.ts\` is transpiled and cached automatically.

This guide folder is deletable; recreate it from **Settings → General**.`,
  },
  {
    guideType: 'themes',
    name: 'Themes',
    dir: THEMES_DIR,
    guideMarkdown: `# Themes

A **theme** customizes the interface colors via CSS variables.

> 💡 **Easiest way:** just ask me to create or edit a theme ("create a dark purple theme…") — I'll write the file myself. The rest explains the format if you'd rather do it by hand.

This folder points to \`~/.agent-desktop/themes/\`. Each theme is a \`.css\` file that redefines the variables:

\`\`\`css
:root {
  --color-base: #1a1b26;
  --color-body: #c0caf5;
  --color-contrast: #ffffff;
}
\`\`\`

- The \`cheatsheet.md\` file in the directory lists all available variables.
- Select your theme in **Settings → Appearance**.

This guide folder is deletable; recreate it from **Settings → General**.`,
  },
]

export async function seedGuideFolders(db: Database.Database): Promise<{ created: number }> {
  let created = 0
  for (const seed of GUIDE_SEEDS) {
    const existing = db.prepare('SELECT id FROM folders WHERE guide_type = ?').get(seed.guideType)
    if (existing) continue

    // Le default_cwd doit pointer vers un répertoire réel ; mkdir best-effort par type.
    try {
      await mkdir(seed.dir, { recursive: true })
    } catch (e) {
      log.warn(`mkdir échoué pour ${seed.dir}, dossier-guide ${seed.guideType} sauté`, errToCtx(e))
      continue
    }

    const insert = db.transaction(() => {
      const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as max FROM folders').get() as { max: number }
      const folder = db.prepare(
        `INSERT INTO folders (name, default_cwd, guide_type, position, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      ).run(seed.name, seed.dir, seed.guideType, maxPos.max + 1)
      // cwd posé explicitement = seed.dir : l'insert brut court-circuite
      // ConversationService.create, qui sinon hérite du default_cwd du dossier.
      const conv = db.prepare(
        `INSERT INTO conversations (title, folder_id, cwd, updated_at)
         VALUES (?, ?, ?, datetime('now'))`
      ).run(`Guide: ${seed.name}`, folder.lastInsertRowid, seed.dir)
      db.prepare(
        `INSERT INTO messages (conversation_id, role, content, created_at)
         VALUES (?, 'assistant', ?, datetime('now'))`
      ).run(conv.lastInsertRowid, seed.guideMarkdown)
    })
    insert()
    created++
  }
  return { created }
}

export async function seedGuideFoldersOnce(db: Database.Database): Promise<void> {
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'guideFolders_seeded'").get()
  if (flag) return
  await seedGuideFolders(db)
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('guideFolders_seeded', '1')").run()
}
