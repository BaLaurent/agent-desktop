# Dossiers-guides de découvrabilité — Design

**Date :** 2026-06-23
**Statut :** approuvé (design), spec en revue

## Problème

L'application permet de créer des **macros**, des **fonctions** et des **thèmes** en
éditant des fichiers sur le disque. Par défaut, l'utilisateur n'a **aucun moyen de
découvrir** que ces possibilités existent : rien dans l'UI ne les mentionne ni
n'indique où vivent les fichiers.

## Objectif

Au premier lancement, créer **trois dossiers de conversations** (« Macros »,
« Fonctions », « Thèmes »). Chaque dossier :

1. **pointe vers** son répertoire disque correspondant (`default_cwd`) ;
2. contient **une conversation pré-remplie** (« seedée ») dont l'unique message
   `assistant` est un guide markdown expliquant le type de config et comment créer
   un fichier.

Les dossiers sont **supprimables et renommables** comme n'importe quel dossier. Une
suppression volontaire est **définitive** (pas de re-création automatique). Un bouton
**« Recréer les dossiers-guides »** dans les Paramètres permet de les ré-obtenir à la
demande.

## Périmètre

| Inclus | Exclu (YAGNI) |
|---|---|
| Macros, Fonctions, Thèmes | Commands / Skills / Hooks / Knowledge |
| Seed one-shot au démarrage | Re-seed auto si manquant au démarrage |
| Bouton « Recréer » dans les Paramètres | Versionnement / mise à jour des guides existants |
| 1 message-guide `assistant` par dossier | Appel IA pour générer le contenu |

## Les deux mécanismes d'idempotence (point central)

Deux protections distinctes, chacune avec son rôle — ne pas les confondre :

1. **Flag global `guideFolders_seeded`** (table `settings`) → empêche le **re-seed
   automatique au démarrage**. Une fois posé, le démarrage ne seede plus jamais.
   C'est ce qui rend une suppression volontaire **définitive**.

2. **Marqueur `folders.guide_type`** (colonne) → rend le **bouton « Recréer »
   idempotent** : on ne recrée que les types dont aucun dossier `guide_type` n'existe,
   donc **jamais de doublon**. Survit au rename (la détection par nom serait cassée par
   « modifiable »), et distingue un dossier-guide d'un dossier « Macros » créé par
   l'utilisateur.

Sans (1), les suppressions reviendraient à chaque démarrage. Sans (2), le bouton
créerait des doublons et ne saurait pas reconnaître les dossiers-guides après rename.

## Architecture

### 1. Source unique — `src/core/services/guideFolders.ts`

Dans `core/` (zéro import `electron` → seedé aussi en runtime headless).

```
GUIDE_SEEDS: Array<{
  guideType: 'macros' | 'functions' | 'themes'
  name: string            // 'Macros' | 'Fonctions' | 'Thèmes'
  dir: string             // répertoire disque cible
  guideMarkdown: string   // contenu du message assistant (FR)
}>

seedGuideFolders(db): { created: number }
```

`seedGuideFolders` — pour chaque entrée de `GUIDE_SEEDS` :
- si **un dossier `guide_type = X` existe déjà** → sauter (idempotent) ;
- sinon : `fs.promises.mkdir(dir, { recursive: true })`, puis en transaction :
  1. insérer le dossier (`name`, `default_cwd = dir`, `guide_type = X`,
     `position` après les dossiers existants) ;
  2. insérer une conversation dans ce dossier ;
  3. insérer **un message** `role = 'assistant'`, `content = guideMarkdown`.
- retourne `{ created }` (nombre de dossiers réellement créés).

Aucun appel IA : ce sont uniquement des lignes en base.

### 2. Résolution des répertoires (DRY)

Réutiliser les résolveurs existants, **ne pas recalculer** :
- **Macros** : exporter `getMacrosDir()` depuis `src/core/handlers/commands.ts`
  (actuellement non exporté).
- **Fonctions** : exporter le dir depuis
  `src/core/services/variableResolver/customLoader.ts` (constante `DEFAULT_DIR`,
  via un getter exporté `getFunctionsDir()`).
- **Thèmes** : **cas particulier** — le dir des thèmes est résolu côté electron
  (`src/main/services/themes.ts:6`, `app.getPath('home')`) ; la `ThemesService` (core)
  le reçoit par injection et ne le connaît pas. Il n'existe donc **pas** de résolveur
  thèmes côté `core/`. `guideFolders.ts` reconstitue le chemin
  `join(homedir(), '.agent-desktop', 'themes')`, avec un commentaire `ponytail:`
  documentant que c'est la même connaissance que le câblage electron, ré-énoncée pour
  le runtime core.

### 3. Démarrage one-shot

