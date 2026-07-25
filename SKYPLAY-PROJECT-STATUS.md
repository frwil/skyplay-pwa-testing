# SKY PLAY — État d'avancement complet

**Date** : 2026-07-26  
**Branche** : `main` — SFA2 play mode découvert + intégré, noms persos game-agnostic, timeouts ×2  
**Dernier commit** : `a2ce061` — wip: template matching for SFA2 round-end detection  

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
| Auth serveur-side (homepage) | 🔧 **WD** | `HeaderAuth` + vérification JWT + lookup username — non commité |
| Logout avec sessionStorage | 🔧 **WD** | `skyplay_logged_out` flag — non commité |

### 🔧 En cours (non commité)

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
| Timeout défi 30s + auto-cancel | ✅ | `cc70b69` |
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

### 3.3 Détection santé SFA2 (pixel — snes9x) ✅ — sessions live 14→20/07

**Refactor 17/07** : logique extraite dans `pixel-match-analyzer.ts` (state machine, column scan, timer OCR, templates). `game-runner.ts` garde l'orchestration (ffmpeg, events, WebSocket).

| Détection | Statut | Notes |
|-----------|--------|-------|
| Capture stripe ffmpeg (y=110, h=52, intégrée au flux vidéo principal) | ✅ | 4 fps raw rgb24, plus de x11grab séparé |
| Machine à états (GamePhase) | ✅ | WARMUP→PLAYING→KO_PENDING→KO_CONFIRMED→NEW_ROUND→MATCH_END |
| **Mesure par comptage de colonnes** (`measureFilledColumns`) | ✅ Validé live | Barres SFA2 se vident du bord extérieur vers le centre |
| **isHealthPixel v2** | ✅ Validé live | `maxC>120` + exclusion bleu-dominant |
| **Recalibration fullBarW par round** | ✅ | Frames 1-4 PLAYING + différée au 1er tick timer (R1) + post-glow |
| Lissage médiane glissante + reset à la recalibration | ✅ | `getSmoothedHealth()` |
| KO (seuil 10%, confirm 5 frames) + KO rétroactif | ✅ Validé live | `koPendingMaxTimer` sticky + guérison impossible |
| **Anti-fantôme time-over** (`roundTimerWasRunning`) | ✅ Validé live | Écran résultat = barres pleines + « 00 » figé → ignoré |
| **Anti-fantôme KO** (timer-decrease liveness gate) | ✅ Validé live | Round « live » seulement si le timer décroît |
| **Garde « filet de vie »** | ✅ Déployé | Barre ≤10% mais timer vivant → reset confirmation KO |
| **Time-over** (timer→0 dans round armé) | ✅ Validé live | Compare `lastRunningHealth`, émet `roundResult` avec `koType: "timeout"` |
| **Bars-vanished KO** (double drop 0%) | ✅ Validé live | Transition écran → KO rétroactif basé sur `lastRunningHealth` |
| **Bar-stable fallback** | ✅ | Barres ≥80% région pendant 30f sans drop timer → arme le round |
| **Perfect KO ratio-based** | ✅ Fixé 20/07 | `minFilled/maxFilled ≥ 0.95` (colonnes brutes) — insensible à la dérive fullBarWidth |
| Draw time-over = aucun point | ✅ Validé live | SFA2 rejoue le round, pas de marque |
| **match_state WebSocket** | ✅ 20/07 | PixelMatchAnalyzer → GameRunner → ws-handler, ~205 lectures/test |
| **Suspension pendant char select** | ✅ Déployé | `⏸️/▶️` + `resetHealthWarmup` dans le guard |
| Timer OCR (template matching 8×12, seuil 160) | ✅ Validé live | Décomptes 99→0, templates sauvegardés dans `/recordings/templates/` |
| Match end (winsNeeded=2) + overlay | ✅ Validé live | |
| Navigation CPU auto end-to-end | ✅ 20/07 | 3× START → char select → 6× A (4s gaps) → combat → rounds → match end |
| Char select joueur (grille 2×9, D-pad counting) | ✅ Commité | `3395538` |
| Xvfb persistant + nettoyage lock (entrypoint.sh) | ✅ Validé | |
| **Portrait capture** (`import -depth 8`) | ✅ Fixé 20/07 | PPM 8-bit, calibrateur collecte 18 échantillons/match (était 0 avec le 16-bit) |
| **Portrait grid fix** (cellW 80→58, gridY 220→230) | ✅ Fixé 20/07 | Mesuré sur char-select-full.ppm : contenu x=30→552. Avant : cols 7-8 (Sodom/Rose/Rolento/Zangief) 0% contenu. Maintenant 18/18 cellules OK. |
| **Portrait calibration persistence** | ✅ Fixé 20/07 | Auto-load/save vers `/recordings/calibration/portrait-samples.json`. 378 échantillons (21/char), 0 corrompus. |
| **Portrait consensus templates** | ✅ 22/07 | Auto-générés 100% cross-val, 23.7% densité, all 18 chars OK, intégrés dans `pixel-game-config.ts` |
| **Time-over guard** | ✅ 22/07 | `roundTimerMaxSeen ≥ 50` — bloque les faux draws inter-round (timer 73→3 artefact transitoire) |
| Overlay SFA2 (noms persos) | ✅ | Templates portrait intégrés, `minConfidence` 0.40, `minMargin` 0.08 |
| **Play mode detection (Auto/Manual)** | ✅ 26/07 | P1=0x1C2A, P2=0x1C2B (+0x23 de char ID). 0=Manual, 1=Auto. Differ scan contrôlé 4-matchs |
| **Play mode intégré** (matchMeta + matchState) | ✅ 26/07 | game-runner.ts, game-config.ts, ws-handler.ts |
| **Noms persos game-agnostic** (KofMatchHUD) | ✅ 26/07 | `p1ActiveName`/`p2ActiveName` serveur-side, plus de lookup KOF98 client |
| **DuelEndOverlay game-agnostic** | ✅ 26/07 | SFA2 char names + play mode, client-side `sfa2Characters.ts` |
| **Timeouts ×2** | ✅ 26/07 | Acceptation défi 20→40s, règles 30→60s, overlay fin 10/30→20/60s |
| **SFA2 char name display in DuelScoreHUD** | ✅ 26/07 | Déjà OK (cursor-tracked grid names via char_selected) |

