# Dossiers-guides de découvrabilité — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Au premier lancement, créer 3 dossiers de conversations (« Macros », « Fonctions », « Thèmes ») pointant vers leur répertoire disque (`default_cwd`) et contenant une conversation pré-remplie d'un message-guide ; supprimables, recréables depuis les Paramètres.

**Architecture:** Un module core `guideFolders.ts` est la source unique (data + logique de seed), sans import `electron` (seedé aussi en headless). Deux idempotences : un flag `settings.guideFolders_seeded` empêche le re-seed automatique au démarrage (suppression définitive), une colonne `folders.guide_type` rend le bouton « Recréer » sans doublon. Le seed est câblé dans `initDatabase`, exposé en IPC via `guides:reseed`, et déclenché par un bouton dans `GeneralSettings`.

**Tech Stack:** TypeScript, Electron, sql.js (API better-sqlite3-like : `prepare/run/get/transaction`), React + Zustand, Vitest.

## Global Constraints

- `core/` MUST NOT import `'electron'` (runtime headless). Valeurs verbatim.
- I/O fichier main-thread : `fs.promises.*` uniquement — jamais de méthode `*Sync`.
- Migrations additives via `applyMigration(db, columnsByTable, table, col, type)` (pattern existant `schema.ts`).
- Ops DB multi-lignes enveloppées dans `db.transaction(...)`.
- Tests colocalisés `*.test.ts` ; `createTestDb()` est **async** (tout `beforeEach` doit `await`).
- Nommage thèmes : variables `--color-base` / `--color-body` / `--color-contrast` (pas `bg`/`text`).
- Réponses/handlers : suivre le pattern `registrar.handle('x:y', async () => { try {...} catch (err) { throw new Error(...) } })`.

---

### Task 1: Migration `folders.guide_type`

**Files:**
- Modify: `src/core/db/schema.ts` (bloc migrations `folders`, après `is_default` — voir `schema.ts:201`)

**Interfaces:**
- Consumes: rien.
- Produces: colonne `folders.guide_type TEXT` (nullable, défaut `NULL`) disponible pour toutes les tâches suivantes.

- [ ] **Step 1: Ajouter la migration**

Dans `src/core/db/schema.ts`, dans le bloc `// folders` des migrations, juste après la ligne :

```ts
    applyMigration(db, columnsByTable, 'folders', 'is_default', 'INTEGER DEFAULT 0')
```

ajouter :

```ts
    // Marqueur des dossiers-guides seedés (macros|functions|themes). NULL = dossier utilisateur normal.
    applyMigration(db, columnsByTable, 'folders', 'guide_type', 'TEXT')
```

- [ ] **Step 2: Vérifier que le build passe**

Run: `npm run build`
Expected: 0 erreur.

- [ ] **Step 3: Commit**

```bash
git add src/core/db/schema.ts
git commit -m "feat(db): add folders.guide_type column for guide folders"
```

---

### Task 2: Module core `guideFolders.ts` (source unique + seed)

**Files:**
- Create: `src/core/services/guideFolders.ts`
- Create: `src/core/services/guideFolders.test.ts`
- Modify: `src/core/handlers/commands.ts` (exporter `getMacrosDir`)
- Modify: `src/core/services/variableResolver/customLoader.ts` (exporter `getFunctionsDir`)

**Interfaces:**
- Consumes: `getMacrosDir()` (commands.ts), `getFunctionsDir()` (customLoader.ts), colonne `folders.guide_type` (Task 1).
- Produces:
  - `seedGuideFolders(db: Database.Database): Promise<{ created: number }>` — create-if-missing par `guide_type`, retourne le nombre de dossiers créés.
  - `seedGuideFoldersOnce(db: Database.Database): Promise<void>` — no-op si le flag `guideFolders_seeded` est posé, sinon seed + pose le flag.

- [ ] **Step 1: Exporter `getMacrosDir`**

Dans `src/core/handlers/commands.ts`, transformer (vers `commands.ts:29`) :

```ts
function getMacrosDir(): string {
  return expandTilde('~/.agent-desktop/macros')
}
```

