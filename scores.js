'use strict';

// ── scores.js ─────────────────────────────────────────────────────────────────
//
// Server-side scoreberekening voor de Waardenanalyse.
// Bronwaarheid: raw_answers (m) – een object met sleutels q1A t/m q32F,
// elk een geheel getal 1–6.
//
// Exporteert één functie: calcScores(m) → { driehoek, voorkeur, allergie, kw, iz }

// ── Driehoek-mapping: per vraag (1–15) welke letters bij s/c/t horen ─────────
const dm = {
   1: { s: ['E','F'], c: ['B','C'], t: ['A','D'] },
   2: { s: ['C','E'], c: ['D','F'], t: ['A','B'] },
   3: { s: ['B','D'], c: ['A','F'], t: ['C','E'] },
   4: { s: ['C','D'], c: ['B','F'], t: ['A','E'] },
   5: { s: ['D','F'], c: ['A','C'], t: ['B','E'] },
   6: { s: ['B','E'], c: ['D','F'], t: ['A','C'] },
   7: { s: ['B','F'], c: ['C','D'], t: ['A','E'] },
   8: { s: ['C','F'], c: ['B','D'], t: ['A','E'] },
   9: { s: ['C','D'], c: ['B','E'], t: ['A','F'] },
  10: { s: ['C','F'], c: ['B','E'], t: ['A','D'] },
  11: { s: ['B','F'], c: ['C','D'], t: ['A','E'] },
  12: { s: ['C','F'], c: ['B','E'], t: ['A','D'] },
  13: { s: ['D','F'], c: ['A','E'], t: ['B','C'] },
  14: { s: ['A','D'], c: ['C','E'], t: ['B','F'] },
  15: { s: ['C','F'], c: ['B','E'], t: ['A','D'] },
};

// ── Spiral Dynamics kleur-mapping: per vraag, letter → kleur ─────────────────
const sm = {
  19: { A:'blauw', B:'oranje', C:'groen', D:'geel', E:'rood',   F:'paars'  },
  20: { A:'blauw', B:'rood',   C:'paars', D:'oranje',E:'groen', F:'geel'   },
  21: { A:'rood',  B:'paars',  C:'groen', D:'oranje',E:'blauw', F:'geel'   },
  22: { A:'blauw', B:'rood',   C:'geel',  D:'paars', E:'groen', F:'oranje' },
  23: { A:'paars', B:'rood',   C:'geel',  D:'oranje',E:'groen', F:'blauw'  },
  24: { A:'rood',  B:'blauw',  C:'groen', D:'paars', E:'oranje',F:'geel'   },
  25: { A:'paars', B:'oranje', C:'blauw', D:'rood',  E:'groen', F:'geel'   },
  26: { A:'oranje',B:'blauw',  C:'groen', D:'rood',  E:'paars', F:'geel'   },
  27: { A:'blauw', B:'rood',   C:'geel',  D:'paars', E:'oranje',F:'groen'  },
  28: { A:'blauw', B:'rood',   C:'geel',  D:'paars', E:'oranje',F:'groen'  },
  29: { A:'rood',  B:'paars',  C:'groen', D:'oranje',E:'blauw', F:'geel'   },
  30: { A:'blauw', B:'rood',   C:'geel',  D:'paars', E:'groen', F:'oranje' },
  31: { A:'paars', B:'rood',   C:'blauw', D:'oranje',E:'groen', F:'geel'   },
  32: { A:'blauw', B:'rood',   C:'geel',  D:'paars', E:'oranje',F:'groen'  },
};

// ── Spiral-vragen: voorkeur (v) en allergie (a) ───────────────────────────────
const sq = {
  v: [19, 20, 21, 22, 23, 24, 25, 26, 27],
  a: [28, 29, 30, 31, 32],
};

