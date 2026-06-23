# Design — Feedback de détection d'intention + suspension capture (mode voix continue)

Date : 2026-06-23
Statut : validé en brainstorming, en attente de revue utilisateur avant plan d'implémentation.

## Problème

En mode voix continue, après que l'utilisateur a fini de parler, il y a un délai (transcription →
classification d'intention LLM ~1 s → envoi → réponse de l'IA) pendant lequel **rien n'indique que
le système traite la demande**. L'overlay affiche encore « Listening… » parce que les phases sont
pilotées uniquement par l'engine, qui est déjà revenu à `listening` au moment où la classification
tourne dans l'orchestrateur. Conséquences :
1. L'utilisateur ne sait pas si quelque chose se passe ni si l'assistant a détecté qu'on lui parlait.
2. Faute de retour, il enchaîne plusieurs phrases ; chacune est capturée/transcrite/classifiée
   indépendamment et « tout arrive d'un coup sur l'IA » (empilement).

Le half-duplex existant (`pauseDuringTts`) ne suspend la capture que pendant le **TTS**, pas pendant
la classification ni le streaming de la réponse.

## Objectifs (validés)

1. **Feedback visuel toujours actif** : surfacer les états manquants — `classifying` (vérification
   d'intention en cours) et `replying` (intention détectée → l'IA répond). Le passage à `replying`
   est la confirmation explicite « ✓ je t'ai entendu » que l'utilisateur réclame.
