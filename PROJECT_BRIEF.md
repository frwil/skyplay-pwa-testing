# SKY PLAY — PWA Compagnon de Test Utilisateur

> **Dossier de Conception Technique** — Implémentation Next.js 14+ (App Router) & SQLite

---

## 1. Contexte & Objectifs

**SkyPlay Africa** est une plateforme de compétitions e-sport fondées sur l'habileté, basée au Cameroun. Le site principal ([skyplay.cloud](https://skyplay.cloud)) permet aux joueurs de s'affronter sur FIFA, COD, Free Fire et d'autres jeux via des duels, challenges et tournois.

Cette **PWA compagnon** est un outil indépendant conçu pour la **phase de test utilisateur**. Elle permet de :

- Simuler et valider les **4 jalons** du protocole de test
- Collecter des **feedbacks UX** accompagnés de **captures d'écran** (Base64)
- Fonctionner **hors ligne** (PWA standalone)
- Offrir une interface d'**administration** pour modérer les soumissions

---

## 2. Stack Technique

| Composant | Choix | Justification |
|---|---|---|
| **Framework** | Next.js 14+ (App Router) | Routes performantes, SSR/ISR |
| **PWA** | `@ducanh2912/next-pwa` | Service Workers auto, cache avancé |
| **Base de données** | SQLite (`better-sqlite3`) | Base locale légère, fichier binaire unique |
| **Styling** | Tailwind CSS + CSS Variables | Utilitaire + thème custom |
| **Icônes** | Lucide React | Icônes cohérentes avec le site principal |
| **Langage** | TypeScript | Typage strict |

---

## 3. Schéma de Base de Données (SQLite)

### Table `users` — Testeurs
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Table `steps` — Jalons du protocole
```sql
CREATE TABLE steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug VARCHAR(20) UNIQUE NOT NULL,   -- 'jalon_1', 'jalon_2', 'jalon_3', 'jalon_4'
    title VARCHAR(100) NOT NULL,
    reward_amount INTEGER NOT NULL
);
```

### Table `submissions` — Feedbacks & Captures
```sql
CREATE TABLE submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    step_id INTEGER NOT NULL,
    ux_feedback TEXT NOT NULL,
    screenshot_base64 TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, APPROVED, REJECTED
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (step_id) REFERENCES steps(id),
    UNIQUE(user_id, step_id)
);
```

---

## 4. Charte Graphique

### Couleurs (fusion PDF + Site Principal)

| Variable | Valeur | Usage |
|---|---|---|
| `--skyplay-bg-dark` | `#070f1e` | Fond principal profond |
| `--skyplay-bg-card` | `#0d1b2e` | Arrière-plan des cartes |
| `--skyplay-cyan` | `#00c8ff` | Cyan néon — éléments interactifs |
| `--skyplay-gold` | `#ffd700` | Or — progression, trophées |
| `--skyplay-pink` | `#FD2E5F` | Rose/rouge — logo, CTA |
| `--skyplay-green` | `#2ecc71` | Vert — succès, validations |
| `--skyplay-orange` | `#e67e22` | Orange — avertissements |
| `--skyplay-text-main` | `#ffffff` | Texte principal |
| `--skyplay-text-muted` | `#8fa0ba` | Texte secondaire |

### Dégradés

```css
--gradient-button: linear-gradient(90deg, #00c8ff 0%, #0097FC 100%);
--gradient-logo: linear-gradient(135deg, #00d2ff 0%, #9b5de5 50%, #f15bb5 100%);
--gradient-hero: linear-gradient(to right, #00c8ff, #ffd700, #FD2E5F);
```

### Typographie

- **Police** : Inter, system-ui, sans-serif
- **Titres** : `font-black` (900), tracking tight
- **Labels** : `text-xs uppercase tracking-[3px]`
- **Corps** : `text-sm` ou `text-base`, `text-white/60`

### Effets Visuels

- **Grid pattern** : overlay subtil (grille cyan à 7% opacité)
- **Glow orbs** : grands cercles floutés en arrière-plan (`blur-[120px]`)
- **Glass morphism** : cartes avec `bg-white/[0.03]`, `border-white/10`, `backdrop-blur`
- **Boutons** : style capsule (`rounded-full`), `box-shadow` lumineux, hover `scale-[1.03]`
- **Animations** : fade-in + translateY sur les sections, `animate-ping` sur les dots live

---

## 5. API Routes

| Route | Méthode | Payload | Action |
|---|---|---|---|
| `/api/submit` | POST | `{ userId, stepId, uxFeedback, screenshot }` | Vérifie l'unicité `(user_id, step_id)`, insère en statut PENDING |
| `/api/admin/submissions` | GET | Headers d'auth requis | Récupère la liste des feedbacks + images Base64 pour modération |
| `/api/admin/approve` | POST | `{ submissionId, status }` | Met à jour le statut (APPROVED/REJECTED), incrémente la cagnotte |

---

## 6. Configuration PWA

- **Mode** : `standalone` (installation sur écran d'accueil, sans barres navigateur)
- **Orientation** : `portrait` (optimisée pour saisie de feedbacks et upload captures)
- **Icônes** : adaptatives (192×192, 512×512)
- **Service Worker** : cache avancé via `@ducanh2912/next-pwa`
- **Theme color** : `#0097FC`
- **Status bar** : `black-translucent`

---

## 7. Structure du Projet (prévue)

```
D:\Skyplay\pwa-compagnon\
├── public/
│   ├── icons/
│   │   ├── icon-192x192.png
│   │   └── icon-512x512.png
│   └── manifest.json
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Layout racine + PWA provider
│   │   ├── page.tsx             # Page formulaire de soumission
│   │   ├── globals.css          # Design system CSS
│   │   ├── admin/
│   │   │   └── page.tsx         # Dashboard admin
│   │   └── api/
│   │       ├── submit/
│   │       │   └── route.ts     # POST /api/submit
│   │       └── admin/
│   │           ├── submissions/
│   │           │   └── route.ts # GET /api/admin/submissions
│   │           └── approve/
│   │               └── route.ts # POST /api/admin/approve
│   ├── lib/
│   │   ├── db.ts                # Connexion SQLite + initialisation
│   │   └── seed.ts              # Données initiales (4 jalons)
│   └── components/
│       ├── SubmissionForm.tsx    # Formulaire de feedback
│       ├── AdminCard.tsx         # Carte de modération admin
│       └── GlowBackground.tsx   # Fond décoratif gaming
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## 8. Notes d'Implémentation

- Les captures d'écran sont stockées en **Base64** dans SQLite (pas de stockage fichier)
- La contrainte `UNIQUE(user_id, step_id)` empêche le double-déclaratif frauduleux
- Les insertions sont **atomiques** (transactions SQLite)
- L'authentification admin est simplifiée (header token) — version test
- La PWA doit fonctionner **hors ligne** : le formulaire peut être soumis sans connexion et synchronisé ultérieurement (amélioration future)

---

*Document généré le 09/06/2026 à partir du Dossier de Conception Technique PWA SKY PLAY et de l'analyse du site skyplay.cloud*
