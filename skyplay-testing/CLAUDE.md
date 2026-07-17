@AGENTS.md

# SKY PLAY Testing — Project Rules

## ⚠️ Database Safety (CRITICAL)

**Avant toute modification du schéma ou des données :**
1. Faire un backup de la base Turso :
   ```bash
   turso db shell skyplay-pwa ".dump" > backup-$(date +%Y%m%d-%H%M%S).sql
   ```
2. Ne jamais exécuter de `DROP TABLE`, `DELETE FROM`, ou `ALTER TABLE ... DROP` sans confirmation explicite.
3. Les colonnes manquantes doivent être ajoutées via `ALTER TABLE ADD COLUMN` avec `try/catch` (colonne peut déjà exister).
4. Les seeds ne doivent s'exécuter que si la table est vide (`SELECT COUNT(*) = 0`).

## Deployment

- **Production URL**: https://skyplay-testing.vercel.app
- **Vercel project**: `fohom-tagne-william-franciss-projects/skyplay-testing`
- **Database**: Turso (`libsql://` via `@libsql/client`)
- **Env vars (Vercel)**: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AUTH_SECRET`, `ADMIN_SUPER_PASS`, `ADMIN_PASS`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`

## Tech Stack

- Next.js 16.2 (App Router, webpack)
- Tailwind CSS v4
- Turso (libsql) for serverless DB
- JWT auth via `jose` + `bcryptjs`
- PWA via `@ducanh2912/next-pwa`

## 📝 Documentation & Memory (CRITICAL)

**À chaque modification confirmée** (que le code soit commité/pushé ou non) :

1. **Mettre à jour `D:\Skyplay\SKYPLAY-PROJECT-STATUS.md`** — le document d'état global du projet. Chaque section doit refléter l'état réel actuel (✅ fait / 🔧 en cours / ❌ restant).

2. **Mettre à jour les fichiers mémoire** dans `C:\Users\MOUTEN\.claude\projects\D--Skyplay\memory\` — un fichier par sujet (KOF98 RAM, SFA2, hosting, etc.). Corriger les adresses, statuts, et supprimer les doublons.

3. **Mettre à jour `MEMORY.md`** (l'index) si un nouveau fichier mémoire est créé ou si le résumé d'un fichier existant change.

**Règle :** ne pas attendre le push git. La doc et la mémoire doivent être à jour en permanence, même en local avec du code non commité.

## 🐳 Docker Maintenance

**Nettoyer le cache Docker régulièrement** (toutes les 2-3 sessions de build) pour éviter l'accumulation :

```bash
docker builder prune --all --force
docker system prune --force
```

Cela supprime le cache de build (`builder prune`) et les conteneurs/réseaux/images inutilisés (`system prune`). Sans `--volumes` pour préserver les données.

**⚠️ Avant chaque `docker-compose restart`**, tuer les sessions Xvfb/RetroArch actives pour éviter les sessions fantômes qui bloquent l'affichage :

```bash
docker exec game-server-game-server-1 sh -c "pkill -9 Xvfb; pkill -9 retroarch; echo 'cleaned'"
```
