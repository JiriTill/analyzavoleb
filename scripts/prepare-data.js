// scripts/prepare-data.js
// Helper pro stažení a sestavení dat (PSP 2025, KZ 2024, KV 2022) → /public/data
// Bez TypeScriptu, funguje v Node 20 (má global fetch).

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { pipeline } = require("stream/promises");
const { createWriteStream } = require("fs");
const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");

const OUT_DIR = path.join("public", "data");
const TARGETS = (process.env.TARGETS || "554821:545911")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .map((item) => {
    const [obec, momc] = item.split(":");
    return { obec, momc: momc || null };
  });

async function HTTP(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

async function downloadToFile(url, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const res = await HTTP(url);
  await pipeline(res.body, createWriteStream(dest));
  return dest;
}

function unzipToDir(zipFile, outDir) {
  const zip = new AdmZip(zipFile);
  zip.extractAllTo(outDir, true);
  return outDir;
}

function listFilesDeep(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      e.isDirectory() ? walk(p) : out.push(p);
    }
  };
  walk(dir);
  return out;
}

function guessProp(obj, candidates) {
  const keys = Object.keys(obj || {});
  for (const c of candidates) {
    const hit = keys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  for (const k of keys) {
    const kl = k.toLowerCase();
    if (candidates.some((c) => kl.includes(c.toLowerCase()))) return k;
  }
  return null;
}
const asStr = (x) => (x == null ? null : String(x).trim());

function parseCsvSmart(raw) {
  const tryParse = (delim) => {
    try {
      return parse(raw, {
        delimiter: delim,
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
      });
    } catch {
      return null;
    }
  };
  // zkus ; , a tab
  return tryParse(";") || tryParse(",") || tryParse("\t");
}


function detectCsv(files, mustHaveCols) {
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".csv")) continue;
    const raw = fs.readFileSync(f, "utf8");
    const rows = parse(raw, { delimiter: ";", bom: true, columns: true, skip_empty_lines: true });
    if (!rows[0]) continue;
    const cols = Object.keys(rows[0]);
    if (mustHaveCols.every((c) => cols.includes(c))) return f;
  }
  return null;
}

// ---- čtení CSV (T4 / T4p / číselníky) ----
function readT4(csvPath) {
  const rows = parseCsvSmart(fs.readFileSync(csvPath, "utf8"));
  if (!rows || !rows[0]) throw new Error("T4: nedokážu parsovat CSV");
  const s = rows[0];
  const OBEC = guessProp(s, ["OBEC", "KOD_OBEC", "CIS_OBEC"]);
  const OKR  = guessProp(s, ["OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU"]);
  const VOL  = guessProp(s, ["VOL_SEZNAM"]);
  const VYD  = guessProp(s, ["VYD_OBALKY"]);
  const PL   = guessProp(s, ["PL_HL_CELK"]);
  if (!OBEC || !OKR || !VOL || !VYD || !PL) throw new Error("T4: hlavičky neznámé");
  return rows.map((r) => ({
    OBEC: asStr(r[OBEC]),
    OKRSEK: asStr(r[OKR]),
    registered: Number(r[VOL] || 0),
    envelopes: Number(r[VYD] || 0),
    valid: Number(r[PL] || 0),
  }));
}

function readT4p(csvPath) {
  const rows = parseCsvSmart(fs.readFileSync(csvPath, "utf8"));
  if (!rows || !rows[0]) throw new Error("T4p: nedokážu parsovat CSV");
  const s = rows[0];
  const OBEC = guessProp(s, ["OBEC", "KOD_OBEC", "CIS_OBEC"]);
  const OKR  = guessProp(s, ["OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU"]);
  const KSTR = guessProp(s, ["KSTRANA", "KOD_STRANY"]);
  const PHL  = guessProp(s, ["POC_HLASU"]);
  if (!OBEC || !OKR || !KSTR || !PHL) throw new Error("T4p: hlavičky neznámé");
  return rows.map((r) => ({
    OBEC: asStr(r[OBEC]),
    OKRSEK: asStr(r[OKR]),
    party_code: asStr(r[KSTR]),
    votes: Number(r[PHL] || 0),
  }));
}

