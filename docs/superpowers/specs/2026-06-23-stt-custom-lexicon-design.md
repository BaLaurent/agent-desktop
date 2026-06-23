# Lexique de mots personnalisés pour la STT — Design

**Date** : 2026-06-23
**Statut** : validé (brainstorming), prêt pour le plan d'implémentation

## Problème

L'utilisateur veut maintenir une liste de mots qu'il emploie souvent (noms propres,
jargon, marques) mais que la reconnaissance vocale transcrit mal — ex. « Toto », « Zorglub ».
Aucune interface ne permet aujourd'hui d'enrichir le vocabulaire des moteurs STT.

État actuel :
- **Whisper** : un champ libre « Initial Prompt » existe (`whisper_advancedParams.prompt`,
  passé en `--prompt`), mais il est enfoui dans *Advanced Parameters* et n'est pas pensé comme un lexique.
- **Sherpa / Parakeet** (preset `parakeet-tdt-0.6b-v3-int8`, famille `transducer`) : aucun
  mécanisme de biais. La config passée à `new OfflineRecognizer(...)` n'expose ni `hotwordsFile`
  ni `hotwordsScore`.

## Objectif

Un **lexique unifié** — une seule liste de mots gérée par l'utilisateur — appliqué quel que
soit le moteur actif :
- **Sherpa** : généré en fichier hotwords + biais contextuel appliqué en continu.
- **Whisper** : pré-remplit le champ Initial Prompt (éditable, pas de synchro continue).

## Faisabilité — vérifiée empiriquement

Un probe jetable (`scratchpad/hotwords-probe.js`) sur le modèle déjà téléchargé a prouvé,
sur un vrai échantillon de parole, que :

| Condition | Résultat |
|---|---|
| `modified_beam_search` sur TDT | ✅ fonctionne (la crainte « TDT greedy-only » est levée) |
| binding offline lit `hotwordsFile`/`hotwordsScore` | ✅ (le C++ appelle `InitHotwords`) |
| texte brut « Zorglub » sans `bpe.vocab` | ❌ `Cannot find ID for token Zorglub` → hotword ignoré |
| forme pré-tokenisée `▁Z or gl ub` | ✅ encodée, et `score=10` → « Zorglub » apparaît dans la sortie |
| score trop élevé (≥20) | ⚠️ sur-boost : le mot est halluciné partout |

Conformité best-practice (doc officielle k2-fsa, sources en fin de document) :
- hotwords = **transducer uniquement** + **`modified_beam_search` obligatoire** ✅
- la voie recommandée tokenise du **texte brut** via `modeling_unit` + `bpe_vocab` ; la forme
  **pré-tokenisée** (`▁HE LL O ▁WORLD`) est le mode de secours documenté quand il n'y a pas de vocab.
- Notre preset HF ne fournit **pas** de `bpe.vocab` → d'où le design **hybride** ci-dessous.

## Décisions de design (arbitrages validés)

1. **Lexique unifié** appliqué aux deux moteurs.
2. **Whisper** : le lexique *pré-remplit* le prompt (éditable ensuite, **pas** de synchro continue).
3. **Force du boost** : slider 3 crans (Doux / Normal / Fort) par défaut **+** option avancée
   « score personnalisé » qui force une valeur libre.
4. **Tokenisation Sherpa : hybride** — si un `bpe.vocab` est présent dans le dossier modèle →
   voie officielle (`modeling_unit` + texte brut) ; sinon → auto-tokenisation (longest-match
   contre `tokens.txt`).

## Architecture

### Modèle de données (settings globaux, non cascadés — comme les autres `stt_*`)

Enregistrés dans `core/services/settings.ts` :

| Clé | Type | Défaut | Rôle |
|---|---|---|---|
| `stt_lexicon` | JSON `string[]` | `[]` | Magasin canonique unique des mots/phrases |
| `sherpa_hotwordsSensitivity` | `'soft' \| 'normal' \| 'strong'` | `'normal'` | Cran du slider |
| `sherpa_hotwordsScoreOverride` | numérique (string) | `''` (vide) | Option avancée — vide = on utilise la sensibilité |

