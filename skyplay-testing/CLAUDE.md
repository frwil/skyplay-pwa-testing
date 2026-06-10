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
- **Env vars (Vercel)**: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AUTH_SECRET`, `ADMIN_SUPER_PASS`, `ADMIN_PASS`

## Tech Stack

- Next.js 16.2 (App Router, webpack)
- Tailwind CSS v4
- Turso (libsql) for serverless DB
- JWT auth via `jose` + `bcryptjs`
- PWA via `@ducanh2912/next-pwa`
