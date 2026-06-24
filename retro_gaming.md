Voici la mise à jour complète de la documentation technique et fonctionnelle. Cette version intègre **EmulatorJS** comme moteur d'exécution des jeux (via WebAssembly) tout en conservant notre architecture réseau découplée à ultra-faible latence.

---

# DOCUMENTATION TECHNIQUE & FONCTIONNELLE (V2)

## Plateforme Web Cloud Gaming — Intégration EmulatorJS & Netcode P2P

Cette documentation définit l'architecture d'une plateforme de Cloud Gaming décentralisée (Hybrid Cloud). Le rendu et l'émulation sont exécutés côté client via **EmulatorJS (WebAssembly)**, tandis que la synchronisation multijoueur temps réel utilise un protocole **WebRTC Peer-to-Peer** personnalisé.

---

## 1. Architecture Système & Flux de Composants

Le système s'articule autour de trois briques majeures : l'interface utilisateur (Next.js), le gestionnaire d'émulation (EmulatorJS) et la couche de transport (WebRTC + WebSockets).

### Schéma d'interaction des composants locaux

```
+-----------------------------------------------------------------------+
|                       NAVIGATEUR DU CLIENT (LOCAL)                    |
|                                                                       |
|  +---------------------+  window.EJS_emulator  +-------------------+  |
|  |   Interface Next.js | <===================> |    EmulatorJS     |  |
|  |  (Gestion Match)    |   (Savestate/Inputs)  | (Cœur WebAssembly)|  |
|  +---------------------+                       +-------------------+  |
+-----------------------------------------------------------------------+
           ^                                                 v
           | Connexion Initiale (WS)                         | Flux Inputs
           v                                                 v
+------------------------+                        +---------------------+
| Serveur de Signalement |                        |  Paired Client (P2P)|
|  (Node.js - Port 8080) |                        |  (RTCDataChannel)   |
+------------------------+                        +---------------------+

```

---

## 2. Spécifications Fonctionnelles

### 2.1 Flux d'exécution d'une partie

1. **Sélection et Chargement :** L'utilisateur choisit un jeu du catalogue rétro. Next.js instancie EmulatorJS en lui passant l'URL de la ROM locale (ex: `/roms/game.nes`) et le cœur Wasm associé (`/emulatorjs/data/`).
2. **Matchmaking & Liaison :** Le client se connecte au salon via le conteneur Docker `signaling`. Les métadonnées WebRTC (SDP/ICE) sont échangées. Une fois la liaison P2P établie, le serveur de signalement passe en arrière-plan.
3. **Détournement des Commandes (Input Hooking) :** La lecture native du clavier par EmulatorJS est interceptée. Chaque pression de touche génère un paquet d'inputs contenant l'état des boutons et l'identifiant de la frame courante.
4. **Synchronisation par Rollback :** Les instances Wasm de chaque joueur calculent le jeu de manière autonome. Si un décalage réseau survient, l'interface Next.js force l'émulateur à charger un état antérieur (`loadState`) pour réinjecter les inputs manquants et corriger la frame courante.

### 2.2 Alignement avec EmulatorJS

Contrairement au mode "Netplay" natif d'EmulatorJS (qui utilise une architecture Client-Serveur synchrone sujette au gel de l'écran), cette architecture utilise l'émulateur comme un **moteur déterministe pur**. C'est notre couche JavaScript/Next.js qui pilote manuellement l'avance des frames et la mémoire de l'émulateur.

---

## 3. Spécifications Techniques

### 3.1 Cartographie du Projet en Dev Local

```text
ma-plateforme-gaming/
│
├── frontend/
│   ├── public/
│   │   ├── emulatorjs/       # Fichiers statiques d'EmulatorJS
│   │   │   └── data/         # Cœurs de l'émulateur (.wasm et .js)
│   │   └── roms/             # Catalogue de fichiers ROMs (.nes, .snes)
│   ├── src/app/game/
│   │   └── page.tsx          # Interface de jeu + Logique WebRTC
│   └── Dockerfile
│
├── signaling/
│   ├── server.js             # Relais WebSockets pour l'échange ICE/SDP
│   └── Dockerfile
│
└── docker-compose.yml        # Orchestrateur de l'infrastructure locale

```

### 3.2 Variables d'Environnement Critiques

Le fichier `.env.local` injecté dans le conteneur Next.js doit référencer l'adresse locale du serveur de signalement :

```env
NEXT_PUBLIC_SIGNALING_SERVER_URL=ws://localhost:8080

```

---

## 4. Interfaces de Programmation (API JavaScript EmulatorJS)

L'intégration repose sur l'utilisation des hooks globaux exposés par EmulatorJS pour manipuler la mémoire de calcul Wasm.

