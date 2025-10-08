// scripts/prepare-data.js
// Připraví okrsková data (PSP 2025, KZ 2024, KV 2022) do /public/data.
// Preferuje zdroje v /manual, jinak stáhne z volby.cz (GeoJSON 2025 z OKRSKY_2025_GEOJSON_URL).
// Node 20+ (global fetch).

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { pipeline } = require("stream/promises");
const { createWriteStream } = require("fs");
const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");

// ---------- Konfigurace ----------
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

// ---------- Pomocné funkce ----------
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

const asStr = (x) => (x == null ? null : String(x).trim());
const cleanId = (x) => (x == null ? null : String(x).trim().replace(/^0+/, ""));

// odebrání diakritiky pro robustní porovnávání hlaviček
function canon(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s._-]+/g, "");
}

function guessKey(obj, candidatesCanon) {
  const keys = Object.keys(obj || {});
  const canonMap = new Map(keys.map((k) => [canon(k), k]));
  for (const c of candidatesCanon) {
    const hit = canonMap.get(c);
    if (hit) return hit;
  }
  // fallback: substring match
  for (const [ck, orig] of canonMap.entries()) {
    if (candidatesCanon.some((c) => ck.includes(c))) return orig;
  }
  return null;
}

// chytrý CSV parser – zkus ; , \t, povol uvozovky/BOM
function parseCsvSmart(raw) {
  const tryParse = (delim) => {
    try {
      return parse(raw, {
        delimiter: delim,
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true
      });
    } catch {
      return null;
    }
  };
  return tryParse(";") || tryParse(",") || tryParse("\t");
}

// ---------- Čtení CSV (T4 / T4p / číselníky) ----------
function readT4(csvPath) {
  const rows = parseCsvSmart(fs.readFileSync(csvPath, "utf8"));
  if (!rows || !rows[0]) throw new Error("T4: nedokážu parsovat CSV");

  // kanonické názvy (bez diakritiky)
  const K_OBEC = ["obec", "kodobec", "cisobec"];
  const K_OKR = ["okrsek", "cisokrsek", "cislookrsku"];
  const K_REG = ["volseznam", "volicivseznamu", "zapsvol", "zapsanivolici"];
  const K_ISS = ["vydobalky", "vydaneobalky"];
  const K_RET = ["odevzobalky", "odevzdaneobalky"];
  const K_VALID = ["plhlcelk", "platnehlasy", "plhlcelkem"];

  const s = rows[0];
  const OBEC = guessKey(s, K_OBEC);
  const OKR = guessKey(s, K_OKR);
  const REG = guessKey(s, K_REG);
  const ISS = guessKey(s, K_ISS);
  const RET = guessKey(s, K_RET);
  const VAL = guessKey(s, K_VALID);

  if (!OBEC || !OKR || !REG || !RET || !VAL) {
    const have = Object.keys(s).join(", ");
    throw new Error(
      `T4: chybí očekávané sloupce (mám: ${have}). Nutné: OBEC, OKRSEK, VOL_SEZNAM/ZAPSANI..., ODEVZ_OBALKY, PL_HL_CELK`
    );
  }

  return rows.map((r) => ({
    OBEC: cleanId(r[OBEC]),
    OKRSEK: cleanId(r[OKR]),
    registered: +asStr(r[REG]) || 0,
    issued: ISS ? +asStr(r[ISS]) || 0 : 0, // jen pro informaci
    returned: +asStr(r[RET]) || 0,
    valid: +asStr(r[VAL]) || 0
  }));
}

function readT4p(csvPath) {
  const rows = parseCsvSmart(fs.readFileSync(csvPath, "utf8"));
  if (!rows || !rows[0]) throw new Error("T4p: nedokážu parsovat CSV");

  const K_OBEC = ["obec", "kodobec", "cisobec"];
  const K_OKR = ["okrsek", "cisokrsek", "cislookrsku"];
  const K_PART = ["kstrana", "kodstrany", "kodsubjektu", "kodstrana"];
  const K_VOTES = ["pochlasu", "pocthlas", "hlasy", "pocethlasu"];

  const s = rows[0];
  const OBEC = guessKey(s, K_OBEC);
  const OKR = guessKey(s, K_OKR);
  const PART = guessKey(s, K_PART);
  const VOTES = guessKey(s, K_VOTES);

  if (!OBEC || !OKR || !PART || !VOTES) {
    const have = Object.keys(s).join(", ");
    throw new Error(
      `T4p: chybí očekávané sloupce (mám: ${have}). Nutné: OBEC, OKRSEK, KSTRANA/KOD_..., POC_HLASU/HLASY`
    );
  }

  return rows.map((r) => ({
    OBEC: cleanId(r[OBEC]),
    OKRSEK: cleanId(r[OKR]),
    party_code: asStr(r[PART]),
    votes: +asStr(r[VOTES]) || 0
  }));
}

