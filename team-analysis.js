'use strict';

// ── team-analysis.js ──────────────────────────────────────────────────────────
//
// Berekent een teamanalyse vanuit een array van submission-rijen.
//
// Exporteert één publieke functie:
//   calcTeamAnalysis(rows) → analyseobject | null
//
// Input:  rows[]  — rijen van getTeamSubmissions() uit database.js
//                   (kolommen score_driehoek / score_voorkeur / score_allergie
//                    zijn JSON-strings; worden hier geparsed)
// Output: analyseobject met meta, driehoek, spiral, patronen en inzichten
// ─────────────────────────────────────────────────────────────────────────────

// ── JSON-parse helper ─────────────────────────────────────────────────────────

/**
 * Parset één DB-rij naar een leesbaar member-object.
 * Gooit een Error met naam + id als een JSON-kolom corrupt is,
 * zodat het endpoint een bruikbare melding kan teruggeven.
 */
function parseRow(r) {
  try {
    return {
      naam:       r.naam,
      rol:        r.rol        ?? null,
      created_at: r.created_at,
      driehoek:   JSON.parse(r.score_driehoek),
      voorkeur:   JSON.parse(r.score_voorkeur),
      allergie:   JSON.parse(r.score_allergie),
    };
  } catch (err) {
    throw new Error(
      `Ongeldige JSON in database voor respondent "${r.naam}" (id: ${r.id}): ${err.message}`
    );
  }
}

// ── team_code — meest voorkomende schrijfwijze ────────────────────────────────

/**
 * Geeft de meest voorkomende team_code-waarde uit de rijen terug.
 * Gebruikt als fallback wanneer geen requestedTeamCode beschikbaar is.
 */
