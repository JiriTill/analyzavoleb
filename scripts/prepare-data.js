// scripts/prepare-data.js
// Čte LOKÁLNÍ zipy v /manual (LFS!) a vyrábí /public/data/results_*.json pro PSP 2025, KZ 2024, KV 2022

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { pipeline } = require("stream/promises");
const { createWriteStream } = require("fs");
const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");

const OUT_DIR = path.join("public", "data");
const MANUAL_DIR = path.join("manual");

// TARGETS = "OBEC[:MOMC],OBEC2[:MOMC2],..."
const TARGETS = (process.env.TARGETS || "554821:545911")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .map((item) => {
    const [obec, momc] = item.split(":");
    return { obec, momc: momc || null };
  });

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
  return tryParse(";") || tryParse(",") || tryParse("\t");
}

function guess(obj, candidates) {
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

// --- LFS guard + ZIP čtečka ---
function isLikelyLfsPointer(filePath) {
  try {
    const head = fs.readFileSync(filePath, { encoding: "utf8", flag: "r" }).slice(0, 200);
    return head.includes("git-lfs.github.com/spec/v1");
  } catch {
    return false;
  }
}

function listCsvFilesInZip(zipPath) {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Soubor ${zipPath} neexistuje.`);
  }
  const stat = fs.statSync(zipPath);
  if (stat.size < 256) {
    throw new Error(`Soubor ${zipPath} je podezřele malý (${stat.size} B). Pravděpodobně je to LFS pointer – v Actions je nutné checkoutnout s lfs: true.`);
  }
  if (isLikelyLfsPointer(zipPath)) {
    throw new Error(`Soubor ${zipPath} je LFS pointer. V .github/workflows/… nastav 'actions/checkout@v4' s 'lfs: true'.`);
  }

  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (e) {
    throw new Error(`ADM-ZIP neumí otevřít ${zipPath} – ${e.message}`);
  }

  const entries = zip.getEntries();
  const csvs = entries
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".csv"))
    .map((e) => ({ name: e.entryName, text: zip.readAsText(e) }));

  if (!csvs.length) {
    throw new Error(`V ZIPu ${zipPath} nebyly nalezeny žádné .csv soubory.`);
  }
  return csvs;
}

function listManualZips() {
  if (!fs.existsSync(MANUAL_DIR)) return [];
  return fs.readdirSync(MANUAL_DIR).filter((f) => f.toLowerCase().endsWith(".zip"));
}

// vrátí první ZIP, jehož název obsahuje všechny "tokens"
function findManualZip(tokens) {
  const all = listManualZips();
  const want = tokens.map((t) => t.toLowerCase());
  const hit = all.find((f) => want.every((t) => f.toLowerCase().includes(t)));
  if (!hit) {
    console.error(`[manual] Dostupné ZIPy v /manual:\n - ${all.join("\n - ") || "(nic)"}\nHledal jsem: ${tokens.join(" + ")}`);
    return null;
  }
  const full = path.join(MANUAL_DIR, hit);
  console.log(`[manual] Vybrán ZIP: ${full}`);
  return full;
}

// --- GeoJSON helpers ---
function featureVal(props, candidates, def = null) {
  const k = guess(props, candidates);
  return k ? asStr(props[k]) : def;
}

function filterPrecincts(geo, target) {
  const feats = (geo.features || []).filter((f) => {
    const p = f.properties || {};
    const obec = featureVal(p, ["OBEC", "KOD_OBEC", "CIS_OBEC", "obec_kod", "obec_kód"]);
    if (obec !== target.obec) return false;
    if (!target.momc) return true;
    const momc = featureVal(p, ["MOMC", "KOD_MOMC", "CIS_MOMC", "kod_momc", "momc_kod"]);
    return momc === target.momc;
  });
  return { type: "FeatureCollection", features: feats };
}

function okrSetFromGeo(geo) {
  const s = new Set();
  for (const f of geo.features || []) {
    const p = f.properties || {};
    const ok = featureVal(p, [
      "OKRSEK",
      "CIS_OKRSEK",
      "CISLO_OKRSKU",
      "cislo_okrsku",
      "okrsek",
      "okrsek_cislo",
      "cislo_okrsku_text",
    ]);
    if (ok) s.add(String(ok));
  }
  return s;
}

// --- CSV čtení ---
function readT4(rows) {
  if (!rows || !rows[0]) throw new Error("T4: prázdné CSV");
  const s = rows[0];
  const OBEC = guess(s, ["OBEC", "KOD_OBEC", "CIS_OBEC", "KOD_OBCE"]);
  const OKR = guess(s, ["OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU"]);
  const REG = guess(s, ["VOL_SEZNAM", "ZAPSANI_VOLICI"]);
  const ODEV = guess(s, ["ODEVZ_OBAL", "ODEVZDANE_OBALKY"]);
  const VALID = guess(s, ["PL_HL_CELK", "PLATNE_HLASY"]);
  if (!OBEC || !OKR || !REG || !ODEV || !VALID) {
    throw new Error(
      `T4: chybí očekávané sloupce (mám: ${Object.keys(s).join(", ")}). Nutné: OBEC, OKRSEK, VOL_SEZNAM/ZAPSANI_VOLICI, ODEVZ_OBAL/ODEVZDANE_OBALKY, PL_HL_CELK/PLATNE_HLASY`
    );
  }
  return rows.map((r) => ({
    OBEC: asStr(r[OBEC]),
    OKRSEK: asStr(r[OKR]),
    registered: +r[REG] || 0,
    returned: +r[ODEV] || 0, // účast správně z odevzdaných obálek
    valid: +r[VALID] || 0,
  }));
}

function readT4p(rows) {
  if (!rows || !rows[0]) throw new Error("T4p: prázdné CSV");
  const s = rows[0];
  const OBEC = guess(s, ["OBEC", "KOD_OBEC", "CIS_OBEC", "KOD_OBCE"]);
  const OKR = guess(s, ["OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU"]);
  const KSTR = guess(s, ["KSTRANA", "KOD_STRANY", "KOD_SUBJEKTU", "KODSTRANA"]);
  const PHL = guess(s, ["POC_HLASU", "HLASY"]);
  if (!OBEC || !OKR || !KSTR || !PHL) {
    throw new Error(`T4p: chybí očekávané sloupce (mám: ${Object.keys(s).join(", ")})`);
  }
  return rows.map((r) => ({
    OBEC: asStr(r[OBEC]),
    OKRSEK: asStr(r[OKR]),
    party_code: asStr(r[KSTR]),
    votes: +r[PHL] || 0,
  }));
}

function readCiselniky(csvFiles) {
  for (const f of csvFiles) {
    const rows = parseCsvSmart(f.text);
    if (!rows || !rows[0]) continue;
    const s = rows[0];
    const KSTR = guess(s, ["KSTRANA", "KOD_STRANY", "KOD_SUBJEKTU", "KODSTRANA"]);
    const NAME = guess(s, ["NAZ_STRANA", "NAZEV_STRANA", "NAZEV_SUBJEKTU", "NAZEV"]);
    if (!KSTR || !NAME) continue;
    const map = {};
    for (const r of rows) {
      const k = asStr(r[KSTR]);
      const v = asStr(r[NAME]);
      if (k && v) map[k] = v;
    }
    if (Object.keys(map).length) return map;
  }
  return {};
}

function buildResults(t4, t4p, cns, okrSet, allowedNames = null) {
  const t4ByOkr = new Map();
  for (const r of t4) {
    if (!okrSet.has(r.OKRSEK)) continue;
    t4ByOkr.set(r.OKRSEK, r);
  }
  const partiesByOkr = {};
  for (const r of t4p) {
    if (!okrSet.has(r.OKRSEK)) continue;
    const name = cns[r.party_code] || r.party_code;
    (partiesByOkr[r.OKRSEK] ||= []).push({ code: r.party_code, name, votes: r.votes });
  }

  const out = {};
  for (const [okr, r] of t4ByOkr.entries()) {
    let parties = (partiesByOkr[okr] || []).sort((a, b) => b.votes - a.votes);
    if (allowedNames && allowedNames.length) {
      const low = allowedNames.map((x) => x.toLowerCase());
      parties = parties.filter((p) => low.some((a) => (p.name || "").toLowerCase().includes(a)));
    }
    out[okr] = {
      registered: r.registered,
      valid: r.valid,
      turnout_pct: r.registered ? +((100 * r.returned) / r.registered).toFixed(2) : 0,
      parties,
    };
  }
  return out;
}

async function processElection(tag, manualTokensData, manualTokensCns, okrskyGeoUrl) {
  const dataZip = findManualZip(manualTokensData);
  const cnsZip = findManualZip(manualTokensCns);
  if (!dataZip || !cnsZip) {
    throw new Error(`${tag}: v /manual chybí zipy dat/číselníků (hledal jsem: ${manualTokensData.join("+")} / ${manualTokensCns.join("+")})`);
  }

  const csvDataFiles = listCsvFilesInZip(dataZip);
  const csvCnsFiles = listCsvFilesInZip(cnsZip);

  // detekce T4/T4p podle hlaviček
  let bestT4 = null, bestT4p = null, bestScoreT4 = -1, bestScoreT4p = -1;
  for (const f of csvDataFiles) {
    const rows = parseCsvSmart(f.text);
    if (!rows || !rows[0]) continue;
    const cols = Object.keys(rows[0]).map((c) => c.toLowerCase());
    const scoreT4 = ["okrsek", "vol_seznam", "zaps", "odevz", "plat"].filter((k) => cols.some((c) => c.includes(k))).length;
    const scoreT4p = ["okrsek", "kstr", "kod", "poc_hlasu", "hlasy"].filter((k) => cols.some((c) => c.includes(k))).length;
    if (scoreT4 > bestScoreT4) { bestScoreT4 = scoreT4; bestT4 = rows; }
    if (scoreT4p > bestScoreT4p) { bestScoreT4p = scoreT4p; bestT4p = rows; }
  }
  if (!bestT4 || !bestT4p) {
    console.error("[detekce] CSV v datovém ZIPu:");
    for (const f of csvDataFiles) {
      const rows = parseCsvSmart(f.text) || [];
      console.error(` - ${f.name} :: [${rows[0] ? Object.keys(rows[0]).join(", ") : "prázdné"}]`);
    }
    throw new Error(`${tag}: nenašel jsem T4/T4p v CSV (zkontroluj obsah ZIPu)`);
  }

  const t4 = readT4(bestT4);
  const t4p = readT4p(bestT4p);
  const cns = readCiselniky(csvCnsFiles);

  if (!okrskyGeoUrl) throw new Error(`${tag}: chybí URL na GeoJSON okrsků (OKRSKY_2025_GEOJSON_URL)`);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${tag}-`));
  const geoPath = path.join(tmp, `${tag}_okrsky.geojson`);
  await pipeline((await fetch(okrskyGeoUrl)).body, createWriteStream(geoPath));
  const fullGeo = JSON.parse(fs.readFileSync(geoPath, "utf8"));

  await fsp.mkdir(OUT_DIR, { recursive: true });

  for (const target of TARGETS) {
    let geoFiltered = filterPrecincts(fullGeo, target);
    if (!geoFiltered.features || geoFiltered.features.length === 0) {
      console.warn(`[${tag}] Po filtrování 0 polygonů pro ${target.obec}:${target.momc} – použiji nefiltrovaný GeoJSON (jen pro ID set).`);
      geoFiltered = fullGeo;
    }
    const okrSet = okrSetFromGeo(geoFiltered);
    const okrResults = buildResults(t4, t4p, cns, okrSet, null);

    const suffix = target.momc ? `${target.obec}_${target.momc}` : `${target.obec}`;
    fs.writeFileSync(
      path.join(OUT_DIR, `results_${tag}_${suffix}.json`),
      JSON.stringify({
        meta: { election: tag, target, generated: new Date().toISOString(), source: "volby.cz (CSV + ciselniky)" },
        okrsky: okrResults,
      })
    );
    console.log(`[OK] /public/data/results_${tag}_${suffix}.json`);
  }
}

(async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });

  const okrsky2025 = process.env.OKRSKY_2025_GEOJSON_URL || null;

  await processElection("psp2025", ["ps2025", "data", "csv"], ["ps2025", "cisel", "csv"], okrsky2025);
  await processElection("kz2024", ["kz2024", "data", "csv"], ["kz2024", "cisel", "csv"], okrsky2025);
  await processElection("kv2022", ["kv2022", "data", "csv"], ["kv2022", "cisel", "csv"], okrsky2025);

  console.log(`✔ Hotovo. Výstupy v ${OUT_DIR}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