en :

```ts
export function getMacrosDir(): string {
  return expandTilde('~/.agent-desktop/macros')
}
```

- [ ] **Step 2: Exporter le répertoire des fonctions**

Dans `src/core/services/variableResolver/customLoader.ts`, sous la constante `DEFAULT_DIR` (`customLoader.ts:11`), ajouter :

```ts
export function getFunctionsDir(): string {
  return DEFAULT_DIR
}
```

- [ ] **Step 3: Écrire le test (échouant)**

Create `src/core/services/guideFolders.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../../main/__tests__/db-helper'
import { seedGuideFolders, seedGuideFoldersOnce } from './guideFolders'

describe('seedGuideFolders', () => {
  let db: any
  beforeEach(async () => { db = await createTestDb() })

  it('crée 3 dossiers-guides, chacun avec une conversation + un message assistant', async () => {
    const { created } = await seedGuideFolders(db)
    expect(created).toBe(3)
    const folders = db.prepare("SELECT * FROM folders WHERE guide_type IS NOT NULL").all()
    expect(folders).toHaveLength(3)
    const types = folders.map((f: any) => f.guide_type).sort()
    expect(types).toEqual(['functions', 'macros', 'themes'])
    for (const f of folders) {
      expect(f.default_cwd).toBeTruthy()
      const conv = db.prepare('SELECT * FROM conversations WHERE folder_id = ?').get(f.id)
      expect(conv).toBeTruthy()
      const msg = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').get(conv.id)
      expect(msg.role).toBe('assistant')
      expect(msg.content.length).toBeGreaterThan(0)
    }
  })

  it('est idempotent — un 2e appel ne crée rien', async () => {
    await seedGuideFolders(db)
    const { created } = await seedGuideFolders(db)
    expect(created).toBe(0)
    expect(db.prepare("SELECT COUNT(*) c FROM folders WHERE guide_type IS NOT NULL").get().c).toBe(3)
  })

  it('ne recrée que le type manquant', async () => {
    await seedGuideFolders(db)
    db.prepare("DELETE FROM folders WHERE guide_type = 'macros'").run()
    const { created } = await seedGuideFolders(db)
    expect(created).toBe(1)
    expect(db.prepare("SELECT id FROM folders WHERE guide_type = 'macros'").get()).toBeTruthy()
  })
})

describe('seedGuideFoldersOnce', () => {
  let db: any
  beforeEach(async () => { db = await createTestDb() })

  it('seede une fois puis pose le flag ; un 2e appel ne re-seede pas après suppression', async () => {
    await seedGuideFoldersOnce(db)
    expect(db.prepare("SELECT COUNT(*) c FROM folders WHERE guide_type IS NOT NULL").get().c).toBe(3)
    expect(db.prepare("SELECT value FROM settings WHERE key = 'guideFolders_seeded'").get().value).toBe('1')
    // L'utilisateur supprime tout ; le flag empêche la recréation auto.
    db.prepare("DELETE FROM folders WHERE guide_type IS NOT NULL").run()
    await seedGuideFoldersOnce(db)
    expect(db.prepare("SELECT COUNT(*) c FROM folders WHERE guide_type IS NOT NULL").get().c).toBe(0)
  })
})
```

- [ ] **Step 4: Lancer le test pour le voir échouer**

Run: `npx vitest run src/core/services/guideFolders.test.ts`
Expected: FAIL (module `./guideFolders` introuvable).

- [ ] **Step 5: Écrire le module**

Create `src/core/services/guideFolders.ts` :