Après `initDatabase` (chemin de démarrage partagé electron + headless) :
- lire le setting `guideFolders_seeded` ;
- si absent → `await seedGuideFolders(db)` puis `setSetting(db, 'guideFolders_seeded', '1')`.

Placement : à proximité de la création du dossier par défaut « Unsorted », mais
**après** `initDatabase` (et non dans `runMigrations`), car le seed fait de l'I/O disque
(`mkdir`) et porte du contenu — il ne relève pas d'une migration de schéma.

### 4. IPC — `guides:reseed`

Handler dans `src/core/handlers/` (suivre le pattern des handlers core existants,
ex. `commands.ts`). Appelle `seedGuideFolders(db)` (create-if-missing via `guide_type`,
donc sans doublon) et renvoie `{ created }`. Exposé au renderer via le bridge dispatch
habituel.

### 5. UI — bouton « Recréer les dossiers-guides »

Dans `src/renderer/components/settings/GeneralSettings.tsx` : un bouton qui
`invoke('guides:reseed')` puis affiche un toast « N dossier(s) recréé(s) » (ou
« Tous les dossiers-guides sont déjà présents » si `created === 0`). Doit déclencher un
rafraîchissement de la liste des dossiers (même mécanisme que `folders:create`).

### 6. Schéma — migration

Ajouter `folders.guide_type TEXT` (nullable, défaut `NULL`). Même pattern de migration
additive que les colonnes existantes (`is_default`, `color`, `default_cwd`).

## Contenu des guides (markdown FR)

Un guide par type, seedé tel quel comme message `assistant`. Chaque guide couvre :
- ce qu'est le type de config (1-2 phrases) ;
- « ce dossier pointe vers `<chemin>` » (le `default_cwd`) ;
- comment créer un fichier : nom, format, exemple minimal ;
- mention que le dossier est **supprimable** (et recréable via les Paramètres).

Exemples de chemins affichés : `~/.agent-desktop/macros/` (`.json`),
`~/.agent-desktop/functions/` (`.ts`), `~/.agent-desktop/themes/` (`.css`).

## Flux de données

```
Premier lancement
  initDatabase → setting 'guideFolders_seeded' absent
    → seedGuideFolders(db)
        pour chaque type sans guide_type :
          mkdir dir ; INSERT folder(default_cwd=dir, guide_type) ;
          INSERT conversation ; INSERT message(assistant, guideMarkdown)
    → setSetting('guideFolders_seeded','1')

Lancements suivants
  setting présent → aucun seed (suppressions respectées)

Bouton Paramètres « Recréer »
  invoke('guides:reseed') → seedGuideFolders(db) [create-if-missing] → toast
```

## Gestion d'erreurs

- `mkdir` échoue (permissions) → l'entrée concernée est sautée, l'erreur est loggée
  via le logger structuré ; les autres types continuent. Le démarrage n'est jamais
  bloqué par le seed.
- Le flag `guideFolders_seeded` est posé **après** la tentative de seed, qu'elle ait
  créé 0 ou N dossiers — un disque non inscriptible au premier lancement ne doit pas
  reseeder en boucle ; le bouton Paramètres reste le filet de secours.
- Insertions dossier+conversation+message enveloppées dans `db.transaction()` (pattern
  existant pour les ops multi-lignes), pour éviter un dossier-guide sans conversation.

## Tests

Un test core sur `seedGuideFolders` (`src/core/services/guideFolders.test.ts`,
`createTestDb()` async) :
- premier appel crée 3 dossiers, 3 conversations, 3 messages `assistant` ;
- chaque dossier a `default_cwd` non nul et `guide_type` correct ;
- **idempotence** : second appel → `created === 0`, aucun doublon ;
- si un seul `guide_type` est supprimé puis re-appel → recrée uniquement celui-là.

## Fichiers touchés

| Fichier | Action |
|---|---|
| `src/core/db/schema.ts` | migration `folders.guide_type TEXT` |
| `src/core/services/guideFolders.ts` | **nouveau** — `GUIDE_SEEDS` + `seedGuideFolders` |
| `src/core/services/guideFolders.test.ts` | **nouveau** — test idempotence |
| `src/core/handlers/commands.ts` | exporter `getMacrosDir()` |
| `src/core/services/variableResolver/customLoader.ts` | exporter `getFunctionsDir()` |
| `src/core/handlers/` (guides) | **nouveau** handler `guides:reseed` |
| démarrage (`initDatabase` caller, electron + headless) | seed one-shot gardé par flag |
| `src/renderer/components/settings/GeneralSettings.tsx` | bouton « Recréer » |
| préload / contrat IPC | exposer `guides:reseed` |

## Hors périmètre

- Aucun re-seed automatique au démarrage si un dossier manque (le flag suffit).
- Aucun versionnement ni mise à jour du contenu des guides déjà seedés.
- Pas de dossiers-guides pour Commands / Skills / Hooks / Knowledge.