function readCNS(zipDir) {
  const files = listFilesDeep(zipDir).filter((f) => f.toLowerCase().endsWith(".csv"));
  // upřednostni soubor s „stran“ v názvu, pokud je
  const ordered = files.sort((a,b) => {
    const pa = path.basename(a).toLowerCase();
    const pb = path.basename(b).toLowerCase();
    const wa = pa.includes("stran") ? 0 : 1;
    const wb = pb.includes("stran") ? 0 : 1;
    return wa - wb;
  });
  for (const f of ordered) {
    const rows = parseCsvSmart(fs.readFileSync(f, "utf8"));
    if (!rows || !rows[0]) continue;
    const s = rows[0];
    const KSTR = guessProp(s, ["KSTRANA", "KOD_STRANY", "KOD_SUBJEKTU", "KODSTRANA"]);
    const NAME = guessProp(s, ["NAZ_STRANA", "NAZEV_STRANA", "NAZEV_SUBJEKTU", "NAZEV"]);
    if (KSTR && NAME) {
      const map = {};
      for (const r of rows) {
        const k = asStr(r[KSTR]);
        const v = asStr(r[NAME]);
        if (k && v) map[k] = v;
      }
      if (Object.keys(map).length) return map;
    }
  }
  return {};
}

// ---- HTML → linky ----
async function fetchHtml(url) {
  return await (await HTTP(url)).text();
}
function extractHref(html, labelRegex) {
  const aTagRegex = /<a\s+href=\"([^\"]+)\"[^>]*>([^<]+)<\/a>/gi;
  const matches = [...html.matchAll(aTagRegex)];
  for (const m of matches) {
    const href = m[1];
    const text = m[2];
    if (labelRegex.test(text)) {
      return href.startsWith("http") ? href : new URL(href, "https://www.volby.cz").toString();
    }
  }
  return null;
}

async function resolvePSP2025() {
  // Odkazy dle oficiální stránky ČSÚ (CSV/CSVW zipy) – stav k 05.10.2025
  const dataZip = "https://www.volby.cz/opendata/ps2025/PS2025data20251005_csv.zip";
  const cnsZip  = "https://www.volby.cz/opendata/ps2025/PS2025ciselniky20251005_csv.zip";
  const okrskyUrl = process.env.OKRSKY_2025_GEOJSON_URL || null; // to necháme ze secreta

  if (!okrskyUrl) {
    console.warn("[PSP2025] Chybí OKRSKY_2025_GEOJSON_URL (GeoJSON hranice okrsků).");
  }
  return { dataZip, cnsZip, okrskyUrl };
}
async function resolveKZ2024() {
  const html = await fetchHtml("https://www.volby.cz/opendata/kz2024/kz2024_opendata.htm");
  const dataZip = extractHref(html, /Okrskov.*CSV|CSV \(CSVW\)/i);
  const cnsZip = extractHref(html, /Číselníky.*CSV/i);
  const okrskyUrl =
    extractHref(html, /GeoJson/i) || "https://www.volby.cz/opendata/kz2024/geo/vol_okrsky_2024g100.geojson";
  return { dataZip, cnsZip, okrskyUrl };
}
async function resolveKV2022() {
  const html = await fetchHtml("https://www.volby.cz/opendata/kv2022/kv2022_opendata.htm");
  const dataZip = extractHref(html, /Okrskov.*CSV|CSV \(CSVW\)/i);
  const cnsZip = extractHref(html, /Číselníky.*CSV/i);
  const okrskyUrl =
    extractHref(html, /GeoJson/i) || "https://www.volby.cz/opendata/kv2022/geo/vol_okrsky_2022g100.geojson";
  return { dataZip, cnsZip, okrskyUrl };
}

// ---- GeoJSON práce ----
function featureVal(props, candidates, def = null) {
  const k = guessProp(props, candidates);
  return k ? asStr(props[k]) : def;
}
function filterPrecincts(geo, target) {
  const feats = (geo.features || []).filter((f) => {
    const p = f.properties || {};
    const obec = featureVal(p, ["OBEC", "KOD_OBEC", "CIS_OBEC", "obec_kod"]);
    if (obec !== target.obec) return false;
    if (!target.momc) return true;
    const momc = featureVal(p, ["MOMC", "KOD_MOMC", "CIS_MOMC", "kod_momc"]);
    return momc === target.momc;
  });
  return { ...geo, features: feats };
}
function okrSetFromGeo(geo) {
  const s = new Set();
  for (const f of geo.features || []) {
    const p = f.properties || {};
    const ok = featureVal(p, ["OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU", "okrsek", "cislo_okrsku"]);
    if (ok) s.add(String(ok));
  }
  return s;
}