### Nouveau module : `core/services/sherpaHotwords.ts`

Pur, testable, **sans import `electron`** (tourne dans le process main mais reste headless-safe).
Interface (deep module — interface simple cachant la complexité de tokenisation) :

```ts
/** Pièces valides (1er champ de chaque ligne de tokens.txt). */
export function loadTokenPieces(tokensPath: string): Promise<Set<string>>

/** Découpe un mot/phrase en pièces existantes. ▁ au début de chaque mot, longest-match glouton.
 *  Retourne null si un caractère est introuvable (entrée à skipper). */
export function tokenizeEntry(text: string, pieces: Set<string>): string | null

/** Mappe la sensibilité (ou l'override) vers un hotwords-score numérique. */
export function resolveScore(sensitivity: string, override: string): number

/** Résout la stratégie hotwords pour un dossier modèle donné.
 *  Branche sur la présence d'un bpe.vocab (voie officielle vs auto-tokenisation). */
export function buildHotwords(args: {
  modelDir: string
  fileNames: string[]      // pour détecter bpe.vocab (même source que detectArchitecture)
  lexicon: string[]
  pieces: Set<string>      // utilisé seulement en auto-tokenisation
}): {
  content: string          // contenu du fichier hotwords
  modelingUnit?: string    // défini seulement en voie officielle
  bpeVocabPath?: string    // défini seulement en voie officielle
  skipped: string[]        // entrées non tokenisables (auto-tokenisation)
}
```