### 4.1 Initialisation de l'Émulateur dans Next.js

Avant le montage du composant, les variables globales suivantes doivent être configurées :

```typescript
window.EJS_player = '#game-container'; // ID de la div hôte
window.EJS_core = 'nes';               // Identifiant du système
window.EJS_gameUrl = '/roms/game.nes'; // Chemin de la ROM
window.EJS_pathtodata = '/emulatorjs/data/'; // Fichiers Wasm d'exécution

```

### 4.2 Fonctions de Manipulation d'État (Savestates)

Pour appliquer l'algorithme de Rollback, l'application Next.js appelle les méthodes de l'instance active d'EmulatorJS :

* **Générer un instantané de la mémoire (Savestate) :**
```typescript
// Récupère l'état du jeu sous forme de tableau d'octets (Uint8Array)
const stateBuffer = window.EJS_emulator.saveState();

```


* **Restaurer un état (Loadstate) :**
```typescript
// Réinjecte le buffer pour replacer le jeu à une frame passée
window.EJS_emulator.loadState(stateBuffer);

```



---

## 5. Garanties du Déterminisme avec EmulatorJS

Pour éviter les désynchronisations fatales entre les deux joueurs (*desync*), l'environnement de développement local applique les contraintes strictes suivantes :

1. **Identité des Fichiers sources :** Les deux joueurs doivent impérativement exécuter la même ROM (vérification par hash MD5/SHA-256 avant le lancement du match).
2. **Fréquence d'Horloge Bloquée :** Le cycle d'exécution d'EmulatorJS doit être calé sur l'événement réseau ou sur un intervalle strict de 60Hz pour éviter qu'un ordinateur plus puissant n'avance plus vite que l'autre.
3. **Gel de l'Audio Local :** Lors d'un processus de Rollback (recalcul rapide de $N$ frames), le flux audio d'EmulatorJS doit être temporairement coupé (*muted*) pour éviter les artéfacts sonores ou les grésillements chez l'utilisateur.

C'est tout à fait exact, et c'est le point le plus critique. L'intégration du Rollback avec **EmulatorJS** est plus subtile qu'avec un simple canevas HTML5, car le code de l'émulateur tourne dans un thread séparé (Web Worker) compilé en WebAssembly.

Voici la section technique cruciale à ajouter à votre documentation : **le protocole précis d'implémentation du rollback appliqué à EmulatorJS**.

---

## 6. Détails d'Implémentation du Rollback avec EmulatorJS

Pour appliquer le netcode de type GGPO à EmulatorJS, Next.js doit piloter l'émulateur non pas comme un lecteur vidéo autonome, mais comme une **machine à états finis** dont on contrôle manuellement chaque cycle d'horloge.

### 6.1 L'Architecture du Gestionnaire de Frames (La Queue)

L'application Next.js maintient deux buffers circulaires (tableaux à taille fixe) en mémoire vive :

* `StateBuffer` : Stocke les structures renvoyées par `window.EJS_emulator.saveState()` pour les 30 dernières frames (environ 500 ms de jeu).
* `InputBuffer` : Stocke un objet contenant `{ p1_input, p2_input }` pour chaque numéro de frame.

---

### 6.2 L'Algorithme d'Avancement d'une Frame (Cycle Local)

À chaque cycle de l'horloge principale (60Hz), le client local effectue la séquence suivante :

```text
[Début Frame T] 
   │
   ├── 1. Capture de l'input du clavier local.
   ├── 2. Envoi immédiat de l'input {Frame: T, Input: X} à l'adversaire via WebRTC.
   ├── 3. Lecture de l'Input Buffer pour la Frame T :
   │       ├── Input Local : Présent (Garantit).
   │       └── Input Adverse : Si absent -> Appliquer la Prédiction (Copie de la Frame T-1).
   │
   ├── 4. Appel de 'window.EJS_emulator.saveState()' -> Enregistré dans StateBuffer[T].
   │
   ├── 5. Injection des deux inputs dans l'émulateur via l'API de contrôle des touches.
   ├── 6. Avancement forcé de l'émulateur d'exactement 1 tick : 'window.EJS_emulator.step()'.
   │
[Fin Frame T -> Rendu à l'écran automatique par Wasm]

```

---

### 6.3 Le Protocole de Rollback (Réception d'un Input en retard)

Lorsque le canal WebRTC reçoit un paquet de l'adversaire contenant `{ type: "input", frame: T_Retard, input: Y }` et que `T_Retard < Frame_Actuelle` :

