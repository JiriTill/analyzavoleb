// scripts/prepare-data.js
// Stáhne/přečte okrsková data (PSP 2025, KZ 2024, KV 2022), vyrobí /public/data/*
// Node 20 (global fetch). Robustní výběr T4/T4p + jednotné mapování sloupců.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { pipeline } = require("stream/promises");
const { createWriteStream, createReadStream } = require("fs");
const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");

const OUT_DIR = path.join("public", "data");

// TARGETS = "OBEC[:MOMC],OBEC2[:MOMC2],..."
const TARGETS = (process.env.TARGETS || "554821:545911")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .map((item) => {
    const [obec, momc] = item.split(":");
    return { obec, momc: momc || null };
  });

/* -------------------- utils -------------------- */
async function HTTP(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

async function materializeToFile(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (src.startsWith("file://")) {
    await pipeline(createReadStream(src.replace("file://", "")), createWriteStream(dest));
    return dest;
  }
  const res = await HTTP(src);
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

function guessKey(obj, candidates) {
  const keys = Object.keys(obj || {});
  // přesná shoda (case-insensitive)
  for (const c of candidates) {
    const hit = keys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  // substring shoda – např. „odevzdane_obalky“ vs „odevz_obalky“
  for (const k of keys) {
    const kl = k.toLowerCase();
    if (candidates.some((c) => kl.includes(c.toLowerCase()))) return k;
  }
  return null;
}

function preferFile(files, includeRe, excludeRe = null) {
  const match = files.find((f) => includeRe.test(path.basename(f)) && (!excludeRe || !excludeRe.test(path.basename(f))));
  return match || null;
}

/* -------------------- detekce CSV -------------------- */
function detectT4(files) {
  // 1) preferuj názvy s "t4" ale ne "t4p"
  const pref = preferFile(files, /t4/i, /t4p/i);
  if (pref) return pref;
  // 2) podle hlaviček
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".csv")) continue;
    const rows = parseCsvSmart(fs.readFileSync(f, "utf8"));
    if (!rows || !rows[0]) continue;
    const s = rows[0];
    const okr = guessKey(s, ["okrsek", "cis_okrsek", "cislo_okrsku"]);
    const reg = guessKey(s, ["zapsani_volici", "volici_v_seznamu", "vol_seznam"]);
    const ret = guessKey(s, ["odevzdane_obalky", "odevz_obalky"]);
    const val = guessKey(s, ["platne_hlasy", "pl_hl_celk"]);
    if (okr && reg && ret && val) return f;
  }
  return null;
}

function detectT4p(files) {
  // 1) preferuj názvy s "t4p"
  const pref = preferFile(files, /t4p/i);
  if (pref) return pref;
  // 2) podle hlaviček
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".csv")) continue;
    const rows = parseCsvSmart(fs.readFileSync(f, "utf8"));
    if (!rows || !rows[0]) continue;
    const s = rows[0];
    const okr = guessKey(s, ["okrsek", "cis_okrsek", "cislo_okrsku"]);
    const kstr = guessKey(s, ["kstrana", "kod_strany", "kod_subjektu", "kodstrana"]);
    const phl = guessKey(s, ["poc_hlasu", "hlasy"]);
    if (okr && kstr && phl) return f;
  }
  return null;
}

function readT4(csvPath, targetObec) {
  const rows = parseCsvSmart(fs.readFileSync(csvPath, "utf8"));
  if (!rows || !rows[0]) throw new Error("T4: nedokážu parsovat CSV");

  const s = rows[0];
  const OKR = guessKey(s, ["okrsek", "cis_okrsek", "cislo_okrsku"]);
  const REG = guessKey(s, ["zapsani_volici", "volici_v_seznamu", "vol_seznam", "zapsani_volici_v_seznamu"]);
  const ISS = guessKey(s, ["vydane_obalky", "vyd_obalky"]);
  const RET = guessKey(s, ["odevzdane_obalky", "odevz_obalky"]);
  const VAL = guessKey(s, ["platne_hlasy", "pl_hl_celk"]);
  const OBC = guessKey(s, ["kod_obec", "cis_obec", "obec_prez", "obec_kod"]);

  if (!OKR || !REG || !RET || !VAL) throw new Error("T4: chybí očekávané sloupce");

  const out = [];
  for (const r of rows) {
    const obecCodeRaw = OBC ? asStr(r[OBC]) : null;
    const obecCode = obecCodeRaw && /^\d+$/.test(obecCodeRaw) ? obecCodeRaw : null;
    if (targetObec && obecCode && obecCode !== String(targetObec)) continue; // drž se jen naší obce

    const okr = asStr(r[OKR]);
    if (!okr) continue;

    const registered = Number(String(r[REG]).replace(/\s/g, "").replace(",", ".")) || 0;
    const issued = ISS ? Number(String(r[ISS]).replace(/\s/g, "").replace(",", ".")) || 0 : 0;
    const returned = Number(String(r[RET]).replace(/\s/g, "").replace(",", ".")) || 0;
    const valid = Number(String(r[VAL]).replace(/\s/g, "").replace(",", ".")) || 0;

    out.push({ OKRSEK: okr, registered, issued, returned, valid });
  }
  return out;
}

