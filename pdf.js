'use strict';

// ── pdf.js ────────────────────────────────────────────────────────────────────
//
// Genereert een A4-PDF van een opgeslagen rapport.
//
// Exporteert één publieke functie:
//   generatePdf(rapport) → Promise<Buffer>
//
// De HTML-template volgt dezelfde secties en teksten als renderResultaat() in
// index.html. Interactieve elementen (knoppen, rapport-link, grafieken) worden
// weggelaten of vervangen door statische equivalenten (SVG-driehoek, scorebalkjes).
// ─────────────────────────────────────────────────────────────────────────────

const puppeteer = require('puppeteer');

// ── Spiral Dynamics metadata (identiek aan DATA.si in index.html) ─────────────

const si = {
  rood:   { hex: '#dc2626', e: '🔴', kern: 'Energie, lef, daadkracht',                  en: 'snel schakelen en knopen doorhakken',            vk: 'te dominant of ongeduldig worden' },
  blauw:  { hex: '#1d4ed8', e: '🔵', kern: 'Orde, duidelijkheid, rechtvaardigheid',      en: 'heldere afspraken en voorspelbaarheid',           vk: 'regels boven mensen laten gaan' },
  groen:  { hex: '#16a34a', e: '🟢', kern: 'Menselijkheid, gelijkwaardigheid, harmonie', en: 'iedereen meenemen en verbinden',                  vk: 'besluitvorming uitstellen door eindeloos afstemmen' },
  geel:   { hex: '#ca8a04', e: '🟡', kern: 'Systeemdenken, flexibiliteit, visie',        en: 'perspectieven verbinden en lange termijn zien',   vk: 'te abstract blijven of keuzes uitstellen' },
  oranje: { hex: '#d97706', e: '🟠', kern: 'Resultaat, ambitie, kansen',                 en: 'doelen bepalen en scoren met slimme ideeën',      vk: 'te veel competitie of win-focus' },
  paars:  { hex: '#7c3aed', e: '🟣', kern: 'Geborgenheid, traditie, loyaliteit',         en: 'vertrouwen en veiligheid in de groep',            vk: "te veel vasthouden aan 'zo doen we het hier'" },
};

// ── SVG-driehoek (geporteerd van tekenDriehoek() in index.html) ──────────────

