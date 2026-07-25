const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.resolve(__dirname, 'SKYPLAY_Devis_Northflank.pdf');

// ── Helpers ──────────────────────────────────────────────────────────────────
const EUR = (n) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const USD = (n) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'USD' });
const XAF = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n * 600)) + ' XAF';

const COLORS = {
  primary: '#1a237e',
  accent: '#0d47a1',
  light: '#e3f2fd',
  muted: '#546e7a',
  border: '#b0bec5',
  green: '#2e7d32',
  orange: '#e65100',
  red: '#b71c1c',
};

let pageNum = 1;

function docFooter(doc) {
  doc.save();
  doc.fontSize(8).fillColor(COLORS.muted);
  doc.text(
    'SKY PLAY ENTERTAINMENT — Devis Northflank — Page ' + pageNum,
    40, doc.page.height - 40,
    { align: 'center', width: doc.page.width - 80 }
  );
  doc.restore();
  pageNum++;
}

function sectionTitle(doc, text, y) {
  doc.fontSize(16).fillColor(COLORS.primary).text(text, 40, y, { underline: true });
  return doc.y + 10;
}

function tableHeader(doc, cols, y) {
  const L = 40; // left margin
  let x = L;
  doc.fontSize(9).fillColor('#fff');
  doc.rect(L, y, doc.page.width - 80, 18).fill(COLORS.accent);
  cols.forEach((c) => {
    doc.text(c.label, x + 4, y + 3, { width: c.w, align: c.align || 'left' });
    x += c.w;
  });
  return y + 22;
}

