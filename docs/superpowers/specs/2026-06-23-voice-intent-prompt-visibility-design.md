# Design — Rendre visible et personnalisable le prompt d'intention (mode voix continue)

Date : 2026-06-23
Statut : validé en brainstorming, en attente de revue utilisateur avant plan d'implémentation.

## Problème

En mode voix continue avec la porte « intent » (sans wakeword), un classifieur LLM décide à
chaque énoncé si l'utilisateur s'adresse à l'assistant (`voice:classifyIntent`). Le prompt de ce
classifieur (`DEFAULT_INTENT_PROMPT`) est codé en dur dans `src/core/handlers/voiceIntent.ts` et
**invisible** pour l'utilisateur : le textarea de réglage (`continuousVoice_intentPrompt` dans
`ContinuousVoiceSettings.tsx`) n'affiche qu'un placeholder « Leave empty to use the built-in… ».
Impossible donc de partir du prompt de base pour l'ajuster, puisqu'on ne le voit nulle part.

Deux objectifs :
1. **Visibilité** — le prompt par défaut doit être affiché et servir de point de départ éditable.
2. **Personnalisation par le nom** — permettre au prompt de référencer le nom de l'assistant
   (réglage `agent_name`, fallback `Claude`/`PI` selon le backend) via un placeholder `{agent_name}`,
   pour que le classifieur sache reconnaître les appels par son nom.

## Décisions de conception (validées)

- **Pré-remplissage du textarea** avec le texte du défaut (jamais blanc), + bouton
  « Réinitialiser au défaut ».
- **Persistance intelligente** : le réglage `continuousVoice_intentPrompt` n'est stocké que si le
  texte diffère réellement du défaut. Tant que l'utilisateur ne personnalise pas, le réglage reste
  vide ⇒ le backend continue d'utiliser `DEFAULT_INTENT_PROMPT` et bénéficie des futures
  améliorations du prompt intégré. « Pas modifié = pas figé. »
- **Placeholder du nom** : `{agent_name}` (cohérent avec la clé de réglage `agent_name`).
- **Mécanisme de substitution générique** : `buildIntentPrompt` remplace tout token `{clé}` présent
  dans un map fourni par l'appelant (mécanisme, pas politique). Ajouter un futur placeholder = une
  entrée de plus dans le map, sans toucher le mécanisme.

## Architecture