```ts
import type Database from 'better-sqlite3'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getMacrosDir } from '../handlers/commands'
import { getFunctionsDir } from './variableResolver/customLoader'
import { createLogger } from '../utils/logger'

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
      log.warn(`mkdir échoué pour ${seed.dir}, dossier-guide ${seed.guideType} sauté`, e as Error)
      continue
    }

    const insert = db.transaction(() => {
      const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as max FROM folders').get() as { max: number }
      const folder = db.prepare(
        `INSERT INTO folders (name, default_cwd, guide_type, position, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      ).run(seed.name, seed.dir, seed.guideType, maxPos.max + 1)
      const conv = db.prepare(
        `INSERT INTO conversations (title, folder_id, updated_at)
         VALUES (?, ?, datetime('now'))`
      ).run(`Guide : ${seed.name}`, folder.lastInsertRowid)
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
```

- [ ] **Step 6: Lancer le test pour le voir passer**

Run: `npx vitest run src/core/services/guideFolders.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/core/services/guideFolders.ts src/core/services/guideFolders.test.ts src/core/handlers/commands.ts src/core/services/variableResolver/customLoader.ts
git commit -m "feat(core): seedGuideFolders — macros/functions/themes guide folders"
```

---

### Task 3: Câblage du seed one-shot dans `initDatabase`

**Files:**
- Modify: `src/core/db/database.ts:26-60`

**Interfaces:**
- Consumes: `seedGuideFoldersOnce` (Task 2).
- Produces: au premier lancement (DB déjà migrée), les 3 dossiers-guides existent ; jamais re-seedés ensuite.

- [ ] **Step 1: Importer la fonction**

Dans `src/core/db/database.ts`, sous l'import de `seedDefaults` (`database.ts:5`), ajouter :

```ts
import { seedGuideFoldersOnce } from '../services/guideFolders'
```

- [ ] **Step 2: Appeler après le try/catch (défensif)**

Dans `initDatabase`, juste avant l'accolade fermante de la fonction (après le bloc `catch`, soit après `database.ts:59`), ajouter :

```ts
  // Seed one-shot des dossiers-guides. Défensif : ne JAMAIS bloquer le boot
  // (la branche de récupération-corruption saute runMigrations → guide_type peut manquer ;
  // mkdir peut échouer). Le bouton Paramètres reste le filet de secours.
  try {
    await seedGuideFoldersOnce(db as any)
  } catch (err) {
    log.error('seedGuideFoldersOnce échoué (non bloquant)', err as Error)
  }
```

(`log` est déjà défini dans `database.ts` — vérifier ; sinon utiliser le logger existant du module.)

- [ ] **Step 3: Vérifier le build**

Run: `npm run build`
Expected: 0 erreur.

- [ ] **Step 4: Test d'intégration du démarrage**

Ajouter à `src/core/services/guideFolders.test.ts` un test qui simule le flux réel via le helper de DB migrée. Si `createTestDb()` applique déjà migrations + seed, vérifier l'idempotence du démarrage :

```ts
import { initDatabase, getDatabase, closeDatabase } from '../db/database'
```

> Si ce test d'intégration s'avère lourd à câbler (chemins WASM, singleton `db`), s'appuyer sur la couverture de `seedGuideFoldersOnce` de la Task 2 et valider le démarrage manuellement à la Task 6. Ne PAS écrire de test fragile.

- [ ] **Step 5: Commit**

```bash
git add src/core/db/database.ts src/core/services/guideFolders.test.ts
git commit -m "feat(core): seed guide folders once at initDatabase (non-blocking)"
```

---

### Task 4: Handler IPC `guides:reseed`

**Files:**
- Create: `src/core/handlers/guides.ts`
- Modify: `src/core/handlers/index.ts` (import + appel dans `registerCoreHandlers`)

**Interfaces:**
- Consumes: `seedGuideFolders` (Task 2), `HandleRegistrar`, `SqlJsAdapter`.
- Produces: canal dispatch `guides:reseed` → `Promise<{ created: number }>`.

- [ ] **Step 1: Écrire le handler**

Create `src/core/handlers/guides.ts` :

```ts
import type Database from 'better-sqlite3'
import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { seedGuideFolders } from '../services/guideFolders'

export function registerGuidesHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('guides:reseed', async () => {
    try {
      return await seedGuideFolders(db as unknown as Database.Database)
    } catch (err) {
      throw new Error(`Failed to reseed guide folders: ${(err as Error).message}`)
    }
  })
}
```

- [ ] **Step 2: Enregistrer le handler**

Dans `src/core/handlers/index.ts` :

1. Sous l'import des commands (`index.ts:18`), ajouter :

```ts
import { registerGuidesHandlers } from './guides'
```

2. Dans `registerCoreHandlers`, après `registerCommandsHandlers(registrar, db)` (`index.ts:73`), ajouter :

```ts
  registerGuidesHandlers(registrar, db)
