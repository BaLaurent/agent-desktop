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
    guideMarkdown: `# Les macros

Une **macro** est une séquence de messages que tu rejoues d'un coup en tapant \`/nom\` dans le chat.

> 💡 **Le plus simple :** demande-moi directement de créer ou modifier une macro (« crée une macro qui… ») — j'écris le fichier moi-même. La suite explique le format si tu préfères le faire à la main.

Ce dossier pointe vers \`~/.agent-desktop/macros/\` (son répertoire de travail). Chaque macro est un fichier \`.json\` :

\`\`\`json
{
  "description": "Lance la revue de code",
  "messages": ["Analyse le diff courant", "Propose des correctifs"]
}
\`\`\`

- Nom du fichier = nom de la commande (\`revue.json\` → \`/revue\`). Lettres, chiffres, \`-\`, \`_\`.
- \`messages\` : tableau non vide, envoyé en rafale.

Tu peux aussi gérer tes macros dans **Paramètres → Macros**. Ce dossier-guide est supprimable ; recrée-le depuis **Paramètres → Général**.`,
  },
  {
    guideType: 'functions',
    name: 'Fonctions',
    dir: getFunctionsDir(),
    guideMarkdown: `# Les fonctions

Une **fonction** est une variable dynamique que tu insères dans tes prompts : elle s'exécute et son résultat remplace l'appel.

> 💡 **Le plus simple :** demande-moi directement de créer ou modifier une fonction (« crée une fonction qui… ») — j'écris le fichier moi-même. La suite explique le format si tu préfères le faire à la main.

Ce dossier pointe vers \`~/.agent-desktop/functions/\`. Chaque fonction est un fichier \`.ts\` exportant une fonction par défaut :

\`\`\`ts
/** Renvoie la date du jour */
export default async function () {
  return new Date().toISOString().slice(0, 10)
}
\`\`\`

- Nom du fichier = nom de la variable.
- Le \`.ts\` est transpilé et mis en cache automatiquement.

Ce dossier-guide est supprimable ; recrée-le depuis **Paramètres → Général**.`,
  },
  {
    guideType: 'themes',
    name: 'Thèmes',
    dir: THEMES_DIR,
    guideMarkdown: `# Les thèmes

Un **thème** personnalise les couleurs de l'interface via des variables CSS.

> 💡 **Le plus simple :** demande-moi directement de créer ou modifier un thème (« crée un thème sombre violet… ») — j'écris le fichier moi-même. La suite explique le format si tu préfères le faire à la main.

Ce dossier pointe vers \`~/.agent-desktop/themes/\`. Chaque thème est un fichier \`.css\` qui redéfinit les variables :

\`\`\`css
:root {
  --color-base: #1a1b26;
  --color-body: #c0caf5;
  --color-contrast: #ffffff;
}
\`\`\`

- Le fichier \`cheatsheet.md\` du répertoire liste toutes les variables disponibles.
- Sélectionne ton thème dans **Paramètres → Apparence**.

Ce dossier-guide est supprimable ; recrée-le depuis **Paramètres → Général**.`,
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
      ).run(`Guide : ${seed.name}`, folder.lastInsertRowid, seed.dir)
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