function readCNS(zipDir) {
  const files = listFilesDeep(zipDir).filter((f) => f.toLowerCase().endsWith(".csv"));
  // preferuj soubory „stran/strany/subjekt…“
  const ordered = files.sort((a, b) => {
    const pa = path.basename(a).toLowerCase();
    const pb = path.basename(b).toLowerCase();
    const wa = /stran|strany|subjekt/.test(pa) ? 0 : 1;
    const wb = /stran|strany|subjekt/.test(pb) ? 0 : 1;
    return wa - wb;
  });
  for (const f of ordered) {
    const rows = parseCsvSmart(fs.readFileSync(f, "utf8"));
    if (!rows || !rows[0]) continue;
    const s = rows[0];
    const K_PART = guessKey(s, ["kstrana", "kodstrany", "kodsubjektu", "kodstrana"]);
    const K_NAME = guessKey(s, ["nazstrana", "nazevstrana", "nazevsubjektu", "nazev"]);
    if (K_PART && K_NAME) {
      const map = {};
      for (const r of rows) {
        const k = asStr(r[K_PART]);
        const v = asStr(r[K_NAME]);
        if (k && v) map[k] = v;
      }
      if (Object.keys(map).length) return map;
    }
  }
  return {};
}

// ---------- GEOMETRIE / GeoJSON ----------
function featureVal(props, candidates, def = null) {
  const k = guessKey(props, candidates.map(canon));
  if (!k) return def;
  return asStr(props[k]);
}

function filterPrecincts(geo, target) {
  const feats = (geo.features || []).filter((f) => {
    const p = f.properties || {};
    const obec = featureVal(p, ["obec", "kodobec", "cisobec", "obec_kod"]);
    if (cleanId(obec) !== cleanId(target.obec)) return false;
    if (!target.momc) return true;
    const momc = featureVal(p, ["momc", "kodmomc", "cismomc", "momc_kod"]);
    return cleanId(momc) === cleanId(target.momc);
  });
  return { ...geo, features: feats };
}

function okrSetFromGeo(geo) {
  const s = new Set();
  for (const f of geo.features || []) {
    const p = f.properties || {};
    const ok = featureVal(p, [
      "okrsek",
      "cisokrsek",
      "cislookrsku",
      "cislo_okrsku",
      "okrsek_cislo"
    ]);
    if (ok != null) s.add(cleanId(ok));
  }
  return s;
}

// ---------- Lokální zdroje v /manual ----------
function findManual(tag, kind /* 'data' | 'cns' | 'geo' */) {
  if (!fs.existsSync(MANUAL_DIR)) return null;
  const all = listFilesDeep(MANUAL_DIR).map((p) => [p, path.basename(p)]);
  const reTag = new RegExp(tag, "i");
  const reKind =
    kind === "data"
      ? /(data|okrsk|t4|csvw)\.zip$/i
      : kind === "cns"
      ? /(cisel|čísel|cns)\.zip$/i
      : /\.(geojson)$/i;
  const hit = all.find(([full, base]) => reTag.test(base) && reKind.test(base));
  return hit ? hit[0] : null;
}

// ---------- Rezolvery zdrojů ----------
async function resolvePSP2025() {
  // 1) lokální
  const dataLocal = findManual("psp2025", "data");
  const cnsLocal = findManual("psp2025", "cns");
  const geoLocal = findManual("psp2025", "geo");

  // 2) fallback URL (data + ciselniky) – pevné odkazy
  const dataZipUrl = "https://www.volby.cz/opendata/ps2025/PS2025data20251005_csv.zip";
  const cnsZipUrl = "https://www.volby.cz/opendata/ps2025/PS2025ciselniky20251005_csv.zip";

  // 3) GeoJSON – z lokálu nebo z secreta
  const okrskyUrl = geoLocal
    ? `file://${path.resolve(geoLocal)}`
    : process.env.OKRSKY_2025_GEOJSON_URL || null;

  if (!okrskyUrl) {
    throw new Error(
      "[PSP2025] Chybí GeoJSON okrsků – nahraj psp2025_okrsky.geojson do /manual nebo nastav OKRSKY_2025_GEOJSON_URL."
    );
  }

  return {
    dataZipLocal: dataLocal,
    dataZipUrl,
    cnsZipLocal: cnsLocal,
    cnsZipUrl,
    okrskyUrl
  };
}