```

- [ ] **Step 3: Vérifier le build**

Run: `npm run build`
Expected: 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add src/core/handlers/guides.ts src/core/handlers/index.ts
git commit -m "feat(ipc): guides:reseed handler"
```

---

### Task 5: Exposition préload `guides.reseed`

**Files:**
- Modify: `src/preload/index.ts` (ajouter le namespace `guides`)
- Modify: `src/preload/api.d.ts` (typer `guides.reseed`)
- Modify: `src/preload/index.test.ts` (test du canal)

**Interfaces:**
- Consumes: canal `guides:reseed` (Task 4).
- Produces: `window.agent.guides.reseed(): Promise<{ created: number }>`.

- [ ] **Step 1: Écrire le test (échouant)**

Dans `src/preload/index.test.ts`, ajouter un cas (suivre le style des tests existants qui assertent `h.invoke` reçoit le bon canal) :

```ts
it('guides.reseed invoque le canal guides:reseed', async () => {
  h.invoke.mockResolvedValueOnce({ created: 3 })
  const res = await (api as any).guides.reseed()
  expect(h.invoke).toHaveBeenCalledWith('guides:reseed')
  expect(res).toEqual({ created: 3 })
})
```

> Adapter `api` au nom réel de l'objet API construit dans ce fichier de test (lire l'en-tête `index.test.ts`).

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run src/preload/index.test.ts`
Expected: FAIL (`guides` undefined).

- [ ] **Step 3: Ajouter le namespace préload**

Dans `src/preload/index.ts`, après le bloc `macros: { ... }` (`index.ts:173-179`), ajouter :

```ts
  guides: {
    reseed: () => withTimeout(ipcRenderer.invoke('guides:reseed')),
  },
```

- [ ] **Step 4: Typer dans `api.d.ts`**

Dans `src/preload/api.d.ts`, après le bloc `macros { ... }` (`api.d.ts:161`), ajouter :

```ts
  guides: {
    reseed(): Promise<{ created: number }>
  }
```

- [ ] **Step 5: Lancer le test pour le voir passer**

Run: `npx vitest run src/preload/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/preload/index.ts src/preload/api.d.ts src/preload/index.test.ts
git commit -m "feat(preload): expose window.agent.guides.reseed"
```

---

### Task 6: Bouton « Recréer les dossiers-guides » (Paramètres → Général)

**Files:**
- Modify: `src/renderer/components/settings/GeneralSettings.tsx`

**Interfaces:**
- Consumes: `window.agent.guides.reseed()` (Task 5), `useConversationsStore().loadFolders` (`conversationsStore.ts:161`).
- Produces: UI — bouton qui reseede + rafraîchit la liste des dossiers + feedback `window.alert`.

> Glue triviale (invoke + alert + loadFolders), sans branchement métier : pas de test unitaire renderer (la couverture vit dans Task 2 et Task 5). Vérification manuelle ci-dessous.

- [ ] **Step 1: Importer le store**

Dans `src/renderer/components/settings/GeneralSettings.tsx`, ajouter en tête :

```ts
import { useConversationsStore } from '../../stores/conversationsStore'
```

- [ ] **Step 2: Ajouter le handler dans le composant**

Dans `GeneralSettings()` (après `const { settings, loadSettings, setSetting } = useSettingsStore()`), ajouter :

```ts
  const loadFolders = useConversationsStore((s) => s.loadFolders)
  const reseedGuides = async () => {
    try {
      const { created } = await window.agent.guides.reseed()
      await loadFolders()
      window.alert(created > 0
        ? `${created} dossier(s)-guide recréé(s).`
        : 'Tous les dossiers-guides sont déjà présents.')
    } catch (err) {
      window.alert(`Erreur : ${(err as Error).message}`)
    }
  }
