# Déploiement du game-server sur un VPS (Europe) — pour joueurs au Cameroun

But : sortir le game-server de la machine de dev + du quick tunnel cloudflared
(latence ~0,5–12 s) pour le mettre sur un VPS bien connecté (~100–150 ms vers le
Cameroun). Le container est le même ; on change seulement l'hébergement + on ajoute
Caddy pour le TLS (`wss://`).

---

## 1. Provisionner le VPS

**Recommandation — provider & taille**
- **Hetzner** (meilleur rapport prix/perf) : `CPX31` = 4 vCPU / 8 Go (~15 €/mois) pour
  démarrer (~2 duels simultanés). Passer à `CPX41` = 8 vCPU / 16 Go (~30 €/mois) au-delà.
  Localisation : **Falkenstein/Nuremberg (DE)**.
- Alternatives : **OVH** (Gravelines/Roubaix, FR) ou **Scaleway** (Paris, FR) — les câbles
  sous-marins vers l'Afrique de l'Ouest atterrissent en France/Portugal, routage souvent
  très correct vers le Cameroun.

**Dimensionnement** : 1 duel ≈ 1,7 cœur (RetroArch + ffmpeg + Xvfb). Compter ~2 cœurs
par duel simultané. RAM : ~0,4 Go/duel. Disque : image + ROMs ≈ 3 Go → 40 Go SSD suffit.

OS : **Debian 12** ou **Ubuntu 22.04/24.04**.

---

## 2. DNS

Créer un enregistrement **A** `game.ton-domaine.com` → **IP publique du VPS**.
(TTL court le temps des tests.) Vérifier : `dig +short game.ton-domaine.com` renvoie l'IP.

Ce hostname sert au certificat TLS **et** devient `GAME_SERVER_PUBLIC_URL` côté Vercel.

---

## 3. Installer Docker sur le VPS

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # puis se reconnecter
docker --version && docker compose version
```

Pare-feu : n'ouvrir que 22, 80, 443.
```bash
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

---

## 4. Copier le game-server + les ROMs sur le VPS

Depuis ta machine (à la racine du repo), copier **uniquement** `apps/game-server`
(pas besoin du reste) :
```bash
rsync -av --exclude node_modules --exclude dist --exclude recordings \
  skyplay-testing/apps/game-server/  user@IP:/opt/game-server/
```

Copier les ROMs dans `./roms` sur le VPS (au moins **kof98.zip + neogeo.zip**) :
```bash
rsync -av skyplay-testing/public/roms/kof98.zip skyplay-testing/public/roms/neogeo.zip \
  user@IP:/opt/game-server/roms/
```
> `neogeo.zip` = BIOS NeoGeo requis par FBNeo pour lancer KOF'98.

---

## 5. Config + lancement

Sur le VPS, dans `/opt/game-server` :
```bash
cp .env.prod.example .env.prod
nano .env.prod           # DOMAIN=game.ton-domaine.com  (+ TLS_EMAIL si voulu)

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
Le 1er build prend quelques minutes (RetroArch + cores + node_modules). Caddy obtient
le certificat Let's Encrypt automatiquement au 1er accès HTTPS.

**Vérifier :**
```bash
docker compose -f docker-compose.prod.yml ps           # game-server healthy, caddy up
curl -s https://game.ton-domaine.com/                   # → {"status":"ok"}
```
Si le certificat n'est pas encore prêt, réessayer après ~30 s (challenge ACME).

---

## 6. Brancher la prod Vercel sur le VPS

Sur ta machine, dans `skyplay-testing/` :
```bash
npx vercel env rm GAME_SERVER_PUBLIC_URL production --yes
printf 'wss://game.ton-domaine.com' | npx vercel env add GAME_SERVER_PUBLIC_URL production --no-sensitive
npx vercel --prod --yes
```
> `wss://` + le **même** hostname que `DOMAIN`. Non-sensitive (sinon `env pull` le vide).

Vérifier après redéploiement : lancer un duel en prod → tester la latence.
Fini le quick tunnel cloudflared : tu peux arrêter `cloudflared` sur la machine de dev.

---

## 7. Exploitation

```bash
# logs
docker compose -f docker-compose.prod.yml logs -f game-server
docker compose -f docker-compose.prod.yml logs -f caddy

# redémarrer / arrêter
docker compose -f docker-compose.prod.yml restart game-server
docker compose -f docker-compose.prod.yml down

# mettre à jour le code (après un git pull / rsync du nouveau src/)
docker compose -f docker-compose.prod.yml up -d --build game-server
```
Ne pas supprimer le volume `caddy_data` (il garde les certificats — sinon re-challenge
Let's Encrypt, avec un risque de rate-limit).

---

## 8. À durcir plus tard (hors périmètre immédiat)

- **Auth WebSocket** : le token de session est désactivé en dev. Sur un VPS public,
  activer une vraie validation (`SESSION_TOKEN_SECRET`) pour empêcher les connexions
  WS non autorisées.
- **STATS_API_TOKEN=dev** : remplacer par un vrai secret des deux côtés (VPS + Vercel).
- **Recording** : réactivable (`RECORDING_ENABLED=1` + `BLOB_READ_WRITE_TOKEN` dans
  `.env.prod` + un mount `./recordings`) une fois la latence validée et le CPU dimensionné.
- **International** : ce VPS règle Cameroun + Europe/Afrique de l'Ouest. Pour du PvP
  entre joueurs très distants, le streaming serveur centralisé plafonne → voir la piste
  **netplay rollback** (échafaudage déjà présent dans le code).