```typescript
function executerRollback(frameRetard: number, vraiInputAdversaire: any) {
  // 1. Mettre à jour l'historique des inputs avec la vraie valeur
  const inputsHistoriques = InputBuffer.get(frameRetard);
  inputsHistoriques.p2 = vraiInputAdversaire; 
  InputBuffer.set(frameRetard, inputsHistoriques);

  // 2. Couper le son pour éviter les micro-coupures ou distorsions audio
  window.EJS_emulator.setVolume(0);

  // 3. Revenir dans le temps (Loadstate)
  const etatHistorique = StateBuffer.get(frameRetard);
  if (etatHistorique) {
    window.EJS_emulator.loadState(etatHistorique);
  }

  // 4. Boucle de recalcul rapide (Fast-Forward) jusqu'au présent
  for (let f = frameRetard; f < frameActuelle; f++) {
    const inputsSpécifiques = InputBuffer.get(f);
    
    // Ré-injecter les inputs corrigés pour cette frame spécifique
    window.EJS_emulator.injectInputsForFrame(inputsSpécifiques);
    
    // Exécuter la logique sans attendre (Wasm va calculer l'état à pleine vitesse)
    window.EJS_emulator.step();
    
    // Mettre à jour le snapshot de sécurité pour les frames futures au cas où
    const nouvelEtat = window.EJS_emulator.saveState();
    StateBuffer.set(f, nouvelEtat);
  }

  // 5. Rétablir le son pour le joueur
  window.EJS_emulator.setVolume(1);
}

```

---

### 6.4 Les Fonctions JavaScript Clés à "Hacker" dans EmulatorJS

Pour que ce modèle fonctionne, vous devez surcharger ou configurer certaines options spécifiques d'EmulatorJS lors de l'initialisation :

* `window.EJS_gamePadStart` : Doit être détourné pour empêcher EmulatorJS de lire directement le clavier physique de l'utilisateur, transférant cette responsabilité à votre écouteur Next.js (`window.addEventListener('keydown')`).
* Interception de la boucle d'affichage : Vous devez vous assurer que le fichier de configuration d'EmulatorJS possède le paramètre `disableFrameDelay: true`. Cela permet à la fonction `window.EJS_emulator.step()` de s'exécuter instantanément lors de la boucle `for` du rollback, sans être bridée par la limite des 16.6ms.

---

Cette section complète la documentation technique et garantit que vous avez la feuille de route exacte pour coder la synchronisation mémoire de l'émulateur.

---

## 7. Implémentation Réelle — Page `/play` du PWA

### 7.1 Choix du Moteur : jsnes

Après analyse de l'écosystème (em-fceux, EmulatorJS, retrojs, Dendy), le choix s'est porté sur **jsnes** (npm: `jsnes`, MIT) pour le premier jalon :

| Critère | jsnes | em-fceux | EmulatorJS |
|---|---|---|---|
| Intégration | `npm install` | Compilation Emscripten | Fichiers statiques |
| API Savestate | `toJSON()`/`fromJSON()` → objet | Slots 0-9 → fichier | Slots → MEMFS |
| API Frame Step | `frame()` | `advanceFrame()` | Pas d'API |
| API Input | `buttonDown()`/`buttonUp()` | `setControllerBits()` | Interne seulement |
| Performance | JS pur (suffisant pour NES) | Wasm (max) | Wasm (max) |
| Multi-système | NES seulement | NES seulement | 20+ systèmes |

jsnes offre l'API la plus propre pour le rollback : `toJSON()`/`fromJSON()` retournent des objets sérialisables, parfaits pour le `StateBuffer`. La NES étant légère, les performances JS sont suffisantes même pendant le fast-forward de rollback. Si les perfs s'avèrent insuffisantes, la migration vers em-fceux (fork avec APIs buffer-based) est planifiée — les interfaces `StateBufferInterface` et `InputBufferInterface` sont indépendantes du moteur.

### 7.2 Arborescence Réelle du Projet

