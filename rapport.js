// ─── VONERLEC — Rapport automatique ─────────────────────────────────────────
// Vercel Serverless Function déclenchée par Cron
// Variables d'environnement requises dans Vercel :
//   RESEND_API_KEY   → clé API Resend (resend.com, gratuit jusqu'à 3000 mails/mois)
//   FIREBASE_URL     → https://vonerlec-badge-default-rtdb.europe-west1.firebasedatabase.app
//   RAPPORT_EMAIL    → rn2s.batiment@gmail.com
//   CRON_SECRET      → une chaîne aléatoire pour sécuriser l'endpoint

const FIREBASE_URL = process.env.FIREBASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RAPPORT_EMAIL = process.env.RAPPORT_EMAIL || "rn2s.batiment@gmail.com";
const CRON_SECRET = process.env.CRON_SECRET;

async function fbGet(path) {
  const r = await fetch(`${FIREBASE_URL}/${path}.json`);
  return await r.json();
}

function fmt(ts, mode = "time") {
  const d = new Date(ts);
  if (mode === "date") return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (mode === "time") return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("fr-FR");
}

function duree(entree, sortie) {
  if (!entree || !sortie) return "—";
  const d = new Date(sortie) - new Date(entree);
  if (d <= 0) return "—";
  const h = Math.floor(d / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  return `${h}h${String(m).padStart(2, "0")}`;
}

// Regroupe les pointages par salarié pour une plage de dates
function grouperPointages(pointages, depuis) {
  const depuisDate = new Date(depuis);
  const filtered = Object.values(pointages || {})
    .filter(p => new Date(p.timestamp) >= depuisDate)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Par jour + salarié
  const map = {};
  filtered.forEach(p => {
    const jour = p.timestamp.slice(0, 10);
    const key = `${jour}__${p.code}`;
    if (!map[key]) map[key] = { jour, code: p.code, prenom: p.prenom, nom: p.nom, chantierNom: p.chantierNom, entree: null, sortie: null };
    if (p.type !== "sortie" && !map[key].entree) map[key].entree = p.timestamp;
    if (p.type === "sortie" && !map[key].sortie) map[key].sortie = p.timestamp;
  });
  return Object.values(map).sort((a, b) => b.jour.localeCompare(a.jour) || a.nom.localeCompare(b.nom));
}

function tableauHTML(lignes, titre) {
  if (lignes.length === 0) return `<p style="color:#888">Aucun pointage sur cette période.</p>`;

  const anomalies = lignes.filter(l => l.entree && !l.sortie);

  let html = `<h2 style="color:#FF5A1F;font-family:sans-serif;margin-top:28px">${titre}</h2>`;

  if (anomalies.length > 0) {
    html += `<div style="background:#fff3cd;border-left:4px solid #FF5A1F;padding:10px 16px;margin-bottom:16px;border-radius:4px;font-family:sans-serif">
      ⚠️ <strong>${anomalies.length} anomalie${anomalies.length > 1 ? "s" : ""}</strong> — Entrée sans sortie :
      ${anomalies.map(l => `<br>• ${l.prenom} ${l.nom} (${l.code}) — ${l.chantierNom} — ${fmt(l.entree, "date")} à ${fmt(l.entree)}`).join("")}
    </div>`;
  }

  html += `<table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px">
    <thead>
      <tr style="background:#1a1a2e;color:#fff">
        <th style="padding:8px 12px;text-align:left">Date</th>
        <th style="padding:8px 12px;text-align:left">Salarié</th>
        <th style="padding:8px 12px;text-align:left">Chantier</th>
        <th style="padding:8px 12px;text-align:left">Arrivée</th>
        <th style="padding:8px 12px;text-align:left">Départ</th>
        <th style="padding:8px 12px;text-align:left">Durée</th>
        <th style="padding:8px 12px;text-align:left">Statut</th>
      </tr>
    </thead>
    <tbody>`;

  lignes.forEach((l, i) => {
    const anomalie = l.entree && !l.sortie;
    const bg = anomalie ? "#fff3cd" : i % 2 === 0 ? "#f9f9f9" : "#fff";
    const statut = anomalie ? "⚠️ Pas de départ" : l.entree && l.sortie ? "✅ Complet" : "—";
    html += `<tr style="background:${bg}">
      <td style="padding:7px 12px;border-bottom:1px solid #eee">${l.jour ? new Date(l.jour).toLocaleDateString("fr-FR") : "—"}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee;font-weight:600">${l.prenom} ${l.nom}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee">${l.chantierNom || "—"}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee;color:#16a34a">${l.entree ? fmt(l.entree) : "—"}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee;color:#2563eb">${l.sortie ? fmt(l.sortie) : "—"}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee;font-weight:600">${duree(l.entree, l.sortie)}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee">${statut}</td>
    </tr>`;
  });

  html += `</tbody></table>`;

  // Résumé heures
  const totaux = {};
  lignes.forEach(l => {
    if (!totaux[l.code]) totaux[l.code] = { prenom: l.prenom, nom: l.nom, jours: 0, minutes: 0 };
    totaux[l.code].jours++;
    if (l.entree && l.sortie) {
      const d = new Date(l.sortie) - new Date(l.entree);
      if (d > 0) totaux[l.code].minutes += Math.floor(d / 60000);
    }
  });

  html += `<h3 style="font-family:sans-serif;margin-top:20px;color:#333">Résumé par salarié</h3>
  <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px">
    <thead><tr style="background:#f0f0f0">
      <th style="padding:7px 12px;text-align:left">Salarié</th>
      <th style="padding:7px 12px;text-align:left">Jours</th>
      <th style="padding:7px 12px;text-align:left">Heures totales</th>
    </tr></thead><tbody>`;

  Object.values(totaux).sort((a, b) => a.nom.localeCompare(b.nom)).forEach((t, i) => {
    const h = Math.floor(t.minutes / 60);
    const m = t.minutes % 60;
    html += `<tr style="background:${i % 2 === 0 ? "#f9f9f9" : "#fff"}">
      <td style="padding:7px 12px;border-bottom:1px solid #eee;font-weight:600">${t.prenom} ${t.nom}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee">${t.jours}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee">${t.minutes > 0 ? `${h}h${String(m).padStart(2, "0")}` : "—"}</td>
    </tr>`;
  });

  html += `</tbody></table>`;
  return html;
}

function emailHTML(type, sections, dateLabel) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="background:#f4f4f4;padding:20px;font-family:sans-serif">
<div style="max-width:800px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <div style="background:linear-gradient(135deg,#FF5A1F,#FF7A45);padding:24px 32px">
    <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:2px">🏗️ VONERLEC</div>
    <div style="color:#ffffff99;font-size:13px;margin-top:4px">Rapport ${type} — ${dateLabel}</div>
  </div>
  <div style="padding:24px 32px">
    ${sections}
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;color:#aaa;font-size:11px">
      Rapport automatique généré par VONERLEC · ${new Date().toLocaleString("fr-FR")}
    </div>
  </div>
</div>
</body></html>`;
}

async function envoyerEmail(sujet, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Vonerlec <rapports@vonerlec.fr>",  // ← à adapter à votre domaine vérifié Resend
      to: [RAPPORT_EMAIL],
      subject: sujet,
      html
    })
  });
  return res.ok;
}

export default async function handler(req, res) {
  // Vérification du secret cron
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const type = req.query.type || "quotidien"; // quotidien | hebdomadaire | mensuel
  const now = new Date();

  try {
    const [rawP, rawC] = await Promise.all([fbGet("pointages"), fbGet("chantiers")]);
    const chantiers = Object.values(rawC || {});

    let depuis, titre, sujet, dateLabel;

    if (type === "quotidien") {
      depuis = new Date(now); depuis.setHours(0, 0, 0, 0);
      titre = "Pointages du jour";
      sujet = `📊 Vonerlec — Rapport du ${fmt(now, "date")}`;
      dateLabel = fmt(now, "date");
    } else if (type === "hebdomadaire") {
      depuis = new Date(now); depuis.setDate(depuis.getDate() - 7);
      titre = "Pointages des 7 derniers jours";
      sujet = `📊 Vonerlec — Rapport hebdomadaire`;
      dateLabel = `Semaine du ${fmt(depuis, "date")} au ${fmt(now, "date")}`;
    } else {
      depuis = new Date(now); depuis.setDate(1); depuis.setHours(0, 0, 0, 0);
      titre = `Pointages du mois de ${now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`;
      sujet = `📊 Vonerlec — Rapport mensuel ${now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`;
      dateLabel = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    }

    const lignes = grouperPointages(rawP, depuis.toISOString());
    const sections = tableauHTML(lignes, titre);
    const html = emailHTML(type, sections, dateLabel);
    const ok = await envoyerEmail(sujet, html);

    res.status(ok ? 200 : 500).json({ ok, type, lignes: lignes.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