**Branche hybride** dans `buildHotwords` :
- fichier nommé exactement `bpe.vocab` (ou `*.bpe.vocab`), **distinct** du fichier tokens résolu
  par `detectArchitecture` (qui peut s'appeler `vocab.txt`), détecté dans `fileNames` → **voie officielle** :
  `content` = lexique en texte brut (une entrée par ligne), `modelingUnit = 'cjkchar+bpe'`
  (multilingue-safe pour Parakeet v3), `bpeVocabPath` = chemin absolu.
- sinon → **auto-tokenisation** : chaque entrée passe par `tokenizeEntry`, les `null` vont dans
  `skipped`, `content` = lignes pré-tokenisées, pas de `modelingUnit`/`bpeVocabPath`.

**Score** : `resolveScore` mappe `soft→2.0`, `normal→4.0`, `strong→6.0` (valeurs de départ
issues du probe, à affiner par un test micro réel lors de l'implémentation) ; un override non
vide et numériquement valide l'emporte.

### Intégration Sherpa : `core/services/sherpaStt.ts`

`transcribe(db, wavBuffer)` (signature inchangée — `db` déjà disponible) :
1. Lit `stt_lexicon`, `sherpa_hotwordsSensitivity`, `sherpa_hotwordsScoreOverride`.
2. **Si** lexique non-vide **et** `detection.family === 'transducer'** :
   - `buildHotwords(...)` → écrire `content` dans `<modelPath>/.agent-hotwords.txt`.
   - Étendre la config du recognizer : `decodingMethod: 'modified_beam_search'`,
     `hotwordsFile`, `hotwordsScore: resolveScore(...)`, et (voie officielle) `modelingUnit` +
     `modelConfig.bpeVocab`.
   - Remonter `skipped` (avertissement non bloquant, cf. UI).
3. **Sinon** : comportement actuel inchangé (`greedy_search`, aucune régression de perf).

**Cache** (point critique) : la clé actuelle `{ modelPath }` devient
`modelPath + '|' + signature(lexique + score + decodingMethod)`. Ainsi un changement de lexique
rebuild le recognizer sans dépendre d'un appel externe. `resetRecognizerCache()` est conservé.

### Intégration Whisper

Pas de changement runtime du chemin Whisper. Le lien lexique → prompt est une action **UI** :
un bouton « Régénérer le prompt depuis le lexique » écrit
`whisper_advancedParams.prompt = lexicon.join(', ')`. Le champ reste éditable ensuite ;
aucun écrasement silencieux d'un prompt réglé à la main.

### UI (renderer)

- **`components/settings/LexiconSettings.tsx`** (nouveau, **partagé / agnostique du moteur**) :
  éditeur de liste (ajout, suppression, affichage), toujours visible dans `VoiceInputSettings`.
  Affiche les entrées `skipped` remontées par le backend en avertissement non bloquant.
- **Sherpa** (`SherpaSettings.tsx`) : slider 3 crans (Doux/Normal/Fort) + section avancée
  « score personnalisé » (champ numérique), calquée sur le pattern *Advanced Parameters* de Whisper.
- **Whisper** (`VoiceInputSettings.tsx`) : bouton « appliquer au prompt » près du champ Initial Prompt.

## Flux de données

```
[UI LexiconSettings] --settings:set stt_lexicon--> [DB]
[UI SherpaSettings]  --settings:set sherpa_hotwords*--> [DB]
                                              │
parole 16kHz WAV --> transcribe(db, wav) -----┤ lit lexicon + sensibilité + override
                                              │ family==transducer && lexicon? 
                                              ├─ oui → buildHotwords → écrit .agent-hotwords.txt
                                              │        recognizer(modified_beam_search + hotwords)
                                              └─ non → recognizer(greedy_search)  [inchangé]
[UI bouton Whisper] --settings:set whisper_advancedParams.prompt = lexicon.join(', ')--> [DB]
```

## Gestion d'erreurs / cas limites

- **Entrée non tokenisable** (auto-tokenisation, caractère hors pièces) → skippée, remontée en
  avertissement non bloquant. La plupart des mots latins passent (les caractères isolés existent).
- **Lexique vide** → Sherpa reste en `greedy_search` (zéro régression), prompt Whisper inchangé.
- **Famille non-transducer** (whisper-sherpa, paraformer, nemoCtc) → lexique ignoré côté Sherpa
  (no-op documenté) ; le lexique reste utilisable côté Whisper.
- **Sur-boost** : borné par le slider ; l'override avancé peut dépasser mais c'est un choix explicite.
- **Modèle indisponible sur la plateforme** : chemin Sherpa déjà géré (`loadSherpa` throw) — inchangé.

## Tests

- **Unitaires purs** sur `sherpaHotwords.ts` :
  - `tokenizeEntry('Zorglub', pieces)` → `'▁Z or gl ub'` (fixture tokens.txt réelle ou réduite).
  - multi-mots → chaque mot préfixé ▁.
  - caractère inconnu → `null`.
  - `resolveScore` : crans + override prioritaire + override invalide ignoré.
  - `buildHotwords` : branche officielle (bpe.vocab présent) vs auto-tokenisation ; `skipped`.
- **Settings** : round-trip des 3 nouvelles clés (defaults, `set('', '')` = suppression de ligne).
- **Whisper** : assemblage du prompt depuis le lexique (`join(', ')`).
- La validation runtime du boost Sherpa est déjà prouvée par le probe (non rejouée en CI — pas
  de modèle 650 Mo en test).

## Hors-scope (YAGNI)

- Boost par-mot individuel (un seul score global ; la syntaxe `MOT :x.x` n'est pas exposée).
- Génération automatique d'un `bpe.vocab` (la voie officielle s'active seulement si un vocab est
  *fourni* dans le dossier modèle).
- Hotwords pour les familles sherpa non-transducer.
- Synchro continue bidirectionnelle lexique ↔ prompt Whisper.

## Sources

- [Hotwords (Contextual biasing) — sherpa-onnx docs](https://k2-fsa.github.io/sherpa/onnx/hotwords/index.html)
- [PR #3077 — modified beam search & hotwords for NeMo transducer models](https://github.com/k2-fsa/sherpa-onnx/pull/3077)
