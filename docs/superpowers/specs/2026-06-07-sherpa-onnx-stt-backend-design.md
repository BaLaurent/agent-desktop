# Design — moteur STT sherpa-onnx (multi-architectures) + consolidation Parakeet

- **Date** : 2026-06-07
- **Statut** : design validé (brainstorming), prêt pour writing-plans
- **Cible** : Linux (utilisateur sur Arch)

## 1. Contexte

L'app a deux backends STT, sélectionnés par le setting `stt_backend` :

- **whisper** — binaire externe (`whisper-cli`) lancé via `child_process.spawn` dans le
  process **main** (`core/services/whisper.ts`, handler `core/handlers/whisper.ts`).
- **parakeet** — `parakeet.js` + `onnxruntime-web` (WASM) dans un **Web Worker renderer**
  (`renderer/services/parakeet/`), modèles servis via le protocole `agent-model://`.

Problèmes du backend Parakeet actuel :

1. une seule architecture supportée (Parakeet/NeMo TDT, moteur d'inférence hardcodé) ;
2. re-téléchargement fragile (cache IndexedDB par-origine) ;
3. nomenclature de fichiers rigide en mode manuel.

`sherpa-onnx` (k2-fsa, npm `sherpa-onnx`, addon natif N-API ~v1.13) gère plusieurs familles
ONNX (Transducer/Zipformer, Whisper, Paraformer, NeMo CTC) et charge les modèles **depuis
des dossiers sur disque** — ce qui règle d'un coup la persistance ET la flexibilité.
sherpa-onnx couvre aussi la famille Parakeet (transducer NeMo), donc il **remplace** le
backend Parakeet actuel au lieu de cohabiter avec lui.

## 2. Objectifs / Non-objectifs

**Objectifs**

- Backends STT finaux : **`whisper` + `sherpa`** (sherpa absorbe Parakeet).
- sherpa tourne dans le process **main** (addon natif), pas de WASM/CSP/IndexedDB.
- Auto-détection de l'architecture d'après les fichiers présents dans le dossier modèle.
- Acquisition modèle : **preset téléchargeable** (1 = Parakeet) **+ dossier manuel**.
- Catalogue de presets = **source de vérité unique** dans les sources, facile à éditer.
- Modèles persistés sur disque dans `~/.agent-desktop/stt-models/<id>/`.
- whisper intact ; wakeword/voix-continue (openWakeWord) intact.

**Non-objectifs (YAGNI)**

- Pas de reconnaisseur **streaming** sherpa (offline/batch uniquement, comme whisper).
- Pas d'override manuel de l'architecture (auto-détection + rapport seulement).
- Pas d'extraction d'archive `.tar.bz2` (download fichier-par-fichier — Node n'a pas bz2).
- Pas de catalogue multi-modèles (1 preset Parakeet ; les autres familles passent par le
  dossier manuel).

## 3. Décisions clés (issues du brainstorming)

| # | Décision | Raison |
|---|----------|--------|
| D1 | Cibler le **format sherpa-onnx** des modèles (pas les exports NeMo/onnx-asr bruts) | sherpa n'accepte pas un `decoder_joint` fusionné ; il veut encoder/decoder/joiner séparés. Fiabilité. |
| D2 | **Supprimer** l'implémentation Parakeet renderer ; sherpa la remplace | Éviter deux moteurs ONNX parallèles (anti-DRY). |
| D3 | Acquisition = **preset (Parakeet) + dossier manuel** | Confort sur le besoin immédiat, couverture totale via manuel. |
| D4 | Download **fichier-par-fichier** depuis HF (`/resolve/main/<file>`) | Zéro dépendance d'extraction bzip2. |
| D5 | Catalogue presets = **module TS typé unique** (`core/services/sherpaPresets.ts`) | Une seule place à éditer si un lien casse ; lu par main + renderer. |
| D6 | Auto-détection d'archi + **rapport** dans « Test Configuration » | KISS, miroir whisper. |
| D7 | `require('sherpa-onnx')` **lazy** (try/catch) | Build + autres backends survivent si la dép n'est pas installée. |
| D8 | Renommer `parakeetProtocol.ts` → `modelProtocol.ts` | Le fichier sert aussi le hotword + le runtime ORT ; le nom ment. |
| D9 | Install `sherpa-onnx` par l'**utilisateur** (`! npm install sherpa-onnx`), Phase 0 + smoke-test ABI | Garde-fou supply-chain ; vérifier N-API/Electron avant tout code feature. |

## 4. Architecture

### 4.1 Nouveaux modules

```
core/services/sherpaStt.ts      # détection archi + transcribe + validateConfig (lazy require)
core/services/sherpaPresets.ts  # SHERPA_MODEL_PRESETS — source de vérité unique (donnée pure)
core/handlers/sherpa.ts         # registerSherpaHandlers → sherpa:transcribe / :validateConfig / :downloadModel
main/services/sherpa.ts         # stub no-op + re-exports pour tests (miroir main/services/whisper.ts)
renderer/components/settings/SherpaSettings.tsx  # UI preset + dossier manuel + test
```

### 4.2 `core/services/sherpaStt.ts` — module profond

Interface simple, complexité cachée. Trois fonctions :

- `detectArchitecture(fileNames: string[]): SherpaModelLayout` — **fonction pure**, aucun
  addon, 100 % testable. Heuristique sur les noms de fichiers :
  - un fichier matchant `joiner` → **transducer** (`encoder` / `decoder` / `joiner` + `tokens.txt`)
  - `encoder` + `decoder` sans `joiner` → **whisper** (encoder / decoder + `tokens.txt`)
  - `paraformer` ou un `model.onnx` unique + `tokens.txt` → **paraformer**
  - sinon, un `.onnx` unique + `tokens.txt` → **nemoCtc**
  - aucun match exploitable → `throw` avec message listant les fichiers vus et ce qui manque.
  Retourne le layout résolu (famille + chemins absolus des fichiers + tokens).
- `transcribe(db, wavBuffer): Promise<{ text: string }>` — lit `sherpa_modelPath`, résout
  le layout, construit l'`OfflineRecognizerConfig` correspondant, décode le WAV mono 16 kHz,
  renvoie le texte. **Cache** le `OfflineRecognizer` (clé = `modelPath`) ; invalidé quand
  `sherpa_modelPath` change.
- `validateConfig(db): { modelPath, detected, files, ok, detail? }` — pour le bouton
  « Test Configuration » (miroir whisper). Affiche l'archi détectée + les fichiers trouvés.

**Lazy require** : `sherpa-onnx` est chargé via `require()` paresseux dans un try/catch.
Absent → erreur explicite « lance `npm install sherpa-onnx` ». Jamais d'import top-level.

### 4.3 `core/services/sherpaPresets.ts` — catalogue unique

Donnée pure, importée par le renderer (liste UI) **et** le main (résolution download) :

```ts
export interface SherpaModelPreset {
  id: string            // dossier cible : ~/.agent-desktop/stt-models/<id>/
  label: string         // libellé UI
  description: string
  repo: string          // dépôt HF, ex. 'csukuangfj/...'
  files: string[]       // fichiers à télécharger depuis /resolve/main/<file>
}
export const SHERPA_MODEL_PRESETS: SherpaModelPreset[] = [ /* Parakeet TDT 0.6B v3 */ ]
```

Ajouter/réparer un modèle = éditer **ce seul fichier**. Les URLs Parakeet exactes sont
**vérifiées au moment de l'implémentation** (un lien mort est pire que pas de preset).

### 4.4 Seam IPC (patron whisper)

- `core/handlers/sherpa.ts` enregistre via `registrar.handle` :
  - `sherpa:transcribe` (WAV `Uint8Array` → `{ text }`)
  - `sherpa:validateConfig`
  - `sherpa:downloadModel` (presetId → télécharge les fichiers dans
    `~/.agent-desktop/stt-models/<id>/`, écrit `sherpa_modelPath`, progression via events)
- Enregistré dans `core/handlers/index.ts` (à côté de `registerWhisperHandlers`).
- `main/services/sherpa.ts` : stub no-op + re-exports (miroir `main/services/whisper.ts`).
- `preload/index.ts` + `api.d.ts` : bloc `sherpa: { transcribe, validateConfig, downloadModel }`
  calqué sur `whisper`.

### 4.5 Download (main)

Le téléchargement vit dans le **main** (accès FS, pas de CORS). Pour chaque fichier du preset :
fetch `https://huggingface.co/<repo>/resolve/main/<file>` → écrit dans
`~/.agent-desktop/stt-models/<id>/<file>` (`fs.promises`, I/O async only). Progression
rapportée au renderer. Au succès, `sherpa_modelPath` = le dossier cible.

### 4.6 Routage renderer

`renderer/services/transcription/transcribeAudioBuffer.ts` :

- `getSttBackend()` élargi : `'whisper' | 'sherpa'` (la branche `parakeet` disparaît).
- branche `sherpa` → `window.agent.sherpa.transcribe(new Uint8Array(encodeWav(buffer, 16000)))`
  (chemin WAV → main, **identique** à whisper ; **pas** le chemin PCM/worker de Parakeet).

### 4.7 UI réglages

- `SherpaSettings.tsx` (calqué `ParakeetSettings`) : Segmented **Preset / Dossier manuel**.
  - Preset : liste depuis `SHERPA_MODEL_PRESETS`, bouton « Télécharger », barre de progression.
  - Manuel : input + Browse (`system.selectFolder`), placeholder `~/.agent-desktop/stt-models/...`.
  - « Test Configuration » → `validateConfig`, affiche l'archi détectée + fichiers.
  - Note d'install `sherpa-onnx`.
- `VoiceInputSettings.tsx` : sélecteur à **2 boutons** (`whisper` / `sherpa`) ;
  `{sttBackend === 'sherpa' && <SherpaSettings />}`.
- `core/db/seed.ts` : ajoute `['sherpa_modelPath', '']` ; **retire** les defaults `parakeet_*`.

## 5. Suppression Parakeet (chirurgicale, même commit que la migration)

Consommateurs migrés ensemble (autorisé : « update ALL consumers in the same commit »).

- 🗑️ **DELETE** : `renderer/services/parakeet/` (index, worker, tests),
  `renderer/components/settings/ParakeetSettings.tsx`, dép `parakeet.js` (package.json),
  mémoire `feature_parakeet_stt.md`.
- ✏️ **EDIT** : `transcribeAudioBuffer.ts`, `renderer/stores/voiceInputStore.ts` (+ test),
  `core/db/seed.ts`, `preload/*`, `VoiceInputSettings.tsx`.
- ✏️ **EDIT + RENAME** : `parakeetProtocol.ts` → `modelProtocol.ts` — retirer la branche
  modèle Parakeet (`parakeet_modelSource`/`parakeet_modelPath`), **garder** le service
  hotword + le serving du runtime ORT-WASM ; maj import dans `main/index.ts` + note CLAUDE.md.
- ✅ **GARDER** : `onnxruntime-web` (transitif, requis par le wakeword), `openwakeword-js`,
  tout le hotword/wakeword, `hotwordTrainer.ts`, le protocole `agent-model://`.

> ⚠️ Garde-fou : `parakeetProtocol.ts` sert AUSSI le wakeword (openWakeWord consomme
> `agent-model://hotword/...` et le même runtime ORT). Ne PAS le supprimer ni retirer
> `onnxruntime-web` — sinon la voix continue casse.

## 6. Tests

- `sherpaStt.test.ts` — table de cas `detectArchitecture` (chaque famille + échec), **sans**
  addon : c'est le gros du coverage.
- `transcribeAudioBuffer` — nouveau cas routage `sherpa` (mock `window.agent.sherpa`) ;
  retrait des cas `parakeet`.
- `SherpaSettings` — rendu, liste presets, Browse, affichage détection (mock `window.agent`).
- `sherpaPresets` — sanity (ids uniques, champs non vides).
- `transcribe()` / `validateConfig()` réels — derrière un guard « addon présent » (skip si
  `sherpa-onnx` non installé) pour ne pas casser la CI sans la dép.
- Retrait des tests Parakeet supprimés (`parakeet/index.test.ts`, `parakeetProtocol.test.ts`
  → adapter en `modelProtocol.test.ts` côté hotword).

## 7. Dépendance (gate supply-chain)

`sherpa-onnx` est un addon natif → **l'utilisateur** lance `! npm install sherpa-onnx`.
**Phase 0** du plan : install + **smoke-test** `require('sherpa-onnx')` dans le process main
Electron (vérifie l'ABI N-API/Electron) AVANT d'écrire le code feature.

## 8. Risques

- **ABI natif dans Electron** — mitigé : sherpa-onnx est N-API (ABI-stable, compatible
  Electron sans `electron-rebuild`). Vérifié en Phase 0.
- **Packaging** — electron-builder doit inclure le `.node` natif (`asar: false` déjà en place).
  À valider sur `dist:linux` (hors périmètre code, noté pour QA release).
- **URLs HF** — vérifiées à l'implémentation ; centralisées dans `sherpaPresets.ts` (D5).
- **Coût par-utterance (voix continue)** — atténué par le cache du `OfflineRecognizer`.

## 9. Conformité aux règles projet

- Nouveau backend = **nouveaux modules**, zéro conditionnel ajouté dans whisper (OCP).
- `detectArchitecture` pure = module profond, interface triviale, testable seule.
- Frontière `core/` (logique partagée, pas d'import `electron`) vs `main/` (câblage) respectée :
  `sherpaStt`/`sherpaPresets`/`handlers` en core, stub + protocole en main.
- DRY : catalogue presets en source unique ; pas de pattern parallèle (seam = celui de whisper).
- Suppression Parakeet = migration tous-consommateurs dans le même commit (deprecation OK).

## 10. Phasage indicatif (détaillé en writing-plans)

0. Install `sherpa-onnx` + smoke-test ABI Electron.
1. `core/services/sherpaStt.ts` (`detectArchitecture` + tests) — TDD, sans addon.
2. `sherpaPresets.ts` + URLs Parakeet vérifiées.
3. `transcribe`/`validateConfig` + handlers + stub main + preload.
4. `sherpa:downloadModel` (main).
5. Suppression Parakeet + renommage protocole + migration consommateurs.
6. `SherpaSettings.tsx` + `VoiceInputSettings` (2 boutons) + seed.
7. Tests d'intégration, audit dedup, CLAUDE.md + mémoire.
