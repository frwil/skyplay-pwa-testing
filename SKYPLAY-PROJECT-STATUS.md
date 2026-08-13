# SKY PLAY — État d'avancement complet

**Date** : 2026-08-13  
**Branche** : `main` — CPS1/Cadillacs & Dinosaurs intégré ✅, brawler pixel end-to-end ✅, score OCR pixel fixé 12/08, rank OCR #TH 13/08  
**Dernier commit** : `1309e76` — feat(dino): rank OCR #TH — white glyphs y=24-44, latch room-1 absence, overlay Rank  

---

## 1. Plateforme principale (Vercel + Next.js)

**URL production** : https://skyplay-testing.vercel.app  
**Projet Vercel** : `fohom-tagne-william-franciss-projects/skyplay-testing`

### ✅ Fait

| Composant | Statut | Description |
|-----------|--------|-------------|
| Homepage | ✅ Live | Landing page avec GlowBackground, sélecteur de jeu, i18n |
| Page Play | ✅ Live | Émulateur NES/SNES/NeoGeo, authentification, contrôles |
| Page Duel | ✅ Live | Lobby, défis, combat cloud |
| Page Admin | ✅ Live | Administration (users, duels, settings) |
| Auth JWT | ✅ Live | `jose` + `bcryptjs`, cookies sécurisés, fallback dev local |
| Auth serveur-side (homepage) | 🔧 **WD** | `HeaderAuth` + vérification JWT + lookup username — commité 13/08 (1309e76) |
| Logout avec sessionStorage | 🔧 **WD** | `skyplay_logged_out` flag — commité 13/08 (1309e76) |

### 🔧 En cours (commité 13/08 — 1309e76)

- HeaderAuth component sur la homepage
- Liens "Plateforme ↗" vers `sky-play-platform-gamma.vercel.app`
- Logout avec garde contre le fallback dev identity

---

## 2. Système de duel

### 2.1 Lobby & Matchmaking ✅ (commité)