async function resolveKZ2024() {
  const dataLocal = findManual("kz2024", "data");
  const cnsLocal = findManual("kz2024", "cns");
  const geoLocal = findManual("kz2024", "geo");

  // veřejný GeoJSON (fallback)
  const geoUrl = "https://www.volby.cz/opendata/kz2024/geo/vol_okrsky_2024g100.geojson";

  return {
    dataZipLocal: dataLocal,
    dataZipUrl: null, // když není lokální, přeskočíme
    cnsZipLocal: cnsLocal,
    cnsZipUrl: null,
    okrskyUrl: geoLocal ? `file://${path.resolve(geoLocal)}` : geoUrl
  };
}

async function resolveKV2022() {
  const dataLocal = findManual("kv2022", "data");
  const cnsLocal = findManual("kv2022", "cns");
  const geoLocal = findManual("kv2022", "geo");

  const geoUrl = "https://www.volby.cz/opendata/kv2022/geo/vol_okrsky_2022g100.geojson";

  return {
    dataZipLocal: dataLocal,
    dataZipUrl: null,
    cnsZipLocal: cnsLocal,
    cnsZipUrl: null,
    okrskyUrl: geoLocal ? `file://${path.resolve(geoLocal)}` : geoUrl
  };
}

// ---------- Sestavení výstupů ----------
function buildResults(t4, t4p, cns, okrSet, allowedNames /* array|null */) {
  // map okrsek -> souhrn
  const t4Map = new Map();
  for (const r of t4) {
    if (!okrSet.has(r.OKRSEK)) continue;
    // klíč = okrsek (bez nul)
    t4Map.set(r.OKRSEK, r);
  }

  // map okrsek -> strany
  const partiesBy = {};
  for (const row of t4p) {
    if (!okrSet.has(row.OKRSEK)) continue;
    const name = cns[row.party_code] || row.party_code;
    (partiesBy[row.OKRSEK] ||= []).push({
      code: row.party_code,
      name,
      votes: row.votes
    });
  }

  const out = {};
  for (const [okr, r] of t4Map.entries()) {
    let parties = (partiesBy[okr] || []).sort((a, b) => b.votes - a.votes);
    if (allowedNames && allowedNames.length) {
      const low = allowedNames.map((x) => x.toLowerCase());
      parties = parties.filter((p) => low.some((a) => (p.name || "").toLowerCase().includes(a)));
    }
    const turnout = r.registered ? +(100 * (r.returned / r.registered)).toFixed(2) : 0;
    out[okr] = {
      registered: r.registered,
      issued: r.issued,
      returned: r.returned,
      turnout_pct: turnout,
      valid: r.valid,
      parties
    };
  }
  return out;
}

