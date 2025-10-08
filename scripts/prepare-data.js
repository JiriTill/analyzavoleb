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

// přesné vyhledání podle kandidátů (už v kanonické podobě)
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

// fuzzy výběr: najdi první key, který obsahuje VŠECHNY zadané tokeny
function guessKeyByTokens(obj, tokenList /* v kanonické podobě */) {
  const keys = Object.keys(obj || {});
  for (const k of keys) {
    const ck = canon(k);
    if (tokenList.every((t) => ck.includes(t))) return k;
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

  // kanonické názvy (bez diakritiky); přidány zkrácené varianty z ČSÚ (např. ODEVZ_OBAL)
  const K_OBEC = ["obec", "kodobec", "cisobec"];
  const K_OKR = ["okrsek", "cisokrsek", "cislookrsku"];
  const K_REG = ["volseznam", "volicivseznamu", "zapsvol", "zapsanivolici"];
  const K_ISS = ["vydobalky", "vydaneobalky"]; // nepoužíváme do výpočtu účasti, ale uložíme
  const K_RET = [
    "odevzobalky",
    "odevzdaneobalky",
    "odevzobal",        // <- ODEVZ_OBAL (zkrácené)
    "odevzobaly",
    "odevzdobal"
  ];
  const K_VALID = ["plhlcelk", "platnehlasy", "plhlcelkem", "platnychlasu"];

  const s = rows[0];
  let OBEC = guessKey(s, K_OBEC);
  let OKR = guessKey(s, K_OKR);
  let REG = guessKey(s, K_REG);
  let ISS = guessKey(s, K_ISS);
  let RET = guessKey(s, K_RET);
  let VAL = guessKey(s, K_VALID);

  // fuzzy fallbacky, když by něco chybělo
  if (!RET) RET = guessKeyByTokens(s, ["odevz", "obal"]); // kryje ODEVZ_OBAL
  if (!REG) REG = guessKeyByTokens(s, ["vol", "seznam"]); // VOL_SEZNAM apod.

  if (!OBEC || !OKR || !REG || !RET || !VAL) {
    const have = Object.keys(s).join(", ");
    throw new Error(
      `T4: chybí očekávané sloupce (mám: ${have}). Nutné: OBEC, OKRSEK, VOL_SEZNAM/ZAPSANI..., ODEVZ_OBAL(KY), PL_HL_CELK`
    );
  }

  console.log(`[T4] Použité sloupce → OBEC=${OBEC}, OKRSEK=${OKR}, REG=${REG}, RET=${RET}, VAL=${VAL}, ISS=${ISS || "-"}`);

  return rows.map((r) => ({
    OBEC: cleanId(r[OBEC]),
    OKRSEK: cleanId(r[OKR]),
    registered: +asStr(r[REG]) || 0,
    issued: ISS ? +asStr(r[ISS]) || 0 : 0,
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

  console.log(`[T4p] Použité sloupce → OBEC=${OBEC}, OKRSEK=${OKR}, PART=${PART}, VOTES=${VOTES}`);

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
  // candidates přijdou v „přirozené“ podobě – převedu je na canon
  const k = (function () {
    const keys = Object.keys(props || {});
    const canonMap = new Map(keys.map((kk) => [canon(kk), kk]));
    for (const c of candidates.map(canon)) {
      const hit = canonMap.get(c);
      if (hit) return hit;
    }
    for (const [ck, orig] of canonMap.entries()) {
      if (candidates.map(canon).some((c) => ck.includes(c))) return orig;
    }
    return null;
  })();
  return k ? asStr(props[k]) : def;
}

function filterPrecincts(geo, target) {
  const feats = (geo.features || []).filter((f) => {
    const p = f.properties || {};
    const obec = featureVal(p, ["OBEC", "KOD_OBEC", "CIS_OBEC", "obec_kod"]);
    if (cleanId(obec) !== cleanId(target.obec)) return false;
    if (!target.momc) return true;
    const momc = featureVal(p, ["MOMC", "KOD_MOMC", "CIS_MOMC", "momc_kod"]);
    return cleanId(momc) === cleanId(target.momc);
  });
  return { ...geo, features: feats };
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
      "cislo_okrsku_text"
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

// ---------- Helper: výběr T4/T4p z rozbaleného ZIPu ----------
function chooseT4T4pFromDir(dataDir) {
  const files = listFilesDeep(dataDir).filter((f) => f.toLowerCase().endsWith(".csv"));
  if (!files.length) throw new Error("V data ZIPu nejsou žádné .csv soubory");

  console.log(`[detekce] Nalezeno CSV:`);
  files.forEach((f) => {
    try {
      const raw = fs.readFileSync(f, "utf8");
      const rows = parseCsvSmart(raw);
      const cols = rows && rows[0] ? Object.keys(rows[0]) : [];
      console.log(` - ${path.basename(f)} :: [${cols.join(", ")}]`);
    } catch (e) {
      console.log(` - ${path.basename(f)} :: (nelze načíst: ${e.message})`);
    }
  });

  const need = {
    okr: ["okrsek", "cisokrsek", "cislookrsku"],
    obec: ["obec", "kodobec", "cisobec"],
    reg: ["volseznam", "volicivseznamu", "zapsvol", "zapsanivolici"],
    ret: ["odevzobalky", "odevzdaneobalky", "odevzobal"],
    val: ["plhlcelk", "platnehlasy", "plhlcelkem", "platnychlasu"],
    part: ["kstrana", "kodstrany", "kodsubjektu", "kodstrana"],
    votes: ["pochlasu", "pocthlas", "hlasy", "pocethlasu"]
  };

  function scoreCols(cols) {
    const cset = new Set(cols.map(canon));
    const has = (arr) => arr.some((a) => cset.has(a));
    const t4Score =
      (has(need.obec) ? 1 : 0) +
      (has(need.okr) ? 1 : 0) +
      (has(need.reg) ? 1 : 0) +
      (has(need.ret) ? 1 : 0) +
      (has(need.val) ? 1 : 0);
    const t4pScore =
      (has(need.obec) ? 1 : 0) +
      (has(need.okr) ? 1 : 0) +
      (has(need.part) ? 1 : 0) +
      (has(need.votes) ? 1 : 0);
    return { t4Score, t4pScore };
  }

  let bestT4 = { file: null, score: -1 };
  let bestT4p = { file: null, score: -1 };

  for (const f of files) {
    let cols = [];
    try {
      const rows = parseCsvSmart(fs.readFileSync(f, "utf8"));
      cols = rows && rows[0] ? Object.keys(rows[0]) : [];
    } catch {}
    const { t4Score, t4pScore } = scoreCols(cols);
    if (t4Score > bestT4.score) bestT4 = { file: f, score: t4Score };
    if (t4pScore > bestT4p.score) bestT4p = { file: f, score: t4pScore };
  }

  // prahy (t4: aspoň obec+okrsek+ret+val = 4; t4p: obec+okrsek+part+votes = 4)
  if (bestT4.score < 4 || bestT4p.score < 4) {
    console.warn(
      `[detekce] Slabé skóre T4/T4p (T4=${bestT4.score}, T4p=${bestT4p.score}). Zkouším fallback podle názvů.`
    );
    const byNameT4 = files.find((f) =>
      /(t4(?!p)|souhrn|okrsek[^/]*souhrn|okrskovy_souhrn)/i.test(path.basename(f))
    );
    const byNameT4p = files.find((f) =>
      /(t4p|hlasy|kstrana|stran|subjekt)/i.test(path.basename(f))
    );
    if (byNameT4 && bestT4.score < 4) bestT4 = { file: byNameT4, score: 4 };
    if (byNameT4p && bestT4p.score < 4) bestT4p = { file: byNameT4p, score: 4 };
  }

  console.log(
    `[detekce] Vybráno: T4="${bestT4.file ? path.basename(bestT4.file) : "nenalezeno"}" (score ${bestT4.score}), ` +
      `T4p="${bestT4p.file ? path.basename(bestT4p.file) : "nenalezeno"}" (score ${bestT4p.score}).`
  );

  return { t4File: bestT4.file, t4pFile: bestT4p.file };
}

// ---------- Sestavení výstupů ----------
function buildResults(t4, t4p, cns, okrSet, allowedNames /* array|null */) {
  // map okrsek -> souhrn
  const t4Map = new Map();
  for (const r of t4) {
    if (!okrSet.has(r.OKRSEK)) continue;
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

  // vyber T4/T4p
  const { t4File, t4pFile } = chooseT4T4pFromDir(dataDir);
  if (!t4File || !t4pFile) throw new Error(`${tag}: nenašel jsem T4/T4p v CSV (zkontroluj obsah ZIPu)`);

  // načti data
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
      console.warn(
        `[${tag}] Varování: po filtrování zbylo 0 polygonů pro ${target.obec}:${target.momc}. Použiju celý GeoJSON (dočasný fallback).`
      );
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