function modeTeamCode(rows) {
  const freq = {};
  rows.forEach(r => {
    const k = r.team_code ?? '';
    freq[k] = (freq[k] || 0) + 1;
  });
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ── Statistieken ──────────────────────────────────────────────────────────────

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Populatie-standaardafwijking. Geeft 0 terug bij minder dan 2 waarden. */
function sd(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

/** Samenvattende statistieken voor een array van getallen. */
function dimStats(values) {
  return {
    mean:   round1(mean(values)),
    sd:     round1(sd(values)),
    min:    Math.min(...values),
    max:    Math.max(...values),
    values,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Sleutel met de hoogste waarde in een object. */
function topKey(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Sleutel met de laagste waarde in een object. */
function minKey(obj) {
  return Object.entries(obj).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
}

// ── Drempel-labels ────────────────────────────────────────────────────────────

/**
 * Vertaalt een SD-waarde naar een leesbaar spreidingsniveau.
 * Drempels zijn afgestemd op de driehoekschaal (totale range ≈ 30–60).
 */
function spreadLabel(sdVal) {
  if (sdVal < 8)  return 'consensus';
  if (sdVal < 15) return 'diversiteit';
  return 'polarisatie';
}

// ── Dynamiek-inzichten ────────────────────────────────────────────────────────

/**
 * Genereert maximaal 4 inhoudelijke inzichten op basis van teampatronen.
 * Signalen worden gecombineerd tot sterkere, minder overlappende inzichten.
 * Slots: 1=spanning, 2=profiel(combinatie), 3=spiral(combinatie), 4=blinde vlek
 */
function buildInsights(driehoek, voorkeurMean, allergieMean) {
  const inzichten = [];

  const s   = driehoek.strategie.mean;
  const c   = driehoek.cultuur.mean;
  const t   = driehoek.structuur.mean;
  const sSd = driehoek.strategie.sd;
  const cSd = driehoek.cultuur.sd;
  const tSd = driehoek.structuur.sd;

  const dom    = topKey({ strategie: s, cultuur: c, structuur: t });
  const zwak   = minKey({ strategie: s, cultuur: c, structuur: t });
  const domSd  = { strategie: sSd, cultuur: cSd, structuur: tSd }[dom];
  const spread = Math.max(s, c, t) - Math.min(s, c, t);
  const maxSd  = Math.max(sSd, cSd, tSd);

  const vkTop = topKey(voorkeurMean);
  const alTop = topKey(allergieMean);

  // Leesbare subtitels per driehoekdimensie
  const dimSub = { strategie: 'richting', cultuur: 'verbinding', structuur: 'duidelijkheid' };

  // Gedragsomschrijvingen per spiraalkleur (voor generieke spiraalzin)
  const vkGedrag = {
    rood:   'daadkracht en resultaat',
    blauw:  'orde en duidelijke afspraken',
    groen:  'verbinding en samenwerking',
    geel:   'overzicht en nieuwe inzichten',
    oranje: 'vooruitgang en prestatie',
    paars:  'zekerheid en saamhorigheid',
  };
  const alGedrag = {
    rood:   'conflict en directe confrontatie',
    blauw:  'regels en vaste protocollen',
    groen:  'langdurig overleg en consensus zoeken',
    geel:   'abstracte analyses en theorievorming',
    oranje: 'competitie en prestatiedruk',
    paars:  'traditie en vaste routines',
  };

  // ── Slot 1: Spanning (eerste match wint — ze sluiten elkaar uit) ─────────────
  if (s > 40 && c < 28 && cSd < 10) {
    inzichten.push({
      type:           'spanning',
      label:          'Visie zonder draagvlak',
      tekst:          'Richting wordt snel bepaald (strategie dominant), maar verbinding met elkaar (cultuur) blijft structureel achter — en iedereen ziet dat zo. '
                    + 'Besluiten landen daardoor niet altijd, zelfs als ze inhoudelijk goed zijn.',
      gespreksopener: 'Wanneer voelde jij je niet meegenomen in een beslissing — en wat deed je daarmee?',
    });
  } else if (t > 40 && s < 28 && sSd < 10) {
    inzichten.push({
      type:           'spanning',
      label:          'Uitvoering zonder richting',
      tekst:          'Sterk in uitvoeren en organiseren (structuur dominant), maar een gedeelde koers ontbreekt (strategie laag) — en iedereen is het daarin eens. '
                    + 'Kans is groot dat iedereen hard werkt, maar aan andere prioriteiten.',
      gespreksopener: 'Als je nu stopt met wat je doet: weet je zeker dat dit het juiste is?',
    });
  } else if (c > 40 && t < 28) {
    inzichten.push({
      type:           'spanning',
      label:          'Harmonie boven helderheid',
      tekst:          'Verbinding en sfeer staan hoog (cultuur dominant), maar duidelijkheid over wie wat doet ontbreekt (structuur laag). '
                    + 'Omdat de sfeer goed is, worden die onduidelijkheden niet benoemd — tot iemand erin struikelt.',
      gespreksopener: 'Welke onduidelijkheid loopt al langer — en waarom is die nog niet uitgesproken?',
    });
  }

  // ── Slot 2: Profiel-combinatie (dominantie × spreiding, altijd één) ──────────
  if (spread >= 10 && domSd > 10) {
    // Dominant + hoge spreiding op die dimensie → iedereen bedoelt iets anders
    inzichten.push({
      type:           'diversiteit',
      label:          `Eens over ${dom}, maar anders over de betekenis`,
      tekst:          `${dom.charAt(0).toUpperCase()+dom.slice(1)} (${dimSub[dom]}) staat centraal, maar teamleden vullen dat sterk verschillend in. `
                    + `Wat eruitziet als eensgezindheid is in de praktijk ieder zijn eigen richting.`,
      gespreksopener: `Wat versta jij onder ${dom} — en wat verwacht je dat anderen daarmee doen?`,
    });
  } else if (spread >= 10 && domSd <= 10) {
    // Dominant + consensus op die dimensie → eensgezind, maar blind voor zwakste
    inzichten.push({
      type:           'balans',
      label:          `Eensgezind op ${dom}`,
      tekst:          `${dom.charAt(0).toUpperCase()+dom.slice(1)} (${dimSub[dom]}) is het sterkste thema — en iedereen staat er eensgezind achter. `
                    + `Tegelijk scoort ${zwak} (${dimSub[zwak]}) duidelijk lager, en dat risico heeft het team nog niet in beeld.`,
      gespreksopener: `Wanneer heeft de focus op ${dom} jullie geholpen — en wanneer heeft het iets gemist?`,
    });
  } else if (spread < 10 && maxSd < 6) {
    // Balans + lage spreiding → gedeeld beeld, maar geen keuze
    inzichten.push({
      type:           'balans',
      label:          'Gedeeld beeld, geen duidelijke focus',
      tekst:          'Richting (strategie), verbinding (cultuur) en duidelijkheid (structuur) liggen dicht bij elkaar — en iedereen kijkt er eensgezind tegenaan. '
                    + 'Flexibel team, maar zonder uitgesproken voorkeur is het lastig om op het juiste moment door te pakken.',
      gespreksopener: 'Als jullie nu één ding centraal moeten stellen — wat zou dat zijn, en waarom?',
    });
  } else {
    // Balans + hoge spreiding → iedereen werkt vanuit ander kompas
    inzichten.push({
      type:           'diversiteit',
      label:          'Geen gedeelde richting',
      tekst:          'Richting (strategie), verbinding (cultuur) en duidelijkheid (structuur) wegen voor iedereen anders — en de perspectieven lopen flink uiteen. '
                    + 'Iedereen werkt vanuit een eigen prioriteit, zonder dat dat ooit is uitgesproken.',
      gespreksopener: 'Waar leg jij de prioriteit — en weet de rest dat?',
    });
  }

  // ── Slot 3: Spiral-combinatie (altijd, voorkeur + allergie samengevoegd) ──────
  let spiraalTekst  = `Veel energie voor ${vkGedrag[vkTop]} (${vkTop}), maar ${alGedrag[alTop]} — precies wat ${alTop} vraagt — wordt actief vermeden. `
                    + `Dat bepaalt hoe beslissingen worden genomen én wat er nooit ter sprake komt.`;
  let spiraalOpener = `Wanneer werkt die voorkeur voor ${vkTop} goed — en wanneer botst het met wat ${alTop} van jullie vraagt?`;

  if (['geel', 'oranje'].includes(vkTop) && ['paars', 'blauw'].includes(alTop)) {
    spiraalTekst  = `Veel energie voor ${vkTop === 'geel' ? 'vernieuwing en overzicht' : 'vooruitgang en prestatie'} (${vkTop}), maar ${alTop === 'blauw' ? 'structuur en vaste kaders' : 'houvast en traditie'} (${alTop}) worden vermeden. `
                  + `Veranderingen worden snel gestart, maar de basis om ze te laten landen ontbreekt.`;
    spiraalOpener = 'Welke verandering van de afgelopen tijd heeft echt beklijfd — en wat maakte dat mogelijk?';
  } else if (['paars', 'blauw'].includes(vkTop) && ['geel', 'oranje'].includes(alTop)) {
    spiraalTekst  = `Veel behoefte aan ${vkTop === 'blauw' ? 'orde en duidelijke kaders' : 'zekerheid en saamhorigheid'} (${vkTop}), maar ${alTop === 'geel' ? 'vernieuwing en systeemdenken' : 'ambitie en prestatie'} (${alTop}) worden vermeden. `
                  + `Daardoor blijft wat al werkt intact — maar aanpassen aan wat nodig is, duurt te lang.`;
    spiraalOpener = 'Welke verbetering weet iedereen al dat nodig is — maar wordt toch uitgesteld?';
  }
  inzichten.push({
    type:           'voorkeur_allergie',
    label:          `Zoekt ${vkTop}, vermijdt ${alTop}`,
    tekst:          spiraalTekst,
    gespreksopener: spiraalOpener,
  });

  // ── Slot 4: Blinde vlek (alleen indien van toepassing) ───────────────────────
  const hoeken = [
    { naam: 'strategie', mean: s, sd: sSd },
    { naam: 'cultuur',   mean: c, sd: cSd },
    { naam: 'structuur', mean: t, sd: tSd },
  ].sort((a, b) => a.mean - b.mean);
  const laagste = hoeken[0];

  const blindVlekTekst = {
    strategie: 'Koers en richting (strategie) scoren het laagst — en iedereen is het daarin eens. '
             + 'Niemand stuurt op wat het doel is, niemand vraagt erom — iedereen werkt vanuit eigen aannames.',
    cultuur:   'Verbinding en onderlinge afstemming (cultuur) scoren het laagst — en dat valt niemand op. '
             + 'Hoe de samenwerking écht loopt is nooit besproken — dat merk je pas als de druk toeneemt.',
    structuur: 'Duidelijkheid over rollen en afspraken (structuur) scoort het laagst — en niemand brengt het in. '
             + 'Dat werkt zolang alles goed gaat — maar bij de eerste onduidelijkheid weet niemand wie aan zet is.',
  };
  const blindVlekOpener = {
    strategie: 'Wie bepaalt eigenlijk de richting — en hoe weten jullie of jullie er nog op zitten?',
    cultuur:   'Wanneer heb je voor het laatst besproken hoe de samenwerking loopt — niet het werk, maar de samenwerking zelf?',
    structuur: 'Als morgen iemand uitvalt: weet iedereen dan wat er van hem of haar wordt verwacht?',
  };

  if (laagste.mean < 25 && laagste.sd < 8) {
    inzichten.push({
      type:           'blinde_vlek',
      label:          `Collectieve blinde vlek: ${laagste.naam}`,
      tekst:          blindVlekTekst[laagste.naam],
      gespreksopener: blindVlekOpener[laagste.naam],
    });
  }

  return inzichten.slice(0, 4);
}

// ── Hoofdfunctie ──────────────────────────────────────────────────────────────

/**
 * Berekent een volledige teamanalyse vanuit DB-rijen.
 *
 * @param  {object[]} rows              Rijen van getTeamSubmissions() — minimaal 1 rij.
 * @param  {string}   [requestedTeamCode]  Aangevraagde teamnaam uit de URL-parameter.
 *                                      Wordt gebruikt als canonieke team_code in meta.
 *                                      Valt terug op meest voorkomende schrijfwijze in rows.
 * @returns {object|null}               Analyseobject, of null als rows leeg is.
 * @throws  {Error}                     Als een JSON-kolom in de DB corrupt is.
 */
function calcTeamAnalysis(rows, requestedTeamCode) {
  if (!rows || rows.length === 0) return null;

  // ── Parse JSON-kolommen — gooit Error bij corrupte data ──────────────────────
  const members = rows.map(parseRow);

  const n = members.length;

  // ── Driehoek aggregatie ──────────────────────────────────────────────────────
  const dims     = ['strategie', 'cultuur', 'structuur'];
  const driehoek = {};
  dims.forEach(dim => {
    const values  = members.map(m => m.driehoek[dim]);
    const stats   = dimStats(values);
    driehoek[dim] = { ...stats, spread: spreadLabel(stats.sd) };
  });

  // ── Spiral aggregatie ────────────────────────────────────────────────────────
  const kleuren     = ['rood', 'blauw', 'groen', 'geel', 'oranje', 'paars'];
  const voorkeurMean = {};
  const allergieMean = {};
  const voorkeurSd   = {};
  const allergieSd   = {};

  kleuren.forEach(k => {
    const vArr = members.map(m => m.voorkeur[k]);
    const aArr = members.map(m => m.allergie[k]);
    voorkeurMean[k] = round1(mean(vArr));
    allergieMean[k] = round1(mean(aArr));
    voorkeurSd[k]   = round1(sd(vArr));
    allergieSd[k]   = round1(sd(aArr));
  });

  // ── Patronen ─────────────────────────────────────────────────────────────────
  const driehoekMeans   = { strategie: driehoek.strategie.mean, cultuur: driehoek.cultuur.mean, structuur: driehoek.structuur.mean };
  const dominanteHoek   = topKey(driehoekMeans);
  const zwaksteHoek     = minKey(driehoekMeans);
  const topVoorkeur     = topKey(voorkeurMean);
  const topAllergie     = topKey(allergieMean);

  // ── Inzichten ────────────────────────────────────────────────────────────────
  const inzichten = buildInsights(driehoek, voorkeurMean, allergieMean);

  // ── Datums ───────────────────────────────────────────────────────────────────
  const dates = [...rows.map(r => r.created_at)].sort();

  // ── Samenstellen output ──────────────────────────────────────────────────────
  return {
    meta: {
      // Gebruik de aangevraagde teamnaam als canonieke waarde (meest betrouwbaar),
      // anders de meest voorkomende schrijfwijze in de opgeslagen rijen.
      team_code:         requestedTeamCode ? requestedTeamCode.trim() : modeTeamCode(rows),
      n,
      eerste_inzending:  dates[0],
      laatste_inzending: dates[dates.length - 1],
      leden: members.map(m => ({
        naam:       m.naam,
        rol:        m.rol,
        created_at: m.created_at,
      })),
    },
    driehoek,
    spiral: {
      voorkeur: Object.fromEntries(
        kleuren.map(k => [k, { mean: voorkeurMean[k], sd: voorkeurSd[k] }])
      ),
      allergie: Object.fromEntries(
        kleuren.map(k => [k, { mean: allergieMean[k], sd: allergieSd[k] }])
      ),
    },
    patronen: {
      dominante_hoek: dominanteHoek,
      zwakste_hoek:   zwaksteHoek,
      top_voorkeur:   topVoorkeur,
      top_allergie:   topAllergie,
    },
    inzichten,
  };
}

module.exports = { calcTeamAnalysis };
