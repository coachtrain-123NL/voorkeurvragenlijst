'use strict';

// node:sqlite is ingebouwd in Node.js 22+ — geen externe afhankelijkheid,
// geen compilatiestap nodig. Op Node.js 22 en 23 toont het een
// ExperimentalWarning; dit is een waarschuwing, geen fout.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

// Bewaar de database buiten de webroot zodat hij niet publiek opvraagbaar is.
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'submissions.db'));

// WAL-mode: betere prestaties bij meerdere gelijktijdige lezers
db.exec('PRAGMA journal_mode = WAL');

// Schema – één tabel met alle benodigde kolommen
db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id              TEXT PRIMARY KEY,
    naam            TEXT NOT NULL,
    email           TEXT NOT NULL,
    team_code       TEXT,
    rol             TEXT,
    created_at      TEXT NOT NULL,
    raw_answers     TEXT NOT NULL,
    score_driehoek  TEXT NOT NULL,
    score_voorkeur  TEXT NOT NULL,
    score_allergie  TEXT NOT NULL,
    score_kw        TEXT NOT NULL,
    score_iz        TEXT NOT NULL
  )
`);

// Prepared statement – één keer compileren, meerdere keren uitvoeren
const insertSubmission = db.prepare(`
  INSERT INTO submissions (
    id, naam, email, team_code, rol, created_at,
    raw_answers, score_driehoek, score_voorkeur,
    score_allergie, score_kw, score_iz
  ) VALUES (
    :id, :naam, :email, :team_code, :rol, :created_at,
    :raw_answers, :score_driehoek, :score_voorkeur,
    :score_allergie, :score_kw, :score_iz
  )
`);

/**
 * Slaat een ingevulde vragenlijst op in de database.
 * Gooit een Error als de opslag mislukt.
 */
function createSubmission(data) {
  insertSubmission.run({
    id:             data.id,
    naam:           data.naam,
    email:          data.email,
    team_code:      data.team_code ?? null,
    rol:            data.rol       ?? null,
    created_at:     data.created_at,
    raw_answers:    JSON.stringify(data.raw_answers),
    score_driehoek: JSON.stringify(data.score_driehoek),
    score_voorkeur: JSON.stringify(data.score_voorkeur),
    score_allergie: JSON.stringify(data.score_allergie),
    score_kw:       JSON.stringify(data.score_kw),
    score_iz:       JSON.stringify(data.score_iz),
  });
}

// Prepared statement voor ophalen – één keer compileren
const selectSubmissionById = db.prepare(
  'SELECT * FROM submissions WHERE id = ?'
);

/**
 * Haalt één opgeslagen submission op via id.
 * Geeft null terug als het id niet bestaat.
 */
function getSubmission(id) {
  return selectSubmissionById.get(id) ?? null;
}

module.exports = { db, createSubmission, getSubmission };