function buildSvgTriangle(d) {
  const W = 280, H = 210;
  const cx = W / 2, cy = H / 2 + 12, R = 76;
  const pt = (a, r) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });

  const aS = -Math.PI / 2;
  const aT = (5 * Math.PI) / 6;
  const aC = (1 * Math.PI) / 6;
  const tot = (d.strategie + d.cultuur + d.structuur) || 1;

  const oS = pt(aS, R), oT = pt(aT, R), oC = pt(aC, R);
  const iS = pt(aS, R * d.strategie / tot);
  const iT = pt(aT, R * d.structuur / tot);
  const iC = pt(aC, R * d.cultuur / tot);

  const f = n => n.toFixed(1);
  const outerPoly = `${f(oS.x)},${f(oS.y)} ${f(oT.x)},${f(oT.y)} ${f(oC.x)},${f(oC.y)}`;
  const innerPoly = `${f(iS.x)},${f(iS.y)} ${f(iT.x)},${f(iT.y)} ${f(iC.x)},${f(iC.y)}`;

  const dots = [[iS], [iT], [iC]].map(([p]) =>
    `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="5" fill="#0000FF"/>` +
    `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="9" fill="none" stroke="#2EF4CD" stroke-width="2"/>`
  ).join('');

  const labelData = [
    { p: oS, dx: 0, dy: -20, l: 'Strategie', v: d.strategie },
    { p: oT, dx: -12, dy: 22, l: 'Structuur', v: d.structuur },
    { p: oC, dx: 12,  dy: 22, l: 'Cultuur',   v: d.cultuur   },
  ];
  const labelsSvg = labelData.map(({ p, dx, dy, l, v }) =>
    `<text x="${f(p.x + dx)}" y="${f(p.y + dy)}" text-anchor="middle" ` +
    `font-size="10" font-weight="700" fill="#111" font-family="Helvetica,Arial,sans-serif">${l}</text>` +
    `<text x="${f(p.x + dx)}" y="${f(p.y + dy + 15)}" text-anchor="middle" ` +
    `font-size="17" font-weight="900" fill="#0000FF" font-family="Helvetica,Arial,sans-serif">${v}</text>`
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${outerPoly}" fill="none" stroke="#ddd" stroke-width="1.5" stroke-dasharray="6 4"/>
    <line x1="${f(cx)}" y1="${f(cy)}" x2="${f(oS.x)}" y2="${f(oS.y)}" stroke="#eee" stroke-width="1"/>
    <line x1="${f(cx)}" y1="${f(cy)}" x2="${f(oT.x)}" y2="${f(oT.y)}" stroke="#eee" stroke-width="1"/>
    <line x1="${f(cx)}" y1="${f(cy)}" x2="${f(oC.x)}" y2="${f(oC.y)}" stroke="#eee" stroke-width="1"/>
    <polygon points="${innerPoly}" fill="rgba(0,0,255,0.16)" stroke="#0000FF" stroke-width="2.5"/>
    ${dots}
    ${labelsSvg}
  </svg>`;
}

// ── Berekening van afgeleide waarden (geporteerd van renderResultaat) ─────────

function computeVars(r) {
  const d  = r.driehoek;
  const ds = [
    { k: 'strategie', l: 'Strategie', i: '🧭', v: d.strategie },
    { k: 'cultuur',   l: 'Cultuur',   i: '🤝', v: d.cultuur   },
    { k: 'structuur', l: 'Structuur', i: '⚙️', v: d.structuur },
  ].sort((a, b) => b.v - a.v);
  const [A, B, C] = ds;

  const vS = Object.entries(r.voorkeur).sort((a, b) => b[1] - a[1]);
  const aS = Object.entries(r.allergie).sort((a, b) => b[1] - a[1]);
  const [p1, p2, p3] = vS;
  const dAB  = A.v  - B.v;
  const dBC  = B.v  - C.v;
  const sd12 = p1[1] - p2[1];
  const sd23 = p2[1] - p3[1];
  const sk1  = si[p1[0]];

  // ── Driehoek-toelichting (identiek aan drToel in index.html) ──────────────
  const drToel = {
    strategie: 'Je denkt van nature in termen van richting, visie en het hogere doel. Je wilt weten <em>waarom</em> iets gedaan wordt. Pas op: zonder aandacht voor Cultuur en Structuur kun je anderen verliezen in abstracte plannen.',
    cultuur:   'Je focust op de beleving en samenwerking. Je wilt dat het goed voelt én dat iedereen meekomt. Pas op: zonder Strategie en Structuur kan dit leiden tot veel overleg en weinig besluitvorming.',
    structuur:  'Je bent actiegericht en wil weten <em>wat</em> er concreet gedaan wordt. Je kunt goed plannen en organiseren. Pas op: zonder Strategie kan dit leiden tot uitvoering zonder richting.',
  };

  // ── Driehoek-interpretatie (identiek aan dInterp in index.html) ────────────
  const dInterp = dAB >= 7
    ? `<p><strong>Dominante voorkeur: ${A.l} (${A.v})</strong>${r.kw[A.k]?.[0]?.w ? ` – kernwaarde: <em>${r.kw[A.k][0].w}</em>` : ''}.</p>
       <p style="font-size:12px;color:#555;margin-top:6px">${drToel[A.k]}</p>
       <p style="margin-top:6px"><strong>Mini-actie:</strong> plan bewust een moment voor ${B.l.toLowerCase()} en ${C.l.toLowerCase()} (5–10 min elk) bij je volgende beslissing.</p>`
    : dBC >= 7
    ? `<p><strong>Dubbele voorkeur: ${A.l} (${A.v}) & ${B.l} (${B.v})</strong>.</p>
       <p style="font-size:12px;color:#555;margin-top:6px">Je combineert ${A.l.toLowerCase()} en ${B.l.toLowerCase()}. Dat is een kracht. Zorg wel dat ${C.l.toLowerCase()} niet structureel wordt overgeslagen – want ook die hoek brengt waardevolle informatie.</p>
       <p style="margin-top:6px"><strong>Aandachtspunt:</strong> voeg aan je beslischecklist één vraag toe voor ${C.l.toLowerCase()}.</p>`
    : `<p><strong>Gebalanceerd profiel</strong> – je schakelt makkelijk tussen alle drie.</p>
       <p style="font-size:12px;color:#555;margin-top:6px">Dat geeft je overzicht en communicatieve flexibiliteit. Tip: spreek met je team vooraf een besluitvormingsproces af zodat iedereen weet welke hoek wanneer aan de beurt is.</p>`;

  // ── Spiral-interpretatie (identiek aan sInterp in index.html) ─────────────
  const sInterp = sd12 >= 7
    ? `<p><strong>Dominante voorkeur: ${sk1?.e} ${p1[0]} (${p1[1]})</strong> – ${sk1?.kern}.<br>
       Je krijgt energie van <em>${sk1?.en}</em> en dat merk je in hoe je omgaat met verandering, leiderschap en samenwerking.</p>
       <p style="font-size:12px;color:#555;margin-top:6px">Mensen met een ander dominant waardesysteem kijken letterlijk anders naar dezelfde situatie – ze waarderen andere dingen en reageren anders op leiderschapsstijlen. Jouw voorkeur geeft inzicht in waar jij het beste rendeert.</p>`
    : sd23 >= 7
    ? `<p><strong>Dubbele voorkeur: ${sk1?.e} ${p1[0]} & ${si[p2[0]]?.e} ${p2[0]}</strong>.<br>
       Je haalt kracht uit zowel <em>${sk1?.kern}</em> als <em>${si[p2[0]]?.kern}</em>. Je kunt schakelen tussen beiden, afhankelijk van de context.</p>
       <p style="font-size:12px;color:#555;margin-top:6px">Dit maakt je flexibel in samenwerking – je begrijpt meerdere perspectieven. Zorg wel dat je duidelijk maakt vanuit welke waarden je op dat moment handelt.</p>`
    : `<p><strong>Gebalanceerd profiel</strong> – je schakelt gemakkelijk tussen meerdere waardesystemen.</p>
       <p style="font-size:12px;color:#555;margin-top:6px">Dit geeft je brede inzetbaarheid. Nadeel kan zijn dat anderen minder goed voorspellen vanuit welke waarden jij handelt. Expliciteer in teamgesprekken welke modus je gebruikt.</p>`;

  const drZin = dAB >= 7
    ? `Koerskompas: sterke voorkeur voor <strong>${A.l} (${A.v})</strong>.`
    : dBC >= 7
    ? `Koerskompas: dubbele focus op <strong>${A.l}</strong> en <strong>${B.l}</strong>.`
    : `Koerskompas: <strong>gebalanceerd profiel</strong>.`;

  const spZin = `Spiral: drijfveer <strong>${sk1?.e || ''} ${p1[0]} (${p1[1]})</strong>, ` +
    `allergie <strong>${si[aS[0][0]]?.e || ''} ${aS[0][0]} (${aS[0][1]})</strong>.`;

  return { ds, A, B, C, vS, aS, sk1, p1, p2, p3, dAB, dBC, sd12, sd23, drZin, spZin, dInterp, sInterp };
}

// ── CSS-scorebalkjes voor Spiral Dynamics ─────────────────────────────────────

function buildScoreBars(scores) {
  const max = Math.max(...Object.values(scores), 1);
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const info = si[k];
      const pct  = ((v / max) * 100).toFixed(0);
      const label = (k.charAt(0).toUpperCase() + k.slice(1)).padEnd(7, '\u00A0');
      return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
          <span style="width:72px;font-size:10px;font-weight:600;color:#444;flex-shrink:0">${info.e} ${label}</span>
          <div style="flex:1;background:#f0f0f0;border-radius:3px;height:13px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${info.hex};border-radius:3px"></div>
          </div>
          <span style="width:24px;font-size:10px;font-weight:800;color:${info.hex};text-align:right;flex-shrink:0">${v}</span>
        </div>`;
    }).join('');
}

