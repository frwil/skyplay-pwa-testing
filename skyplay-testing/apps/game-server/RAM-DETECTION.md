# KOF98 — Détection RAM (game-server)

Carte des adresses RAM (RetroArch `READ_CORE_RAM` sur `127.0.0.1:55355` dans le conteneur)
et suivi des avancements. Toutes les valeurs de perso sont des IDs KOF98 `0x00`–`0x25`.

## Adresses validées

| Info | P1 | P2 | Notes |
|------|----|----|-------|
| Santé (HP) | `0x8238` | `0x8438` | max `0x67` (=103). ⚠️ **peu fiable** au moment KO/time-over (lit souvent le mauvais perso) → NE PAS utiliser pour le vainqueur. |
| **Persos perdus (compteur fin de match)** | **`0xA859`** | **`0xA868`** | **✅ FIABLE.** Nb de persos éliminés par joueur, 0→3, **draw inclus** (un draw incrémente les DEUX). Fin de match = un atteint 3 → l'autre gagne ; 3-3 = draw. Remis à 0 au char-select. Immunisé au faux-vainqueur santé ET au rejeu 31%. |
| Victoires *propres* (KO net, hors draw) | `0xA856` | `0xA869` | Comptent les victoires de round **sans** les draws — NE PAS utiliser pour la fin de match (ratent les draws). |
| **Perso actif** (combattant courant) | **`0x8256`** | **`0x8456`** | Dupliqué à `+0x58`. Fiable **en combat stable** (matchFlag `0x40`/`0x48`). |
| Équipe (3 persos, *set order*) | `0xA84E`/`0xA84F`/`0xA851` | `0xA85E`/`0xA860`/`0xA861` | Offsets irréguliers + séparateur `0x00`. **≠ ordre de sélection**. ⚠️ région **repurposée** aux transitions de round (les IDs bougent) — figer en char-select. |
| **Ordre de pick (fight order)** | 1er=`0x15CB` 2e=`0x15CA` 3e=`0x15CD` | 1er=`0x17CB` 2e=`0x17CA` 3e=`0x17CD` | **✅ VALIDÉ (diff contrôlé 3 ordres, 2026-07-10).** Buffer struct joueur, miroir P2=P1+`0x200`. Séparateur `00` à `0x15CC`/`0x17CC`. Layout mémoire inhabituel `[2e,1er,sep,3e]`. Valeurs = IDs `0x00–0x25`. C'est le **vrai ordre de sélection** (fiable dès le combat), ≠ set-order `0xA84E`. À lire en combat stable et figer. |
| Timer | `0xA83A` (16-bit LE avec `0xA83B`) | — | `0x85D2` = timer alt. `0xA83C`/`0xA83D` = sous-compteurs frame (bruit). |
| matchFlag (état) | `0xA840` | — | `0x00`=char select, `0x40`/`0x48`=combat, `0x42`/`0x43`/`0x47`/`0xCA`=transition/KO, `0xFF`=perso KO. **Écran victoire/CONTINUE : `0xC6` (P2 a perdu) / `0xCA` (P1 a perdu)** — persiste à travers l'anim de victoire ET le char-select post-continue (ne bouge qu'au démarrage du match). |
| **Compteur de pièces** | **`0xF2C0`** (miroir `0xF2C8`) | — | **✅** Monte **+1 par pièce** insérée, stable sinon. `crédit affiché = 0xF2C0 − 0xF0` (offset 240). Sert à **vérifier qu'une pièce a été prise** (continue de revanche) : lire avant/après l'insertion, tout changement = pièce enregistrée. |

Structs joueur en **miroir** : P2 = P1 `+ 0x200`.

## ⚠️ Détection fin de match — la santé ne suffit PAS (2026-07-10)

**Découverte clé (confirmée par logs live) :** en KOF98, un **« draw à 31 % » n'est PAS une élimination — c'est un REJEU de la manche.** Quand une manche est nulle (double-KO ou time-over à égalité), le jeu **garde les deux mêmes persos** et les fait rejouer avec la vie remise à ~`0x20`/`0x67` (≈31 %). Personne n'est éliminé, le match **continue**.

