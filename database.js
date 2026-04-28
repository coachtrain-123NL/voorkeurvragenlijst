'use strict';

// node:sqlite is ingebouwd in Node.js 22+ — geen externe afhankelijkheid,
// geen compilatiestap nodig. Op Node.js 22 en 23 toont het een
// ExperimentalWarning; dit is een waarschuwing, geen fout.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

// Bewaar de database buiten de webroot zodat hij niet publiek opvraagbaar is.
// DATA_DIR kan als omgevingsvariabele worden ingesteld voor persistent storage
// op platforms zoals Railway (Volume mount). Fallback: lokale ./data/ map.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'submissions.db'));

// WAL-mode: betere prestaties bij meerdere gelijktijdige lezers
db.exec('PRAGMA journal_mode = WAL');

// Migraties: veilig te herhalen, fout = kolom bestaat al
try { db.exec('ALTER TABLE submissions ADD COLUMN deleted_at TEXT'); }                    catch (_) {}
try { db.exec('ALTER TABLE submissions ADD COLUMN is_test INTEGER DEFAULT 0'); }          catch (_) {}
try { db.exec('ALTER TABLE submissions ADD COLUMN excluded_from_team INTEGER DEFAULT 0'); } catch (_) {}

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

// Prepared statement voor teamopvraging met deduplicatie per e-mailadres.
// CTE 'latest': per genormaliseerd e-mailadres de meest recente created_at.
// Join: geef alleen die rijen terug die overeenkomen met de laatste inzending.
// Matching op team_code is case-insensitief en trim-onafhankelijk.
// De originele team_code-waarde in de database wordt niet gewijzigd.
const selectTeamSubmissions = db.prepare(`
  WITH ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
             PARTITION BY LOWER(TRIM(email))
             ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM   submissions
    WHERE  LOWER(TRIM(team_code)) = LOWER(TRIM(?))
    AND    deleted_at IS NULL
    AND    excluded_from_team = 0
    AND    is_test = 0
  )
  SELECT id, naam, email, team_code, rol, created_at,
         raw_answers, score_driehoek, score_voorkeur,
         score_allergie, score_kw, score_iz
  FROM   ranked
  WHERE  rn = 1
  ORDER  BY created_at ASC
`);

/**
 * Haalt alle teamleden op voor een gegeven teamnaam.
 * Matching is case-insensitief en negeert omringende spaties.
 * Per e-mailadres wordt alleen de meest recente inzending binnen het team
 * meegenomen (deduplicatie in de query — alle rijen blijven bewaard in de DB).
 * Geeft een lege array terug als geen inzendingen gevonden.
 */
function getTeamSubmissions(teamCode) {
  return selectTeamSubmissions.all(teamCode);
}

// Prepared statement voor adminoverzicht — alle inzendingen inclusief verwijderde + test
const selectAllSubmissions = db.prepare(`
  SELECT id, naam, email, team_code, rol, created_at, deleted_at, is_test, excluded_from_team
  FROM   submissions
  ORDER  BY created_at DESC
`);

/**
 * Haalt alle inzendingen op (incl. soft-deleted), alleen metadata.
 * Uitsluitend bedoeld voor de admin-beheerpagina.
 */
function getAllSubmissions() {
  return selectAllSubmissions.all();
}

// Soft delete: zet deleted_at op huidige timestamp
const stmtSoftDelete = db.prepare('UPDATE submissions SET deleted_at = ? WHERE id = ?');
function softDeleteSubmission(id) {
  stmtSoftDelete.run(new Date().toISOString(), id);
}

// Restore: wis deleted_at
const stmtRestore = db.prepare('UPDATE submissions SET deleted_at = NULL WHERE id = ?');
function restoreSubmission(id) {
  stmtRestore.run(id);
}

// Bewerk naam/email/team_code/rol/is_test/excluded_from_team — scores blijven ongewijzigd
const stmtUpdate = db.prepare(
  'UPDATE submissions SET naam=:naam, email=:email, team_code=:team_code, rol=:rol, is_test=:is_test, excluded_from_team=:excluded_from_team WHERE id=:id'
);
function updateSubmission(id, { naam, email, team_code, rol, is_test, excluded_from_team }) {
  stmtUpdate.run({
    id,
    naam, email,
    team_code:          team_code          ?? null,
    rol:                rol                ?? null,
    is_test:            is_test            ? 1 : 0,
    excluded_from_team: excluded_from_team ? 1 : 0,
  });
}

module.exports = {
  db, createSubmission, getSubmission, getTeamSubmissions,
  getAllSubmissions, softDeleteSubmission, restoreSubmission, updateSubmission,
};