function loadManualMandates(tag) {
  const f = path.join("manual", `mandates_${tag}.json`);
  if (fs.existsSync(f)) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      if (Array.isArray(j.parties)) return j.parties.map(String);
    } catch {}
  }
  return null;
}

function buildResults(t4, t4p, cns, okrSet, allowedNames) {
  const t4Map = new Map();
  for (const r of t4) {
    if (!okrSet.has(r.OKRSEK)) continue;
    t4Map.set(r.OKRSEK, r);
  }
  const partiesBy = {};
  for (const row of t4p) {
    if (!okrSet.has(row.OKRSEK)) continue;
    const name = cns[row.party_code] || row.party_code;
    (partiesBy[row.OKRSEK] ||= []).push({ code: row.party_code, name, votes: row.votes });
  }
  const out = {};
  for (const [okr, r] of t4Map.entries()) {
    let parties = (partiesBy[okr] || []).sort((a, b) => b.votes - a.votes);
    if (allowedNames) {
      const low = allowedNames.map((x) => x.toLowerCase());
      parties = parties.filter((p) => low.some((a) => (p.name || "").toLowerCase().includes(a)));
    }
    out[okr] = {
      registered: r.registered,
      turnout_pct: r.registered ? +(100 * (r.envelopes / r.registered)).toFixed(2) : 0,
      valid: r.valid,
      parties,
    };
  }
  return out;
}

async function processElection(tag, links) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${tag}-`));

  if (!links.dataZip || !links.cnsZip) throw new Error(`${tag}: chybí zipy dat/číselníků`);
  const dataZip = await downloadToFile(links.dataZip, path.join(tmp, `${tag}_data.zip`));
  const cnsZip = await downloadToFile(links.cnsZip, path.join(tmp, `${tag}_cns.zip`));
  if (!links.okrskyUrl) throw new Error(`${tag}: chybí URL na GeoJSON okrsků`);
  const okrGeoPath = await downloadToFile(links.okrskyUrl, path.join(tmp, `${tag}_okrsky.geojson`));

  const dataDir = unzipToDir(dataZip, path.join(tmp, "data"));
  const cnsDir = unzipToDir(cnsZip, path.join(tmp, "cns"));
  const files = listFilesDeep(dataDir);

  const t4File =
    detectCsv(files, ["OBEC", "OKRSEK", "VOL_SEZNAM", "VYD_OBALKY", "PL_HL_CELK"]) ||
    files.find((f) => f.toLowerCase().includes("t4") && f.toLowerCase().endsWith(".csv"));
  const t4pFile =
    detectCsv(files, ["OBEC", "OKRSEK", "KSTRANA", "POC_HLASU"]) ||
    files.find((f) => f.toLowerCase().includes("t4p") && f.toLowerCase().endsWith(".csv"));
  if (!t4File || !t4pFile) throw new Error(`${tag}: nenašel jsem T4/T4p`);

  const t4 = readT4(t4File);
  const t4p = readT4p(t4pFile);
  const cns = readCNS(cnsDir);

  const fullGeo = JSON.parse(fs.readFileSync(okrGeoPath, "utf8"));
  const manualMandates = loadManualMandates(tag);

  for (const target of TARGETS) {
    const geoFiltered = filterPrecincts(fullGeo, target);
    const okrSet = okrSetFromGeo(geoFiltered);
    const okrResults = buildResults(t4, t4p, cns, okrSet, manualMandates);

    await fsp.mkdir(OUT_DIR, { recursive: true });
    const suffix = target.momc ? `${target.obec}_${target.momc}` : `${target.obec}`;
    fs.writeFileSync(path.join(OUT_DIR, `precincts_${tag}_${suffix}.geojson`), JSON.stringify(geoFiltered));
    fs.writeFileSync(
      path.join(OUT_DIR, `results_${tag}_${suffix}.json`),
      JSON.stringify({
        meta: { election: tag, target, generated: new Date().toISOString(), source: "volby.cz/ČSÚ" },
        okrsky: okrResults,
      })
    );
  }
}

(async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });

  const psp = await resolvePSP2025();
  await processElection("psp2025", psp);

  const kz = await resolveKZ2024();
  await processElection("kz2024", kz);

  const kv = await resolveKV2022();
  await processElection("kv2022", kv);

  console.log(`✔ Hotovo. Výstupy v ${OUT_DIR}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