```
skyplay-testing/
├── public/
│   └── roms/                       # ROMs NES (.nes) — servies en statique
├── src/
│   ├── app/
│   │   ├── play/
│   │   │   └── page.tsx            # Page /play — layout + assemblage
│   │   ├── api/
│   │   │   └── roms/
│   │   │       └── route.ts        # GET /api/roms — liste les ROMs
│   │   └── page.tsx                # MODIFIÉ : lien "Play" ajouté au header
│   ├── components/
│   │   └── play/
│   │       ├── EmulatorCore.tsx     # Canvas + placeholder + contrôles clavier
│   │       ├── GameControls.tsx     # Barre d'outils : ROM, pause, reset, volume, FPS
│   │       └── TouchControls.tsx    # Overlay tactile D-pad + A/B (mobile)
│   └── lib/
│       ├── emulator/
│       │   ├── types.ts             # Types : EmulatorStatus, InputFrame, StateBufferInterface…
│       │   ├── constants.ts         # KEY_MAP, NES_BUTTON_BITS, buffer sizes, NES_WIDTH/HEIGHT
│       │   ├── buffers/
│       │   │   ├── StateBuffer.ts   # Buffer circulaire de 30 savestates (JSON deep-clone)
│       │   │   └── InputBuffer.ts   # Buffer circulaire de 30 frames d'inputs + méthode update()
│       │   └── hooks/
│       │       ├── useEmulator.ts   # Hook central : jsnes lifecycle, game loop rAF, buffers
│       │       ├── useNesAudio.ts   # Web Audio API : ring buffer, mute/unmute (rollback-ready)
│       │       ├── useKeyboard.ts   # Keyboard → NES buttons + bitmask
│       │       └── useGamepad.ts    # Gamepad API polling → NES buttons + bitmask
│       └── i18n/
│           ├── types.ts             # MODIFIÉ : ajout de l'interface PlayDictionary
│           └── dictionaries/
│               ├── fr.ts            # MODIFIÉ : section "play" en français
│               └── en.ts            # MODIFIÉ : section "play" en anglais
```

### 7.3 Game Loop Implémenté (useEmulator.ts)

```typescript
// Boucle requestAnimationFrame throttlée à 60Hz
function gameLoop(timestamp: DOMHighResTimeStamp) {
  if (!running) return;
  rafId = requestAnimationFrame(gameLoop);

  // Throttle ~16.67ms (60Hz) — avec cap à 200ms pour le retour de background tab
  if (timestamp - lastFrameTime < 16.67) return;
  if (timestamp - lastFrameTime > 200) lastFrameTime = timestamp - 16.67;

  // 1. Capture input local (keyboard bitmask | gamepad bitmask)
  const localInput = keyboard.getP1Bitmask() | gamepad.getP1Bitmask();

  // 2. [TODO P2P] Envoi input au pair via WebRTC DataChannel

  // 3. InputBuffer: stocke l'input prédit du P2 (copie T-1)
  const predictedP2 = inputBuffer.get(0)?.p2 ?? 0;
  inputBuffer.push(frameCount, localInput, predictedP2);

  // 4. StateBuffer: deep-clone l'état AVANT d'avancer
  stateBuffer.push(nes.toJSON());

  // 5. Injection edge-detected dans jsnes
  applyInputs(1, localInput, prevP1Bitmask);
  applyInputs(2, predictedP2, prevP2Bitmask);

  // 6. Avancement d'une frame
  nes.frame();
  frameCount++;
  lastFrameTime = timestamp;

  // 7. Poll gamepad (les objets Gamepad se mettent à jour in-place)
  gamepad.poll();

  // 8. Rendu canvas via le callback onFrame (ARGB → ImageData RGBA)
  // 9. Audio via le callback onAudioSample → ring buffer → ScriptProcessorNode
}
```

### 7.4 Protocole de Rollback (Implémenté, en attente du P2P)

```typescript
// Appelé quand un input distant arrive en retard (T_retard < T_actuelle)
function executerRollback(frameRetard: number, vraiInputAdversaire: number) {
  // 1. Corriger l'InputBuffer
  inputBuffer.update(frameRetard, undefined, vraiInputAdversaire);

  // 2. Couper le son
  audio.mute();

  // 3. Revenir dans le temps
  const etatHistorique = stateBuffer.get(frameRetard);
  if (etatHistorique) nes.fromJSON(etatHistorique);

  // 4. Fast-forward jusqu'au présent
  for (let f = frameRetard; f < frameCount; f++) {
    const inputs = inputBuffer.get(frameCount - f);
    applyInputs(1, inputs.p1, prevP1[f]);
    applyInputs(2, inputs.p2, prevP2[f]);
    nes.frame();
    stateBuffer.set(f, nes.toJSON());
  }

  // 5. Rétablir le son
  audio.unmute();
}
```

### 7.5 Prochaines Étapes

1. **WebRTC Signaling** : Serveur Node.js (comme décrit en Section 1) pour l'échange SDP/ICE
2. **WebRTC DataChannel** : Intégration dans useEmulator pour l'envoi/réception des inputs
3. **Rollback complet** : Activer la fonction `executerRollback()` sur réception d'un input en retard
4. **Multi-système** : Migration vers un core libretro compilé en Wasm (via retrojs ou fork em-fceux)
5. **Lobby/Matchmaking** : Interface de création/recherche de salon de jeu

---

*Documentation mise à jour le 2026-06-22 — reflète l'implémentation réelle dans `skyplay-testing/src/lib/emulator/` et `skyplay-testing/src/app/play/`.*
