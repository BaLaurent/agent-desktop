# Intent gate — endpoint custom (modèle local)

**Date :** 2026-06-23
**Statut :** approuvé

## Problème

Dans les réglages *Voice Input → Continuous Voice → Intent detection*, sélectionner
**Custom…** pour le *Intent model* n'a aucun effet utile : on ne peut pas pointer un
modèle local (Ollama / vLLM / passerelle OpenAI- ou Anthropic-compatible) sur son
propre endpoint.

Cause racine, dans `src/core/handlers/voiceIntent.ts` :

1. Le modèle custom est passé à `mapModelToBackend(intentModel, aiSettings.sdkBackend, …)`,
   qui **réécrit le modèle vers le backend de la conversation** par famille. Un id
   non-mappable (ex. `qwen2.5`) retombe sur le modèle par défaut → le choix custom est ignoré.
2. La classification consomme `apiKey` / `baseUrl` issus des réglages AI **de la
   conversation**. Impossible de viser un endpoint distinct sans modifier la conversation.
3. `summarizeWithModel` route par préfixe de nom (`claude-*` → SDK Claude, sinon → PI) ;
   un modèle local ne s'appelle pas `claude-*` mais doit emprunter le client HTTP
   Anthropic pointé sur la Base URL custom (vérifié empiriquement : Ollama/vLLM/passerelles
   acceptent le protocole Anthropic via `ANTHROPIC_BASE_URL`).

## Solution

Découpler le gate d'intention des réglages de la conversation : lui donner sa propre
Base URL + clé + modèle, **en cascade** (champs dédiés qui retombent sur ceux de la
conversation s'ils sont vides), et arrêter le remappage qui écrase le modèle.

### Réglages (globaux, à côté de `continuousVoice_intentModel`)

| Clé | Rôle | Vide ⇒ |
|---|---|---|
| `continuousVoice_intentModel` | id du modèle (existe déjà) | `aiSettings.model` → `HAIKU_MODEL` |
| `continuousVoice_intentBaseUrl` | **nouveau** — Base URL de l'endpoint | `aiSettings.baseUrl` |
| `continuousVoice_intentApiKey` | **nouveau** — clé de l'endpoint | `aiSettings.apiKey` |

### Résolution (`voiceIntent.ts`)

```
baseUrl = intentBaseUrl || aiSettings.baseUrl
apiKey  = intentApiKey  || aiSettings.apiKey

si intentBaseUrl renseignée  → endpoint custom explicite :
    model   = intentModel || aiSettings.model || HAIKU_MODEL   (PAS de mapModelToBackend)
    backend = 'claude'                                         (HTTP protocole Anthropic vers la Base URL)
sinon                        → comportement actuel inchangé :
    model   = mapModelToBackend(intentModel || aiSettings.model || HAIKU_MODEL, …)
    backend = undefined                                        (route par nom)

summarizeWithModel(prompt, model, { cwd, apiKey, baseUrl, backend })
```

La **présence d'une Base URL dédiée** est le déclencheur du mode custom — la donnée
encode l'état, pas de 4ᵉ réglage « type de backend ». Hors de ce mode, aucun comportement
ne change → zéro régression.

### Seam `summarizeWithModel`

Ajout d'un champ optionnel `backend?: 'claude' | 'pi'` à `SummarizeOptions`. S'il est
défini, il **court-circuite le routage par préfixe de nom**. Additif ; `undefined` =
comportement actuel. Nécessaire car un modèle local ne porte pas le préfixe `claude-`
mais doit passer par le client HTTP Anthropic.

### UI (`ContinuousVoiceSettings.tsx`)

Quand **Custom…** est sélectionné, sous l'input modèle existant :

- **Base URL** (texte, placeholder type `http://localhost:11434` — vide = endpoint de la conversation)
- **API key** (type password — vide = clé de la conversation)
- note d'aide : un endpoint Ollama/vLLM/passerelle compatible fonctionne via cette Base URL.

## Tests

- `voiceIntent.test.ts` :
  - Base URL dédiée ⇒ pas de remap, `backend: 'claude'`, injection de la baseUrl/clé dédiées.
  - champs vides ⇒ cascade sur la conversation (comportement actuel préservé).
- `summarization.test.ts` :
  - `backend: 'claude'` force le chemin Claude même pour un modèle non-`claude-*`.
  - `backend: 'pi'` force le chemin PI même pour un modèle `claude-*`.

## Hors-scope (YAGNI)

- Pas de client OpenAI HTTP séparé (le protocole Anthropic via Base URL suffit).
- Pas de route PI dédiée (`resolvePIModel` exige le registre ; coût de spawn par énoncé).
- Pas de réglage explicite « type de backend ».