// ---------- Hlavní zpracování jedné volby ----------
async function processElection(tag, links) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${tag}-`));
  const dl = async (maybeLocal, url, name) => {
    if (maybeLocal && maybeLocal.startsWith("file://")) return maybeLocal;
    if (maybeLocal && fs.existsSync(maybeLocal)) return `file://${path.resolve(maybeLocal)}`;
    if (!url) return null;
    const dest = path.join(tmp, name);
    await downloadToFile(url, dest);
    return `file://${dest}`;
  };

  // data + číselníky (zipy)
  const dataZipUri = await dl(links.dataZipLocal, links.dataZipUrl, `${tag}_data.zip`);
  const cnsZipUri = await dl(links.cnsZipLocal, links.cnsZipUrl, `${tag}_cns.zip`);
  if (!dataZipUri || !cnsZipUri) {
    throw new Error(`${tag}: chybí zipy dat/číselníků (nahraj je do /manual jako ${tag}_* nebo doplň URL).`);
  }

  // GeoJSON
  let okrGeoUri = links.okrskyUrl;
  if (!okrGeoUri) throw new Error(`${tag}: chybí URL/ soubor s GeoJSON okrsků`);
  if (!okrGeoUri.startsWith("file://")) {
    const dest = path.join(tmp, `${tag}_okrsky.geojson`);
    await downloadToFile(okrGeoUri, dest);
    okrGeoUri = `file://${dest}`;
  }

  // unzip
  const dataDir = unzipToDir(new URL(dataZipUri).pathname, path.join(tmp, "data"));
  const cnsDir = unzipToDir(new URL(cnsZipUri).pathname, path.join(tmp, "cns"));

  // najdi T4/T4p podle hlaviček
  const files = listFilesDeep(dataDir).filter((f) => f.toLowerCase().endsWith(".csv"));
  let t4File = null;
  let t4pFile = null;
  for (const f of files) {
    const rows = parseCsvSmart(fs.readFileSync(f, "utf8"));
    if (!rows || !rows[0]) continue;
    const colsC = Object.keys(rows[0]).map(canon);
    const hasOkr = colsC.includes("okrsek") || colsC.includes("cisokrsek") || colsC.includes("cislookrsku");
    const hasObec = colsC.includes("obec") || colsC.includes("kodobec") || colsC.includes("cisobec");
    const hasVotes = colsC.includes("pochlasu") || colsC.includes("pocthlas") || colsC.includes("hlasy") || colsC.includes("pocethlasu");
    const hasReturned = colsC.includes("odevzobalky") || colsC.includes("odevzdaneobalky");
    const hasValid = colsC.includes("plhlcelk") || colsC.includes("platnehlasy");
    if (hasOkr && hasObec && hasVotes && !t4pFile) t4pFile = f;
    if (hasOkr && hasObec && hasReturned && hasValid && !t4File) t4File = f;
  }
  if (!t4File || !t4pFile) throw new Error(`${tag}: nenašel jsem T4/T4p v CSV (zkontroluj obsah ZIPu)`);

  const t4 = readT4(t4File);
  const t4p = readT4p(t4pFile);
  const cns = readCNS(cnsDir);

  // GeoJSON načíst + filtrovat
  const fullGeo = JSON.parse(fs.readFileSync(new URL(okrGeoUri), "utf8"));

  // případné lokální omezení na vybrané subjekty (mandates_<tag>.json)
  const manFile = path.join("manual", `mandates_${tag}.json`);
  let manualMandates = null;
  if (fs.existsSync(manFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(manFile, "utf8"));
      if (Array.isArray(j.parties)) manualMandates = j.parties.map(String);
    } catch {}
  }

  // pro každý TARGET (OBEC[:MOMC]) připravit výstupy
  for (const target of TARGETS) {
    let geoFiltered = filterPrecincts(fullGeo, target);
    if (!geoFiltered.features || geoFiltered.features.length === 0) {
      console.warn(`[${tag}] Varování: po filtrování zbylo 0 polygonů pro ${target.obec}:${target.momc}. Použiju celý GeoJSON (dočasný fallback).`);
      geoFiltered = fullGeo;
    }
    const okrSet = okrSetFromGeo(geoFiltered);
    const okrResults = buildResults(t4, t4p, cns, okrSet, manualMandates);

    await fsp.mkdir(OUT_DIR, { recursive: true });
    const suffix = target.momc ? `${target.obec}_${target.momc}` : `${target.obec}`;
    fs.writeFileSync(path.join(OUT_DIR, `precincts_${tag}_${suffix}.geojson`), JSON.stringify(geoFiltered));
    fs.writeFileSync(
      path.join(OUT_DIR, `results_${tag}_${suffix}.json`),
      JSON.stringify({
        meta: {
          election: tag,
          target,
          generated: new Date().toISOString(),
          source: "volby.cz (+ lokální /manual, pokud přítomné)",
          turnout_formula: "odevzdané_obálky / voliči_v_seznamu * 100"
        },
        okrsky: okrResults
      })
    );
  }
}

// ---------- Main ----------
(async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });

  // PSP 2025
  const psp = await resolvePSP2025();
  await processElection("psp2025", psp);

  // KZ 2024 – pokud nemáme lokální ZIPy, přeskočíme (ať build nepadá)
  try {
    const kz = await resolveKZ2024();
    if (!kz.dataZipLocal || !kz.cnsZipLocal) {
      console.warn("[KZ2024] Nenašel jsem lokální ZIPy v /manual – přeskočeno.");
    } else {
      await processElection("kz2024", kz);
    }
  } catch (e) {
    console.warn("[KZ2024] přeskočeno:", e.message || e);
  }

  // KV 2022 – dtto
  try {
    const kv = await resolveKV2022();
    if (!kv.dataZipLocal || !kv.cnsZipLocal) {
      console.warn("[KV2022] Nenašel jsem lokální ZIPy v /manual – přeskočeno.");
    } else {
      await processElection("kv2022", kv);
    }
  } catch (e) {
    console.warn("[KV2022] přeskočeno:", e.message || e);
  }

  console.log(`✔ Hotovo. Výstupy v ${OUT_DIR}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
