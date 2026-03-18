'use strict';

// ── scores.js ─────────────────────────────────────────────────────────────────
//
// Server-side scoreberekening voor de Waardenanalyse.
// Dit is een exacte poort van de SE- en DATA-objecten uit index.html.
//
// Bronwaarheid: raw_answers (m) – een object met sleutels q1A t/m q33F,
// elk een geheel getal 1–6.
//
// Exporteert één functie: calcScores(m) → { driehoek, voorkeur, allergie, kw, iz }
// De namen en structuur van de returnwaarden zijn identiek aan SE.calc() in de frontend,
// zodat de rapportweergave zonder aanpassingen werkt.

// ── Statische data (identiek aan DATA in index.html) ─────────────────────────

// Driehoek-mapping: per vraag (1–15) welke letters bij strategie/cultuur/structuur horen
const dm = {
   1: { s: ['E','F'], c: ['B','C'], t: ['A','D'] },
   2: { s: ['C','E'], c: ['D','F'], t: ['A','B'] },
   3: { s: ['B','D'], c: ['A','F'], t: ['C','E'] },
   4: { s: ['A','D'], c: ['B','C'], t: ['E','F'] },
   5: { s: ['A','F'], c: ['C','D'], t: ['B','E'] },
   6: { s: ['B','E'], c: ['D','F'], t: ['A','C'] },
   7: { s: ['C','F'], c: ['B','E'], t: ['A','D'] },
   8: { s: ['A','F'], c: ['B','D'], t: ['C','E'] },
   9: { s: ['C','E'], c: ['B','F'], t: ['A','D'] },
  10: { s: ['A','D'], c: ['C','F'], t: ['B','E'] },
  11: { s: ['B','F'], c: ['C','D'], t: ['A','E'] },
  12: { s: ['A','E'], c: ['C','F'], t: ['B','D'] },
  13: { s: ['B','E'], c: ['C','F'], t: ['A','D'] },
  14: { s: ['B','E'], c: ['C','F'], t: ['A','D'] },
  15: { s: ['C','F'], c: ['B','E'], t: ['A','D'] },
};

// Volgorde van de zes Spiral Dynamics waarden (index 0–5 = letter A–F)
const sv = ['rood', 'blauw', 'groen', 'geel', 'oranje', 'paars'];

// Spiral-vragen: voorkeur (v) en allergie (a)
const sq = {
  v: [19, 20, 21, 22, 23, 24, 25, 26, 27, 33],
  a: [28, 29, 30, 31, 32],
};

// Antwoordteksten – alleen de vragen die gebruikt worden in tw():
//   q2  → iz.org    (ik werk het liefst in een…)
//   q7  → iz.rol    (teamrol)
//   q13 → iz.uitd   (uitdagingen)
//   q16 → kw.structuur (waarden vanuit rol)
//   q17 → kw.strategie (waarden vanuit visie)
//   q18 → kw.cultuur   (waarden vanuit beleving)
const ant = {
   2: ['flexibele organisatie', 'goed functionerende organisatie',
       'organisatie waar velen achter het gekozen beleid staan',
       'organisatie waar de medewerkers tevreden zijn',
       'organisatie waar ruimte is voor innovatie en creativiteit',
       'organisatie waarin medewerkers veel delen met elkaar'],
   7: ['de controleur', 'de gangmaker', 'de inspirator',
       'de helper', 'de analyticus', 'de visionair'],
  13: ['hoe om te gaan met conflicten', 'hoe ik duidelijker kan zijn',
       'hoe ik anderen kan overtuigen', 'hoe ik processen kan verbeteren',
       "hoe ik collega's kan motiveren", 'hoe ik balans hou tussen werk en privé'],
  16: ['resultaatgerichtheid', 'teamspirit', 'creativiteit',
       'open communicatie', 'duidelijke afspraken', 'verantwoordelijkheid'],
  17: ['heldere doelen', 'vernieuwing en initiatief', 'betrouwbaarheid',
       'persoonlijke ontwikkeling', 'professioneel gedrag', 'visie en strategie'],
  18: ['respect', 'onderlinge betrokkenheid', 'afspraken nakomen',
       'ruimte voor creativiteit', 'transparantie', 'positieve werksfeer'],
};

// ── Scorefuncties (identiek aan SE in index.html) ────────────────────────────

/**
 * Berekent de Dynamische Driehoek-scores (strategie / cultuur / structuur)
 * op basis van vragen 1–15.
 */
function driehoek(m) {
  const s = { strategie: 0, cultuur: 0, structuur: 0 };
  for (let q = 1; q <= 15; q++) {
    const mp = dm[q];
    ['A','B','C','D','E','F'].forEach(l => {
      const v = m[`q${q}${l}`];
      if (v == null) return;
      if      (mp.s.includes(l)) s.strategie += v;
      else if (mp.c.includes(l)) s.cultuur   += v;
      else                       s.structuur += v;
    });
  }
  return s;
}

/**
 * Berekent de Spiral Dynamics voorkeur- en allergiescores.
 */
function spiral(m) {
  const v = { rood:0, blauw:0, groen:0, geel:0, oranje:0, paars:0 };
  const a = { rood:0, blauw:0, groen:0, geel:0, oranje:0, paars:0 };

  sq.v.forEach(q =>
    ['A','B','C','D','E','F'].forEach((l, i) => {
      const x = m[`q${q}${l}`];
      if (x != null) v[sv[i]] += x;
    })
  );
  sq.a.forEach(q =>
    ['A','B','C','D','E','F'].forEach((l, i) => {
      const x = m[`q${q}${l}`];
      if (x != null) a[sv[i]] += x;
    })
  );
  return { v, a };
}

/**
 * Geeft de top-n antwoorden voor vraag q, gesorteerd op score (hoog naar laag).
 * Identiek aan tw() in de frontend.
 *
 * @param {object} m       - raw_answers
 * @param {number} q       - vraagnummer
 * @param {number} [n=3]   - aantal resultaten
 * @returns {{ w: string, s: number }[]}
 */
function tw(m, q, n = 3) {
  const a = ant[q];
  return ['A','B','C','D','E','F']
    .map((l, i) => ({ w: a[i], s: m[`q${q}${l}`] || 0 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n);
}

// ── Publieke API ──────────────────────────────────────────────────────────────

/**
 * Berekent alle scores vanuit raw_answers.
 *
 * De returnstructuur is identiek aan wat SE.calc() in de frontend produceert
 * (exclusief naam, email en datum – die worden apart opgeslagen).
 *
 * @param {object} m - raw_answers: { q1A: number, …, q33F: number }
 * @returns {{ driehoek, voorkeur, allergie, kw, iz }}
 */
function calcScores(m) {
  const sp = spiral(m);
  return {
    driehoek: driehoek(m),
    voorkeur: sp.v,
    allergie: sp.a,
    kw: {
      structuur: tw(m, 16),
      strategie: tw(m, 17),
      cultuur:   tw(m, 18),
    },
    iz: {
      org:  tw(m,  2, 1)[0]?.w ?? null,
      rol:  tw(m,  7, 1)[0]?.w ?? null,
      uitd: tw(m, 13, 1)[0]?.w ?? null,
    },
  };
}

module.exports = { calcScores };