// ── Generate ─────────────────────────────────────────────────────────────────
function generate() {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 40, bottom: 60, left: 40, right: 40 },
    info: {
      Title: 'Devis Northflank — SKY PLAY ENTERTAINMENT',
      Author: 'SKY PLAY ENTERTAINMENT',
      Subject: 'Hébergement Infrastructure Cloud',
    },
  });
  const stream = fs.createWriteStream(OUTPUT);
  doc.pipe(stream);

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 1 — Couverture
  // ═══════════════════════════════════════════════════════════════════════════
  doc.fontSize(28).fillColor(COLORS.primary).text('SKY PLAY', 40, 100);
  doc.fontSize(22).fillColor(COLORS.accent).text('Devis Northflank', 40, 140);
  doc.fontSize(10).fillColor(COLORS.muted);
  doc.text('Client : SKY PLAY ENTERTAINMENT', 40, 200);
  doc.text('Service : Hébergement & Infrastructure Cloud Northflank', 40, 218);
  doc.text('Date : ' + new Date().toLocaleDateString('fr-FR'), 40, 236);
  doc.text('Validité du devis : 15 jours', 40, 254);

  doc.fontSize(11).fillColor(COLORS.primary).text('RÉFÉRENCE : SKYPLAY-NORTHFLANK-001', 40, 300);
  doc.fontSize(10).fillColor('#333');
  doc.text(
    'Ce devis couvre l\'infrastructure cloud nécessaire au déploiement de la plateforme SKY PLAY :\n' +
    'game-server (RetroArch/KOF98), API NestJS, base de données PostgreSQL, Redis, cache, ' +
    'et services annexes — sur la plateforme Northflank (hébergement européen, facturation mensuelle).',
    40, 330, { width: doc.page.width - 80 }
  );
  docFooter(doc);
  doc.addPage();

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 2 — Hypothèses
  // ═══════════════════════════════════════════════════════════════════════════
  let y2 = sectionTitle(doc, 'Hypothèses de dimensionnement', 50);

  doc.fontSize(10).fillColor('#333');
  const hyp = [
    ['Périmètre', 'Plateforme e-sport complète : site web (Next.js), API, game-server (RetroArch), DB, cache, stockage, streaming RTMP'],
    ['Game-server cloud', '8 joueurs simultanés × 1 vCPU + 1 GB RAM — émulation NeoGeo streamée'],
    ['Base de données', 'PostgreSQL 15, 1 GB RAM, 10 GB volume (données + backups)'],
    ['Cache & sessions', 'Redis 1 GB RAM — cache session, files d\'attente, realtime pub/sub'],
    ['Streaming RTMP', '~500 GO/mois egress vidéo (duels enregistrés + stream)'],
    ['Builds CI', '~5 builds/semaine × 5 minutes × 1 CPU — 300 builds minutes/mois'],
    ['Scalabilité', 'Auto-scaling jusqu\'à 2× en heures de pointe (soir, week-ends)'],
    ['Région', 'Europe (Frankfurt / Paris) — latence Cameroun ~150 ms RTT plancher'],
    ['Devise', 'Tous les prix sont en USD hors taxes. Frais egress réseau inclus. Facturation Northflank au mois.'],
    ['Taux indicatif', '1 USD ≈ 600 XAF pour l\'équivalent en francs CFA (ordre de grandeur, hors frais bancaires)'],
  ];
  hyp.forEach(([k, v], i) => {
    const yy = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.primary).text(k + ' :', 40, yy);
    doc.font('Helvetica').fontSize(9).fillColor('#333').text(v, 160, yy, { width: doc.page.width - 200 });
    doc.moveDown(1.2);
  });

  doc.moveDown(2);
  doc.fontSize(10).fillColor(COLORS.muted)
    .text('Les services sont détaillés page suivante. Les prix sont indicatifs et susceptibles d\'évoluer selon l\'usage réel.', 40, doc.y, { width: doc.page.width - 80, italic: true });
  docFooter(doc);
  doc.addPage();

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 3 — Détail des coûts mensuels
  // ═══════════════════════════════════════════════════════════════════════════
  sectionTitle(doc, 'Détail des coûts mensuels', 50);
  doc.fontSize(9).fillColor(COLORS.muted).text('Tarifs Northflank en vigueur au ' + new Date().toLocaleDateString('fr-FR'), 40, doc.y + 2);

  let y3 = doc.y + 14;
  const colsCost = [
    { label: 'Service', w: 120 },
    { label: 'Type / Plan', w: 120 },
    { label: 'vCPU', w: 35, align: 'center' },
    { label: 'RAM', w: 50, align: 'center' },
    { label: 'Stockage', w: 55, align: 'center' },
    { label: 'Quantité', w: 45, align: 'center' },
    { label: 'Coût/mois', w: 75, align: 'right' },
  ];

  y3 = tableHeader(doc, colsCost, y3);
  const costRows = [
    ['Game-server (RetroArch)', 'Dedicated CPU S', '1', '1 GB', '—', '4', USD(9.00 * 4)],
    ['API NestJS', 'Shared CPU XS', '0.5', '512 MB', '—', '2', USD(5.00 * 2)],
    ['PostgreSQL', 'DB M', '1', '1 GB', '10 GB', '1', USD(15.00)],
    ['Redis', 'DB S', '—', '256 MB', '1 GB', '1', USD(5.00)],
    ['Storage (objets)', 'Volume 10 GB', '—', '—', '10 GB', '1', USD(2.00)],
    ['Web (Next.js)', 'Dedicated CPU S', '1', '1 GB', '2 GB', '1', USD(9.00)],
    ['RTMP Relay', 'Shared CPU XS', '0.5', '512 MB', '2 GB', '1', USD(5.00)],
    ['Admin / Back-office', 'Shared CPU XS', '0.5', '512 MB', '—', '1', USD(5.00)],
  ];

  costRows.forEach((r) => {
    if (doc.y > 680) { docFooter(doc); doc.addPage(); sectionTitle(doc, 'Détail des coûts mensuels (suite)', 50); y3 = doc.y + 14; y3 = tableHeader(doc, colsCost, y3); }
    doc.rect(40, doc.y, doc.page.width - 80, 16).fill(i => i % 2 ? '#fff' : COLORS.light);
    let x = 40;
    doc.fontSize(8.5).fillColor('#333');
    r.forEach((v, j) => { doc.text(v, x + 4, doc.y + 2, { width: colsCost[j].w, align: colsCost[j].align || 'left' }); x += colsCost[j].w; });
  });
  doc.moveDown(1.5);

  doc.fontSize(8).fillColor(COLORS.muted).text('Builds CI : ~300 build-minutes/mois (5 builds/sem × 5 min × 1 CPU)', 40, doc.y, { width: doc.page.width - 80 });

  docFooter(doc);
  doc.addPage();

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 4 — Egress + Récapitulatif
  // ═══════════════════════════════════════════════════════════════════════════
  sectionTitle(doc, 'Frais de trafic réseau (egress)', 50);
  doc.fontSize(9).fillColor('#333');
  const egressRows = [
    ['Streaming RTMP (vidéo duel)', '300-500 Go', '~0.05 $/Go', USD(20.00)],
    ['API + Web + WS (usage normal)', '~50 Go', 'forfait', 'inclus'],
    ['Builds CI (téléchargements)', '~20 Go', 'forfait', 'inclus'],
  ];

  let y4 = doc.y + 14;
  const egCols = [
    { label: 'Type de trafic', w: 220 },
    { label: 'Volume/mois', w: 100, align: 'center' },
    { label: 'Tarif', w: 90, align: 'center' },
    { label: 'Coût/mois', w: 75, align: 'right' },
  ];
  y4 = tableHeader(doc, egCols, y4);
  egressRows.forEach((r) => {
    doc.rect(40, doc.y, doc.page.width - 80, 16).fill(i => i % 2 ? '#fff' : COLORS.light);
    let x = 40;
    doc.fontSize(9).fillColor('#333');
    r.forEach((v, j) => { doc.text(v, x + 4, doc.y + 2, { width: egCols[j].w, align: egCols[j].align || 'left' }); x += egCols[j].w; });
  });

  doc.moveDown(2);

  // Récapitulatif
  const totalCompute = 9*4 + 5*2 + 15 + 5 + 2 + 9 + 5 + 5;
  const totalEgress = 20;
  const totalMonth = totalCompute + totalEgress;
  const totalYear = totalMonth * 12;

  const recapX = 40;
  let ry = doc.y;
  doc.fontSize(12).fillColor(COLORS.primary).text('Récapitulatif', recapX, ry);
  ry = doc.y + 10;

  doc.fontSize(10).fillColor('#333');
  const recapColW = 200;
  const valColW = 100;
  doc.text('Compute (8 services)', recapX, ry); doc.text(USD(totalCompute), recapX + recapColW, ry, { width: valColW, align: 'right' }); ry += 18;
  doc.text('Trafic réseau (egress)', recapX, ry); doc.text(USD(totalEgress), recapX + recapColW, ry, { width: valColW, align: 'right' }); ry += 18;
  doc.text('Builds CI (forfait)', recapX, ry); doc.text('inclus', recapX + recapColW, ry, { width: valColW, align: 'right' }); ry += 24;

  doc.font('Helvetica-Bold').fillColor(COLORS.primary).fontSize(13).text('TOTAL MENSUEL', recapX, ry);
  doc.text(USD(totalMonth), recapX + recapColW, ry, { width: valColW, align: 'right' }); ry += 22;

  doc.font('Helvetica').fontSize(11).fillColor(COLORS.primary).text('TOTAL ANNUEL', recapX, ry);
  doc.text(USD(totalYear), recapX + recapColW, ry, { width: valColW, align: 'right' }); ry += 26;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.orange).text('Soit environ :', recapX, ry + 10);
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.orange);
  doc.text(XAF(totalMonth) + ' / mois', recapX + 140, ry + 10);
  ry += 22;
  doc.text(XAF(totalYear) + ' / an', recapX + 140, ry + 10);

  docFooter(doc);
  doc.addPage();

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 5 — 3 scénarios
  // ═══════════════════════════════════════════════════════════════════════════
  sectionTitle(doc, 'Scénarios de déploiement', 50);
  doc.fontSize(9).fillColor('#333');
  doc.text('Trois niveaux d\'infrastructure selon le stade de croissance de la plateforme :', 40, doc.y + 4);
  doc.moveDown(1.5);

  const scen = [
    {
      title: '📦 MVP / Test (89-100 $/mois)',
      color: COLORS.green,
      items: [
        '1 game-server × 1 vCPU + 1 Go RAM',
        'API NestJS sur service partagé (XS)',
        'PostgreSQL 512 Mo — volume 5 Go',
        'Redis 256 Mo',
        'Pas de scaling ni de haute disponibilité',
        'Limité à ~5 duels simultanés',
        '+ egress streaming jusqu\'à 150 Go/mois',
      ],
    },
    {
      title: '⭐ Recommandé (176 $/mois)',
      color: COLORS.accent,
      items: [
        '4 game-servers × 1 vCPU + 1 Go RAM',
        'API NestJS × 2 instances (haute dispo)',
        'PostgreSQL 1 Go — volume 10 Go',
        'Redis 1 Go',
        'Web + Admin × 2 instances',
        'RTMP relay dédié',
        'Auto-scaling jusqu\'à 2× en pointe',
        '+ egress streaming 500 Go/mois',
      ],
    },
    {
      title: '🌍 Multi-région / Scale (450-600 $/mois)',
      color: COLORS.orange,
      items: [
        'Déploiement sur 2 régions (EU + AF/NA)',
        '6-8 game-servers × région',
        'PostgreSQL HA (réplication cross-région)',
        'Redis cluster',
        'CDN pour assets statiques + vidéos',
        'Équilibrage de charge Géographique (GeoDNS)',
        '+ egress streaming 1-2 To/mois',
      ],
    },
  ];

  scen.forEach((s) => {
    if (doc.y > 640) { docFooter(doc); doc.addPage(); sectionTitle(doc, 'Scénarios de déploiement (suite)', 50); }
    const sy = doc.y;
    doc.fontSize(12).fillColor(s.color).text(s.title, 40, sy);
    doc.moveDown(0.5);
    s.items.forEach((t) => {
      doc.fontSize(9).fillColor('#333').text('  •  ' + t, 40, doc.y, { width: doc.page.width - 80 });
    });
    doc.moveDown(1.5);
  });

  docFooter(doc);
  doc.addPage();

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 6 — Notes & recommandations
  // ═══════════════════════════════════════════════════════════════════════════
  sectionTitle(doc, 'Notes & recommandations', 50);
  doc.fontSize(9).fillColor('#333');
  const notes = [
    `Latence Afrique : le facteur limitant est le transport réseau. Le diagnostic établi avec skyplay-testing montre que la latence Cameroun plafonne à ~150 ms de RTT vers l'Europe. L'optimisation applicative (compression WebP, prédiction d'input) a été réalisée ; le reliquat nécessite des solutions d'infrastructure (voir section 7).`,
    `Les intégrations Flutterwave / AWS Cognito / Vercel ne sont pas incluses dans ce devis Northflank mais dans les budgets de développement respectifs (frais de transaction, licensing).`,
    `L'intégration entre la plateforme Next.js (sur Vercel) et le game-server (sur Northflank) nécessite des WebSockets sécurisés (WSS) — pris en charge sans surcoût sur les deux plateformes.`,
    `Northflank propose un crédit gratuit de 25$ pour les nouveaux comptes — permet 2-3 semaines de test à l'échelle réduite avant engagement.`,
    `Les prix sont indiqués hors taxes. La facturation Northflank est au mois, sans engagement. Possibilité de réserve de capacité pour réductions ( -15 à -25 % sur engagement 12 mois).`,
    `Un plan de reprise d'activité (PRA) et sauvegardes automatisées sont configurés via les snapshots Northflank (inclus dans le stockage). Recommandation : backup hebdomadaire de la base PostgreSQL.`,
  ];
  notes.forEach((n) => {
    doc.text('•  ' + n, 40, doc.y + 2, { width: doc.page.width - 80 });
    doc.moveDown(1.2);
  });

  docFooter(doc);
  doc.addPage();

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE 7 — Amélioration de la latence (NOUVEAU)
  // ═══════════════════════════════════════════════════════════════════════════
  sectionTitle(doc, '7. Options d\'amélioration de la latence', 50);
  doc.fontSize(9).fillColor('#333');
  doc.text(
    'Diagnostic établi : la cause racine du « ça rame » sur skyplay-testing est le RTT du tunnel cloudflared ' +
    '(0,5–12 s selon l\'heure), pas le code applicatif. Le plancher Cameroun vers l\'Europe est ~150 ms. ' +
    'Les leviers ci-dessous l\'attaquent par ordre de rapport gain/coût.',
    40, doc.y + 4, { width: doc.page.width - 80 }
  );
  doc.moveDown(1.5);

  // Tableau des leviers
  const latCols = [
    { label: '#', w: 20, align: 'center' },
    { label: 'Levier', w: 170 },
    { label: 'Effet attendu', w: 160 },
    { label: 'Coût/mois', w: 75, align: 'right' },
    { label: 'XAF (≈)', w: 60, align: 'right' },
  ];
  let y7 = tableHeader(doc, latCols, doc.y);

  const leviers = [
    ['L1', 'Optimisation transport\n(QUIC / WebRTC DC)', '−100 à −300 ms RTT\nsupprime overhead tunnel', '0 $ (dev)', '0'],
    ['L2', 'Région Northflank\nproche (EU, ZA si dispo)', 'Rapproche le POP\n−20 à −50 ms', '0 $ (inclus)', '0'],
    ['L3', 'VPS près des joueurs\n(Cameroun / voisins)', 'Transport local\n5–40 ms au lieu de 150+', '10–40 $', '6–24k'],
    ['L4', 'Multi-région + routage\n(GeoDNS / anycast)', 'Chaque joueur routé\nau plus proche', '55–110 $ + 5–20 $', '36–78k'],
    ['L5', 'Cloudflare Argo /\nSpectrum', 'Optimise chemin réseau\n−30 % RTT', '~5 $ + 0,10 $/Go', '~3k+trafic'],
    ['L6', 'Serveur média WebRTC\n(SFU : LiveKit/med.)', 'Réduit latence + charge\ndu game-server', '27–55 $ (self)', '16–33k'],
    ['L7', 'TURN/STUN (coturn)\n— NAT traversal', 'Fiabilise connexion\nP2P WebRTC', '5–10 $ (petit VPS)', '3–6k'],
  ];

  leviers.forEach((r, i) => {
    if (doc.y > 660) { docFooter(doc); doc.addPage(); y7 = 50; y7 = tableHeader(doc, latCols, y7); }
    const ry = doc.y;
    doc.rect(40, ry, doc.page.width - 80, 32).fill(i % 2 === 0 ? '#fff' : COLORS.light);
    let x = 40;
    doc.fontSize(8.5).fillColor('#333');
    r.forEach((v, j) => {
      doc.text(v, x + 3, ry + 2, { width: latCols[j].w - 4, align: latCols[j].align || 'left', lineGap: 1 });
      x += latCols[j].w;
    });
    doc.moveDown(2.2);
  });

  doc.moveDown(2);

  // Combinaisons recommandées
  doc.fontSize(12).fillColor(COLORS.primary).text('Combinaisons recommandées', 40, doc.y);
  doc.moveDown(0.5);

  const combos = [
    { title: 'Éco / Lancement', cost: '+0 $', desc: 'L1 + L2 : transport optimisé + bonne région. Aucune nouvelle facture, uniquement du dev.', items: ['→ 200–235 $/mois total'] },
    { title: 'Recommandé', cost: '+15–50 $', desc: 'L1 + L3 (+ L7 si WebRTC) : attaque directe du plancher 150 ms par VPS locale + transport optimisé.', items: ['→ 215–285 $/mois total'] },
    { title: 'Scale multi-région', cost: '+90–190 $', desc: 'L1 + L4 + L5 (+ L6) : routage géographique + CDN + média WebRTC pour une audience répartie.', items: ['→ 290–425 $/mois total'] },
  ];

  combos.forEach((c) => {
    if (doc.y > 660) { docFooter(doc); doc.addPage(); }
    const cy = doc.y;
    doc.rect(40, cy, doc.page.width - 80, 58).fillColor(COLORS.light).rect(40, cy, 4, 58).fill(c === combos[1] ? COLORS.accent : COLORS.muted);
    doc.fontSize(10).fillColor(COLORS.primary).text(c.title, 50, cy + 4);
    doc.fontSize(9).fillColor(COLORS.accent).text(c.cost, doc.page.width - 150, cy + 4, { width: 100, align: 'right' });
    doc.fontSize(8).fillColor('#333').text(c.desc, 50, cy + 18, { width: doc.page.width - 110 });
    c.items.forEach((t) => doc.fontSize(7.5).fillColor(COLORS.muted).text('  ' + t, 55, doc.y + 1));
    doc.moveDown(4.5);
  });

  doc.moveDown(1);
  doc.fontSize(9).fillColor(COLORS.orange);
  doc.text(
    'Note d\'arbitrage : pour un démarrage 100 % Cameroun, L1 + L3 (VPS locale) offre le meilleur ratio coût/efficacité. ' +
    'Le multi-région (L4) ne devient rentable qu\'à partir d\'une audience répartie sur plusieurs pays. ' +
    'Les coûts egress réels du streaming vidéo sont le principal driver de L4/L5 — à mesurer en production.',
    40, doc.y, { width: doc.page.width - 80 }
  );

  docFooter(doc);

  // ═══════════════════════════════════════════════════════════════════════════
  // Finalize
  // ═══════════════════════════════════════════════════════════════════════════
  doc.end();
  console.log('✅ Devis généré :', OUTPUT);
  console.log('   Taille :', fs.statSync(OUTPUT).size, 'octets');
}

generate();
