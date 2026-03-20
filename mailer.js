'use strict';

// ── mailer.js ─────────────────────────────────────────────────────────────────
//
// Verstuurt het persoonlijk rapport als e-mail met PDF-bijlage.
//
// Configuratie via omgevingsvariabelen (zie .env.example):
//   BREVO_API_KEY, MAIL_FROM, ADMIN_EMAIL, BASE_URL
//   MAIL_TEST_MODE=true → logt naar console zonder te versturen
//
// Exporteert één publieke functie:
//   sendRapportMail({ naam, email, teamCode, rapport, rapportUrl })
// ─────────────────────────────────────────────────────────────────────────────

const { generatePdf } = require('./pdf');

// Minimale Spiral Dynamics-metadata — genoeg voor de e-mailsamenvatting
const si = {
  rood:   { e: '🔴', kern: 'Energie, lef, daadkracht' },
  blauw:  { e: '🔵', kern: 'Orde, duidelijkheid, rechtvaardigheid' },
  groen:  { e: '🟢', kern: 'Menselijkheid, gelijkwaardigheid, harmonie' },
  geel:   { e: '🟡', kern: 'Systeemdenken, flexibiliteit, visie' },
  oranje: { e: '🟠', kern: 'Resultaat, ambitie, kansen' },
  paars:  { e: '🟣', kern: 'Geborgenheid, traditie, loyaliteit' },
};

// ── Hulpfuncties ──────────────────────────────────────────────────────────────

function sortedEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

function topDriehoek(d) {
  return [
    { l: 'Strategie', v: d.strategie },
    { l: 'Cultuur',   v: d.cultuur   },
    { l: 'Structuur', v: d.structuur },
  ].sort((a, b) => b.v - a.v);
}

// ── Brevo Transactional Email API (HTTPS, poort 443) ─────────────────────────
//
// Vervangt Nodemailer/SMTP. Railway blokkeert uitgaand SMTP (587/465);
// Brevo's REST API gaat via HTTPS en werkt altijd vanuit cloud-omgevingen.

function parseSender(from) {
  // Parseer "Naam <email>" naar { name, email } voor Brevo's sender-object
  const m = from.match(/^(.*?)\s*<([^>]+)>$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: from.trim() };
}