// ── Antwoordteksten (alleen vragen gebruikt in tw() en bestAnswer()) ──────────
const ant = {
   2: ['flexibele organisatie','goed functionerende organisatie',
       'organisatie waar velen achter het gekozen beleid staan',
       'organisatie waar de medewerkers tevreden zijn',
       'organisatie waar ruimte is voor innovatie en creativiteit',
       'organisatie waarin medewerkers veel delen met elkaar'],
   7: ['Organisator','Strateeg','Helper','Sfeermaker','Procesbewaker','Belangenbehartiger'],
  13: ['het openstaan voor feedback over mijn houding en gedrag',
       'het vergroten van mijn professionele deskundigheid',
       'het versterken van mijn persoonlijk leiderschap',
       'het kunnen uitdragen van mijn visie',
       'het afstemmen met mijn collega\'s',
       'het krachtig kunnen overbrengen van ons teambeleid'],
  16: ['Stabiliteit','Ondernemerschap','Professionaliteit','Duurzaamheid','Marktleiderschap','Continuïteit'],
  17: ['Efficiëntie','Resultaatgerichtheid','Deskundigheid','Vernieuwing','Pro-activiteit','Betrouwbaarheid'],
  18: ['Eerlijkheid','Eigenheid','Collegialiteit','Bezieling','Erkenning','Betrokkenheid'],
  19: ['Duidelijk, betrouwbaar en rechtvaardig','Uitdagend, succesvol en ondernemend',
       'Betrokken, gelijkwaardig en open','Vernieuwend, onderscheidend en zinvol',
       'Aanzien, macht en doortastend','Verbindend, veilig en traditiegetrouw'],
  20: ['secuur, netjes en eerlijk zijn','duidelijk en direct zijn','wijs en ervaren zijn',
       'succesvol en ambitieus zijn','betrokken en verbonden zijn','creatief en vernieuwend zijn'],
  21: ['krachtig en snel','volgzaam en honkvast','mensgericht en zorgzaam',
       'doelgericht en succesvol','eerlijk en streng','tolerant en creatief'],
  22: ['het toepassen van procedures en regels','het uitvoeren van opgedragen taken',
       'het gebruik maken van innovatieve ontwikkelingen',
       'het vertrouwen op beproefde tradities en ervaringen',
       'een veilige en stabiele samenwerking','aantoonbare successen en uitdagende doelen'],
  23: ['een familiaire organisatie waar men zich veilig en thuis voelt',
       'een lijnorganisatie met focus op resultaat',
       'een professionele projectorganisatie waarin experts samenwerken',
       'een netwerkorganisatie waarin prestatie en competitie centraal staan',
       'een mensgerichte organisatie gericht op optimale samenwerking en consensus',
       'een traditionele organisatie gericht op beheersing van kwaliteit en kwantiteit'],
  24: ['dat we doelgerichte beslissingen nemen',
       'dat iedereen verantwoordelijk is voor het eigen werk',
       'dat we onderling tevreden zijn over onze manier van samenwerken',
       'dat we elkaar bijstaan en bij de groep blijven horen',
       'dat er vooruitgang geboekt wordt en we uitdagingen durven aangaan',
       'dat we creatief blijven en we ons persoonlijk blijven ontwikkelen'],
  25: ['voorzichtige benadering en bescheiden opstelling',
       'laat niet over zich heen lopen',
       'verbetert eigen fouten, is eerlijk en soms streng',
       'strategisch slim, houdt eigenbelang altijd in achterhoofd',
       'praat graag met anderen en helpt ze',
       'gaat vaak eigen gang en is intelligent'],
  26: ['haantje de voorste, fel','wil teveel, overvraagt','overgevoelig, hulpvaardig',
       'veroordelend, streng','ondergeschikt, afhankelijk','gereserveerd, arrogant'],
  27: ['moet ieder de taak doen waarvoor hij/zij aangenomen is',
       'stort ik me erop en sla me er doorheen',
       'ontstaan ook veranderingen en vernieuwingen',
       'wordt er vaak vertrouwd op beslissingen van het hoger kader',
       'kan ik goed scoren, kom ik tot mijn beste prestaties',
       'zorgen we samen dat de sfeer er niet onder leidt'],
  28: ['regels, rapportage en het beleid op papier',
       'ruzie maken, macht, invloed uitoefenen',
       'eentonigheid en kalm blijven',
       'veel vergelijkingen met vroeger en eerdere leidinggevenden',
       'de nadruk leggen op geld, winst en resultaat',
       'het gepraat over ieders eigen stokpaardje of affiniteit'],
  29: ['dominant, agressief zijn','angstig overkomen','praterig zijn',
       'hebberig, bezitterig doen','pietje precies zijn','eigenwijs, vrijpostig gedrag vertonen'],
  30: ['een baasjes-cultuur, de nadruk op rollen','impulsieve, opvliegende karakters',
       'abstracte theorieën en ingewikkelde ideeën',
       'eerbied voor wat vroeger gepresteerd is',
       'elkaar voortdurend willen begrijpen en aanvoelen',
       'korte termijn succes en winstbejag'],
  31: ['een vaste werkplek, traditioneel vakmanschap',
       'onderdrukking, witte voetjes halen, vriendjes met de baas',
       'alles volgens de regels en afspraken, de regelmaat',
       'de targets, het najagen van steeds hogere resultaten',
       'alles bespreekbaar houden, steeds in vergadering en groepen zitten',
       'de toegenomen complexiteit en talloze nieuwigheden'],
  32: ['alleen je plicht en het voorgeschreven werk te doen',
       'de sterkste en kartrekker te willen zijn',
       'nog meer te willen veranderen',
       'het navragen bij leidinggevenden of meer ervaren collega\'s',
       'onderlinge competities',
       'elkaar voortdurend te willen helpen en ondersteunen'],
};

