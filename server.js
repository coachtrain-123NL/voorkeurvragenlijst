'use strict';

require('dotenv').config();

const express  = require('express');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const {
  createSubmission, getSubmission, getTeamSubmissions,
  getAllSubmissions, softDeleteSubmission, restoreSubmission, updateSubmission,
} = require('./database');
const { calcScores }        = require('./scores');
const { calcTeamAnalysis }  = require('./team-analysis');
const { generatePdf }       = require('./pdf');
const { sendRapportMail }   = require('./mailer');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

// Parseer JSON-bodies; limiet op 1 MB is ruim genoeg voor 198 antwoorden
app.use(express.json({ limit: '1mb' }));

// Serveer index.html en overige statische bestanden vanuit de projectmap.
// In een latere productiefase verplaats je de frontend naar een aparte
// public/-map om server.js en database.js niet publiek toegankelijk te maken.
app.use(express.static(path.join(__dirname)));

// ── Validatiehulpfuncties ─────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LETTERS  = ['A','B','C','D','E','F'];
const N_VRAGEN = 32;

/**
 * Controleert dat raw_answers alle 192 sleutels bevat (q1A t/m q32F)
 * en dat elk antwoord een geheel getal 1–6 is, waarbij per vraag
 * de waarden 1 t/m 6 elk precies één keer voorkomen.
 * Zelfde logica als VAL.v1 in de frontend.
 */
function validateRawAnswers(raw) {
  const errors = [];
  for (let q = 1; q <= N_VRAGEN; q++) {
    const values = LETTERS.map(l => raw[`q${q}${l}`]);

    const allValid = values.every(
      v => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 6
    );
    if (!allValid) {
      errors.push(`Vraag ${q}: verwacht 6 gehele getallen van 1 t/m 6.`);
      continue; // sla de unieke-waarden-check over
    }

    if (new Set(values).size !== 6) {
      errors.push(`Vraag ${q}: elke waarde (1–6) moet precies één keer voorkomen.`);
    }
  }
  return errors;
}

// ── Endpoint: submit ──────────────────────────────────────────────────────────

app.post('/api/submit', (req, res) => {
  const { naam, email, team_code, rol, raw_answers } = req.body ?? {};
  // Eventuele client-side scores in de body worden genegeerd:
  // de server berekent altijd zijn eigen scores vanuit raw_answers.

  // — Verplichte persoonlijke velden —
  if (typeof naam !== 'string' || naam.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Naam is verplicht.' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ ok: false, error: 'Geldig e-mailadres is verplicht.' });
  }

  // — Antwoorden valideren —
  if (!raw_answers || typeof raw_answers !== 'object' || Array.isArray(raw_answers)) {
    return res.status(400).json({ ok: false, error: 'Antwoorden ontbreken of hebben een ongeldig formaat.' });
  }
  const answerErrors = validateRawAnswers(raw_answers);
  if (answerErrors.length > 0) {
    return res.status(400).json({ ok: false, errors: answerErrors });
  }

  // — Server-side scoreberekening vanuit raw_answers (bron van waarheid) —
  const scores = calcScores(raw_answers);

  // — Opslaan —
  const id = uuidv4();

  try {
    createSubmission({
      id,
      naam:       naam.trim(),
      email:      email.trim().toLowerCase(),
      team_code:  typeof team_code === 'string' && team_code.trim() ? team_code.trim() : null,
      rol:        typeof rol === 'string' && rol.trim() ? rol.trim() : null,
      created_at: new Date().toISOString(),
      raw_answers,
      score_driehoek: scores.driehoek,
      score_voorkeur: scores.voorkeur,
      score_allergie: scores.allergie,
      score_kw:       scores.kw,
      score_iz:       scores.iz,
    });

    return res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error('[submit] database error:', err);
    return res.status(500).json({ ok: false, error: 'Opslaan mislukt. Probeer het opnieuw.' });
  }
});

// ── Endpoint: rapport ophalen ─────────────────────────────────────────────────
//
// Geeft alleen de benodigde rapportdata terug (geen raw_answers, geen e-mail).
// De UUID-check voorkomt dat willekeurige strings de DB bereiken.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get('/api/rapport/:id', (req, res) => {
  const { id } = req.params;

  if (!UUID_RE.test(id)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig rapport-id.' });
  }

  let row;
  try {
    row = getSubmission(id);
  } catch (err) {
    console.error('[rapport] database error:', err);
    return res.status(500).json({ ok: false, error: 'Fout bij ophalen rapport.' });
  }

  if (!row) {
    return res.status(404).json({ ok: false, error: 'Rapport niet gevonden.' });
  }

  // Zelfde datumopmaak als de frontend (SE.calc): "18 maart 2026"
  const datum = new Date(row.created_at).toLocaleDateString('nl-NL', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return res.json({
    ok: true,
    rapport: {
      naam:     row.naam,
      datum,
      driehoek: JSON.parse(row.score_driehoek),
      voorkeur: JSON.parse(row.score_voorkeur),
      allergie: JSON.parse(row.score_allergie),
      kw:       JSON.parse(row.score_kw),
      iz:       JSON.parse(row.score_iz),
      // e-mail en raw_answers worden bewust NIET teruggestuurd (privacy)
    },
  });
});

