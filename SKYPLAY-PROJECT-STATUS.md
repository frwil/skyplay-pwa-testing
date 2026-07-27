# SKY PLAY — État d'avancement complet

**Date** : 2026-07-27  
**Branche** : `main` — offline-first SQLite, winner_share DB, nettoyage configs hardcodées  
**Dernier commit** : `d929fb5` — offline-first local SQLite + winner_share DB-configurable + hardcoded config cleanup  

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

### 3.4 Ancienne détection pixel SFA2 (SUPPRIMÉE 26/07)

Toute la détection visuelle/health-based KO ci-dessous a été retirée car redondante avec les round counters RAM :
- ~~PixelMatchAnalyzer, state machine WARMUP→PLAYING→KO_PENDING→…~~
- ~~Stripe ffmpeg, comptage colonnes, isHealthPixel v2~~
- ~~Recalibration fullBarW, KO rétroactif, anti-fantôme time-over/KO~~
- ~~Timer OCR template matching, bars-vanished KO, bar-stable fallback~~
- ~~Portrait capture/calibration/templates consensus~~
- ~~TextEventDetector, TemplateMatcher~~

**Raison** : les round counters RAM (0x0701/0x0A04) sont le ground truth — ils incrémentent atomiquement en fin de round, indépendants des heuristiques visuelles (time-over winner erroné, draw manqué, calibration asymétrique).

### 3.5 Config → DB (Turso variables)

- TURSO_DATABASE_URL + TURSO_AUTH_TOKEN ajoutés au Docker compose
- Permet au game-server de lire la config RAM depuis la BDD
- 🔧 **WD** — pas encore utilisé par le code, moins prioritaire maintenant (config RAM chargée directement)

### 3.6 Déploiement VPS

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
│ │ i18n base   │ Admin panel  │ DuelGameSelector │ Timeout 40s   │ │
│ │ RulesOverlay│ VPS deploy   │ Multi-challenge  │ vsync video   │ │
│ │ DB registre │ winner_share │ entry_fee dyn.  │ Offline-first │ │
│ │ escrow rooms│ bank platform│ Sync heartbeat  │ SFA2 RAM      │ │
│ └─────────────┴──────────────┴─────────────────┴───────────────┘ │
│                                                                   │
│ 🔧 NON COMMITÉ (working tree)                                     │
│ ┌─────────────┬──────────────┬─────────────────┬───────────────┐ │
│ │ Rules flow  │ Confirm-rule │ Recovery lobby   │ DuelPause     │ │
│ │ DuelScore   │ DuelWizard   │ Auto-rematch    │ HeaderAuth    │ │
│ │ SSO Arcade  │ Lieu partage │ WSS URL regen   │               │ │
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
1. **Committer le working tree** :
   - ~~D-pad tracking~~ ✅ Retiré (26/07)
   - ~~Détection visuelle/pixel SFA2~~ ✅ Retiré (26/07), RAM-only
   - ~~Lot 1 : game-runner + pixel/~~ ✅ Supprimé (plus pertinent)
   - Lot 2 : DB + registre jeux
   - Lot 3 : Flow règles (respond → confirm-rules)
   - Lot 4 : UI duel (wizard, pause, score, lobby)
   - Lot 5 : i18n + config SNES + homepage
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

*Document mis à jour le 2026-07-26 — suppression détection visuelle SFA2, round counters RAM autoritaires, D-pad tracking retiré, noms persos game-agnostic, timeouts ×2.*
