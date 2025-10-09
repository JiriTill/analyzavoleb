// scripts/prepare-data.js
// Builduje okrsková data z lokálních zipů v /manual pro PSP 2025, KZ 2024, KV 2022
// a uloží je do /public/data. Běží v Node 20 (global fetch).

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

// ---------- utils pro HTTP (používá nativní global fetch) ----------

async function HTTP(url) {
  // Global fetch je dostupný v Node 20+
  if (typeof fetch === 'undefined') {
    throw new Error("Globální 'fetch' není dostupný. Zkontrolujte verzi Node.js (potřeba 20+)");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} pro ${url}`);
  return res;
}

function asStr(x) { return x == null ? null : String(x).trim(); }

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
    } catch { return null; }
  };
  return tryParse(";") || tryParse(",") || tryParse("\t");
}

function listCsvFilesInZip(zipPath) {
  const zip = new AdmZip(zipPath);
  return zip.getEntries()
    .filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith(".csv"))
    .map(e => ({ name: e.entryName, text: zip.readAsText(e) }));
}

function guess(obj, candidates) {
  const keys = Object.keys(obj || {});
  for (const c of candidates) {
    const hit = keys.find(k => k.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  // volnější shoda
  for (const k of keys) {
    const kl = k.toLowerCase();
    if (candidates.some(c => kl.includes(c.toLowerCase()))) return k;
  }
  return null;
}

// vrátí první existující file v /manual, jehož název obsahuje všechna „tokens“
function findManualZip(tokens) {
  if (!fs.existsSync(MANUAL_DIR)) return null;
  const files = fs.readdirSync(MANUAL_DIR).filter(f => f.toLowerCase().endsWith(".zip"));
  const want = tokens.map(t => t.toLowerCase());
  const hit = files.find(f => want.every(t => f.toLowerCase().includes(t)));
  return hit ? path.join(MANUAL_DIR, hit) : null;
}

function featureVal(props, candidates, def = null) {
  const k = guess(props, candidates);
  return k ? asStr(props[k]) : def;
}

// filtr GeoJSONu podle OBEC(:MOMC)
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
    // Pro GeoJSON okrsků hledáme okrsek_local, okrsek_cislo, atd.
    const ok = featureVal(p, [
      "OKRSEK","CIS_OKRSEK","CISLO_OKRSKU","cislo_okrsku","okrsek","okrsek_cislo","cislo_okrsku_text", "okrsek_local" // Přidán okrsek_local pro spolehlivější join
    ]);
    if (ok) s.add(String(ok));
  }
  return s;
}

// ---------- čtení CSV T4 / T4p ----------
function readT4(rows) {
  if (!rows || !rows[0]) throw new Error("T4: prázdné CSV");
  const s = rows[0];
  const OBEC = guess(s, ["OBEC","KOD_OBEC","CIS_OBEC","KOD_OBCE"]);
  const OKR  = guess(s, ["OKRSEK","CIS_OKRSEK","CISLO_OKRSKU"]);
  const REG  = guess(s, ["VOL_SEZNAM","ZAPSANI_VOLICI"]);
  const ODEV = guess(s, ["ODEVZ_OBAL","ODEVZDANE_OBALKY"]);
  const VALID= guess(s, ["PL_HL_CELK","PLATNE_HLASY"]);
  if (!OBEC || !OKR || !REG || !ODEV || !VALID) {
    throw new Error(`T4: chybí očekávané sloupce (mám: ${Object.keys(s).join(", ")}). Nutné: OBEC, OKRSEK, VOL_SEZNAM/ZAPSANI_VOLICI, ODEVZ_OBAL/ODEVZDANE_OBALKY, PL_HL_CELK/PLATNE_HLASY`);
  }
  return rows.map(r => ({
    OBEC: asStr(r[OBEC]),
    OKRSEK: asStr(r[OKR]),
    registered: +r[REG] || 0,
    returned: +r[ODEV] || 0,          // správně pro účast
    valid: +r[VALID] || 0,
  }));
}

function readT4p(rows) {
  if (!rows || !rows[0]) throw new Error("T4p: prázdné CSV");
  const s = rows[0];
  const OBEC = guess(s, ["OBEC","KOD_OBEC","CIS_OBEC","KOD_OBCE"]);
  const OKR  = guess(s, ["OKRSEK","CIS_OKRSEK","CISLO_OKRSKU"]);
  const KSTR = guess(s, ["KSTRANA","KOD_STRANY","KOD_SUBJEKTU","KODSTRANA"]);
  const PHL  = guess(s, ["POC_HLASU","HLASY"]);
  if (!OBEC || !OKR || !KSTR || !PHL) {
    throw new Error(`T4p: chybí očekávané sloupce (mám: ${Object.keys(s).join(", ")})`);
  }
  return rows.map(r => ({
    OBEC: asStr(r[OBEC]),
    OKRSEK: asStr(r[OKR]),
    party_code: asStr(r[KSTR]),
    votes: +r[PHL] || 0,
  }));
}

// ---------- číselníky (mapování kód -> název) ----------
function readCiselniky(csvFiles) {
  // najdu tabulku, která má kód strany + její název
  for (const file of csvFiles) {
    const rows = parseCsvSmart(file.text);
    if (!rows || !rows[0]) continue;
    const s = rows[0];
    const KSTR = guess(s, ["KSTRANA","KOD_STRANY","KOD_SUBJEKTU","KODSTRANA"]);
    const NAME = guess(s, ["NAZ_STRANA","NAZEV_STRANA","NAZEV_SUBJEKTU","NAZEV"]);
    if (!KSTR || !NAME) continue;
    const map = {};
    for (const r of rows) {
      const k = asStr(r[KSTR]); const v = asStr(r[NAME]);
      if (k && v) map[k] = v;
    }
    if (Object.keys(map).length) return map;
  }
  return {};
}

// ---------- sestavení výstupu ----------
function buildResults(t4, t4p, cns, okrSet, allowedNames = null) {
  const t4ByOkr = new Map();
  for (const r of t4) {
    // Problém: V GeoJSONu je okrsek jako '1' a v T4 souborech je např. '8001'.
    // Pro zjednodušení teď používáme surové OKRSEK kódy z obou, pokud se filtruje přes okrSet.
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
    let parties = (partiesByOkr[okr] || []).sort((a,b) => b.votes - a.votes);
    if (allowedNames && allowedNames.length) {
      const low = allowedNames.map(x => x.toLowerCase());
      parties = parties.filter(p => low.some(a => (p.name||"").toLowerCase().includes(a)));
    }
    out[okr] = {
      registered: r.registered,
      valid: r.valid,
      // Důležité: 'issued' chybí v T4, ale je očekáváno v dataClient.ts, 
      // i když se nepoužívá pro turnout (zde r.returned). Pro jistotu:
      issued: 0, 
      turnout_pct: r.registered ? +((100 * r.returned / r.registered).toFixed(2)) : 0,
      parties
    };
  }
  return out;
}

// ---------- hlavní pipeline pro volby ----------
async function processElection(tag, manualTokensData, manualTokensCns, okrskyGeoUrl) {
  // 1) z /manual najdi odpovídající zipy
  const dataZip = findManualZip(manualTokensData);
  const cnsZip  = findManualZip(manualTokensCns);
  if (!dataZip || !cnsZip) {
    throw new Error(`${tag}: v /manual chybí zipy dat/číselníků (hledal jsem: ${manualTokensData.join("+")} / ${manualTokensCns.join("+")})`);
  }

  // 2) načti CSV z obou zipů
  const csvDataFiles = listCsvFilesInZip(dataZip);
  const csvCnsFiles  = listCsvFilesInZip(cnsZip);

  // detekce T4/T4p souborů podle hlaviček (skórování, které se zdá být robustní)
  let bestT4 = null, bestT4p = null, bestScoreT4 = -1, bestScoreT4p = -1;
  for (const f of csvDataFiles) {
    const rows = parseCsvSmart(f.text); if (!rows || !rows[0]) continue;
    const cols = Object.keys(rows[0]).map(c => c.toLowerCase());
    const scoreT4  = ["okrs","okrsek","vol_seznam","zaps","odevz","plat"].filter(k=>cols.some(c=>c.includes(k))).length;
    const scoreT4p = ["okrsek","kstr","kod","poc_hlasu","hlasy"].filter(k=>cols.some(c=>c.includes(k))).length;
    if (scoreT4  > bestScoreT4)  { bestScoreT4  = scoreT4;  bestT4  = rows; }
    if (scoreT4p > bestScoreT4p) { bestScoreT4p = scoreT4p; bestT4p = rows; }
  }
  if (!bestT4 || !bestT4p) {
    console.error("[detekce] Nalezeno CSV:", csvDataFiles.map(f => ` - ${f.name}`).join("\n"));
    throw new Error(`${tag}: nenašel jsem T4/T4p v CSV (zkontroluj obsah ZIPu)`);
  }

  const t4  = readT4(bestT4);
  const t4p = readT4p(bestT4p);
  const cns = readCiselniky(csvCnsFiles);
  console.log(`[${tag}] Načteno: T4=${t4.length} řádků, T4p=${t4p.length} řádků, Číselníků=${Object.keys(cns).length} záznamů.`);

  // 3) stáhni GeoJSON okrsků (jen pro filtraci na TARGETS & okrskové ID set)
  if (!okrskyGeoUrl) throw new Error(`${tag}: chybí URL na GeoJSON okrsků`);
  
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${tag}-`));
  const geoPath = path.join(tmp, `${tag}_okrsky.geojson`);
  
  // Stáhni GeoJSON pomocí robustního HTTP (fetch) a streamu
  const res = await HTTP(okrskyGeoUrl);
  await pipeline(res.body, createWriteStream(geoPath));
  
  const fullGeo = JSON.parse(fs.readFileSync(geoPath, "utf8"));

  // 4) pro každý target vygeneruj dvojici souborů
  await fsp.mkdir(OUT_DIR, { recursive: true });

  for (const target of TARGETS) {
    let geoFiltered = filterPrecincts(fullGeo, target);
    
    // Problém: GeoJSON může být v pořádku, ale filtrování nemusí nic vrátit.
    // Pro sestavení okrskového setu se spolehneme na to, co GeoJSON obsahuje.
    if (!geoFiltered.features || geoFiltered.features.length === 0) {
      console.warn(`[${tag}] Po filtrování 0 polygonů pro ${target.obec}:${target.momc} – okrSet bude prázdný.`);
      continue;
    }

    const okrSet = okrSetFromGeo(geoFiltered);
    const okrResults = buildResults(t4, t4p, cns, okrSet, null /* bez filtru stran */);

    const suffix = target.momc ? `${target.obec}_${target.momc}` : `${target.obec}`;

    // Zde generujeme GEOJSON pro daný TARGET a pro PSP 2025 (kvůli dataClient.ts)
    if (tag === 'psp2025') {
        fs.writeFileSync(path.join(OUT_DIR, `precincts_${tag}_${suffix}.geojson`), JSON.stringify(geoFiltered));
    }
    
    // Uložit results_*.json
    fs.writeFileSync(
      path.join(OUT_DIR, `results_${tag}_${suffix}.json`),
      JSON.stringify({
        meta: { election: tag, target, generated: new Date().toISOString(), source: "volby.cz (CSV + ciselniky)" },
        okrsky: okrResults
      })
    );
  }
}