// ── Endpoint: PDF downloaden ──────────────────────────────────────────────────
//
// Genereert een A4-PDF van een opgeslagen rapport via Puppeteer.
// Zelfde UUID-validatie als GET /api/rapport/:id.

app.get('/api/pdf/:id', async (req, res) => {
  const { id } = req.params;

  if (!UUID_RE.test(id)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig rapport-id.' });
  }

  let row;
  try {
    row = getSubmission(id);
  } catch (err) {
    console.error('[pdf] database error:', err);
    return res.status(500).json({ ok: false, error: 'Fout bij ophalen rapport.' });
  }

  if (!row) {
    return res.status(404).json({ ok: false, error: 'Rapport niet gevonden.' });
  }

  // Zelfde rapportobject als GET /api/rapport/:id — datum in Nederlandse opmaak
  const datum = new Date(row.created_at).toLocaleDateString('nl-NL', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const rapport = {
    naam:     row.naam,
    datum,
    driehoek: JSON.parse(row.score_driehoek),
    voorkeur: JSON.parse(row.score_voorkeur),
    allergie: JSON.parse(row.score_allergie),
    kw:       JSON.parse(row.score_kw),
    iz:       JSON.parse(row.score_iz),
  };

  try {
    const pdfBuffer = await generatePdf(rapport);

    // Bestandsnaam: rapport-<naam>-<id-prefix>.pdf
    const safeName = row.naam.replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-');
    const filename  = `rapport-${safeName}-${id.slice(0, 8)}.pdf`;

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      pdfBuffer.length,
    });
    return res.send(pdfBuffer);

  } catch (err) {
    console.error('[pdf] generatie mislukt:', err);
    return res.status(500).json({ ok: false, error: 'PDF generatie mislukt. Probeer het opnieuw.' });
  }
});

// ── Endpoint: rapport e-mailen ────────────────────────────────────────────────
//
// Haalt het rapport op uit de DB, genereert de PDF en verzendt twee mails:
// één naar de invuller en één naar de beheerder (ADMIN_EMAIL).
// Zelfde UUID-validatie als de andere rapport-endpoints.