// ── Top-3 kaarten ─────────────────────────────────────────────────────────────

function buildTop3(arr) {
  return arr.slice(0, 3).map(([k, score], i) => {
    const info    = si[k];
    const rankBg  = i === 0 ? '#2EF4CD' : '#e5e7eb';
    const rankClr = i === 0 ? '#0000FF' : '#374151';
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;
                  border-bottom:1px solid #f0f0f0;break-inside:avoid">
        <div style="width:22px;height:22px;border-radius:50%;background:${rankBg};
                    color:${rankClr};text-align:center;line-height:22px;
                    font-weight:800;font-size:11px;flex-shrink:0">${i + 1}</div>
        <div style="width:8px;height:8px;border-radius:2px;background:${info.hex};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700">${info.e} ${k.charAt(0).toUpperCase() + k.slice(1)}</div>
          <div style="font-size:10px;color:#888;margin-top:1px">${info.kern}</div>
        </div>
        <div style="font-size:18px;font-weight:900;color:${info.hex};flex-shrink:0">${score}</div>
      </div>`;
  }).join('');
}

// ── Volledige A4-HTML ─────────────────────────────────────────────────────────

function buildPdfHtml(r) {
  const cv = computeVars(r);
  const { ds, A, B, C, vS, aS, sk1, p1, dInterp, sInterp, drZin, spZin } = cv;

  const svgTriangle = buildSvgTriangle(r.driehoek);
  const vBars = buildScoreBars(r.voorkeur);
  const aBars = buildScoreBars(r.allergie);
  const vTop3 = buildTop3(vS);
  const aTop3 = buildTop3(aS);

  // ── Driehoek-pillar-scores (gesorteerd) ──────────────────────────────────
  const pillars = ds.map((x, i) => `
    <td style="width:33%;padding:0 6px;text-align:center;vertical-align:top">
      <div style="background:${i === 0 ? 'rgba(46,244,205,.2)' : 'rgba(255,255,255,.08)'};
                  border:1px solid ${i === 0 ? '#2EF4CD' : 'rgba(255,255,255,.15)'};
                  border-radius:8px;padding:10px 6px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                    color:${i === 0 ? '#2EF4CD' : 'rgba(255,255,255,.5)'};letter-spacing:.8px">
          ${x.i} ${x.l}
        </div>
        <div style="font-size:26px;font-weight:900;color:${i === 0 ? '#2EF4CD' : '#fff'};
                    line-height:1;margin:4px 0 2px">${x.v}</div>
        <div style="font-size:9px;color:rgba(255,255,255,.35)">${i === 0 ? 'Hoogste score' : ''}</div>
      </div>
    </td>`).join('');

  // ── Kernwaarden ───────────────────────────────────────────────────────────
  const kwRows = [
    { l: 'Structuur', ws: r.kw.structuur },
    { l: 'Strategie', ws: r.kw.strategie },
    { l: 'Cultuur',   ws: r.kw.cultuur   },
  ].map(({ l, ws }) => `
    <div style="background:#f7f7f7;border:1px solid #e2e2e2;border-left:4px solid #0000FF;
                border-radius:7px;padding:9px 12px;margin-bottom:7px;break-inside:avoid">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#0000FF;
                  margin-bottom:3px">${l}</div>
      <div style="font-size:11px;font-weight:500;color:#444">
        ${ws.slice(0, 2).map(w => w.w).join(' · ')}
      </div>
    </div>`).join('');

  // ── Inzichten (met toelichting, identiek aan iz-rich in index.html) ────────
  const izToels = {
    org:  'Hier haal jij energie uit en kom je het beste tot je recht. Gebruik dit als referentiepunt bij keuzes over samenwerking en rollen.',
    rol:  'Zo positioneer jij jezelf van nature in een team. Bekijk of dit aansluit bij hoe anderen jou zien en of dit de ruimte krijgt in jouw huidige werkcontext.',
    uitd: 'Dit is het ontwikkelpunt dat nu het meest relevant is. Een goed gesprek met een coach kan helpen om hier concrete stappen in te zetten.',
  };
  const izItems = [
    { icon: '🏢', l: 'Ideale organisatie',  k: 'org'  },
    { icon: '👥', l: 'Jouw teamrol',        k: 'rol'  },
    { icon: '🎯', l: 'Uitdaging voor jou',  k: 'uitd' },
  ].map(({ icon, l, k }) => `
    <td style="width:33%;padding:0 5px;vertical-align:top">
      <div style="background:#f7f7f7;border:1px solid #e2e2e2;border-radius:8px;
                  padding:10px 12px;break-inside:avoid">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                    color:#888;margin-bottom:4px">${icon} ${l}</div>
        <div style="font-size:12px;font-weight:600;color:#111;margin-bottom:5px;line-height:1.4">
          ${r.iz[k] || '–'}
        </div>
        <div style="font-size:10px;color:#666;line-height:1.4">${izToels[k]}</div>
      </div>
    </td>`).join('');

  // ── Acties (identiek aan renderResultaat) ────────────────────────────────
  const actieItems = [
    `<strong>Koerskompas-check:</strong> begin één overleg vanuit ${A.l} en sluit af met een vraag voor ${C.l.toLowerCase()}.`,
    `<strong>Spiral-checkvraag:</strong> voeg aan je beslisagenda één vraag toe die je allergie (${aS[0][0]}) adresseert.`,
    `<strong>Mini-reflectie:</strong> schrijf na een besluit per hoek op wat goed ging.`,
    `<strong>Gesprek met collega:</strong> deel één inzicht uit dit rapport.`,
  ].map((t, i) => `
    <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;break-inside:avoid">
      <div style="min-width:22px;height:22px;border-radius:50%;background:#2EF4CD;
                  color:#0000FF;text-align:center;line-height:22px;font-weight:800;
                  font-size:11px;flex-shrink:0">${i + 1}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.88);line-height:1.5;padding-top:3px">${t}</div>
    </div>`).join('');

  // ── "Zo pas je dit meteen toe" tips (identiek aan index.html) ────────────
  const toepassingTips = [
    { ti: '💪', tekst: `<strong>Werk met je kracht:</strong> start vanuit ${si[p1[0]]?.e || ''} <em>${p1[0]}</em> – ${si[p1[0]]?.en || ''}.` },
    { ti: '⚠️', tekst: `<strong>Voorkom frictie:</strong> herken je allergie op ${si[aS[0][0]]?.e || ''} <em>${aS[0][0]}</em> – ${si[aS[0][0]]?.vk || ''}.` },
    { ti: '🔗', tekst: `<strong>Brug bouwen:</strong> combineer ${p1[0]} met ${vS[1][0]} voor de sterkste samenwerking.` },
    { ti: '🪞', tekst: `<strong>Reflectie:</strong> vraag een collega hoe hij/zij jouw ${aS[0][0]}-allergie ervaart.` },
  ].map(({ ti, tekst }) => `
    <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:7px;break-inside:avoid">
      <span style="flex-shrink:0;font-size:14px">${ti}</span>
      <div style="font-size:12px;line-height:1.5;color:#333">${tekst}</div>
    </div>`).join('');

  // ── "Wat dit voor jou betekent" bullets (identiek aan index.html) ─────────
  const betekenisBullets = [
    { ti: '✅', tekst: `<strong>Kracht:</strong> je brengt van nature ${A.l.toLowerCase()} in – dat helpt bij richting geven en keuzes maken.` },
    { ti: '👁️', tekst: `<strong>Aandachtspunt:</strong> neem expliciet het perspectief van ${C.l.toLowerCase()} mee bij complexe besluiten.` },
    { ti: '⚡', tekst: `<strong>Spanning:</strong> let op situaties die je allergie (${aS[0][0]}) triggeren – plan vooraf een checkvraag.` },
    { ti: '🌱', tekst: `<strong>Ontwikkeling:</strong> verken bewust één waardesysteem buiten je voorkeur.` },
  ].map(({ ti, tekst }) => `
    <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:7px;break-inside:avoid">
      <span style="flex-shrink:0;font-size:14px">${ti}</span>
      <div style="font-size:12px;line-height:1.5;color:rgba(255,255,255,.88)">${tekst}</div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <title>Persoonlijk rapport – ${r.naam || 'De Coachtrain'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      background: #f7f7f7;
      color: #111;
      font-size: 13px;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .wrapper { max-width: 740px; margin: 0 auto; background: #f7f7f7; }

    /* Witte secties – geen page-break-inside:avoid op hele secties
       om lege vlakken te voorkomen. Wel op kleine sub-blokken. */
    .section {
      background: #fff;
      border-radius: 0;
      padding: 20px 24px;
      margin-bottom: 12px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 800;
      color: #0000FF;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      break-after: avoid;
    }
    .section-title .icon {
      width: 30px; height: 30px;
      background: #0000FF;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      flex-shrink: 0;
    }
    .col-half   { width: 50%; vertical-align: top; }
    .col-half-l { padding-right: 12px; }
    .col-half-r { padding-left: 12px; }
    .sub-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .8px;
      color: #0000FF;
      margin-bottom: 8px;
      break-after: avoid;
    }
    .sub-label-al { color: #d97706; }

    /* Interpretatie-blokken: klein genoeg dat break-inside:avoid veilig is */
    .interp {
      background: #e8e8ff;
      border: 1.5px solid #0000FF;
      border-radius: 7px;
      padding: 12px 14px;
      margin-top: 12px;
      font-size: 12px;
      line-height: 1.6;
      break-inside: avoid;
    }
    .interp p { margin-bottom: 6px; }
    .interp p:last-child { margin-bottom: 0; }
    .interp-title {
      font-size: 10px; font-weight: 700; color: #0000FF;
      text-transform: uppercase; letter-spacing: .5px; margin-bottom: 7px;
    }
    .interp-al {
      background: #fff8f0;
      border: 1.5px solid #f97316;
      break-inside: avoid;
    }
    .interp-al .interp-title { color: #c2410c; }

    /* Zorg dat footer aan contactblok vastplakt */
    .contact-section { break-inside: avoid; }
    .footer-block    { break-before: avoid; }

    @media print {
      body { background: white; }
      .wrapper { max-width: 100%; }
    }
  </style>
</head>
<body>
<div class="wrapper">

  <!-- ── HEADER ── -->
  <div style="background:#0000FF;border-radius:10px 10px 0 0;padding:22px 24px 18px;
              margin-bottom:0;break-inside:avoid">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="vertical-align:top">
          <div style="color:#fff;font-size:20px;font-weight:900;line-height:1;letter-spacing:-1px">
            de coach<br>train<span style="color:#2EF4CD">.</span>
          </div>
          <div style="color:rgba(255,255,255,.42);font-size:9px;text-transform:uppercase;
                      letter-spacing:1px;margin-top:3px">Waardenanalyse</div>
        </td>
        <td style="text-align:right;vertical-align:top">
          <div style="background:#2EF4CD;color:#0000FF;font-size:9px;font-weight:800;
                      letter-spacing:1px;text-transform:uppercase;padding:3px 10px;
                      border-radius:20px;display:inline-block">Persoonlijk rapport</div>
          <div style="color:#fff;font-size:17px;font-weight:800;margin-top:5px">
            ${r.naam || 'Resultaten'}
          </div>
          <div style="color:rgba(255,255,255,.45);font-size:11px">${r.datum}</div>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">
      <tr>${pillars}</tr>
    </table>
  </div>

  <!-- ── DRIEHOEK ── -->
  <div class="section" style="border-top:1px solid #e2e2e2">
    <div class="section-title">
      <span class="icon">🧭</span> De Dynamische Driehoek: jouw koerskompas
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="col-half col-half-l" style="vertical-align:middle">
          ${svgTriangle}
        </td>
        <td class="col-half col-half-r">
          <div class="sub-label">Kernwaarden per hoek</div>
          ${kwRows}
        </td>
      </tr>
    </table>

    <div class="sub-label" style="margin-top:14px">📌 Inzichten uit de vragenlijst</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>${izItems}</tr>
    </table>

    <div class="interp">
      <div class="interp-title">Jouw interpretatie</div>
      ${dInterp}
      <p style="font-size:11px;margin-top:8px;color:#555">💬 <strong>Tip voor communicatie:</strong> Wanneer je alle drie de hoeken benoemt in je boodschap, bereik je ook collega's met een andere voorkeur en vergroot je de kans op draagvlak.</p>
    </div>
  </div>

  <!-- ── SPIRAL DYNAMICS ── -->
  <div class="section">
    <div class="section-title">
      <span class="icon">🌀</span> Spiral Dynamics profiel
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="col-half col-half-l">
          <div class="sub-label">Top 3 Voorkeur</div>
          ${vTop3}
        </td>
        <td class="col-half col-half-r">
          <div class="sub-label sub-label-al">Top 3 Allergie</div>
          ${aTop3}
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">
      <tr>
        <td class="col-half col-half-l">
          <div class="sub-label">Voorkeurscores</div>
          ${vBars}
        </td>
        <td class="col-half col-half-r">
          <div class="sub-label sub-label-al">Allergiescores</div>
          ${aBars}
        </td>
      </tr>
    </table>

    <div class="interp">
      <div class="interp-title">Jouw interpretatie</div>
      ${sInterp}
    </div>

    <div class="interp interp-al" style="margin-top:10px">
      <div class="interp-title">Je allergie in de praktijk</div>
      <p>Hoogste allergie: <strong>${si[aS[0][0]]?.e || ''} ${aS[0][0]} (${aS[0][1]})</strong> – ${si[aS[0][0]]?.kern || ''}.</p>
      <p style="margin-top:5px">Een allergie ontstaat doordat dit waardesysteem botst met jouw waarden. Dit kan leiden tot frictie, irritatie of afhankelijk opstellen in samenwerking. <em>Let op:</em> ${si[aS[0][0]]?.vk || ''}.</p>
      <p style="background:rgba(249,115,22,.08);border-radius:6px;padding:9px 12px;margin-top:8px;font-size:11px">
        🔍 <strong>Reflectievraag:</strong> "Wanneer trigger ik dit bij anderen — en hoe kan ik de ${aS[0][0]}-behoefte erkennen zonder er in mee te gaan?"
      </p>
    </div>

    <div class="sub-label" style="margin-top:14px">Zo pas je dit meteen toe</div>
    ${toepassingTips}
  </div>

  <!-- ── CONCLUSIE & ACTIES ── -->
  <div style="background:#0000FF;border-radius:10px;padding:20px 24px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;break-after:avoid">
      <div style="width:30px;height:30px;background:rgba(46,244,205,.2);border-radius:8px;
                  display:flex;align-items:center;justify-content:center;font-size:15px;
                  flex-shrink:0">🧩</div>
      <h2 style="font-size:16px;font-weight:800;color:#2EF4CD;margin:0">
        Totale conclusie &amp; acties
      </h2>
    </div>

    <!-- Profiel in één oogopslag -->
    <div style="background:rgba(255,255,255,.1);border-radius:7px;padding:12px 14px;
                margin-bottom:14px;break-inside:avoid">
      <div style="font-size:9px;font-weight:700;color:#2EF4CD;text-transform:uppercase;
                  letter-spacing:1px;margin-bottom:5px">Jouw profiel in één oogopslag</div>
      <div style="font-size:12px;color:rgba(255,255,255,.9);line-height:1.6">
        ${drZin.replace(/<[^>]*>/g, '')} ${spZin.replace(/<[^>]*>/g, '')}
      </div>
    </div>

    <!-- Wat dit voor jou betekent -->
    <div style="font-size:9px;font-weight:700;color:#2EF4CD;text-transform:uppercase;
                letter-spacing:.8px;margin-bottom:10px;break-after:avoid">Wat dit voor jou betekent</div>
    ${betekenisBullets}

    <!-- Acties voor komende week -->
    <div style="font-size:9px;font-weight:700;color:#2EF4CD;text-transform:uppercase;
                letter-spacing:.8px;margin:14px 0 10px;break-after:avoid">Acties voor komende week</div>
    ${actieItems}
  </div>

  <!-- ── CONTACT + FOOTER (vastgeplakt) ── -->
  <div class="contact-section">
    <div class="section" style="margin-bottom:0;border-radius:0">
      <div style="font-size:9px;font-weight:700;color:#0000FF;text-transform:uppercase;
                  letter-spacing:.5px;margin-bottom:10px">
        Dieper werken aan je inzichten?
      </div>
      <p style="font-size:12px;color:#555;margin-bottom:12px">Plan een coachinggesprek en vertaal je inzichten naar concrete volgende stappen.</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:50%;padding-right:6px;vertical-align:top">
            <div style="border:1px solid #e2e2e2;border-left:4px solid #2EF4CD;
                        border-radius:7px;padding:10px 13px">
              <div style="font-size:12px;font-weight:700">Andrew van der Veen</div>
              <div style="font-size:11px;color:#0000FF;margin-top:3px">andrewvanderveen@decoachtrain.nl</div>
              <div style="font-size:11px;color:#0000FF">06 44289764</div>
            </div>
          </td>
          <td style="width:50%;padding-left:6px;vertical-align:top">
            <div style="border:1px solid #e2e2e2;border-left:4px solid #2EF4CD;
                        border-radius:7px;padding:10px 13px">
              <div style="font-size:12px;font-weight:700">Marijke Scheenloop</div>
              <div style="font-size:11px;color:#0000FF;margin-top:3px">marijke.scheneloop@decoachtrain.nl</div>
              <div style="font-size:11px;color:#0000FF">06 33031450</div>
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Footer: plakt aan contact vast via break-before:avoid -->
    <div class="footer-block" style="background:#0000FF;border-radius:0 0 10px 10px;
                padding:14px 24px;text-align:center">
      <div style="color:#2EF4CD;font-size:16px;font-weight:900;letter-spacing:-.5px;
                  margin-bottom:3px">de coachtrain.</div>
      <div style="color:rgba(255,255,255,.5);font-size:11px">
        info@decoachtrain.nl &nbsp;·&nbsp; www.decoachtrain.nl
      </div>
    </div>
  </div>

</div>
</body>
</html>`;
}

// ── PDF-generatie via Puppeteer ───────────────────────────────────────────────

/**
 * Genereert een A4-PDF van een rapport-object.
 *
 * @param {object} rapport  - { naam, datum, driehoek, voorkeur, allergie, kw, iz }
 * @returns {Promise<Buffer>}
 */
async function generatePdf(rapport) {
  const html = buildPdfHtml(rapport);

  // Puppeteer start een headless Chromium-instantie.
  // '--no-sandbox' is vereist op Linux-productieservers zonder sandboxing.
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // setContent is sneller en betrouwbaarder dan navigeren naar een URL:
    // alle HTML is al aanwezig, geen externe afhankelijkheden.
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,       // achtergrondkleuren meenemen
      margin: { top: '12mm', right: '14mm', bottom: '12mm', left: '14mm' },
    });

    // Puppeteer >= 22 retourneert Uint8Array; zet om naar Buffer voor Express
    return Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdf };
