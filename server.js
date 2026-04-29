'use strict';

require('dotenv').config();

const express        = require('express');
const path           = require('path');
const helmet         = require('helmet');
const session        = require('express-session');
const { rateLimit }  = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const {
  createSubmission, getSubmission, getTeamSubmissions,
  getAllSubmissions, softDeleteSubmission, restoreSubmission, updateSubmission,
} = require('./database');
const { calcScores }       = require('./scores');
const { calcTeamAnalysis } = require('./team-analysis');
const { generatePdf }      = require('./pdf');
const { sendRapportMail }  = require('./mailer');

const app  = express();
const PORT = process.env.PORT || 3000;

// Railway (en andere reverse-proxy platformen) sturen X-Forwarded-* headers.
// Zonder trust proxy ziet Express het interne IP als client-IP en kan de
// Secure-vlag op cookies problemen geven.
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
// CSP uitgeschakeld: client-side rendering in HTML-bestanden; volgt in Fase 3.
app.use(helmet({ contentSecurityPolicy: false }));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Session ───────────────────────────────────────────────────────────────────
if (!process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET niet ingesteld — stel een willekeurige string in via .env');
}
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-only-insecure-fallback',
  resave:            false,
  saveUninitialized: false,
  name:              'sid',
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   8 * 60 * 60 * 1000,  // 8 uur
  },
}));

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Login: max 10 pogingen per 15 min (brute-force bescherming)
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  message:         { ok: false, error: 'Te veel inlogpogingen. Probeer het over 15 minuten opnieuw.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// Submit: max 20 inzendingen per 15 min per IP
const submitLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  message:         { ok: false, error: 'Te veel inzendingen. Probeer het later opnieuw.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Admin auth middleware ─────────────────────────────────────────────────────
// Controleer of de bezoeker een geldige admin-sessie heeft.
// API-routes krijgen een 401-JSON; pagina-routes worden doorgestuurd naar /login.html.
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) return next();
  if (req.path.startsWith('/api/') || req.xhr) {
    return res.status(401).json({ ok: false, error: 'Niet ingelogd.' });
  }
  return res.redirect('/login.html');
}

// ── Auth routes ───────────────────────────────────────────────────────────────

app.post('/auth/login', authLimiter, (req, res) => {
  const { wachtwoord } = req.body ?? {};
  const adminToken = process.env.ADMIN_TOKEN;

  console.log('[login] ADMIN_TOKEN aanwezig:', Boolean(adminToken));
  console.log('[login] SESSION_SECRET aanwezig:', Boolean(process.env.SESSION_SECRET));

  if (!adminToken) {
    return res.status(503).json({ ok: false, error: 'Server niet geconfigureerd (ADMIN_TOKEN ontbreekt).' });
  }
  const ok = typeof wachtwoord === 'string' && wachtwoord === adminToken;
  console.log('[login] wachtwoord correct:', ok);

  if (!ok) {
    return res.status(401).json({ ok: false, error: 'Ongeldig wachtwoord.' });
  }

  // Session fixation protection: nieuwe sessie-id na succesvolle login
  req.session.regenerate(err => {
    if (err) {
      console.error('[login] regenerate mislukt:', err.message);
      return res.status(500).json({ ok: false, error: 'Sessie aanmaken mislukt.' });
    }
    req.session.isAdmin = true;
    // Expliciet opslaan vóór redirect — voorkomt race condition op Railway
    req.session.save(err2 => {
      if (err2) {
        console.error('[login] save mislukt:', err2.message);
        return res.status(500).json({ ok: false, error: 'Sessie opslaan mislukt.' });
      }
      console.log('[login] sessie opgeslagen, isAdmin:', req.session.isAdmin);
      return res.redirect('/admin.html');
    });
  });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    return res.json({ ok: true });
  });
});

// ── Beschermde HTML-pagina's (vóór express.static!) ──────────────────────────
// admin.html wordt hier onderschept zodat express.static hem niet serveert.
app.get('/admin.html', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── Statische bestanden ───────────────────────────────────────────────────────
// Serveert index.html, team.html, login.html, CSS, JS, etc.
// admin.html is hierboven al afgevangen.
app.use(express.static(path.join(__dirname)));

// ── Validatiehulpfuncties ─────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LETTERS  = ['A','B','C','D','E','F'];
const N_VRAGEN = 32;

/**
 * Controleert dat raw_answers alle 192 sleutels bevat (q1A t/m q32F)
 * en dat elk antwoord een geheel getal 1–6 is, waarbij per vraag
 * de waarden 1 t/m 6 elk precies één keer voorkomen.
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
      continue;
    }
    if (new Set(values).size !== 6) {
      errors.push(`Vraag ${q}: elke waarde (1–6) moet precies één keer voorkomen.`);
    }
  }
  return errors;
}

// ── Endpoint: submit ──────────────────────────────────────────────────────────

app.post('/api/submit', submitLimiter, (req, res) => {
  const { naam, email, team_code, rol, raw_answers } = req.body ?? {};

  if (typeof naam !== 'string' || naam.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Naam is verplicht.' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ ok: false, error: 'Geldig e-mailadres is verplicht.' });
  }
  if (!raw_answers || typeof raw_answers !== 'object' || Array.isArray(raw_answers)) {
    return res.status(400).json({ ok: false, error: 'Antwoorden ontbreken of hebben een ongeldig formaat.' });
  }
  const answerErrors = validateRawAnswers(raw_answers);
  if (answerErrors.length > 0) {
    return res.status(400).json({ ok: false, errors: answerErrors });
  }

  const scores = calcScores(raw_answers);
  const id     = uuidv4();

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
    console.error('[submit] database error:', err.message);
    return res.status(500).json({ ok: false, error: 'Opslaan mislukt. Probeer het opnieuw.' });
  }
});

// ── Endpoint: rapport ophalen ─────────────────────────────────────────────────
// Geeft alleen de benodigde rapportdata terug (geen raw_answers, geen e-mail).

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
    console.error('[rapport] database error:', err.message);
    return res.status(500).json({ ok: false, error: 'Fout bij ophalen rapport.' });
  }

  if (!row) {
    return res.status(404).json({ ok: false, error: 'Rapport niet gevonden.' });
  }

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

app.get('/api/pdf/:id', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig rapport-id.' });
  }

  let row;
  try {
    row = getSubmission(id);
  } catch (err) {
    console.error('[pdf] database error:', err.message);
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

  try {
    const pdfBuffer = await generatePdf(rapport);
    const safeName  = row.naam.replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-');
    const filename  = `rapport-${safeName}-${id.slice(0, 8)}.pdf`;
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      pdfBuffer.length,
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[pdf] generatie mislukt:', err.message);
    return res.status(500).json({ ok: false, error: 'PDF generatie mislukt. Probeer het opnieuw.' });
  }
});

// ── Endpoint: rapport e-mailen ────────────────────────────────────────────────

app.post('/api/mail/:id', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig rapport-id.' });
  }

  let row;
  try {
    row = getSubmission(id);
  } catch (err) {
    console.error('[mail] database error:', err.message);
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
    console.error('[mail] verzenden mislukt:', err.message);
    return res.status(500).json({ ok: false, error: 'E-mail verzenden mislukt. Probeer het opnieuw.' });
  }
});

// ── Endpoint: teamanalyse ophalen ─────────────────────────────────────────────
// Beveiligd: accepteert sessie-cookie (admin ingelogd via browser) óf
// X-Admin-Token-header (backward compat voor directe API-aanroepen en
// team.html met ?token= in de URL).
//
// Gedrag per teamgrootte:
//   0  respondenten → 404
//   1  respondent   → 200 met melding (geen analyse)
//   2  respondenten → 200 met analyse + waarschuwing (indicatief)
//   3+ respondenten → 200 met volledige analyse

app.get('/api/team/:team_code', (req, res) => {
  const hasSession = req.session && req.session.isAdmin === true;
  const adminToken = process.env.ADMIN_TOKEN;
  const hasToken   = adminToken && req.headers['x-admin-token'] === adminToken;

  if (!hasSession && !hasToken) {
    if (!adminToken) {
      return res.status(503).json({
        ok:    false,
        error: 'Team-endpoint is niet geconfigureerd. Stel ADMIN_TOKEN in als omgevingsvariabele.',
      });
    }
    return res.status(403).json({ ok: false, error: 'Toegang geweigerd.' });
  }

  const { team_code } = req.params;
  if (!team_code || team_code.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Teamnaam ontbreekt.' });
  }

  let rows;
  try {
    rows = getTeamSubmissions(team_code);
  } catch (err) {
    console.error('[team] database error:', err.message);
    return res.status(500).json({ ok: false, error: 'Fout bij ophalen teamdata.' });
  }

  if (!rows || rows.length === 0) {
    return res.status(404).json({
      ok:    false,
      error: `Geen inzendingen gevonden voor team "${team_code}".`,
    });
  }

  if (rows.length === 1) {
    return res.status(200).json({
      ok:      true,
      analyse: null,
      melding: 'Slechts 1 respondent gevonden. Teamanalyse is zinvol vanaf 3 respondenten.',
      leden:   rows.map(r => ({ naam: r.naam, rol: r.rol ?? null, created_at: r.created_at })),
    });
  }

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

  if (rows.length === 2) {
    analyse.waarschuwing =
      'Slechts 2 respondenten — spreiding en inzichten zijn indicatief, niet representatief. '
    + 'Voeg meer teamleden toe voor een volledige analyse.';
  }

  return res.json({ ok: true, analyse });
});

// ── Admin endpoints ───────────────────────────────────────────────────────────
// Alle /api/admin/* routes zijn beveiligd via de requireAdmin-middleware.

// Alle inzendingen (alleen metadata — bedoeld voor de beheerpagina)
app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  try {
    return res.json({ ok: true, submissions: getAllSubmissions() });
  } catch (err) {
    console.error('[admin] database error:', err.message);
    return res.status(500).json({ ok: false, error: 'Fout bij ophalen data.' });
  }
});

// Inzending bewerken (naam, email, team_code, rol, is_test, excluded_from_team)
app.patch('/api/admin/submissions/:id', requireAdmin, (req, res) => {
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
    console.error('[admin] update error:', err.message);
    return res.status(500).json({ ok: false, error: 'Bijwerken mislukt.' });
  }
});

// Soft delete
app.delete('/api/admin/submissions/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Ongeldig id.' });

  try {
    softDeleteSubmission(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] soft delete error:', err.message);
    return res.status(500).json({ ok: false, error: 'Verwijderen mislukt.' });
  }
});

// Herstellen
app.post('/api/admin/submissions/:id/restore', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: 'Ongeldig id.' });

  try {
    restoreSubmission(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] restore error:', err.message);
    return res.status(500).json({ ok: false, error: 'Herstellen mislukt.' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server draait op http://localhost:${PORT}`);
});