app.post('/api/mail/:id', async (req, res) => {
  const { id } = req.params;

  if (!UUID_RE.test(id)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig rapport-id.' });
  }

  let row;
  try {
    row = getSubmission(id);
  } catch (err) {
    console.error('[mail] database error:', err);
    return res.status(500).json({ ok: false, error: 'Fout bij ophalen rapport.' });
  }

  if (!row) {
    return res.status(404).json({ ok: false, error: 'Rapport niet gevonden.' });
  }

  const datum = new Date(row.created_at).toLocaleDateString('nl-NL', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const rapport = {
    naam:     row.naam,
    datum,
    driehoek: JSON.parse(row.score_driehoek),
    voorkeur: JSON.parse(row.score_voorkeur),
    allergie: JSON.parse(row.score_allergie),
    kw:       JSON.parse(row.score_kw),
    iz:       JSON.parse(row.score_iz),
  };

  const base       = (process.env.BASE_URL || '').replace(/\/$/, '');
  const rapportUrl = base ? `${base}/?rapport=${id}` : null;

  try {
    await sendRapportMail({
      naam:      row.naam,
      email:     row.email,
      teamCode:  row.team_code,
      rapport,
      rapportUrl,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[mail] verzenden mislukt:', err);
    return res.status(500).json({ ok: false, error: 'E-mail verzenden mislukt. Probeer het opnieuw.' });
  }
});

// ── Endpoint: teamanalyse ophalen ─────────────────────────────────────────────
//
// Berekent een teamanalyse voor alle inzendingen met dezelfde teamnaam.
// Beveiligd met een simpele ADMIN_TOKEN header-check.
//
// Gedrag per teamgrootte:
//   0  respondenten → 404
//   1  respondent   → 200 met melding (geen analyse)
//   2  respondenten → 200 met analyse + waarschuwing (indicatief)
//   3+ respondenten → 200 met volledige analyse
//
// Matching op team_code is case-insensitief en trim-onafhankelijk.
// De originele teamnaam wordt teruggegeven in analyse.meta.team_code.

app.get('/api/team/:team_code', (req, res) => {
  // — Tokenbeveiliging —
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return res.status(503).json({
      ok:    false,
      error: 'Team-endpoint is niet geconfigureerd. Stel ADMIN_TOKEN in als omgevingsvariabele.',
    });
  }
  if (req.headers['x-admin-token'] !== adminToken) {
    return res.status(403).json({ ok: false, error: 'Toegang geweigerd.' });
  }

  const { team_code } = req.params;
  if (!team_code || team_code.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Teamnaam ontbreekt.' });
  }

  // — Inzendingen ophalen —
  let rows;
  try {
    rows = getTeamSubmissions(team_code);
  } catch (err) {
    console.error('[team] database error:', err);
    return res.status(500).json({ ok: false, error: 'Fout bij ophalen teamdata.' });
  }

  if (!rows || rows.length === 0) {
    return res.status(404).json({
      ok:    false,
      error: `Geen inzendingen gevonden voor team "${team_code}".`,
    });
  }

  // — Te weinig respondenten voor analyse —
  if (rows.length === 1) {
    return res.status(200).json({
      ok:      true,
      analyse: null,
      melding: 'Slechts 1 respondent gevonden. Teamanalyse is zinvol vanaf 3 respondenten.',
      leden:   rows.map(r => ({ naam: r.naam, rol: r.rol ?? null, created_at: r.created_at })),
    });
  }

  // — Analyse berekenen —
  let analyse;
  try {
    analyse = calcTeamAnalysis(rows, team_code);
  } catch (err) {
    console.error('[team] analyse mislukt:', err.message);
    return res.status(500).json({
      ok:    false,
      error: `Teamanalyse mislukt: ${err.message}`,
    });
  }

  // Bij 2 respondenten: analyse is indicatief, geen harde conclusies
  if (rows.length === 2) {
    analyse.waarschuwing =
      'Slechts 2 respondenten — spreiding en inzichten zijn indicatief, niet representatief. '
    + 'Voeg meer teamleden toe voor een volledige analyse.';
  }

  return res.json({ ok: true, analyse });
});

// ── Admin auth helper ─────────────────────────────────────────────────────────
function requireAdmin(req, res) {
  const tok = process.env.ADMIN_TOKEN;
  if (!tok) { res.status(503).json({ ok: false, error: 'ADMIN_TOKEN niet geconfigureerd.' }); return false; }
  if (req.headers['x-admin-token'] !== tok) { res.status(403).json({ ok: false, error: 'Toegang geweigerd.' }); return false; }
  return true;
}

// ── Endpoint: admin — alle inzendingen ───────────────────────────────────────
//
// Geeft id, naam, email, team_code, rol en datum terug van alle inzendingen.
// Bedoeld voor de beheerpagina (admin.html). Beveiligd met ADMIN_TOKEN.

app.get('/api/admin/submissions', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    return res.json({ ok: true, submissions: getAllSubmissions() });
  } catch (err) {
    console.error('[admin] database error:', err);
    return res.status(500).json({ ok: false, error: 'Fout bij ophalen data.' });
  }
});

// ── Endpoint: admin — inzending bewerken ─────────────────────────────────────
app.patch('/api/admin/submissions/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Ongeldig id.' });

  const { naam, email, team_code, rol, is_test, excluded_from_team } = req.body ?? {};
  if (typeof naam !== 'string' || !naam.trim())
    return res.status(400).json({ ok: false, error: 'Naam is verplicht.' });
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()))
    return res.status(400).json({ ok: false, error: 'Ongeldig e-mailadres.' });

  try {
    updateSubmission(id, {
      naam:               naam.trim(),
      email:              email.trim().toLowerCase(),
      team_code:          typeof team_code === 'string' && team_code.trim() ? team_code.trim() : null,
      rol:                typeof rol === 'string' && rol.trim() ? rol.trim() : null,
      is_test:            is_test            ? 1 : 0,
      excluded_from_team: excluded_from_team ? 1 : 0,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] update error:', err);
    return res.status(500).json({ ok: false, error: 'Bijwerken mislukt.' });
  }
});

// ── Endpoint: admin — soft delete ────────────────────────────────────────────
app.delete('/api/admin/submissions/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Ongeldig id.' });

  try {
    softDeleteSubmission(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] soft delete error:', err);
    return res.status(500).json({ ok: false, error: 'Verwijderen mislukt.' });
  }
});

// ── Endpoint: admin — herstellen ─────────────────────────────────────────────
app.post('/api/admin/submissions/:id/restore', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Ongeldig id.' });

  try {
    restoreSubmission(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] restore error:', err);
    return res.status(500).json({ ok: false, error: 'Herstellen mislukt.' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server draait op http://localhost:${PORT}`);
});