function readT4p(csvPath, targetObec) {
  const rows = parseCsvSmart(fs.readFileSync(csvPath, "utf8"));
  if (!rows || !rows[0]) throw new Error("T4p: nedokážu parsovat CSV");

  const s = rows[0];
  const OKR = guessKey(s, ["okrsek", "cis_okrsek", "cislo_okrsku"]);
  const KSTR = guessKey(s, ["kstrana", "kod_strany", "kod_subjektu", "kodstrana"]);
  const PHL = guessKey(s, ["poc_hlasu", "hlasy"]);
  const OBC = guessKey(s, ["kod_obec", "cis_obec", "obec_prez", "obec_kod"]);
  if (!OKR || !KSTR || !PHL) throw new Error("T4p: chybí očekávané sloupce");

  const out = [];
  for (const r of rows) {
    const obecCodeRaw = OBC ? asStr(r[OBC]) : null;
    const obecCode = obecCodeRaw && /^\d+$/.test(obecCodeRaw) ? obecCodeRaw : null;
    if (targetObec && obecCode && obecCode !== String(targetObec)) continue;

    const okr = asStr(r[OKR]);
    if (!okr) continue;

    const code = asStr(r[KSTR]);
    const votes = Number(String(r[PHL]).replace(/\s/g, "").replace(",", ".")) || 0;
    out.push({ OKRSEK: okr, party_code: code, votes });
  }
  return out;
}

