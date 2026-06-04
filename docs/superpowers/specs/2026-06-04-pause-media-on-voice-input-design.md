# Pause des lecteurs média pendant la saisie vocale

**Date :** 2026-06-04
**Statut :** Validé (design)

## Objectif

Quand la saisie vocale (capture micro pour transcription whisper) démarre, mettre en
**pause** les lecteurs média en cours de lecture (Spotify, navigateurs, VLC… via MPRIS),
puis **les reprendre** quand la saisie vocale se termine. Ce comportement est un **réglage
opt-in** que l'utilisateur active ou désactive.

Ce comportement est **distinct et complémentaire** du « ducking » de volume existant
(`voice_volumeDuck`), qui baisse le volume système sans arrêter la lecture.

## Contexte du code existant

- Le ducking de volume vit dans `src/core/utils/volume.ts` (headless-safe, sans import
  `electron`) : `duckVolume` / `restoreVolume` (volume système), `duckOtherStreams` /
  `restoreOtherStreams` (par-stream pour la TTS). Backends auto-détectés : wpctl / pactl /
  amixer. **Linux-only**, no-op gracieux si aucun backend.
- Le ducking est déclenché sur **deux couches volontairement redondantes** :
  1. **Renderer → IPC** : `voiceInputStore.ts` appelle `window.agent.voice.duck()` au
     démarrage (ligne 83) et `window.agent.voice.restore()` à l'arrêt/annulation
     (lignes 102, 109, 164). Les handlers `voice:duck` / `voice:restore` sont dans
     `src/core/handlers/whisper.ts`. Cette couche couvre le micro in-app **et** l'overlay
     Quick Voice (OverlayVoice monte → `startRecording` → `voice:duck`).
  2. **Main (filet de sécurité)** : `src/main/services/quickChat.ts` rejoue duck/restore
     autour du cycle de vie de la fenêtre overlay — `duckVolume` dans `showOverlay('voice')`
     (ligne 155), `restoreVolume()` dans `win.on('closed')` (ligne 126) et au re-toggle
     (ligne 137). Nécessaire car le renderer ne garantit pas un restore propre si la
     fenêtre est détruite sans transcription.
- Les guards idempotents (`savedVolume === null`) rendent les doubles appels sûrs.
- **Aucune** intégration MPRIS / playerctl / D-Bus média n'existe. La « pause » de lecteur
  est un concept neuf.
- Pattern de réglage booléen global : whitelist `ALLOWED_SETTING_KEYS` dans
  `src/core/services/settings.ts`, stockage clé/valeur string dans la table `settings`
  (sql.js), toggle UI dans les composants `settings/*`. `voice_volumeDuck` est l'exemple
  de référence (global, lu via `getSetting(db)`, non cascadé).

## Décisions

| Décision | Choix |
|---|---|
| Mécanisme | `playerctl` (MPRIS). No-op gracieux si binaire absent, comme wpctl/pactl. |
| Plateforme | Linux-only (cohérent avec le ducking existant). Pas de Windows/SMTC. |
| Reprise | **Uniquement** les lecteurs qu'on a mis en pause (statut `Playing` au démarrage). On ne relance jamais un média que l'utilisateur avait déjà mis en pause. |
| Orchestration | Seam unique : un module mécanisme `mediaPlayers.ts` + une paire policy `applyVoiceAudioEffects` / `clearVoiceAudioEffects` (source unique de la connaissance « effets audio pendant la saisie vocale »). |
| Réglage | `voice_pauseMediaPlayers`, global-only, défaut `'false'` (opt-in). |
| Timing reprise | Dès l'arrêt de l'enregistrement (même instant que le restore volume, avant la fin de la transcription whisper). |
| Noms canaux IPC | Conservation de `voice:duck` / `voice:restore` (rôle élargi à « effets audio début/fin »). Pas de renommage → évite de toucher preload + renderer. |

## Architecture

### Nouveaux modules

**`src/core/utils/mediaPlayers.ts`** — mécanisme (miroir structurel de `volume.ts`)

Contrôle des lecteurs MPRIS via `playerctl`, exécuté avec `execFile` (pas de shell).

Interface publique :
- `pauseMediaPlayers(): Promise<void>`
  - Idempotent : si `pausedPlayers !== null` (déjà actif), retour immédiat.
  - Détecte `playerctl` via `findBinaryInPath('playerctl')` (caché). Absent → retour sans
    rien marquer (`pausedPlayers` reste `null` → reprise = no-op).
  - Énumère les lecteurs (`playerctl --list-all`), interroge chaque statut
    (`playerctl -p <name> status`), met en pause (`playerctl -p <name> pause`) **uniquement
    ceux en `Playing`**, mémorise leurs noms dans `pausedPlayers`.
  - Stocke la promesse en cours dans `pausePromise` (protection de course).
- `resumeMediaPlayers(): Promise<void>`
  - Attend `pausePromise` si en cours (comme `restoreVolume` attend `duckPromise`).
  - Si `pausedPlayers === null` → no-op.
  - Pour chaque nom mémorisé : `playerctl -p <name> play`, best-effort (`.catch` ignoré :
    le lecteur peut avoir été fermé entre-temps).
  - Reset `pausedPlayers = null`.
