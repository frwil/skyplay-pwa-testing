# Intégration Arcade — SSO plateforme → émulateur

La **plateforme** (`SKY-PLAY-Platform-main`, façade publique) expose une **zone cachée** (l'émulateur
`skyplay-testing`) atteignable via un **lien débloqué par un cheat code auto-généré par utilisateur**,
toujours visible pour les admins. Les deux apps restent des déploiements séparés ; l'identité est
transmise par un jeton SSO court signé.

## Flux

1. La plateforme génère un `emulatorCode` unique par utilisateur (à la volée, visible dans **Admin → Arcade**).
2. L'admin donne ce code à un joueur. Le joueur le saisit (**Konami** ⬆⬆⬇⬇⬅➡⬅➡ B A, ou **5 taps rapides sur le logo**)
   → `POST /emulator/redeem` → `emulatorUnlocked = true`. Le lien **Arcade** apparaît dans la navbar.
   Les admins voient « Arcade » sans code.
3. Clic sur Arcade → `GET /emulator/launch` forge un JWT HS256 (5 min) signé par `EMULATOR_SSO_SECRET`,
   renvoie `https://skyplay-testing.vercel.app/api/sso?token=…` → `window.location`.
4. `skyplay-testing/api/sso` vérifie le jeton (même secret), retrouve/crée un user Turso
   (username brut, email namespacé `@platform.sso`), **seed 10000 SKY** pour un nouveau non-admin,
   pose le cookie `auth_token`, redirige vers `/duel`. Le cheat code ne traverse jamais la frontière ;
   seul le jeton court le fait.

## Fichiers

**Plateforme — `api-deploy`**
- `prisma/schema.prisma` : `User.emulatorCode`, `User.emulatorUnlocked` (+ migration `20260711120000_add_emulator_code`).
- `src/modules/emulator/` : module + service (`mintSsoToken` via `jsonwebtoken`, génération de code) + controller
  (`POST /emulator/redeem`, `GET /emulator/launch`, `GET /emulator/codes`, `POST /emulator/codes/:id/regenerate`).
- `src/app.module.ts` : `EmulatorModule` enregistré.

**Plateforme — `apps/web`**
- `src/lib/auth-store.ts` : `AuthUser.emulatorUnlocked`.
- `src/components/layout/Navbar.tsx` : entrée cachée (Konami + 5-taps logo), modale de code, lien Arcade, launch.
- `src/app/admin/emulator/page.tsx` + onglet « Arcade » dans `src/app/admin/layout.tsx`.

**Émulateur — `skyplay-testing`**
- `src/app/api/sso/route.ts` : handoff SSO (réutilise `signToken`/`setAuthCookie`, wallet Turso).

## Déploiement (à faire par l'humain)

1. **Secret partagé** — générer une valeur : `openssl rand -base64 32`.
2. **Northflank (api-deploy)** : définir `EMULATOR_SSO_SECRET` (= la valeur générée) et
   `EMULATOR_BASE_URL=https://skyplay-testing.vercel.app`.
3. **Vercel (skyplay-testing)** : définir `EMULATOR_SSO_SECRET` avec **exactement la même** valeur
   (distincte de `AUTH_SECRET`).
4. **Migration Postgres** — appliquer la nouvelle colonne. Le `start` de l'API lance déjà
   `prisma migrate deploy` ; la migration `20260711120000_add_emulator_code` sera donc appliquée au
   prochain déploiement (Northflank). En local : `cd api-deploy && npx prisma migrate deploy` (ou `db push`).
5. Rebuild + redeploy des deux apps.

> ⚠️ `EMULATOR_SSO_SECRET` doit être **identique** des deux côtés, sinon `/api/sso` renvoie 401.

## Vérification end-to-end

1. User normal connecté → pas d'onglet Arcade ; mauvais code → « Code invalide » ; bon code → Arcade apparaît.
2. Clic Arcade → redirection `…/api/sso?token=…` → arrivée sur `/duel` authentifié, solde 10000 SKY.
3. Admin plateforme → Arcade visible sans code ; `/admin/emulator` liste/régénère les codes.
4. Jeton expiré (>5 min) ou secret différent → redirection `/login?sso_error=expired`.