| Fonctionnalité | Statut | Commit |
|----------------|--------|--------|
| Lobby temps réel (WebSocket polling 2s) | ✅ | `3c9e0a9` |
| Heartbeat + nettoyage stale entries | ✅ | `3115646` |
| Un seul défi par joueur (FIFO) | ✅ | `919a1fb` |
| Résolution défi mutuel (auto-accept) | ✅ | `c3fe573` |
| Timeout défi 40s + auto-cancel | ✅ | `cc70b69` |
| 3 types de défi : Standard / XL / Fighter | ✅ | `6e5819d` |
| Règles multilingues FR/EN | ✅ | `6e5819d` |
| WSS URL régénérée (pas d'URL de tunnel morte) | 🔧 **WD** | Non commité |
| Recovery après refresh (findActive=1) | 🔧 **WD** | Non commité |
| Nettoyage intelligent (vérifie heartbeat adverse) | 🔧 **WD** | Non commité |
| Filtre joueurs par pseudo | 🔧 **WD** | Non commité |
| Lien d'invitation partageable | 🔧 **WD** | Non commité |
| Champ "coller un lien d'invitation" | 🔧 **WD** | Non commité |

### 2.2 Flow de règles ✅→🔧 (partiellement commité)

| Fonctionnalité | Statut | Notes |
|----------------|--------|-------|
| Accept → rules_pending (ne crée plus la session) | 🔧 **WD** | Route `respond` modifiée |
| Route confirm-rules | 🔧 **WD** | Nouveau fichier untracked |
| Overlay règles avec checkbox | ✅ Commité | `DuelRulesOverlay.tsx` commit `821b7af` |
| Waiting opponent pour 1er confirmateur | ✅ Commité | Commit `821b7af` |
| Notifications duel_rules_pending aux deux joueurs | 🔧 **WD** | Non commité |
| Colonnes BDD (challenger/target_rules_accepted) | 🔧 **WD** | Non commité |

### 2.3 Combat & Streaming vidéo

| Fonctionnalité | Statut | Notes |
|----------------|--------|-------|
| H.264 + Opus streaming (WebCodecs) | ✅ | `46ff3d6` |
| CloudAdapter (P2 cold-start, SPS/PPS/IDR) | ✅ | 4 commits fix cloud |
| VideoDecoder recreation on error (vs reset) | ✅ | `60fc8b4` |
| AVCDecoderConfigurationRecord pour Chrome | ✅ | `ce3ad04` |
| GOP priming (P1/P2 parity) | ✅ | `59d2268` |
| vsync-synced video paint (rAF) | ✅ | `2f68fbf` |
| Pause système (overlay + countdown) | 🔧 **WD** | `DuelPauseOverlay.tsx` + callbacks |
| Auto-rematch multi-matchs (XL/Fighter) | 🔧 **WD** | `onAutoRematch`, `DuelScoreHUD` |
| Duel score HUD (plein écran) | 🔧 **WD** | `DuelScoreHUD.tsx` |

### 2.4 DuelEnd & Post-match

| Fonctionnalité | Statut | Notes |
|----------------|--------|-------|
| Abandon/forfeit (Plan B) | ✅ | `6e5819d` |
| Revanche | ✅ | `cc70b69` |
| Historique des duels | ✅ | `c6dcf04` |
| Animations AnimatedNumber | ✅ | `DuelEndOverlay` |
| Wallet privé (cache balance adverse) | ✅ | `3395538` |

### 2.5 UI & Wizard

| Fonctionnalité | Statut | Notes |
|----------------|--------|-------|
| DuelGameSelector (grille/liste) | ✅ Commité | `467400a` |
| DuelWizardStepper (3 étapes) | 🔧 **WD** | Nouveau composant |
| DuelModeSelector | 🔧 **WD** | Nouveau composant |
| i18n wizard/mode/controls étendu | 🔧 **WD** | Sections rules, pause, wizard, mode |

---

## 3. Game-server (Docker RetroArch)

### 3.1 Support système

| Système | Core | Résolution | Statut |
|---------|------|------------|--------|
| Neo Geo | fbneo_libretro.so | 320×224 (3x=960×672) | ✅ Stable |
| PS1 | pcsx_rearmed_libretro.so | 640×480 (3x=1920×1440) | ✅ Stable |
| SNES | snes9x_libretro.so | 256×224 (3x=768×672) | ✅ (Docker + code) |
| CPS1 | fbneo_libretro.so | 384×224 (3x=1152×672) | 🔧 WD (commité 13/08 — 1309e76) |

### 3.2 Détection santé KOF98 (RAM — FBNeo) ✅

| Détection | Mécanisme | Adresse | Statut |
|-----------|-----------|---------|--------|
| Santé P1/P2 | UDP READ_CORE_RAM | 0x8238 / 0x8438 | ✅ |
| Timer 16-bit | UDP fast poll | 0xA83A-A83B | ✅ |
| Perso actif | Lecture RAM | 0x8256 / 0x8456 | ✅ |
| Compteur pertes (autoritaire) | Diff prev/curr | 0xA859 / 0xA868 | ✅ Validé live |
| Match end | p1Lost ≥3 ∥ p2Lost ≥3 | Hardcodé | ✅ |
| Perfect KO | Heuristique minHealth≥95% | — | ✅ |
| Time-over | Timer >0 → 0 transition | 0xA83A | ✅ |
| Draw | Deux compteurs incrémentés | — | ✅ |
| Équipes (3 persos) | Read + freeze | 0xA84E/0xA84F/0xA851 | ✅ |
| Mode gauge ADV/EXTRA | Adresse RAM | 0x821E / 0x841E | ✅ Validé live (5 matchs + 29 échantillons) |
| Ordre sélection pick | one-shot RAM | 0x15CB/0x15CA/0x15CD | ✅ Câblé complet (capturePickOrders→matchMeta→ws-handler→overlay) |
| Continue/revanche | Pièce 0xF2C0 + START | UDP btn | ✅ |
| RAM config dans DB | JSON via duel_games | — | 🔧 **WD** |

### 3.3 Détection SFA2 (RAM — snes9x) ✅ — migré pixel→RAM 26/07

**⚠️ 26/07 : Détection visuelle SUPPRIMÉE.** Toute la partie pixel/health-based KO fallback (~280 lignes) retirée de `processHealthFrame()`. SFA2 utilise désormais exclusivement les **round counters RAM** (0x0701 P1 / 0x0A04 P2) via `processSfa2RoundCounters()`, comme KOF98 utilise ses loss counters. Le répertoire `pixel/` (opencv-bridge.py) a été supprimé.

| Détection | Statut | Notes |
|-----------|--------|-------|
| **Round counters RAM (autoritaire)** | ✅ 26/07 | `processSfa2RoundCounters()` — 0x0701 P1, 0x0A04 P2, best-of-3 |
| **Match end RAM** | ✅ 26/07 | p1≥2 ou p2≥2 → matchEnd |
| **Draw RAM** | ✅ 26/07 | Les deux compteurs incrémentent simultanément |
| **Char detection RAM** | ✅ | 0x1C07 P1 / 0x1C08 P2, `SFA2_CHARACTERS` map (18 persos) |
| **Play mode RAM** | ✅ 26/07 | P1=0x1C2A, P2=0x1C2B (+0x23 de char ID), 0=Manual, 1=Auto |
| **Timer BCD decode** | ✅ | SFA2 SNES timer BCD-encoded → décodé en décimal |
| **matchStarted timer-based** | ✅ | Timer 99→decrement (RAM, pas pixel) |
| **matchState WebSocket** | ✅ | État live poussé toutes les 500ms (santé RAM, persos, rounds) |
| **Noms persos game-agnostic** (KofMatchHUD) | ✅ 26/07 | `p1ActiveName`/`p2ActiveName` serveur-side |
| **DuelEndOverlay game-agnostic** | ✅ 26/07 | SFA2 char names + play mode |
| **Timeouts ×2** | ✅ 26/07 | Acceptation 40s, règles 60s, overlay fin 20/60s |
| **Overlay delay server-side** | ✅ 26/07 | 8s timeout avant freeze + overlay |
| Navigation CPU auto end-to-end | ✅ | 3× START → char select → 6× A (4s gaps) → combat |
| Xvfb persistant + nettoyage | ✅ | entrypoint.sh |
| **Perfect KO (KOF98 seulement)** | ✅ | RAM health + timer > 0, KOF98 only. SFA2 : compteurs ne donnent pas le perfect |

### 3.4 Cadillacs and Dinosaurs (CPS1) — Brawler Mode 🔧 WD

**Intégration + pixel + score + rank : commité 13/08 (1309e76)**

#### 3.4.1 Intégration système CPS1 ✅ (commité 13/08)

| Composant | Fichier | Changement |
|-----------|---------|------------|
| SystemType | `types.ts` | Ajout `"cps1"` au discriminated union |
| SYSTEM_CONFIGS | `EmulatorAdapter.ts` | CPS1: 384×224, 10 boutons, fbneo, cloud:true |
| SYSTEM_KEY_MAPS | `EmulatorAdapter.ts` | Mapping clavier CPS1 (Arrow+WASD pour d-pad, Z/X/C/V actions) |
| GAMEPAD_MAPPINGS | `EmulatorAdapter.ts` | Mapping manette CPS1 |
| useEmulator | `hooks/useEmulator.ts` | `case "cps1"` → CloudAdapter (mêmes callbacks que neogeo) |
| cloud-session API | `route.ts` | `cps1` ajouté à la validation system |
| ROM list API | `roms/route.ts` | Override `CPS1_ROMS` set (dino.zip → cps1, pas neogeo) |
| GameControls | `GameControls.tsx` | `cps1` dans `SYSTEM_LIST` |
| i18n | `types.ts` + `en.ts` + `fr.ts` | Label `cps1: "CPS1 Arcade (Desktop)"` |

#### 3.4.2 Game-server brawler prep 🔧 WD

| Composant | Fichier | Description |
|-----------|---------|-------------|
| config.ts | +6 lignes | SYSTEM_CORES cps1 → fbneo, SYSTEM_RESOLUTIONS 384×224 |
| game-config.ts | +65 lignes | Fallback RAM config dino (adresses placeholder), champs brawler (lives, score, level, gameOverFlag) |
| game-runner.ts | +250 lignes | Mode brawler: processBrawlerFrame(), événements playerDied/brawlerGameOver/brawlerState/brawlerLevelStart, auto-start gameplay (past char select + intro), pause hotkey fix (`input_pause_toggle = "nul"` + `xdotool key F12` uppercase) |
| types.ts | +49 lignes | Interfaces messages brawler (BrawlerPlayerDied, BrawlerGameOver, BrawlerState, BrawlerLevelStart) |
| ws-handler.ts | +43 lignes | Handlers forward brawlerPlayerDied/GameOver/State vers WebSocket clients |

#### 3.4.3 RAM Discovery 🔧 En cours (Scan #1 terminé 30/07)

**Scan #1 — Jack Tenrec, gameplay actif P1 (180s) :**

| Donnée | Adresse | Confiance | Détails |
|--------|---------|-----------|---------|
| **Vies P1** | **`0xdd15`** | 🟢 Élevée | Range 0-2, 14 stepDecs, valeur=1 après 1 vie perdue. Validé live. |
| Niveau | `0x879d` / `0x87a1` | 🟡 Moyenne | 0→7 range, 15 jumps (trop élevé), valeur=1 après niveau 1 |
| Santé | `0xd3e7` / `0xd4c7` | 🔴 Faible | 200→180→0, mais à 0 quand P1 vivant (faux négatif) |
| Score | — | ❌ Introuvable | 130 700 absent en binaire 24-bit et BCD dans les 64KB → **OCR pixel** (voir 3.4.5) |
| Char ID | `0x0000-0x000E` | ❌ Échec | Tous à 0x00, pas discriminant |
| Game Over | `0xb2ac` | ❌ Faux positif | =1 alors que le jeu était actif |
| Paire P1/P2 | `0xec32+0xec34` | 🔴 Incertain | Corr=3, max=188, mais FF en lecture live |

**Problèmes identifiés :**
- Score introuvable → encoding custom ou dynamique. Scan #2 : noter le score à plusieurs moments.
- Santé peu de variations → P1 n'a peut-être pas pris assez de coups variés.
- Pas de P2 actif → impossible de différencier P1/P2 par contraste.

**Scan #2 planifié :**
1. Personnage différent (Hannah/Mustapha) → trouver char ID
2. P1 + P2 actifs avec dégâts différenciés
3. Relever le score à T+0s, T+60s, T+120s, T+180s
4. Scan ciblé sur les zones chaudes + régions 0xdd00-0xde00 et 0x8700-0x8900

| Tâche | Statut |
|-------|--------|
| Script `discover-dino.mjs` | ✅ Écrit (600 lignes) |
| Docker rebuild avec correctifs pause | ✅ Fait (30/07) |
| **Scan #1 (Jack, P1 actif, 180s)** | ✅ Terminé 30/07 |
| **Scan #2 (autre perso, P1+P2 actifs)** | 🔧 **En attente** — utilisateur va lancer |
| Adresses confirmées → game-config.ts | ❌ Après scan #2 |
| Test end-to-end brawler | ❌ Après adresses |

#### 3.4.4 Correctifs divers (commité 13/08 — 1309e76)

| Fix | Fichier | Description |
|-----|---------|-------------|
| Pause hotkey désactivée | `game-runner.ts` | `input_pause_toggle = "nul"` (était "f12" — causait pause involontaire) |
| xdotool case fix | `game-runner.ts` | `xdotool key F12` majuscule (minuscule `f12` ignoré par xdotool) |
| layout.tsx Script | `layout.tsx` | Suppression `<Script>` next/script (bloquait le rendu React) |
| /duel loading guards | `page.tsx` | Loading state + `!game` null guard + optional chaining (évite crash si duelGames vide) |
| SKY balance test | `sky_transactions` | testplayer1 + testplayer2 → 20000 SKY (SQLite local) |
| db.ts seed dino | `db.ts` | INSERT duel_games pour dino (CPS1, mode brawler) |

#### 3.4.5 Pipeline pixel brawler + Score OCR ✅ (fix 12/08, commité 13/08 — 1309e76)

RAM score Dino introuvable → OCR pixel. End-to-end vérifié en live le 10/08 (mort + game-over + overlay).

| Composant | Fichier | Description |
|-----------|---------|-------------|
| Santé + vies pixel | `brawler-pixel-analyzer.ts` | Column-scan santé, island-counting vies, bar visibility 3-frame streak |
| Machine à états | `game-runner.ts` | NORMAL→DYING→respawn/deadline→GAME OVER (3 chemins) |
| **Score OCR (fix 12/08)** | `brawler-pixel-analyzer.ts` | Détection d'encre bg-agnostique, templates DINO consensus, blank check relaxé |
| **Rank OCR (13/08)** | `brawler-pixel-analyzer.ts` | `measureRank()` #TH blanc y=24-44, templates dédiés 1/0/T/H, latch absence salle 1 |

**Diagnostic score = -1 (résolu 12/08)** : l'OCR utilisait une réf figée (153,153,238) +
MIN_DEVIATION=25 → tout le fond ciel était « déviant » → vecteur tout-1 → garde solid → -1.
En réalité **pas de panneau HUD fixe** : les chiffres sont dessinés directement sur l'écran
(ciel 153,187,238 ou sol sombre). Fix en 4 points :
1. `extractDigitVector` : détection d'encre (navy outline / cyan fill / dark blue) au lieu de la déviation
2. Templates DINO 0/2/4/5/6/7/8/9 → consensus extraits des frames confirmées (5 = frame 16500)
3. Blank check `rowsWithContent < 4` → `< 3` (le « 7 » fin rejeté à tort)
4. Discriminateur 8/9 (`isInkPixel` + `inkCountInRect` + jambe bas-gauche) — glyphes identiques à 5×7 ; zone jambe ancrée sur le bord gauche réel du glyphe (tx), pas sur x0 (le glyphe peut être rendu ±1px)

**Ground truth utilisateur confirmé (12/08)** : recent=62000, live=62400, latest=62800,
verify=10700, ask=17100 + score-frame-…37721=14700 + score-frame-…40722=16500
(template 5 extrait de cette frame) + score-frame-…34691=12900 (révélé l'ambiguïté 8/9)
+ score-frame-…3822689=**9500** (valide le discriminateur ancré tx) + score-frame-…3816676=**4900**.
**10/10 frames lues correctement**, distances ≤ 4. **8/9 disambigués** par la jambe
bas-gauche du 8, ancrée sur le bord gauche réel du glyphe (tx) — glyphes identiques
à la grille 5×7 (la fenêtre de 10px coupe le côté droit des glyphes ~14px).
**Séquence complète batch 12/08 monotone et confirmée** : 800→1800→4100→4900→7200→
9500→10500→12900→14700→16500→17100 ✓.
**Reste : le chiffre 3 sans échantillon réel — à tester en live.**
`npx tsc` clean, dist rebuildé, déployé (docker restart 12/08).

**Disposition HUD complète (rappel utilisateur 12/08) — identique pour P1/P2/P3** :
1. En haut à gauche : vies (`=x`) — ✅ pixel (island-counting)
2. En haut à droite : score — ✅ OCR (ink-based)
3. Sous les vies : nom du perso — 🟡 à détecter, à croiser avec le char ID RAM
4. Sous le score : rank — ✅ OCR implémenté 13/08 (#TH, stats + overlay), validation live en attente
5. Sous ces éléments : barre de vie — ✅ pixel (column-scan)
6. Sous la barre : noms des adversaires — 🟡 visibles seulement quand on les frappe / proximité
7. Sous les noms adverses : leur barre de vie — 🟡 à détecter

**Rank OCR #TH (implémenté 13/08, déployé, validation live en attente)** : tous les
éléments HUD hors score sont BLANCS (utilisateur 13/08) — le prédicat ink attrape le
blanc via `g>195 && b>215`. Zone y=24..44, x=330..445 (upscaled), right-aligned sous
le score ; "10TH" = glyphes x=354..423. Police rank plus étroite que le score (« 0 »
carré vs arrondi) → templates dédiés `RankGlyphRefs` (1/0/T/H), vecteurs 5×7 adaptatifs
par bbox. **Absent en salle 1** (apparaît après les premiers ennemis) → présence = ink
20..900 rangées y+3.., latch (clear après 3 frames vides), garde dalle de transition.
Glyphes inconnus (2-9, S/N/D/R) loggués `🧩 Unknown rank glyph` 1×/session pour
extraction future. Chaîne : analyzer → game-runner (sync + log `🔢 OCR rank`) →
brawlerState + 7× brawlerGameOver → types/ws-handler → CloudAdapter → useEmulator →
overlays GAME OVER (bloc Rank cyan conditionnel sur /play + /duel). tsc server+frontend
clean, dist rebuildé, docker restart 13/08.

### 3.5 Ancienne détection pixel SFA2 (SUPPRIMÉE 26/07)

Toute la détection visuelle/health-based KO ci-dessous a été retirée car redondante avec les round counters RAM :
- ~~PixelMatchAnalyzer, state machine WARMUP→PLAYING→KO_PENDING→…~~
- ~~Stripe ffmpeg, comptage colonnes, isHealthPixel v2~~
- ~~Recalibration fullBarW, KO rétroactif, anti-fantôme time-over/KO~~
- ~~Timer OCR template matching, bars-vanished KO, bar-stable fallback~~
- ~~Portrait capture/calibration/templates consensus~~
- ~~TextEventDetector, TemplateMatcher~~

**Raison** : les round counters RAM (0x0701/0x0A04) sont le ground truth — ils incrémentent atomiquement en fin de round, indépendants des heuristiques visuelles (time-over winner erroné, draw manqué, calibration asymétrique).

### 3.6 Config → DB (Turso variables)

- TURSO_DATABASE_URL + TURSO_AUTH_TOKEN ajoutés au Docker compose
- Permet au game-server de lire la config RAM depuis la BDD
- 🔧 **WD** — pas encore utilisé par le code, moins prioritaire maintenant (config RAM chargée directement)

### 3.7 Déploiement VPS

| Fichier | Statut |
|---------|--------|
| docker-compose.prod.yml | ✅ |
| Caddyfile (HTTPS auto + WSS) | ✅ |
| .env.prod.example | ✅ |
| DEPLOY-VPS.md (walkthrough complet) | ✅ |

---

## 4. Base de données (Turso/libsql)

### 4.1 Tables existantes ✅

- `users` — comptes joueurs
- `duel_lobby` — heartbeat, statut joueurs
- `duel_challenges` — défis (pending/accepted/declined/cancelled/rules_pending)
- `netplay_notifications` — notifications temps réel
- `duel_results` — résultats de duels
- `sky_transactions` — transactions SKY
- `cloud_rooms` — mapping room code → session

### 4.2 Nouvelles tables ✅ (commit `d929fb5`)

| Table | Description |
|-------|-------------|
| `duel_games` | Registre de jeux (kof98, sf2, kof2002, sfa2) avec winner_share, ram_config, category, cover_image, description |
| `duel_game_modes` | 3 modes par jeu (standard/XL/fighter) avec rules i18n, winner_share |
| `duel_game_controls` | Contrôles clavier par jeu/joueur |
| `duel_game_config_versions` | Versioning git-like des configs RAM + contrôles |
| `escrow_rooms` | Chambres d'escrow isolées par session (pot, settlement) |
| `platform_bank` | Revenus plateforme tracés par match |
| `sky_transactions` | Ledger transactions SKY (entry_fee, payout, dispute, seed, admin_adjust) |
| `duel_recordings` | Enregistrements blob des matchs |

### 4.3 Seeds ✅ (commit `d929fb5`)

- 4 jeux avec cover_image, description, category
- KOF98 : RAM config complète en JSON + contrôles
- KOF2002 : RAM config basic (health/timer/mode)
- SF2 : contrôles 6 boutons
- SFA2 : contrôles SNES 6 boutons
- Config versions v1 seedées pour chaque jeu

### 4.4 ALTER TABLE migrations ✅ (commit `d929fb5`)

- `duel_challenges` : mode_id, match_count, match_number, challenger_rules_accepted, target_rules_accepted, rules_pending_at
- `duel_games` : entry_fee, winner_share, ram_config, category, cover_image, description
- `duel_game_modes` : rules, winner_share
- `duel_results` : perfect_ko_count

### 4.5 Offline-first ✅ (commit `d929fb5`)

| Fonctionnalité | Description |
|----------------|-------------|
| USE_LOCAL_DB=true | SQLite local (`skyplay-local.db`), zéro réseau |
| Sync heartbeat | Probe Turso toutes les 60s, fail silencieux offline |
| DbSyncPoller | Composant client : sync au mount, on `window.online`, et heartbeat 60s |
| POST /api/admin/db/sync | Endpoint de sync manuel |
| Fallback automatique | Sans config DB → SQLite local automatiquement |

---

## 5. Économie SKY

| Fonctionnalité | Statut | Notes |
|----------------|--------|-------|
| Balance compte | ✅ | |
| Entry fee par jeu/mode | ✅ | Lu depuis `duel_games.entry_fee` / `duel_game_modes.entry_fee` |
| WINNER_SHARE DB-configurable | ✅ | Mode > jeu > DEFAULT_WINNER_SHARE (0.75) |
| InsufficientFunds gate | ✅ | |
| Admins (unlimited SKY) | ✅ | |
| Charge au début du combat | ✅ | gated par `gameStarted` |
| Litige (remboursement / award) | ✅ | `resolveDispute()` |
| Litige avec frais dynamiques | ✅ | Lit depuis `duel_games` |
| Historique transactions | ✅ | |
| Payout winner avec winner_share DB | ✅ | Mode-level > game-level > default |

---

## 6. i18n (FR/EN)

| Section | Statut | Notes |
|---------|--------|-------|
| Common + Play | ✅ | |
| Duel (base) | ✅ | lobby, intro, fight prompt, rematch |
| Duel (étendu) | 🔧 **WD** | rules, pause, wizard, mode, controls KOF/SF2 |
| Profile | ✅ | |
| Admin | ✅ | |
| Dynamic strings | 🔧 **WD** | `lobbySubtitle(game)`, `arenaTitle(game)`, `startingDuel(game)`, `notifChallenge(game)` |

---

## 7. Système de cadeaux virtuels (Gift System) ✅ Sprints 0-3

### 6.1 Plateforme principale (NestJS)
| Fonctionnalité | Statut | Notes |
|----------------|--------|-------|
| Modèles Prisma | ✅ | VirtualWallet, Gift, GiftTransaction, GiftCategory |
| API catalog | ✅ | GET public, POST/PATCH/DELETE admin |
| API wallet | ✅ | GET auth JWT |
| API buy-coins | ✅ | POST auth — debit XAF, credit SkyCoins |
| API send gift | ✅ | POST auth — atomic Prisma tx, forward game-server |
| API withdraw diamonds | ✅ | POST auth — Diamond → XAF conversion |
| API leaderboard | ✅ | GET public — daily/weekly/alltime |
| API history | ✅ | GET auth — sent/received filter |
| Socket.IO events | ✅ | gift_received, gift_sent, wallet_update, diamonds_withdrawn |
| Notifications DB | ✅ | GIFT_RECEIVED type |
| 10 demo gifts seeded | ✅ | FREE/COMMON/RARE/EPIC/LEGENDARY |

### 6.2 Game-server (spectator + gift forwarding)
| Fonctionnalité | Statut | Notes |
|----------------|--------|-------|
| Spectator WebSocket | ✅ | JWT HS256 auth, read-only guards |
| Spectator binary relay | ✅ | H.264 video + codec config broadcast |
| POST /gift-notify | ✅ | Bearer auth, forward to all session viewers |

### 6.3 Frontend Next.js (skyplay-testing)
| Fonctionnalité | Statut | Fichier |
|----------------|--------|---------|
| API proxy routes | ✅ | `src/app/api/gifts/{catalog,send,leaderboard,wallet}/route.ts` |
| Proxy helper | ✅ | `src/lib/gifts-proxy.ts` |
| GiftPanel modal | ✅ | `src/components/overlay/GiftPanel.tsx` |
| DonorRanking sidebar | ✅ | `src/components/overlay/DonorRanking.tsx` |
| GiftOverlay animation | ✅ | `src/components/overlay/GiftOverlay.tsx` |
| Spectate page gifts | ✅ | GiftPanel + DonorRanking + gift button |
| Play page gifts | ✅ | receiverId = opponentId (PvP), gift button + GiftOverlay |
| CloudAdapter onGiftNotify | ✅ | Callback + gift_notify case |
| useEmulator gift state | ✅ | giftNotifications array, auto-remove 5s |
| Host user ID resolution | ✅ | cloud_rooms.user_id, spectate API returns hostUserId |

---

## 8. SSO Arcade

| Fichier | Statut |
|---------|--------|
| `INTEGRATION-ARCADE-SSO.md` | 📄 Document untracké (plan) |
| Route `api/sso/` | Untracké (vide) |

---

## 9. Migration + Hébergement

### 9.1 Railway → Northflank

| Tâche | Statut |
|-------|--------|
| Config/docs sweep (Dockerfile, NORTHFLANK docs) | ✅ |
| Swap URLs .railway.app | ❌ Pas fait |
| Rotation secrets JWT/Cloudinary/Postgres | ❌ Pas fait |
| 3 WSS placeholders Northflank | Scaffolded, pas configuré |

### 9.2 VPS (alternative)

| Tâche | Statut |
|-------|--------|
| Package prod complet | ✅ |
| Caddy, deploy docs | ✅ |
| Pas encore déployé | ⏳ |

---

## 10. Plateforme principale (SKY-PLAY-Platform-main/)

Dossier untracké contenant :

| Fichier | Description |
|---------|-------------|
| `DEMARRAGE.md` | Guide de démarrage |
| `README.md` | Overview |
| `VERCEL_ENV_SETUP.md` | Setup Vercel env |
| `DISCORD_INTEGRATION.md` | Intégration Discord |
| `AWS_S3_SETUP.md` | Setup S3 |
| `NORTHFLANK_DEPLOY.md` | Déploiement Northflank |
| `NORTHFLANK_STORAGE.md` | Stockage Northflank |
| `TEST_AVATAR_UPLOAD.md` | Test upload avatar |
| `api-deploy/` | API NestJS avec Dockerfile |

---

## 11. Scripts & Tests (untrackés)

| Script | Description |
|--------|-------------|
| `scripts/backup-sky-users.mjs` | Backup utilisateurs |
| `scripts/check-schema.mjs` | Vérification schéma BDD |
| `scripts/migrate-duel-schema.mjs` | Migration schéma duel |
| `scripts/reset-test-sky.mjs` | Reset SKY test |
| `apps/game-server/scripts/analyze-stripe-cols.cjs` | Analyse colonnes stripe santé (diagnostic perfect KO) |
| `apps/game-server/scripts/scan-sfa2-timer.mjs` | Génération templates timer SFA2 |
| `apps/game-server/scripts/discover-dino.mjs` | 🆕 Découverte RAM Cadillacs & Dinosaurs (CPS1, 600 lignes) |
| `apps/game-server/scripts/start-dino.sh` | 🆕 Script lancement dino (helper) |

*Nettoyage 17/07 : supprimés `nav-sfa2.*`, `scan-sfa2-ram.mjs`, `test-keys.cjs`, `test-ws.mjs`, `debug-*.png/jpg`, `screenshots/`, captures `.rgb` (approches abandonnées / debug one-shot). Conservés : `char-select-shots/` (tâches portraits) et `recordings/templates` + `timercap` (templates timer).*

---

## 12. Résumé visuel

```
┌──────────────────────────────────────────────────────────────────┐
│                     SKY PLAY — ÉTAT PROJET                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│ ✅ COMMITÉ (stable en prod)                                        │
│ ┌─────────────┬──────────────┬─────────────────┬───────────────┐ │
│ │ NES Emu     │ NeoGeo Emu   │ KOF98 RAM det.  │ Lobby Duel    │ │
│ │ Auth JWT    │ CloudStream  │ SKY Economy     │ Duels 1v1     │ │
│ │ DuelEnd     │ Revanche     │ Abandon/Forfeit  │ Historique    │ │
│ │ i18n base   │ Admin panel  │ DuelGameSelector │ Timeout 40s   │ │
│ │ RulesOverlay│ VPS deploy   │ Multi-challenge  │ vsync video   │ │
│ │ DB registre │ winner_share │ entry_fee dyn.  │ Offline-first │ │
│ │ escrow rooms│ bank platform│ Sync heartbeat  │ SFA2 RAM      │ │
│ │ Gift System │ GiftPanel    │ DonorRanking    │ API proxy     │ │
│ │ Spectate WS │ GiftOverlay  │ Wallet virtuel  │ Leaderboard   │ │
│ └─────────────┴──────────────┴─────────────────┴───────────────┘ │
│                                                                   │
│ 🔧 NON COMMITÉ (working tree)                                     │
│ ┌─────────────┬──────────────┬─────────────────┬───────────────┐ │
│ │ Rules flow  │ Confirm-rule │ Recovery lobby   │ DuelPause     │ │
│ │ DuelScore   │ DuelWizard   │ Auto-rematch    │ HeaderAuth    │ │
│ │ SSO Arcade  │ Lieu partage │ WSS URL regen   │ CPS1 system   │ │
│ │ CPS1 brawler│ Dino RAM     │ layout fix      │ /duel fix     │ │
│ │ Pause fix   │ xdotool fix  │ SKY testplayers │ dino db seed  │ │
│ └─────────────┴──────────────┴─────────────────┴───────────────┘ │
│                                                                   │
│ ❌ NON FAIT                                                       │
│ ┌─────────────┬──────────────┬─────────────────┬───────────────┐ │
│ │ Northflank  │ Secret rotate│ KOF2002 RAM    │ Dino RAM      │ │
│ │ swap URLs   │              │ complet        │ confirmé      │ │
│ └─────────────┴──────────────┴─────────────────┴───────────────┘ │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 13. Priorités restantes

### 🔴 URGENT
1. **Terminer la découverte RAM Cadillacs & Dinosaurs** — scan en cours (30/07), gameplay actif P1
   - Valider les adresses santé, vies, score, niveau, game over
   - Cross-reference avec 2ème scan
   - Câbler dans game-config.ts FALLBACK_RAM_CONFIGS + game-runner.ts HEALTH_MEMORY_MAP

### 🟡 IMPORTANT
1. **Committer le working tree** (17 fichiers, +521/-40 lignes) :
   - Lot CPS1 : types.ts, EmulatorAdapter.ts, useEmulator.ts, cloud-session, roms API, GameControls, i18n
   - Lot Game-server brawler : config.ts, game-config.ts, game-runner.ts, types.ts, ws-handler.ts
   - Lot Fixes : layout.tsx (Script removal), /duel page (loading guards), pause hotkey (game-runner.ts)
   - Lot DB : db.ts (dino seed), discover-dino.mjs (script)
2. ~~**Pick order KOF98**~~ ✅ Câblé complet (22/07)
3. ~~**Templates portrait SFA2**~~ ✅ Plus pertinent (détection visuelle supprimée)

### 🟢 SECONDAIRE
4. **Northflank** — swapper URLs, rotate secrets
5. **SSO Arcade** — reprendre l'intégration
6. **KOF2002** — détection complète (team, pick order, perfect)
7. **Config RAM charger depuis DB** (Turso → game-runner) — moins prioritaire

### ⚠️ Infra
- **Docker Desktop instable** (2 gels backend le 16/07) — remède : kill processus Docker + `wsl --shutdown` + relancer Docker Desktop, puis `docker-compose up -d`

---

## 14. Analyse des coûts de déploiement production

**Date d'estimation** : 2026-07-30  
**Périmètre** : Plateforme complète (frontends, API, game-server, DB, stockage)  
**Monnaie** : EUR (conversion USD → EUR au taux ~0.92)

---

### 14.1 Architecture cible

```
┌─────────────────────────────────────────────────────────────┐
│                       UTILISATEURS                           │
│  Navigateur (Cameroun, Afrique, Europe)                       │
└──────────┬──────────────────────┬───────────────────────────┘
           │ HTTPS (pages, API)    │ WSS (streaming vidéo)
           ▼                       ▼
┌──────────────────┐    ┌──────────────────────┐
│  VERCEL (edge)    │    │  GAME-SERVER (VPS)    │
│  • Next.js PWA    │    │  • Docker RetroArch   │
│  • API routes     │    │  • Xvfb + FFmpeg      │
│  • Pages statiques│    │  • WebSocket WSS      │
└────────┬─────────┘    └──────────┬───────────┘
         │                         │
         ▼                         ▼
┌──────────────────┐    ┌──────────────────────┐
│  TURSO (libsql)   │    │  NORTHFLANK (API)     │
│  • Config jeux   │    │  • NestJS backend     │
│  • Lobby duels   │    │  • Gift System        │
│  • Résultats     │    │  • Auth/SSO           │
│  • Transactions  │    │  • Notifications      │
└──────────────────┘    └──────────────────────┘
```

---

### 14.2 Détail par service

#### A. Vercel — Frontend + API Routes

| Ressource | Plan | Coût mensuel | Notes |
|-----------|------|-------------|-------|
| Pro plan (2 membres) | Pro | **20 €** | Inclut 2 projets simultanés, SSO, analytics |
| Bande passante | Inclus (1 TB) | 0 € | Pages + API légères, pas de streaming |
| Function execution | Inclus (1000 GB-hrs) | 0 € | API routes (lobby, auth, duel CRUD) très légères |
| Build minutes | Inclus (6000 min) | 0 € | Déploiements Next.js |
| **Sous-total Vercel** | | **20 €/mois** | |

**Détail** : Les streams vidéo passent en WebSocket direct (game-server → navigateur), sans transiter par Vercel. Le frontend ne consomme que des appels API REST légers (JSON, <1 KB par requête). Même à 10 000 utilisateurs/jour, on reste dans le tier gratuit.

**Marge de sécurité** : Ajouter 10-50 € si les API routes deviennent plus lourdes (upload, traitement). Peu probable à court terme.

---

#### B. Game-server (VPS) — Le poste principal

Chaque duel consomme environ **1,5-2 vCPU** (Xvfb + RetroArch FBNeo + 2 flux FFmpeg libx264/Opus par joueur). Avec GPU encoding (h264_nvenc/vaapi), on réduit à ~0,5 vCPU par duel.

##### Tier 1 — Démarrage (1-3 duels simultanés)

| Ressource | Spécification | Coût mensuel | Fournisseur |
|-----------|---------------|-------------|-------------|
| VPS Cloud L | 8 vCPU, 30 GB RAM, 800 GB SSD | **18 €** | Contabo |
| Bande passante | Illimité (port 1 Gbps) | 0 € | Inclus |
| IP statique | IPv4 + IPv6 | 0 € | Inclus |
| **Sous-total Tier 1** | | **18 €/mois** | |

Capacité estimée : 3-5 duels simultanés (software encoding), connexions spectateurs illimitées (relay binaire, quasi gratuit).

##### Tier 2 — Croissance Cameroun (5-15 duels simultanés)

| Ressource | Spécification | Coût mensuel | Fournisseur |
|-----------|---------------|-------------|-------------|
| VPS Cloud XL | 10 vCPU, 60 GB RAM, 1.6 TB SSD | **27 €** | Contabo |
| OU Serveur dédié | AX42 (6c/12t, 64 GB, 2×512 NVMe) | **49 €** | Hetzner |
| Bande passante | Illimité / 1 Gbps | 0 € | Inclus |
| **Sous-total Tier 2** | | **27-49 €/mois** | |

Capacité estimée : 6-12 duels simultanés (software), 10-20 (GPU encoding).

##### Tier 3 — Scale international (20-50+ duels simultanés)

| Ressource | Spécification | Coût mensuel | Fournisseur |
|-----------|---------------|-------------|-------------|
| 2× Serveur dédié | AX52 (8c/16t, 128 GB, 2×1TB NVMe) | **2×74 € = 148 €** | Hetzner |
| OU Multi-VPS | 3-4× Cloud XL (10 vCPU, 60 GB) | **3-4×27 € = 81-108 €** | Contabo |
| Load balancer | HAProxy ou Traefik sur VPS d'entrée | **5-10 €** | — |
| **Sous-total Tier 3** | | **86-158 €/mois** | |

##### Option alternative : Northflank (scaling à la demande)

| Composant | Coût unitaire | Pour 1000 duels/mois (15 min) |
|-----------|---------------|------|
| Container 2 vCPU / 4 GB | ~0,015 €/min | 1000 × 15 × 0,015 = **225 €** |
| Bande passante sortante | 0,03 €/GB | ~225 MB/duel × 1000 = 225 GB → **6,75 €** |
| Container always-on (API) | ~10 €/mois | **10 €** |
| **Total Northflank** | | **~242 €/mois** |

Northflank est plus cher que le VPS pour le jeu vidéo continu, mais évite la gestion serveur. Avantage clé : scaling multi-région (déploiement automatique Europe/Amérique/Asie).

---

#### C. Turso — Base de données (libsql)

| Ressource | Plan | Coût mensuel | Notes |
|-----------|------|-------------|-------|
| Stockage | Gratuit (9 GB) | **0 €** | Configs, lobby, users, résultats : <100 MB |
| Lectures DB | Gratuit (1B rows/mo) | **0 €** | Polling lobby 2s, ~50 joueurs actifs |
| Écritures DB | Gratuit (25M rows/mo) | **0 €** | Résultats, transactions : milliers/mois max |
| Locations | Gratuit (3 régions) | **0 €** | EU-West + 2 autres |
| **Sous-total Turso** | | **0 €/mois** | Niveau gratuit très généreux |

**⚠️ Limites** : 500 bases de données max, 9 GB total. Si on dépasse (audience >50k), passer au plan Scaler :
- 0,05 €/GB stocké → ~1-5 €/mois
- 0,03 €/GB lu → négligeable (lectures KB)
- **Plan scaler estimé : 5-25 €/mois**

---

#### D. Northflank — API NestJS (Gift System, Auth, Notifications)

| Ressource | Spécification | Coût mensuel |
|-----------|---------------|-------------|
| Service Combined | 0,5 vCPU, 512 MB RAM, always-on | **10-12 €** |
| Bande passante | Trafic API léger (JSON) | Inclus |
| Domaine/TLS | Automatique | Inclus |
| **Sous-total Northflank API** | | **12 €/mois** |

Alternative : héberger l'API sur le même VPS que le game-server → 0 € supplémentaire (démarrage).

---

#### E. Vercel Blob — Enregistrements vidéo (optionnel)

| Ressource | Coût unitaire | Si 100 duels/jour (RECORDING_ENABLED) |
|-----------|---------------|--------------------------------------|
| Stockage (30j rétention) | 0,05 €/GB | 675 GB → **33,75 €/mois** |
| Bande passante (visionnage) | 0,10 €/GB | Faible (consultation occasionnelle) |
| **Sous-total Blob** | | **0-40 €/mois** |

**Note** : Le recording est actuellement **désactivé** (`RECORDING_ENABLED=0`). À activer uniquement si la monétisation le justifie (replay payant, litiges, contenu highlight). Chaque duel de 15 min à 2 Mbps ≈ 225 MB. À 1000 duels/mois = 225 GB stocké = 11,25 €/mois.

---

#### F. Domaines & DNS

| Domaine | Usage | Coût annuel | Coût mensuel |
|---------|-------|-------------|-------------|
| `skyplay.cloud` | Principal | ~12 €/an | **1,00 €** |
| `skyplay.cm` | Local Cameroun (optionnel) | ~25 €/an | **2,08 €** |
| Sous-domaines Vercel | `*.vercel.app` | Gratuit | 0 € |
| Tunnel Cloudflare | Exposition game-server | Gratuit (quick) | 0 € |
| **Sous-total Domaines** | | | **1-3 €/mois** |

---

#### G. Services auxiliaires

| Service | Usage | Coût mensuel |
|--------|-------|-------------|
| Gmail API | Emails transactionnels (<500/j) | **0 €** |
| GitHub | Code source, CI de base | **0 €** |
| Docker Hub | Images conteneur (public) | **0 €** |
| Cloudflare Tunnel | Exposition game-server nommé | **0 €** (tunnel gratuit) |
| **Sous-total Auxiliaires** | | **0 €/mois** |

---

### 14.3 Synthèse par tier

#### Tier 1 — Démarrage / Démo (1-3 duels simultanés, ~500 joueurs/mois)

| Poste | Mensuel | Annuel |
|-------|---------|--------|
| Vercel Pro | 20 € | 240 € |
| VPS Game-server (Contabo L) | 18 € | 216 € |
| Turso | 0 € | 0 € |
| Northflank API | 0 € (sur VPS) | 0 € |
| Domaines | 1 € | 12 € |
| Blob (recording off) | 0 € | 0 € |
| **TOTAL** | **39 €** | **468 €** |

---

#### Tier 2 — Croissance Cameroun (5-15 duels simultanés, ~5000 joueurs/mois)

| Poste | Mensuel | Annuel |
|-------|---------|--------|
| Vercel Pro | 20 € | 240 € |
| VPS Game-server (Hetzner AX42) | 49 € | 588 € |
| Turso (scaler si dépassement) | 5 € | 60 € |
| Northflank API | 12 € | 144 € |
| Domaines | 1 € | 12 € |
| Blob (recording ON, 1000 duels/mois) | 15 € | 180 € |
| **TOTAL** | **102 €** | **1 224 €** |

---

#### Tier 3 — Scale international (20-50 duels simultanés, ~20k+ joueurs/mois)

| Poste | Mensuel | Annuel |
|-------|---------|--------|
| Vercel Pro / Team | 20-50 € | 240-600 € |
| 2× Serveur dédié (Hetzner AX52) | 148 € | 1 776 € |
| Load balancer + failover | 10 € | 120 € |
| Turso scaler multi-région | 25 € | 300 € |
| Northflank API (HA) | 25 € | 300 € |
| Domaines (.cloud + .cm) | 3 € | 36 € |
| Blob (recording ON, 10k duels/mois) | 100 € | 1 200 € |
| **TOTAL** | **331-361 €** | **3 972-4 332 €** |

---

### 14.4 Coûts annuels récapitulatifs

| Tier | Mensuel | Annuel | Capacité | Cible |
|------|---------|--------|----------|-------|
| **Tier 1** Démarrage | **39 €** | **468 €** | 1-3 duels simultanés | Tests, démo, early adopters |
| **Tier 2** Croissance | **102 €** | **1 224 €** | 5-15 duels simultanés | Lancement Cameroun |
| **Tier 3** Scale | **331-361 €** | **~4 000 €** | 20-50+ duels | Multi-pays, e-sport |

---

### 14.5 Recommandations d'optimisation

| Levier | Économie estimée | Délai |
|--------|-----------------|-------|
| **GPU encoding** (h264_nvenc/vaapi) | -40% CPU = 2× capacité au même prix | 1-2 jours (config FFmpeg + driver) |
| **API sur VPS game-server** (pas Northflank séparé) | -12 €/mois (Tier 2) | 0 jour (déjà possible) |
| **Cloudflare Tunnel nommé** (vs tunnel quick) | URL stable, 0 € | 30 min config |
| **Turso gratuit long terme** | 0 € jusqu'à 50k utilisateurs | Déjà en place |
| **Recording off par défaut** | -40 €/mois (Tier 3) | Déjà en place |
| **Hetzner au lieu de Contabo** | +puissance, +fiabilité, ~30% plus cher | Migration 1 jour |
| **Multi-région Northflank** au lieu de multi-VPS | +50-100% coût mais 0 maintenance | Quand scaling >50 duels |

### 14.6 Projection 3 ans (Tier 2 → Tier 3)

| Année | Tier | Coût annuel | Cumul |
|-------|------|-------------|-------|
| 2026 (août-déc) | Tier 1 → Tier 2 | 200-500 € | 500 € |
| 2027 | Tier 2 (Cameroun) | 1 224 € | 1 724 € |
| 2028 | Tier 2 → Tier 3 (multi-pays) | 2 500-3 500 € | ~5 000 € |

**Coût total sur 3 ans : ~5 000 €** — très compétitif pour une plateforme de cloud gaming e-sport.

Comparaison : une solution tout-cloud (AWS GameLift + Lambda + RDS) coûterait 1 500-3 000 €/mois pour la même capacité, soit 54 000-108 000 € sur 3 ans. L'approche VPS + serverless léger divise le coût par **~20**.

---

*Document mis à jour le 2026-08-13 — Rank OCR #TH Dino implémenté + déployé (templates dédiés 1/0/T/H, zone y=24-44, latch absence salle 1, HUD hors score tout blanc), chaîne complète jusqu'aux overlays GAME OVER. Validation live en attente.*