async function brevoSend({ from, to, subject, html, text, pdfBuffer, pdfName }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY ontbreekt in omgevingsvariabelen.');

  const body = {
    sender:      parseSender(from),
    to:          [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
    attachment:  [{ name: pdfName, content: pdfBuffer.toString('base64') }],
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method:  'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo API fout ${res.status}: ${detail}`);
  }
}

// ── HTML-mail voor de invuller ────────────────────────────────────────────────

function buildInvullerHtml(naam, rapport, rapportUrl) {
  const [A]  = topDriehoek(rapport.driehoek);
  const vS   = sortedEntries(rapport.voorkeur);
  const aS   = sortedEntries(rapport.allergie);
  const [v1] = vS, [a1] = aS;

  const rapportLinkRij = rapportUrl ? `
    <tr><td style="padding:16px 28px 0">
      <a href="${rapportUrl}"
         style="background:#0000FF;color:#fff;padding:12px 24px;border-radius:50px;
                text-decoration:none;font-weight:700;font-size:13px;display:inline-block">
        🔗 Bekijk je rapport online
      </a>
    </td></tr>` : '';

  const izRijen = [
    { l: '🏢 Organisatie', v: rapport.iz.org  },
    { l: '👥 Teamrol',     v: rapport.iz.rol  },
    { l: '🎯 Uitdaging',   v: rapport.iz.uitd },
  ].map(({ l, v }) => `
    <td width="33%" style="padding:0 4px;vertical-align:top">
      <div style="background:#f7f7f7;border:1px solid #e2e2e2;border-left:3px solid #0000FF;
                  border-radius:7px;padding:9px 11px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;
                    color:#888;margin-bottom:3px">${l}</div>
        <div style="font-size:11px;font-weight:600;color:#111">${v || '–'}</div>
      </div>
    </td>`).join('');

  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><title>Jouw resultaten – De Coachtrain</title></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;padding:20px 0">
  <tr><td align="center">
  <table width="580" cellpadding="0" cellspacing="0"
         style="max-width:580px;width:100%;background:#fff;border-radius:12px;
                box-shadow:0 2px 12px rgba(0,0,0,.08)">

    <!-- Header -->
    <tr><td style="background:#0000FF;border-radius:12px 12px 0 0;padding:22px 28px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <div style="color:#fff;font-size:20px;font-weight:900;line-height:1;letter-spacing:-1px">
            de coach<br>train<span style="color:#2EF4CD">.</span></div>
          <div style="color:rgba(255,255,255,.42);font-size:9px;text-transform:uppercase;
                      letter-spacing:1px;margin-top:3px">Waardenanalyse</div>
        </td>
        <td align="right">
          <div style="background:#2EF4CD;color:#0000FF;font-size:9px;font-weight:800;
                      letter-spacing:1px;text-transform:uppercase;padding:4px 10px;
                      border-radius:20px;display:inline-block">Persoonlijk rapport</div>
          <div style="color:#fff;font-size:16px;font-weight:800;margin-top:5px">${naam}</div>
          <div style="color:rgba(255,255,255,.45);font-size:11px">${rapport.datum}</div>
        </td>
      </tr></table>
    </td></tr>

    <!-- Intro -->
    <tr><td style="padding:22px 28px 8px">
      <p style="font-size:14px;color:#111;margin:0 0 10px">Beste ${naam},</p>
      <p style="font-size:13px;color:#444;line-height:1.7;margin:0">
        Hieronder vind je een samenvatting van je resultaten van de
        <strong>Waardenanalyse Samenwerken</strong>. Je volledige persoonlijke
        rapport is bijgevoegd als PDF.
      </p>
    </td></tr>

    <!-- Highlights -->
    <tr><td style="padding:16px 28px 0">
      <div style="font-size:10px;font-weight:700;color:#0000FF;text-transform:uppercase;
                  letter-spacing:.8px;margin-bottom:10px">Jouw highlights</div>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="33%" style="padding:0 4px">
          <div style="background:#e8e8ff;border:1px solid #0000FF;border-radius:8px;
                      padding:12px 10px;text-align:center">
            <div style="font-size:9px;font-weight:700;color:#0000FF;text-transform:uppercase">
              🧭 Sterkste hoek</div>
            <div style="font-size:18px;font-weight:900;color:#0000FF;margin:5px 0 2px">${A.v}</div>
            <div style="font-size:11px;font-weight:600;color:#333">${A.l}</div>
          </div>
        </td>
        <td width="33%" style="padding:0 4px">
          <div style="background:#f0fdf4;border:1px solid #16a34a;border-radius:8px;
                      padding:12px 10px;text-align:center">
            <div style="font-size:9px;font-weight:700;color:#166534;text-transform:uppercase">
              Top voorkeur</div>
            <div style="font-size:17px;margin:5px 0 2px">${si[v1[0]]?.e || ''}</div>
            <div style="font-size:11px;font-weight:600;color:#333">
              ${v1[0].charAt(0).toUpperCase() + v1[0].slice(1)} (${v1[1]})</div>
          </div>
        </td>
        <td width="33%" style="padding:0 4px">
          <div style="background:#fff8f0;border:1px solid #f97316;border-radius:8px;
                      padding:12px 10px;text-align:center">
            <div style="font-size:9px;font-weight:700;color:#c2410c;text-transform:uppercase">
              Top allergie</div>
            <div style="font-size:17px;margin:5px 0 2px">${si[a1[0]]?.e || ''}</div>
            <div style="font-size:11px;font-weight:600;color:#333">
              ${a1[0].charAt(0).toUpperCase() + a1[0].slice(1)} (${a1[1]})</div>
          </div>
        </td>
      </tr></table>
    </td></tr>

    <!-- Inzichten -->
    <tr><td style="padding:12px 28px 0">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>${izRijen}</tr>
      </table>
    </td></tr>

    <!-- Rapport-link -->
    ${rapportLinkRij}

    <!-- CTA coachingsgesprek -->
    <tr><td style="padding:16px 28px 20px">
      <div style="background:#f7f7f7;border-radius:8px;padding:14px 16px">
        <div style="font-size:12px;font-weight:700;color:#111;margin-bottom:5px">
          Dieper werken aan je inzichten?</div>
        <div style="font-size:12px;color:#444;line-height:1.6">
          Plan een persoonlijk coachinggesprek en vertaal je resultaten naar concrete stappen.
        </div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr>
          <td width="50%" style="padding-right:5px;vertical-align:top">
            <div style="font-size:11px;color:#0000FF;font-weight:600;line-height:1.6">
              Andrew van der Veen<br>andrewvanderveen@decoachtrain.nl<br>06 44289764</div>
          </td>
          <td width="50%" style="padding-left:5px;vertical-align:top">
            <div style="font-size:11px;color:#0000FF;font-weight:600;line-height:1.6">
              Marijke Scheenloop<br>marijke.scheneloop@decoachtrain.nl<br>06 33031450</div>
          </td>
        </tr></table>
      </div>
    </td></tr>

    <!-- Footer -->
    <tr><td style="background:#0000FF;border-radius:0 0 12px 12px;padding:14px 28px;
                   text-align:center">
      <div style="color:#2EF4CD;font-size:15px;font-weight:900;letter-spacing:-.5px;
                  margin-bottom:3px">de coachtrain.</div>
      <div style="color:rgba(255,255,255,.5);font-size:11px">
        info@decoachtrain.nl &nbsp;·&nbsp; www.decoachtrain.nl</div>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>`;
}

// ── Plain-text fallback voor invuller ────────────────────────────────────────

function buildInvullerText(naam, rapport) {
  const [A] = topDriehoek(rapport.driehoek);
  const vS  = sortedEntries(rapport.voorkeur);
  const aS  = sortedEntries(rapport.allergie);
  return (
    `Beste ${naam},\n\n` +
    `Hierbij jouw resultaten van de Waardenanalyse Samenwerken.\n` +
    `Je volledige rapport is bijgevoegd als PDF.\n\n` +
    `JOUW HIGHLIGHTS\n` +
    `Sterkste hoek : ${A.l} (${A.v})\n` +
    `Top voorkeur  : ${vS[0][0]} (${vS[0][1]})\n` +
    `Top allergie  : ${aS[0][0]} (${aS[0][1]})\n` +
    `Teamrol       : ${rapport.iz.rol || '–'}\n\n` +
    `Meer informatie: www.decoachtrain.nl\n` +
    `Contact: info@decoachtrain.nl\n\n` +
    `Met vriendelijke groet,\nDe Coachtrain`
  );
}

// ── HTML-notificatie voor de beheerder ───────────────────────────────────────

function buildAdminHtml(naam, email, teamCode, rapport) {
  const [A] = topDriehoek(rapport.driehoek);
  const vS  = sortedEntries(rapport.voorkeur);
  const aS  = sortedEntries(rapport.allergie);

  const rows = [
    ['Naam',    naam],
    ['E-mail',  `<a href="mailto:${email}" style="color:#0000FF">${email}</a>`],
    ['Team',    teamCode || '–'],
    ['Datum',   rapport.datum],
  ].map(([k, v]) => `
    <tr>
      <td style="width:70px;font-size:12px;font-weight:700;color:#888;
                 padding:6px 0;border-bottom:1px solid #f0f0f0">${k}</td>
      <td style="font-size:12px;color:#111;padding:6px 8px;
                 border-bottom:1px solid #f0f0f0">${v}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f7f7f7;padding:20px 0">
<table width="580" cellpadding="0" cellspacing="0" align="center"
       style="max-width:580px;width:100%;background:#fff;border-radius:12px;
              box-shadow:0 2px 12px rgba(0,0,0,.08)">
  <tr><td style="background:#0000FF;border-radius:12px 12px 0 0;padding:18px 24px">
    <div style="color:#2EF4CD;font-size:17px;font-weight:900">de coachtrain.</div>
    <div style="color:rgba(255,255,255,.6);font-size:12px;margin-top:2px">
      Nieuwe invulling ontvangen</div>
  </td></tr>
  <tr><td style="padding:20px 24px">
    <div style="font-size:11px;font-weight:700;color:#0000FF;text-transform:uppercase;
                letter-spacing:.5px;margin-bottom:10px">Invullergegevens</div>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <div style="margin-top:14px;font-size:11px;font-weight:700;color:#0000FF;
                text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Highlights</div>
    <div style="font-size:12px;color:#333;line-height:1.8">
      Sterkste hoek: <strong>${A.l} (${A.v})</strong><br>
      Top voorkeur: <strong>${vS[0][0]} (${vS[0][1]})</strong><br>
      Top allergie: <strong>${aS[0][0]} (${aS[0][1]})</strong><br>
      Teamrol: <strong>${rapport.iz.rol || '–'}</strong>
    </div>
    <div style="margin-top:12px;font-size:12px;color:#888">
      Het volledige rapport is bijgevoegd als PDF.</div>
  </td></tr>
  <tr><td style="background:#0000FF;border-radius:0 0 12px 12px;padding:12px 24px;
                 text-align:center">
    <div style="color:rgba(255,255,255,.5);font-size:11px">
      De Coachtrain &nbsp;·&nbsp; info@decoachtrain.nl</div>
  </td></tr>
</table>
</body></html>`;
}

// ── Plain-text notificatie voor beheerder ────────────────────────────────────

function buildAdminText(naam, email, teamCode, datum) {
  return (
    `Nieuwe invulling ontvangen\n\n` +
    `Naam  : ${naam}\n` +
    `E-mail: ${email}\n` +
    `Team  : ${teamCode || '–'}\n` +
    `Datum : ${datum}\n\n` +
    `Het volledige rapport is bijgevoegd als PDF.`
  );
}

// ── Hoofdfunctie ──────────────────────────────────────────────────────────────

/**
 * Genereert een PDF-bijlage en verstuurt het rapport per e-mail naar:
 *   1. de invuller (volledig opgemaakt met highlights + bijlage)
 *   2. de beheerder (notificatie met invullergegevens + bijlage)
 *
 * @param {object}      opts
 * @param {string}      opts.naam       - naam van de invuller
 * @param {string}      opts.email      - e-mailadres van de invuller
 * @param {string|null} opts.teamCode   - teamcode (optioneel)
 * @param {object}      opts.rapport    - { naam, datum, driehoek, voorkeur, allergie, kw, iz }
 * @param {string|null} opts.rapportUrl - volledige URL voor "bekijk online"-link
 * @returns {Promise<void>}
 */
async function sendRapportMail({ naam, email, teamCode, rapport, rapportUrl }) {
  const from       = process.env.MAIL_FROM   || 'De Coachtrain <info@decoachtrain.nl>';
  const adminEmail = process.env.ADMIN_EMAIL || 'info@decoachtrain.nl';

  // PDF één keer genereren; dezelfde buffer als bijlage in beide mails
  const pdfBuffer  = await generatePdf(rapport);
  const safeName   = naam.replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-');
  const attachment = {
    filename:    `rapport-${safeName}.pdf`,
    content:     pdfBuffer,
    contentType: 'application/pdf',
  };

  // ── Testmodus: geen echte SMTP-verbinding nodig ───────────────────────────
  if (process.env.MAIL_TEST_MODE === 'true') {
    console.log('[mailer] TESTMODUS – mail NIET verstuurd:');
    console.log(`  Aan invuller  : ${email}`);
    console.log(`  Aan beheerder : ${adminEmail}`);
    console.log(`  Bijlage       : ${attachment.filename} (${pdfBuffer.length} bytes)`);
    console.log(`  Rapport-URL   : ${rapportUrl || '(geen)'}`);
    return;
  }

  const pdfName = attachment.filename;

  // Mail 1: persoonlijk rapport naar de invuller
  console.log(`[mailer] Mail 1 verzenden → ${email}`);
  await brevoSend({
    from,
    to:        email,
    subject:   'Jouw resultaten – Waardenanalyse Samenwerken – De Coachtrain',
    html:      buildInvullerHtml(naam, rapport, rapportUrl),
    text:      buildInvullerText(naam, rapport),
    pdfBuffer,
    pdfName,
  });
  console.log('[mailer] Mail 1 verstuurd ✓');

  // Mail 2: notificatie naar de beheerder
  console.log(`[mailer] Mail 2 verzenden → ${adminEmail}`);
  await brevoSend({
    from,
    to:        adminEmail,
    subject:   `[Nieuw rapport] ${naam} – Waardenanalyse`,
    html:      buildAdminHtml(naam, email, teamCode, rapport),
    text:      buildAdminText(naam, email, teamCode, rapport.datum),
    pdfBuffer,
    pdfName,
  });
  console.log('[mailer] Mail 2 verstuurd ✓');
}

module.exports = { sendRapportMail };