2. **Suspension de capture réglable** : un nouveau toggle suspend la capture micro depuis le début
   de la classification jusqu'à la fin de la réponse de l'IA. Défaut **activé** (le correctif marche
   d'emblée). Désactivable pour autoriser le barge-in.

## Décisions de conception (validées)

- Labels en **anglais** (cohérent avec l'overlay existant).
- En mode **wakeword**, `gate.evaluate` est quasi-instantané → `classifying` ne fera qu'un flash.
  On le garde **uniforme** (même code-path que le mode intent) : le flash est inoffensif et, s'il
  traîne, sert de signal de debug.
- Le feedback visuel est **indépendant** du toggle de suspension (toujours affiché).

## Architecture

### Crux — éviter la course sur la phase

L'engine remet la phase à `listening` dans le `.finally` de la transcription, **après** avoir
déclenché `onUtterance` (où démarre la classification). Si l'orchestrateur écrivait `phase =
'classifying'` dans le même champ, l'engine l'écraserait aussitôt (l'engine a sa propre variable
`phase` locale + le store ; son `.finally` rappelle `setPhase(listening)` → écrase le store).

**Solution (un seul writer par champ, conforme au design du store)** : un champ **distinct**
`processing`, écrit uniquement par l'orchestrateur, que l'UI affiche **en priorité** sur `phase`.
Même motif que `lastIgnored` (champ orchestrateur transitoire déjà présent). L'engine continue de
piloter `phase` sans conflit.

### Composant 1 — Store (`continuousVoiceStore.ts`)

Ajouter :
```ts
export type ProcessingState = 'classifying' | 'replying'
// dans l'interface :
processing: ProcessingState | null
setProcessing: (p: ProcessingState | null) => void
```
`reset()` remet `processing: null`. Writer unique = l'orchestrateur (`useContinuousVoice`).

### Composant 2 — Orchestrateur (`useContinuousVoice.ts`)

Lire le flag `pauseDuringProcessing` via `readContinuousVoiceFlags()` (voir Composant 4). Dans
`onUtterance` :
```ts
onUtterance: async (u) => {
  store.getState().setProcessing('classifying')
  if (readContinuousVoiceFlags().pauseDuringProcessing) engineRef.current?.suspend()
  const decision = await gate.evaluate(u)
  if (decision.action === 'send') {
    store.getState().setProcessing('replying')   // reste suspendu pendant la réponse
    onSendRef.current(decision.text)
  } else {
    store.getState().setProcessing(null)
    if (readContinuousVoiceFlags().pauseDuringProcessing) engineRef.current?.resume()
    store.getState().setIgnored(decision.reason, performance.now())
  }
},
```
Étendre `notifyExchangeComplete` (appelé au flanc descendant du streaming par la surface) pour
clôturer le cycle :
```ts
const notifyExchangeComplete = useCallback(() => {
  gateRef.current?.notifyExchangeComplete()
  store.getState().setProcessing(null)
  if (readContinuousVoiceFlags().pauseDuringProcessing) engineRef.current?.resume()
}, [store])
```
Coexistence avec le `pauseDuringTts` existant : `suspend()`/`resume()` sont idempotents. Quand le
TTS joue, l'effet `pauseDuringTts` suspend déjà ; `resume()` au `notifyExchangeComplete` ne ré-arme
la capture que si le TTS n'est plus actif (l'effet `speakingMessageId` reprend la main — voir note).

**Note d'ordonnancement** : l'effet half-duplex TTS (`useEffect` sur `speakingMessageId`) et le
`resume()` du `notifyExchangeComplete` peuvent tous deux appeler `resume()`. C'est sûr (idempotent),
mais le flanc descendant du streaming précède souvent l'arrêt du TTS. Le résultat correct est :
capture reste suspendue tant que `speakingMessageId !== null`. Comme l'effet TTS re-suspend sur tout
changement de `speakingMessageId`, et que `notifyExchangeComplete` n'appelle `resume()` qu'une fois,
l'état final converge vers « suspendu pendant le TTS, repris après ». Le plan inclut un test couvrant
l'enchaînement classify → reply → streaming-end → TTS-end.

### Composant 3 — Lecture du flag (`config.ts`)

`readContinuousVoiceFlags()` lit déjà `continuousVoice_pauseDuringTts`. Ajouter :
```ts
pauseDuringProcessing: s['continuousVoice_pauseDuringProcessing'] !== 'false',  // défaut true
```
(Sémantique « absent ou ≠ 'false' = activé », identique à `pauseDuringTts`.)

### Composant 4 — Réglage UI (`ContinuousVoiceSettings.tsx`)

Sous le `Toggle` « Pause while assistant speaks » existant, ajouter un `Toggle` :
- clé `continuousVoice_pauseDuringProcessing`, `checked={settings[...] !== 'false'}` (défaut on),
  `onChange={(v) => setSetting('continuousVoice_pauseDuringProcessing', v ? 'true' : 'false')}`.
- label : « Pause while processing your request »
- hint : « Stops listening from the moment a request is detected until the assistant finishes
  replying, so chained sentences don't pile up. »

### Composant 5 — Overlay (`OverlayContinuousVoice.tsx`)

Lire `processing` du store et l'afficher **en priorité** sur `phase` :
```ts
const processing = useContinuousVoiceStore((s) => s.processing)
const PROCESSING_LABEL: Record<ProcessingState, string> = {
  classifying: "Checking if you're talking to me…",
  replying: '✓ Got it — replying…',
}
// label affiché : error || (processing ? PROCESSING_LABEL[processing] : PHASE_LABEL[phase]) || 'Listening…'
```
Point d'état (`<span>` coloré) :
- `processing === 'replying'` → point plein couleur primaire.
- `processing === 'classifying'` → point en pulse (réutiliser l'animation `pulse` existante).
- sinon → comportement actuel (basé sur `phase`).
Le hint « ignored » reste inchangé.

## Surfaces concernées

`useContinuousVoice` est le seam partagé entre l'overlay ET la vue chat principale. La logique
(store + orchestrateur + flag) bénéficie aux **deux** surfaces ; seul le rendu des labels est câblé
par surface. **Périmètre de ce travail : l'overlay** (surface testée). Si la vue chat principale
affiche un statut voix continue, brancher `processing` y est un suivi optionnel, hors périmètre ici.

## Error handling

- `classify-error` (gate) → `decision.action !== 'send'` → `setProcessing(null)` + `resume()` +
  hint « ignored » existant. Le toggle off : pas de suspend/resume, juste le feedback.
- Si le stream échoue (pas de flanc descendant propre) : `notifyExchangeComplete` est déjà déclenché
  par la transition `isStreaming` true→false côté surface, qui survient aussi sur erreur de stream →
  `resume()` + clear se font. (Pas de nouveau chemin d'erreur introduit.)

## Tests

- `continuousVoiceStore` : `setProcessing` met à jour le champ ; `reset()` le remet à `null`.
- `useContinuousVoice` (orchestrateur) — avec engine/gate mockés :
  - addressed : séquence `setProcessing('classifying')` → `suspend()` → `setProcessing('replying')`
    → `onSend` appelé ; `notifyExchangeComplete` → `setProcessing(null)` + `resume()`.
  - not-addressed : `classifying` → `setProcessing(null)` + `resume()` immédiat + `setIgnored`.
  - toggle off (`pauseDuringProcessing=false`) : aucun `suspend()`/`resume()`, mais `processing`
    est quand même positionné (feedback indépendant du toggle).
- `config.ts` : `readContinuousVoiceFlags().pauseDuringProcessing` — true par défaut, false quand
  la valeur stockée est `'false'`.
- `OverlayContinuousVoice` : label/point reflètent `processing` en priorité (classifying → texte +
  pulse ; replying → texte + point plein) ; quand `processing` est null, retombe sur `phase`.

## Hors périmètre (YAGNI)

- Pas de file d'attente des phrases enchaînées (la suspension les évite à la racine).
- Pas de barge-in actif pendant la réponse (le toggle off le permet déjà en réécoutant).
- Pas de câblage de la vue chat principale (suivi optionnel).
- Aucune modification de `vadStateMachine`/`engine` (les phases engine restent telles quelles).

## Fichiers touchés (récap)

| Fichier | Nature |
|---|---|
| `src/renderer/services/continuousVoice/continuousVoiceStore.ts` | champ `processing` + `ProcessingState` + setter + reset |
| `src/renderer/services/continuousVoice/useContinuousVoice.ts` | set processing + suspend/resume dans `onUtterance` et `notifyExchangeComplete` |
| `src/renderer/services/continuousVoice/config.ts` | lecture du flag `pauseDuringProcessing` |
| `src/renderer/components/settings/ContinuousVoiceSettings.tsx` | nouveau Toggle |
| `src/renderer/components/overlay/OverlayContinuousVoice.tsx` | rendu `processing` prioritaire |
| `*.test.ts(x)` | tests ci-dessus |