// ── Scorefuncties ─────────────────────────────────────────────────────────────

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

function spiral(m) {
  const v = { rood:0, blauw:0, groen:0, geel:0, oranje:0, paars:0 };
  const a = { rood:0, blauw:0, groen:0, geel:0, oranje:0, paars:0 };
  sq.v.forEach(q =>
    ['A','B','C','D','E','F'].forEach(l => {
      const x = m[`q${q}${l}`];
      if (x != null) v[sm[q][l]] += x;
    })
  );
  sq.a.forEach(q =>
    ['A','B','C','D','E','F'].forEach(l => {
      const x = m[`q${q}${l}`];
      if (x != null) a[sm[q][l]] += x;
    })
  );
  return { v, a };
}

function tw(m, q, n = 3) {
  const a = ant[q];
  return ['A','B','C','D','E','F']
    .map((l, i) => ({ w: a[i], s: m[`q${q}${l}`] || 0 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n);
}

/**
 * Geeft de antwoordtekst met de hoogste score uit een set vragen.
 * Alleen als score >= 5, anders null.
 */
function bestAnswer(m, questions) {
  let bestTekst = null;
  let bestScore = -1;
  questions.forEach(q => {
    ['A','B','C','D','E','F'].forEach((l, i) => {
      const score = m[`q${q}${l}`];
      if (score != null && score > bestScore) {
        bestScore = score;
        bestTekst = ant[q]?.[i] ?? null;
      }
    });
  });
  return bestScore >= 5 ? bestTekst : null;
}

// ── Publieke API ──────────────────────────────────────────────────────────────

function calcScores(m) {
  const sp = spiral(m);
  return {
    driehoek: driehoek(m),
    voorkeur: sp.v,
    allergie: sp.a,
    kw: {
      strategie: tw(m, 16),
      structuur:  tw(m, 17),
      cultuur:    tw(m, 18),
    },
    iz: {
      org:              tw(m,  2, 1)[0]?.w ?? null,
      rol:              tw(m,  7, 1)[0]?.w ?? null,
      uitd:             tw(m, 13, 1)[0]?.w ?? null,
      topVoorkeurTekst: bestAnswer(m, sq.v),
      topAllergeTekst:  bestAnswer(m, sq.a),
    },
  };
}

module.exports = { calcScores };