Source unique du texte et de la substitution dans un nouveau module **core sans dépendance
`electron`**, sur le modèle existant de `core/services/sherpaPresets.ts` (catalogue single-sourcé
importé par l'UI renderer) et `core/services/modelBackendMap.ts`.

### Composant 1 — `src/core/services/voiceIntentPrompt.ts` (nouveau)

Exporte :

- `DEFAULT_INTENT_PROMPT: string` — déplacé verbatim depuis `voiceIntent.ts`, **avec le texte
  enrichi pour mentionner le nom** via `{agent_name}`. Exemple d'ajustement de la 1ʳᵉ phrase :
  > « …whether the following transcribed utterance is the user DIRECTLY ADDRESSING a voice
  > assistant named "{agent_name}" (asking it something…) ». Le placeholder `{utterance}` reste
  > l'emplacement de l'énoncé en fin de prompt.
- `buildIntentPrompt(template: string, replacements: Record<string, string>): string` — substitution
  **en une seule passe** :
  ```ts
  return template.replace(/\{(\w+)\}/g, (m, key) => replacements[key] ?? m)
  ```
  Justification (3 bugs évités vs `String.replace(literal, value)`) :
  - **global** : remplace toutes les occurrences (`{agent_name}` peut apparaître dans l'instruction
    *et* dans un exemple) ;
  - **remplacement par fonction** : neutralise les motifs `$` (le `agent_name` est du texte libre
    utilisateur, peut contenir `$`) ;
  - **passe unique** : un énoncé contenant littéralement `{agent_name}` n'est pas réinterprété
    comme un token ; les tokens inconnus sont laissés intacts (`?? m`).

### Composant 2 — Résolution du nom effectif

`useAgentDisplayName` (`src/renderer/hooks/useAgentDisplayName.ts`) contient aujourd'hui inline la
règle « nom effectif » : `name || BACKEND_DISPLAY_NAMES[backend ?? 'claude-agent-sdk'] || 'Claude'`.
Avec le backend qui devient un 2ᵉ consommateur, on **extrait** cette règle (DRY, 2 occurrences du
même savoir) :

- Nouvelle fonction pure `resolveAgentDisplayName(name?: string, backend?: string): string` dans
  `src/core/types/constants.ts` (emplacement canonique de `BACKEND_DISPLAY_NAMES` ;
  `src/shared/constants.ts` n'est qu'un shim de ré-export déprécié).
- `useAgentDisplayName` est refactoré pour appeler `resolveAgentDisplayName` (comportement
  identique).

### Composant 3 — Récupération du `agent_name` cascadé côté backend

`AISettings` (retour de `getAISettings`) **ne porte pas** `agentName` (vérifié :
`src/core/services/streaming.ts:194` — seul `sdkBackend` est présent). La machinerie de cascade
(`getConversationOverrideContext` / `parseConvOverrides` / `cascadeStringKey`) est déjà branchée
dans `getAgentDirectives` (`src/core/handlers/messages/knowledgeBase.ts`).

- **Extension additive** de `AgentDirectives` et `getAgentDirectives` avec un champ `name?: string`
  (= `cascadeStringKey(db, 'agent_name', convOv, folderId)`, brut, possiblement vide).
- `formatAgentDirectives` **reste inchangé** (n'injecte pas le nom) ⇒ **aucun impact sur le system
  prompt existant** ni sur le consommateur TTS de `getAgentDirectives`.

### Composant 4 — Câblage dans le handler `voiceIntent.ts`

```ts
import { DEFAULT_INTENT_PROMPT, buildIntentPrompt } from '../services/voiceIntentPrompt'
import { resolveAgentDisplayName } from '../types/constants'
import { getAgentDirectives } from './messages/knowledgeBase'
// ...
const template = getSetting(db, 'continuousVoice_intentPrompt') || DEFAULT_INTENT_PROMPT
const agentName = resolveAgentDisplayName(
  getAgentDirectives(db, convId).name,
  aiSettings.sdkBackend,
)
const prompt = buildIntentPrompt(template, { utterance, agent_name: agentName })
```

La ligne `template.replace('{utterance}', utterance)` (actuelle ligne 71) est remplacée par
`buildIntentPrompt`. Tout le reste du handler (résolution modèle, env credentials, parsing yes/no)
est inchangé. La contrainte « pas de `json_schema`/`outputFormat` » reste respectée.

### Composant 5 — UI `ContinuousVoiceSettings.tsx`

Le textarea du prompt d'intention passe à un **état d'édition local** (corrige un bug du composant
contrôlé pur — voir « Cas limite critique » ci-dessous) :

- `const [draft, setDraft] = useState(stored || DEFAULT_INTENT_PROMPT)` où
  `stored = settings['continuousVoice_intentPrompt'] || ''`.
- `onChange` : `setDraft(v)`, puis persistance via le helper d'égalité :
  `setSetting('continuousVoice_intentPrompt', draftToStored(v))`.
- Bouton **« Réinitialiser au défaut »** : `setDraft(DEFAULT_INTENT_PROMPT)` +
  `setSetting('continuousVoice_intentPrompt', '')`. Affiché uniquement quand un override est
  réellement stocké (`stored !== ''`).
- Le placeholder « Leave empty… » est retiré (le champ n'est plus jamais vide). Un hint liste les
  placeholders disponibles : `{utterance}` et `{agent_name}`.

Helper pur testable (hors JSX) :
```ts
// stocke '' quand le texte égale le défaut → préserve l'héritage des futures améliorations
export function draftToStored(draft: string): string {
  return draft === DEFAULT_INTENT_PROMPT ? '' : draft
}
```

## Cas limite critique — textarea contrôlé

Un textarea **contrôlé** dont `value = stored || DEFAULT` empêche l'utilisateur de vider le champ :
effacer tout → `onChange('')` → `'' !== DEFAULT` → `setSetting('')` → ligne supprimée → re-rendu →
`'' || DEFAULT` = DEFAULT (snap-back instantané). Le cas « j'efface pour réécrire de zéro » est
cassé. **Correction** : état local `draft` (ci-dessus) ; la valeur affichée vient de `draft`, pas du
store. Le store ne sert qu'à la persistance/initialisation. Le bouton « Réinitialiser » resynchronise
`draft` ← défaut.

Pour les utilisateurs **non touchés** : `onChange` ne se déclenche jamais → `stored` reste `''` →
héritage des futures améliorations préservé (objectif tenu). Pré-requis : `setSetting` met le store à
jour de façon synchrone (Zustand) — à confirmer à l'implémentation, mais sans incidence sur la
valeur affichée puisqu'elle dérive de `draft`.

## Migration

**Aucune migration nécessaire** — point fort à ne pas sur-ingénierer :
- Utilisateurs non personnalisés (`stored = ''`) : prennent automatiquement le nouveau
  `DEFAULT_INTENT_PROMPT` (avec `{agent_name}`).
- Utilisateurs personnalisés : conservent leur texte ; l'absence de `{agent_name}` y est un no-op
  (substitution qui ne trouve pas le token le laisse tel quel — ici il n'y est simplement pas).
- Le textarea stocke/compare **le template verbatim** (placeholders intacts), jamais une version
  rendue.

## Tests

- `voiceIntentPrompt.test.ts` (nouveau, pur) :
  - `buildIntentPrompt` substitue `{utterance}` et `{agent_name}` ; multi-occurrence ;
    `$`-safe (valeur contenant `$&`, `$1`) ; token inconnu laissé intact ; énoncé contenant
    littéralement `{agent_name}` non réinterprété.
  - `draftToStored` : défaut → `''` ; texte custom → lui-même.
- `constants.test.ts` (ou colocalisé) : `resolveAgentDisplayName` — nom explicite prioritaire ;
  fallback backend (`pi` → `PI`, `claude-agent-sdk` → `Claude`) ; fallback final `Claude` ;
  backend inconnu/undefined.
- `voiceIntent.test.ts` (existant) : override stocké utilisé ; vide → défaut ; `{agent_name}`
  résolu avec le bon fallback selon `sdkBackend`.
- `getAgentDirectives` : le champ `name` reflète le `agent_name` cascadé ; `formatAgentDirectives`
  inchangé (régression : le system prompt n'inclut toujours pas le nom).

## Hors périmètre (YAGNI)

- Pas de changement à `continuousVoice_intentModel` ni aux autres prompts cachés de l'app.
- Pas d'injection du nom dans le system prompt principal (`formatAgentDirectives` reste tel quel).
- Pas d'autres placeholders que `{utterance}` et `{agent_name}` (le mécanisme générique permet d'en
  ajouter plus tard sans refactor).

## Fichiers touchés (récap)

| Fichier | Nature |
|---|---|
| `src/core/services/voiceIntentPrompt.ts` | **nouveau** — `DEFAULT_INTENT_PROMPT`, `buildIntentPrompt`, `draftToStored` |
| `src/core/handlers/voiceIntent.ts` | retire la constante locale ; importe et câble le module + nom |
| `src/core/types/constants.ts` | ajoute `resolveAgentDisplayName` |
| `src/renderer/hooks/useAgentDisplayName.ts` | refactor → appelle `resolveAgentDisplayName` |
| `src/core/handlers/messages/knowledgeBase.ts` | `AgentDirectives.name` + résolution dans `getAgentDirectives` |
| `src/renderer/components/settings/ContinuousVoiceSettings.tsx` | état `draft`, bouton Réinitialiser, prefill, hint |
| `*.test.ts` | tests ci-dessus |