### 3.4 Config → DB (Turso variables)

- TURSO_DATABASE_URL + TURSO_AUTH_TOKEN ajoutés au Docker compose
- Permet au game-server de lire la config RAM/pixel depuis la BDD
- 🔧 **WD** — pas encore utilisé par le code

### 3.5 Déploiement VPS

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

### 4.2 Nouvelles tables (🔧 WD — dans db.ts non commité)

| Table | Description |
|-------|-------------|
| `duel_games` | Registre de jeux (kof98, sf2, kof2002, sfa2) |
| `duel_game_modes` | 3 modes par jeu (standard/XL/fighter) |
| `duel_game_controls` | Contrôles clavier par jeu/joueur |
| `duel_game_config_versions` | Versioning git-like des configs |

### 4.3 Nouveaux seeds (🔧 WD)

- 4 jeux avec cover_image, description, category
- KOF98 : RAM config complète en JSON + contrôles
- KOF2002 : RAM config basic (health/timer/mode)
- SF2 : contrôles 6 boutons
- SFA2 : en attente de config pixel

### 4.4 Nouveaux ALTER TABLE (🔧 WD)

- `duel_challenges` : mode_id, match_count, match_number, challenger_rules_accepted, target_rules_accepted

---

## 5. Économie SKY

| Fonctionnalité | Statut | Notes |
|----------------|--------|-------|
| Balance compte | ✅ | |
| Entry fee fixe 1000 SKY | ✅ → 🔧 | Devient `DEFAULT_ENTRY_FEE` |
| Frais d'entrée par jeu/mode | 🔧 **WD** | Depuis `duel_games.entry_fee` / `duel_game_modes.entry_fee` |
| WINNER_SHARE (75%) | ✅ | |
| InsufficientFunds gate | ✅ | |
| Admins (unlimited SKY) | ✅ | |
| Charge au début du combat | ✅ | gated par `gameStarted` |
| Litige (remboursement / award) | ✅ | `resolveDispute()` |
| Litige avec frais dynamiques | 🔧 **WD** | Lit depuis `duel_games` |
| Historique transactions | ✅ | |

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

## 7. SSO Arcade

| Fichier | Statut |
|---------|--------|
| `INTEGRATION-ARCADE-SSO.md` | 📄 Document untracké (plan) |
| Route `api/sso/` | Untracké (vide) |

---

## 8. Migration + Hébergement

### 8.1 Railway → Northflank