// ---------- main ----------
(async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });

  // GeoJSON PSP 2025 bereme ze secretu (stejně jako dřív)
  const okrsky2025 = process.env.OKRSKY_2025_GEOJSON_URL || null;

  if (!okrsky2025) {
     console.error("Chyba: Proměnná prostředí OKRSKY_2025_GEOJSON_URL není nastavena. Nelze pokračovat.");
     process.exit(1);
  }

  try {
    // PSP 2025 – zipy v /manual: PS2025data...csv.zip + PS2025ciselniky...csv.zip
    await processElection(
      "psp2025",
      ["ps2025","data","csv"],       // tokens pro data ZIP
      ["ps2025","cisel","csv"],      // tokens pro číselníky ZIP
      okrsky2025
    );
  } catch (e) {
    console.error(`🔴 Chyba při zpracování PSP 2025: ${e.message}`);
  }

  try {
    // KZ 2024 – KZ2024data...csv.zip + KZ2024ciselniky...csv.zip
    await processElection(
      "kz2024",
      ["kz2024","data","csv"],
      ["kz2024","cisel","csv"],
      okrsky2025 // použijeme stejný GeoJSON okrsků (hranice okrsků se neliší)
    );
  } catch (e) {
    console.error(`🔴 Chyba při zpracování KZ 2024: ${e.message}`);
  }

  try {
    // KV 2022 – KV2022...data...csv.zip + KV2022ciselniky...csv.zip
    await processElection(
      "kv2022",
      ["kv2022","data","csv"],
      ["kv2022","cisel","csv"],
      okrsky2025
    );
  } catch (e) {
    console.error(`🔴 Chyba při zpracování KV 2022: ${e.message}`);
  }

  console.log(`✔ Hotovo. Výstupy v ${OUT_DIR}`);
})().catch((e) => {
  console.error("FATÁLNÍ CHYBA SKRIPTU:", e);
  process.exit(1);
});