Preuve (match #1) : après `DRAW! Both at 31%` → on a émis `MATCH OVER`, mais le jeu montrait toujours `active: P1=King P2=Ralf` en train de se battre à 31 %, timer qui descend. La revanche a alors fait `resume()` **en plein rejeu à 31 %** au lieu de la sélection → « départ à 31 %, on aurait dû retourner à la sélection ».

Conséquences de la détection par la vie (patterns santé dans `game-runner.ts`) :
- Un draw 31 % est compté à tort comme **+1 perte pour chacun** → fin de match prématurée (faux overlay).
- Un time-over à vide (2 joueurs immobiles) est tantôt **ignoré** (santé lue ~100 %), tantôt **compté** (santé lue 31 %) — pur hasard de timing de poll (250 ms).
- Impossible de distinguer de façon fiable : vrai KO/élimination vs rejeu de draw vs time-over.

**→ Refonte faite ET VALIDÉE EN LIVE (2026-07-10).** `processHealthFrame()` route désormais vers `processLossCounters()` pour kof98 (compteurs `0xA859`/`0xA868`). Match live confirmé bout en bout : R1→P1, R2→P2, R3→P1, R4→**draw** (P1=2 P2=3) → `MATCH #1 OVER Winner: P1`, overlay affiché avec le bon vainqueur. Plus de faux time-over, plus de rejeu-31%-compté-comme-fin. La santé n'est plus utilisée que pour le HUD (et le flag `perfect`, encore peu fiable — voir reste).

Garde-fous en place (chemin santé désormais bypassé pour kof98, gardés par sécurité) :
- Stopgap anti-démo (`pause()` sur attract) **gardé** par `Math.max(p1Losses,p2Losses) >= 2` — évite le freeze à 0-0 sur transition de round 1.
- Pattern B3 (« 31 % timer expiré ») n'émet **plus** de `matchEnd` inconditionnel (retiré).
- Pause/resume UDP autoritatif (GET_STATUS/PAUSE_TOGGLE via socket `healthUdp` + boucle de convergence) — la revanche reprend sans désync.

## À faire / en cours
- [x] **Compteur de persos perdus TROUVÉ** — `0xA859` (P1) / `0xA868` (P2), 0→3, draw inclus. Validé sur un match complet (P1 R1+R3, P2 R2, draw R4 → `0xA868`=3 → P1 gagne). Outil : `watch-counter.mjs` (conteneur `/tmp/`).
- [x] **Refonte `processHealthFrame()` sur `0xA859`/`0xA868` — FAITE + VALIDÉE LIVE (2026-07-10).** Nouveau `processLossCounters()` : lit les 2 octets à chaque poll, round result sur deltas (`0xA859`↑ = P2 gagne ; `0xA868`↑ = P1 gagne ; les deux ↑ = draw), matchEnd sur `>=3`. Logs préfixe `🧮`. Match live OK : R1→P1, R2→P2, R3→P1, R4→draw → `MATCH #1 OVER Winner P1` + overlay bon vainqueur.
- [x] **Stat `perfectKOs`** — ✅ **VALIDÉE LIVE (2026-07-10, 2 matchs + revanche).** Pas de compteur RAM de perfects (`0xA867`/`0x2584` éliminés — carryover / perso-dépendant). Règle retenue : **perfect = round fini par KO (timer > 0) ET vainqueur intact** (`min-health ≥ 95`, samplé en combat stable `flag 0x4x`). Discriminateur KO-vs-time-over = **le timer seul** : `roundTimerHitZero` latch quand `memTimer16` passe `>0 → 0` en combat (flag `0x4x`) ; KOF98 remet le timer au max entre rounds sans passer par 0, donc un KO ne le déclenche jamais. Un **TIME OVER** (chrono à 0), y compris "DRAW GAME" où le jeu affiche PERFECT sans KO, ne compte JAMAIS : ni perfect, ni badge victoire perso (emit `koType=draw`/`winner=0`, score du match toujours piloté par les compteurs `0xA859`/`0xA868`). ⚠️ NE PAS utiliser "les 2 joueurs intacts" comme discriminateur → raterait un perfect KO rapide (dégâts du perdant entre 2 polls). Validé : R1/R4 perfect KO comptés, R2 KO normal non, R3 time-over-1-compteur → branche TIME OVER, R4 draw-2-compteurs → branche DRAW → `perfectKOs` exact (1 puis 2). Champs : `roundTimerHitZero`, `lcPrevTimer16` ; reset au round + `beginRematch()`.
- [x] **Valider le flux revanche** — ✅ **VALIDÉ LIVE (2026-07-10).** `beginRematch()` → reset scoring/équipes → `resume()` → continue du perdant (pièce sur écran CONTINUE `0xC6`/`0xCA` vérifiée via `0xF2C0`, puis START). Confirmé bout en bout : `Rematch REQUESTED → ACCEPTED → 🔁 beginRematch → continue → perdant revient à la SÉLECTION (vrais persos, pas de CPU, pas à 31%) → match #2 joué, scoring reparti de 0 → MATCH #2 OVER → overlay réapparaît`. Aucun `🛑` sur match fini en draw. Rappels : coiner **seulement le perdant** ; pièce **sur** l'écran CONTINUE.
- [x] **Mode de jauge ADVANCED vs EXTRA** — ✅ **CONFIRMÉ LIVE (2026-07-10)** : `p1Mode=0x821E`/`p2Mode=0x841E` (**1=ADVANCED, 0=EXTRA**, miroir +0x200). Test décisif P1 ADV/P2 EXTRA en combat (`flag=0x40`) → lu `P1=ADVANCED / P2=EXTRA`. Se fixe au démarrage du combat (au char-select `flag=0x00` lit 0/0=EXTRA/EXTRA). L'ancienne `0x81F0`/`0x83F0` était fausse (toujours ADV).
- [ ] **Affichage live** pendant le match : équipes + perso actif (maj auto) + mode.
- [x] **Ordre de sélection** dans les stats de fin de match — **TROUVÉ + VALIDÉ + CÂBLÉ (2026-07-10)** : ordre de pick P1 `0x15CB/CA/CD`, P2 `0x17CB/CA/CD` (1er/2e/3e), miroir +0x200 — voir tableau. Lu en combat stable via `capturePickOrders()` (helper `readRamRange`), figé une fois (`pickOrderCaptured`), écrit dans `p1SelectOrder`/`p2SelectOrder` (remplace la reconstruction au fil des rounds) → `matchMeta()` → payload → overlay (déjà câblé bout en bout). Log `🎯 Pick order (RAM)`. ✅ **VALIDÉ LIVE (2026-07-10)** : ordre P1/P2 lu correctement et figé, cohérent avec la séquence de combat.

## Méthode (rappel)
Diff multi-snapshots : capture RAM 64KB complète (`snapshot.mjs`) à des états connus, puis on contraint
les adresses par la valeur attendue à chaque état. La contrainte miroir P1/P2 (`+0x200`) isole très
efficacement (utilisée pour perso actif et à utiliser pour le mode).

## Scripts (apps/game-server, non commités)
`snapshot.mjs` (capture 64KB), `capture-rounds.mjs` (1 snapshot/round auto), `diff-active.mjs`
(séquence perso actif), `scan-active.mjs`/`watch-active.mjs` (scan live), `diff*.mjs` (diffs équipe).

## Validé end-to-end
xdotool BadWindow corrigé ; équipes P1/P2 ; perso actif P1/P2 ; ordre de sélection —
confirmés sur plusieurs tests à l'aveugle (l'utilisateur choisit sans le dire, le serveur détecte correctement).
Reset auto au nouveau match (char-select `0x00`) pour éviter équipe/ordre périmés sur relance manuelle.