- `_resetForTesting(): void` — réinitialise l'état du module (caché playerctl, `pausedPlayers`,
  `pausePromise`), comme `volume.ts`.

État du module (non exporté) : `pausedPlayers: string[] | null`, `pausePromise`,
cache de détection playerctl.

**`src/core/services/voiceAudioEffects.ts`** — policy / source unique

- `applyVoiceAudioEffects(db): Promise<void>`
  - `voice_volumeDuck` > 0 → `duckVolume(n)`.
  - `voice_pauseMediaPlayers === 'true'` → `pauseMediaPlayers()`.
- `clearVoiceAudioEffects(db): Promise<void>`
  - `restoreVolume()` + `resumeMediaPlayers()` (les deux idempotents).

### Modules modifiés

- **`src/core/handlers/whisper.ts`** : `voice:duck` → `await applyVoiceAudioEffects(db)` ;
  `voice:restore` → `await clearVoiceAudioEffects(db)`. La lecture de `voice_volumeDuck`
  migre dans `applyVoiceAudioEffects` (la duplication pré-existante avec quickChat disparaît).
- **`src/main/services/quickChat.ts`** : remplace `duckVolume(duck)` (ligne 155) par
  `applyVoiceAudioEffects(db)` (fire-and-forget, `.catch` ignoré) et les deux
  `restoreVolume()` (lignes 126, 137) par `clearVoiceAudioEffects(db)`. Le filet de
  sécurité `win.on('closed')` est conservé.
- **`src/core/services/settings.ts`** : ajout de `'voice_pauseMediaPlayers'` à
  `ALLOWED_SETTING_KEYS`, à côté de `'voice_volumeDuck'`.
- **`src/renderer/components/settings/QuickChatSettings.tsx`** : case à cocher sous le
  slider « Voice Volume » — `checked={settings.voice_pauseMediaPlayers === 'true'}`,
  `onChange` → `setSetting('voice_pauseMediaPlayers', e.target.checked ? 'true' : 'false')`,
  avec texte d'aide.

## Flux de données

```
Démarrage micro (in-app OU overlay Quick Voice)
  → IPC voice:duck → applyVoiceAudioEffects(db)
       ├─ voice_volumeDuck > 0           → duckVolume(n)
       └─ voice_pauseMediaPlayers='true' → pauseMediaPlayers()   (pause les Playing, mémorise)

quickChat.showOverlay('voice')           → applyVoiceAudioEffects(db)   [couche sécurité main]

Arrêt / annulation
  → IPC voice:restore → clearVoiceAudioEffects(db) → restoreVolume() + resumeMediaPlayers()
quickChat win.on('closed') / re-toggle   → clearVoiceAudioEffects(db)   [filet de sécurité]
```

## Gestion d'erreurs

- `playerctl` absent → no-op total, aucune erreur remontée (identique aux backends volume absents).
- Lecteur fermé entre pause et reprise → `playerctl play` échoue → `.catch` ignoré.
- Exécution via `execFile` uniquement (pas de shell → pas d'injection), même posture que `volume.ts`.
- Guards idempotents + `pausePromise` (protection de course) pour survivre au double appel
  renderer/main de façon symétrique à `duckPromise` dans `volume.ts`.

## Tests

- **`src/core/utils/mediaPlayers.test.ts`** (miroir de `volume.test.ts`, mock `execFile` +
  `findBinaryInPath`) :
  - pause uniquement les lecteurs `Playing` (ignore `Paused`/`Stopped`) ;
  - reprend uniquement les lecteurs mémorisés ;
  - idempotence : second `pauseMediaPlayers` = no-op ;
  - `resumeMediaPlayers` sans pause préalable = no-op ;
  - `playerctl` absent → no-op (aucune commande exécutée) ;
  - lecteur fermé à la reprise → erreur avalée, pas de throw ;
  - course : `resumeMediaPlayers` attend une `pauseMediaPlayers` encore en cours.
- **`src/core/services/voiceAudioEffects.test.ts`** (mock `volume`, `mediaPlayers`,
  `getSetting`) :
  - les 2 réglages on → `duckVolume` + `pauseMediaPlayers` ;
  - duck seul / pause seule / aucun → appels attendus uniquement ;
  - `clearVoiceAudioEffects` → `restoreVolume` + `resumeMediaPlayers`.
- **`src/renderer/components/settings/QuickChatSettings.test.tsx`** : le toggle se rend,
  reflète `voice_pauseMediaPlayers`, écrit `'true'`/`'false'`.
- **`src/core/handlers/whisper.test.ts`** (si présent) : mise à jour — les handlers
  délèguent désormais à l'orchestration.

## Hors périmètre

- Support Windows (SMTC) / macOS.
- Pause via D-Bus MPRIS direct (on utilise `playerctl`).
- Renommage des canaux IPC `voice:duck` / `voice:restore`.
- Toute interaction avec le ducking par-stream de la TTS (`duckOtherStreams`).