| Tâche | Statut |
|-------|--------|
| Config/docs sweep (Dockerfile, NORTHFLANK docs) | ✅ |
| Swap URLs .railway.app | ❌ Pas fait |
| Rotation secrets JWT/Cloudinary/Postgres | ❌ Pas fait |
| 3 WSS placeholders Northflank | Scaffolded, pas configuré |

### 8.2 VPS (alternative)

| Tâche | Statut |
|-------|--------|
| Package prod complet | ✅ |
| Caddy, deploy docs | ✅ |
| Pas encore déployé | ⏳ |

---

## 9. Plateforme principale (SKY-PLAY-Platform-main/)

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

## 10. Scripts & Tests (untrackés)

| Script | Description |
|--------|-------------|
| `scripts/backup-sky-users.mjs` | Backup utilisateurs |
| `scripts/check-schema.mjs` | Vérification schéma BDD |
| `scripts/migrate-duel-schema.mjs` | Migration schéma duel |
| `scripts/reset-test-sky.mjs` | Reset SKY test |
| `apps/game-server/scripts/analyze-stripe-cols.cjs` | Analyse colonnes stripe santé (diagnostic perfect KO) |
| `apps/game-server/scripts/scan-sfa2-timer.mjs` | Génération templates timer SFA2 |

*Nettoyage 17/07 : supprimés `nav-sfa2.*`, `scan-sfa2-ram.mjs`, `test-keys.cjs`, `test-ws.mjs`, `debug-*.png/jpg`, `screenshots/`, captures `.rgb` (approches abandonnées / debug one-shot). Conservés : `char-select-shots/` (tâches portraits) et `recordings/templates` + `timercap` (templates timer).*

---

## 11. Résumé visuel

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
│ │ i18n base   │ Admin panel  │ DuelGameSelector │ Timeout 30s   │ │
│ │ RulesOverlay│ VPS deploy   │ Multi-challenge  │ vsync video   │ │
│ └─────────────┴──────────────┴─────────────────┴───────────────┘ │
│                                                                   │
│ 🔧 NON COMMITÉ (working tree)                                     │
│ ┌─────────────┬──────────────┬─────────────────┬───────────────┐ │
│ │ Rules flow  │ Confirm-rule │ Recovery lobby   │ Frais dyn.    │ │
│ │ DuelScore   │ DuelPause    │ DuelWizard      │ Auto-rematch  │ │
│ │ HeaderAuth  │ Turso conf   │ DB registre     │ Lieu partage  │ │
│ │ SSO Arcade  │              │                 │               │ │
│ │ (début)     │              │                 │               │ │
│ └─────────────┴──────────────┴─────────────────┴───────────────┘ │
│                                                                   │
│ ❌ NON FAIT                                                       │
│ ┌─────────────┬──────────────┬─────────────────┬───────────────┐ │
│ │ Northflank  │ Secret rotate│ KOF2002 RAM    │               │ │
│ │ swap URLs   │              │ complet        │               │ │
│ └─────────────┴──────────────┴─────────────────┴───────────────┘ │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 12. Priorités restantes

### 🔴 URGENT
*Aucune tâche urgente en cours.*

### 🟡 IMPORTANT
2. **Committer le reste du working tree** :
   - ~~Lot 1 : game-runner + pixel/~~ ✅ Commit `3efcf3e` le 20/07
   - Lot 2 : DB + registre jeux
   - Lot 3 : Flow règles (respond → confirm-rules)
   - Lot 4 : UI duel (wizard, pause, score, lobby)
   - Lot 5 : i18n + config SNES + homepage
3. ~~**Pick order KOF98**~~ ✅ Câblé complet (22/07)
4. ~~**Templates portrait SFA2**~~ ✅ 378 échantillons (21/char), templates consensus intégrés (22/07)

### 🟢 SECONDAIRE
6. **Northflank** — swapper URLs, rotate secrets
7. **SSO Arcade** — reprendre l'intégration
8. **KOF2002** — détection complète (team, pick order, perfect)
9. **Config pixel charger depuis DB** (Turso → game-runner)

### ⚠️ Infra
- **Docker Desktop instable** (2 gels backend le 16/07) — remède : kill processus Docker + `wsl --shutdown` + relancer Docker Desktop, puis `docker-compose up -d`

---

*Document mis à jour le 2026-07-22 — cleanup escrow dry-run OK, tempslates portrait SFA2 21/char intégrés, pick order KOF98 câblé, time-over guard déployé.*