function readCNS(zipDir) {
  const files = listFilesDeep(zipDir).filter((f) => f.toLowerCase().endsWith(".csv"));
  // preferuj soubor s náznakem „stran/subjekt“
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
    const KSTR = guessKey(s, ["kstrana", "kod_strany", "kod_subjektu", "kodstrana"]);
    const NAME = guessKey(s, ["naz_strana", "nazev_strana", "nazev_subjektu", "nazev"]);
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

/* -------------------- link resolvery + lokální override -------------------- */
function localOr(url, localPath) {
  return fs.existsSync(localPath) ? `file://${path.resolve(localPath)}` : url;
}

// PSP 2025: fixní URL + možnost lokálního override
async function resolvePSP2025() {
  const dataZip = localOr(
    "https://www.volby.cz/opendata/ps2025/PS2025data20251005_csv.zip",
    "manual/src/psp2025_data.zip" // volitelně – když nahraješ ručně
  );
  const cnsZip = localOr(
    "https://www.volby.cz/opendata/ps2025/PS2025ciselniky20251005_csv.zip",
    "manual/src/psp2025_ciselniky.zip"
  );
  const okrskyUrl =
    process.env.OKRSKY_2025_GEOJSON_URL ||
    (fs.existsSync("manual/src/psp2025_okrsky.geojson") ? "file://" + path.resolve("manual/src/psp2025_okrsky.geojson") : null);

  if (!okrskyUrl) console.warn("[PSP2025] Chybí OKRSKY_2025_GEOJSON_URL (GeoJSON hranic okrsků).");
  return { dataZip, cnsZip, okrskyUrl };
}

async function resolveKZ2024() {
  const dataZip = localOr(
    "https://www.volby.cz/opendata/kz2024/kz2024_opendata_okrs_data.zip",
    "manual/src/kz2024_data.zip"
  );
  const cnsZip = localOr(
    "https://www.volby.cz/opendata/kz2024/kz2024_opendata_ciselniky.zip",
    "manual/src/kz2024_ciselniky.zip"
  );
  const okrskyUrl = localOr(
    "https://www.volby.cz/opendata/kz2024/geo/vol_okrsky_2024g100.geojson",
    "manual/src/kz2024_okrsky.geojson"
  );
  return { dataZip, cnsZip, okrskyUrl };
}

async function resolveKV2022() {
  const dataZip = localOr(
    "https://www.volby.cz/opendata/kv2022/kv2022_opendata_okrs_data.zip",
    "manual/src/kv2022_data.zip"
  );
  const cnsZip = localOr(
    "https://www.volby.cz/opendata/kv2022/kv2022_opendata_ciselniky.zip",
    "manual/src/kv2022_ciselniky.zip"
  );
  const okrskyUrl = localOr(
    "https://www.volby.cz/opendata/kv2022/geo/vol_okrsky_2022g100.geojson",
    "manual/src/kv2022_okrsky.geojson"
  );
  return { dataZip, cnsZip, okrskyUrl };
}

/* -------------------- GeoJSON helpery -------------------- */
function pickProp(props, candidates, def = null) {
  const k = guessKey(props, candidates);
  return k ? asStr(props[k]) : def;
}

function filterPrecincts(geo, target) {
  const feats = (geo.features || []).filter((f) => {
    const p = f.properties || {};
    const obec = pickProp(p, ["obec", "kod_obec", "cis_obec", "obec_kod", "obec_kód", "KOD_OBEC"]);
    if (obec !== target.obec) return false;
    if (!target.momc) return true;
    const momc = pickProp(p, ["momc", "kod_momc", "cis_momc", "momc_kod", "KOD_MOMC"]);
    return momc === target.momc;
  });
  return { ...geo, features: feats };
}

function okrSetFromGeo(geo) {
  const s = new Set();
  for (const f of geo.features || []) {
    const p = f.properties || {};
    const ok = pickProp(p, ["okrsek", "cis_okrsek", "cislo_okrsku", "OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU"]);
    if (ok) s.add(String(ok));
  }
  return s;
}

/* -------------------- build výsledků -------------------- */
function buildResults(t4, t4p, cns, okrSet) {
  // T4 – 1 řádek na okrsek
  const t4ByOkr = new Map();
  for (const r of t4) {
    if (!okrSet.has(r.OKRSEK)) continue;
    t4ByOkr.set(r.OKRSEK, r);
  }

  // T4p – hlasy podle stran
  const partyByOkr = {};
  for (const r of t4p) {
    if (!okrSet.has(r.OKRSEK)) continue;
    (partyByOkr[r.OKRSEK] ||= []).push({
      code: r.party_code,
      name: cns[r.party_code] || r.party_code,
      votes: r.votes,
    });
  }

  // spoj do jedné struktury
  const out = {};
  for (const [okr, base] of t4ByOkr.entries()) {
    const parties = (partyByOkr[okr] || []).sort((a, b) => b.votes - a.votes);
    const valid = base.valid || 0;
    const registered = base.registered || 0;
    const returned = base.returned || 0;

    out[okr] = {
      registered,
      issued: base.issued || 0,
      returned,
      turnout_pct: registered ? +(100 * (returned / registered)).toFixed(2) : 0,
      valid,
      parties,
      top6: parties.slice(0, 6).map((p) => ({
        code: p.code,
        name: p.name,
        votes: p.votes,
        pct: valid ? +(100 * (p.votes / valid)).toFixed(2) : 0,
      })),
    };
  }
  return out;
}

/* -------------------- 1 volby → výsledky pro všechny TARGETS -------------------- */
async function processElection(tag, links) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${tag}-`));

  if (!links.dataZip || !links.cnsZip) throw new Error(`${tag}: chybí zipy dat/číselníků`);
  const dataZip = await materializeToFile(links.dataZip, path.join(tmp, `${tag}_data.zip`));
  const cnsZip = await materializeToFile(links.cnsZip, path.join(tmp, `${tag}_cns.zip`));
  if (!links.okrskyUrl) throw new Error(`${tag}: chybí URL na GeoJSON okrsků`);
  const okrGeoPath = await materializeToFile(links.okrskyUrl, path.join(tmp, `${tag}_okrsky.geojson`));

  const dataDir = unzipToDir(dataZip, path.join(tmp, "data"));
  const cnsDir = unzipToDir(cnsZip, path.join(tmp, "cns"));
  const files = listFilesDeep(dataDir).filter((f) => f.toLowerCase().endsWith(".csv"));

  const t4File = detectT4(files);
  const t4pFile = detectT4p(files);
  if (!t4File || !t4pFile) {
    throw new Error(`${tag}: nenašel jsem T4/T4p (okrskové) CSV v zipu`);
  }

  const fullGeo = JSON.parse(fs.readFileSync(okrGeoPath, "utf8"));
  const cns = readCNS(cnsDir);

  for (const target of TARGETS) {
    // Čti jen řádky pro konkrétní obec (kód obce), potom filtr okrsků z geo
    const t4 = readT4(t4File, target.obec);
    const t4p = readT4p(t4pFile, target.obec);

    let geoFiltered = filterPrecincts(fullGeo, target);
    if (!geoFiltered.features || geoFiltered.features.length === 0) {
      console.warn(`[${tag}] Varování: po filtrování zbylo 0 polygonů pro ${target.obec}:${target.momc}.`);
      continue;
    }
    const okrSet = okrSetFromGeo(geoFiltered);

    const okrResults = buildResults(t4, t4p, cns, okrSet);

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

/* -------------------- main -------------------- */
(async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });

  const psp = await resolvePSP2025();
  await processElection("psp2025", psp);

  try {
    const kz = await resolveKZ2024();
    await processElection("kz2024", kz);
  } catch (e) {
    console.warn("[WARN] KZ2024 přeskočeno:", e.message || e);
  }

  try {
    const kv = await resolveKV2022();
    await processElection("kv2022", kv);
  } catch (e) {
    console.warn("[WARN] KV2022 přeskočeno:", e.message || e);
  }

  console.log(`✔ Hotovo. Výstupy v ${OUT_DIR}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