```

- [ ] **Step 3: Ajouter la ligne de réglage**

Dans le JSX rendu, ajouter une `SettingRow` (composant déjà importé) avec un bouton, en suivant le style des boutons existants (`className="text-xs rounded px-2 py-1 border ..."`, cf. `GeneralSettings.tsx:252`) :

```tsx
        <SettingRow
          label="Dossiers-guides"
          description="Recrée les dossiers Macros, Fonctions et Thèmes avec leur guide. Les dossiers déjà présents sont conservés.">
          <button
            onClick={reseedGuides}
            className="text-xs rounded px-2 py-1 border mobile:text-base mobile:py-2">
            Recréer
          </button>
        </SettingRow>
```

> Vérifier la signature réelle de `SettingRow` (`src/renderer/components/shared/SettingRow.tsx`) et adapter `label`/`description`/children en conséquence.

- [ ] **Step 4: Vérifier le build**

Run: `npm run build`
Expected: 0 erreur.

- [ ] **Step 5: Vérification manuelle**

```bash
rm -f ~/.config/agent-desktop/agent.db   # repartir d'une DB neuve (ATTENTION: efface les données locales de dev)
npm run dev
```

Attendu :
1. Au lancement, 3 dossiers « Macros », « Fonctions », « Thèmes » apparaissent dans la sidebar, chacun contenant une conversation « Guide : … » dont le message affiche le markdown.
2. Le `default_cwd` de chaque dossier pointe vers le bon répertoire (vérifier via les réglages du dossier).
3. Supprimer un dossier → redémarrer → il ne réapparaît PAS.
4. Paramètres → Général → « Recréer » → le dossier supprimé revient ; les autres ne sont pas dupliqués ; alerte « 1 dossier(s)-guide recréé(s) ».
5. Re-cliquer « Recréer » → alerte « Tous les dossiers-guides sont déjà présents. ».

- [ ] **Step 6: Lancer toute la suite**

Run: `npm test`
Expected: suite verte (cf. CLAUDE.md pour les flakys connus webServer/variableResolver — relancer en isolation si touché).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/settings/GeneralSettings.tsx
git commit -m "feat(settings): bouton Recréer les dossiers-guides"
```

---

## Self-Review

**Spec coverage :**
- Seed 3 types (Macros/Fonctions/Thèmes) → Task 2 (`GUIDE_SEEDS`).
- `default_cwd` = répertoire → Task 2 (insert folder).
- Conversation pré-remplie d'un message `assistant` → Task 2 (insert conversation + message).
- Flag one-shot anti-reseed-démarrage → Task 2 (`seedGuideFoldersOnce`) + Task 3 (câblage).
- Marqueur `guide_type` anti-doublon → Task 1 (colonne) + Task 2 (create-if-missing).
- Bouton « Recréer » Paramètres → Task 4 (IPC) + Task 5 (préload) + Task 6 (UI).
- Réutilisation des résolveurs de dir (DRY) → Task 2 (Steps 1-2).
- Gestion d'erreurs non bloquante au démarrage → Task 3 (try/catch) + Task 2 (mkdir best-effort).
- Cas `created === 0` → Task 6 (alerte « déjà présents »).
- Suppressions définitives → Task 2 test `seedGuideFoldersOnce` + Task 6 vérif manuelle #3.

**Placeholder scan :** les seuls renvois « adapter à la signature réelle » concernent `SettingRow`, le nom de l'objet API dans `index.test.ts`, et le logger de `database.ts` — vérifications locales, pas du code manquant. Le contenu des guides, les inserts SQL, le handler et le préload sont fournis intégralement.

**Type consistency :** `seedGuideFolders`/`seedGuideFoldersOnce` (`Database.Database`) cohérents entre Task 2, 3, 4 ; `{ created: number }` identique Task 2 → 4 → 5 → 6 ; `guide_type` (valeurs `'macros'|'functions'|'themes'`) cohérent migration/seed/tests.

## Hors périmètre (rappel)
- Pas de re-seed auto si manquant au démarrage (flag suffit).
- Pas de versionnement/màj des guides existants.
- Pas de dossiers-guides Commands/Skills/Hooks/Knowledge.
