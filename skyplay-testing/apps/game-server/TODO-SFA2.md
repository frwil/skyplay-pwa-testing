# TODO — Détection portraits SFA2 & Rapports de statut

## État actuel

| Élément | Statut |
|---------|--------|
| Container actif | `689ae16b1bb7` (image `17a79cd88fe8` du 16:13) — **vieux code** |
| Nouvelle image | `4a4b13c14027` (build 19:02) — **pas déployée** |
| Fixs portrait-detector | ✅ Codés, ❌ Pas en prod |
| Templates calibrés | ❌ Zéro-seed, aucun template réel généré |
| Rapports 10s | ❌ Pas encore mis en place |

---

## Tâches restantes

### 1. Redéployer le container avec les fixs
```bash
cd "D:\SkyPlay\skyplay-testing\apps\game-server" && docker compose up -d --force-recreate
```
- La nouvelle image `4a4b13c14027` contient les 2 fixs (`bestCharId=-1`, `margin>0`)
- Après redéploiement, les portraits devraient afficher `?` au lieu de Ryu 100%

### 2. Vérifier que les fixs sont en prod
```bash
docker logs --tail 50 game-server-game-server-1 2>&1 | grep -iE "portrait|MATCH|charId"
```
- **Attendu** : `charId: -1`, `charName: "?"`, `isReliable: false`
- **Plus attendu** : `✅ P1 portrait MATCH: Ryu conf=100%`

### 3. Collecter les échantillons calibrator
- Lancer une partie SFA2 (CPU ou PvP)
- Visiter l'écran de sélection des personnages **2-3 fois minimum**
- 5 frames × 18 cellules = 90 échantillons par visite
- Objectif : ≥10 échantillons par personnage (18 persos × 10 = 180 échantillons)

### 4. Récupérer les templates auto-générés
- Surveiller les logs pour le bloc :
  ```
  [game-runner] 🔧 AUTO-GENERATED consensus templates!
  [game-runner] 🔧 ── BEGIN TEMPLATE EXPORT ──
  ... (code TypeScript)
  [game-runner] 🔧 ── END TEMPLATE EXPORT ──
  ```
- Copier le bloc d'export entre les marqueurs BEGIN/END

### 5. Intégrer les templates dans `pixel-game-config.ts`
- Remplacer les 18 templates zéro-seed dans `SFA2_PORTRAIT_CONFIG`
- Coller les templates générés par le calibrator

### 6. Rebuild Docker avec les vrais templates
```bash
cd "D:\SkyPlay\skyplay-testing\apps\game-server" && docker compose build --no-cache && docker compose up -d --force-recreate
```

### 7. Mettre en place les rapports de statut périodiques (10s)
- Script de monitoring qui interroge les logs Docker toutes les 10s
- Affichage structuré : santé P1/P2, timer, round, personnages
- Via `CronCreate` ou script shell externe

### 8. Investiguer le timeout ffmpeg
- Logs montraient `"Portrait capture timed out after 3000ms"` alors que la capture réussissait
- Possible race condition dans la Promise de capture
- Vérifier `captureCharSelectPortraits()` dans `game-runner.ts`

---

## Points d'attention

- **État in-memory** : le calibrator perd ses échantillons à chaque rebuild Docker → collecter les échantillons APRÈS le redéploiement
- **Templates zéro-seed** : tant que les vrais templates ne sont pas dans `pixel-game-config.ts`, la détection restera `?` (ce qui est mieux que des faux positifs)
- **Tracking curseur** : reste la source autoritaire pour le gameplay ; la détection portrait est un diagnostic
