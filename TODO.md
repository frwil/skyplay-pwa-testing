# TODO — Plan d'action 4 tâches

## Tâche 1: Cleanup escrow (8 rooms × 2000 SKY)
- [x] **1.1** Mettre à jour `cleanup-escrow.ts` pour utiliser l'auth JWT (POST `/api/auth/login` + cookie)
- [x] **1.2** Exécuter le script en dry-run d'abord : `npx tsx scripts/cleanup-escrow.ts --dry-run` ✅
- [x] **1.3** Exécuter pour de vrai — 8/8 rooms remboursées, 16000 SKY retournés ✅

## Tâche 2: Investigation Perfect KO mystère SFA2
- [x] **2.1** Code déjà en place : `isPerfectKo()` dans `pixel-match-analyzer.ts` ✅
- [x] **2.2** Time-over correctement discriminé via `roundTimerWasRunning` ✅
- [x] **2.3** Perfect KO crédité UNIQUEMENT sur KO round (timer>0), JAMAIS sur time-over ✅

## Tâche 3: Templates portraits SFA2 denses
- [x] **3.1** `minConfidence` baissé de 0.65 → 0.40 dans `pixel-game-config.ts` ✅
- [x] **3.2** Collecter 20+ samples par personnage — 378 échantillons (21/char) déjà collectés ✅
- [x] **3.3** Templates consensus auto-générés et intégrés dans `pixel-game-config.ts` (100% cross-val, 23.7% densité, all 18 chars OK) ✅

## Tâche 4: Câblage ordre sélection KOF98
- [x] **4.1** `capturePickOrders()` lit les adresses RAM ✅ (déjà fait)
- [x] **4.2** `matchMeta()` inclut p1SelectOrder/p2SelectOrder ✅ (déjà fait)
- [x] **4.3** ws-handler.ts envoie p1SelectOrder/p2SelectOrder ✅ (déjà fait)
- [x] **4.4** Client overlay DuelEndOverlay.tsx utilise déjà les données ✅ (déjà fait)
