// scripts/prepare-data.js
// Builduje okrsková data z lokálních zipů v /manual pro PSP 2025, KZ 2024, KV 2022
// a uloží je do /public/data.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");
// Import pro robustnější stahování (fetch může být v některých prostředích nestabilní)
const axios = require('axios'); 
// POZOR: K použití axios je nutné jej nainstalovat: npm install axios

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

// ---------- utils ----------
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

// Case-insensitive a fuzzy shoda pro hlavičky
function canon(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s._-]+/g, "");
}

function guess(obj, candidates) {
  const keys = Object.keys(obj || {});
  const canonMap = new Map(keys.map(k => [canon(k), k]));
  const candidatesCanon = candidates.map(canon);

  for (const c of candidatesCanon) {
    const hit = canonMap.get(c);
    if (hit) return hit;
  }
  // volnější shoda: substring match
  for (const [ck, orig] of canonMap.entries()) {
    if (candidatesCanon.some(c => ck.includes(c))) return orig;
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
    // Používám robustnější shodu featureVal
    const obec = featureVal(p, ["OBEC", "KOD_OBEC", "CIS_OBEC", "obec_kod", "obec_kód", "KOD_OBCE"]);
    if (obec !== target.obec) return false;
    if (!target.momc) return true;
    const momc = featureVal(p, ["MOMC", "KOD_MOMC", "CIS_MOMC", "kod_momc", "momc_kod", "KOD_MOMC"]);
    return momc === target.momc;
  });
  return { type: "FeatureCollection", features: feats };
}

function okrSetFromGeo(geo) {
  const s = new Set();
  for (const f of geo.features || []) {
    const p = f.properties || {};
    // DŮLEŽITÉ: Není spolehlivé spoléhat jen na OKRSEK kód (8001), pokud GeoJSON neobsahuje lokální číslo (1).
    // Pro GeoJSON pro JOIN by bylo lepší přidat okrsek_local (jako v původní verzi),
    // ale pro tuto chvíli použijeme co je dostupné v GeoJSONu pro získání seznamu okrsků.
    const ok = featureVal(p, [
      "OKRSEK","CIS_OKRSEK","CISLO_OKRSKU","cislo_okrsku","okrsek","okrsek_cislo","cislo_okrsku_text"
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
  const ISS  = guess(s, ["VYDANE_OBALKY", "VYDOBALKY"]); // VYDANE_OBALKY
  const ODEV = guess(s, ["ODEVZ_OBAL","ODEVZDANE_OBALKY"]);
  const VALID= guess(s, ["PL_HL_CELK","PLATNE_HLASY"]);

  if (!OBEC || !OKR || !REG || !ODEV || !VALID) {
    throw new Error(`T4: chybí očekávané sloupce (mám: ${Object.keys(s).join(", ")}). Nutné: OBEC, OKRSEK, VOL_SEZNAM/ZAPSANI_VOLICI, ODEVZ_OBAL/ODEVZDANE_OBALKY, PL_HL_CELK/PLATNE_HLASY`);
  }
  return rows.map(r => ({
    OBEC: asStr(r[OBEC]),
    OKRSEK: asStr(r[OKR]),
    registered: +r[REG] || 0,
    issued: ISS ? +r[ISS] || 0 : 0,  // přidáno zpět pro konzistenci s datovým modelem
    returned: +r[ODEV] || 0,
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
  for (const file of csvFiles) {
    const rows = parseCsvSmart(file.text);
    if (!rows || !rows[0]) continue;
    const s = rows[0];
    const KSTR = guess(s, ["KSTRANA","KOD_STRANY","KOD_SUBJEKTU","KODSTRANA"]);
    const NAME = guess(s, ["NAZ_STRANA","NAZEV_STRANA","NAZEV_SUBJEKTU","NAZEV"]);
    if (!KSTR || !NAME) continue;
    
    // Fallback pro soubory, kde je pouze Kód a Název (např. Ciselnik_okrsky.csv)
    // Zkusíme, zda máme dostatek unikátních párů
    if (KSTR && NAME) {
      const map = {};
      for (const r of rows) {
        const k = asStr(r[KSTR]); const v = asStr(r[NAME]);
        if (k && v) map[k] = v;
      }
      // Jen pokud se našlo dostatek mapování (např. aspoň 10 subjektů)
      if (Object.keys(map).length > 10) return map;
    }
  }
  return {};
}

// ---------- sestavení výstupu ----------
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
    let parties = (partiesByOkr[okr] || []).sort((a,b) => b.votes - a.votes);
    if (allowedNames && allowedNames.length) {
      const low = allowedNames.map(x => x.toLowerCase());
      parties = parties.filter(p => low.some(a => (p.name||"").toLowerCase().includes(a)));
    }
    out[okr] = {
      registered: r.registered,
      issued: r.issued, // přidáno pro konzistenci
      valid: r.valid,
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

  // detekce T4/T4p souborů – robustní detekce podle názvů
  let t4Rows = null, t4pRows = null;
  for (const f of csvDataFiles) {
    const isT4 = /(t4(?!p)|souhrn|okrsek_souhrn)/i.test(f.name);
    const isT4p = /(t4p|hlasy|kstrana|stran)/i.test(f.name);
    if ((isT4 || isT4p) && !t4Rows && !t4pRows) {
      const rows = parseCsvSmart(f.text);
      if (!rows || !rows[0]) continue;
      // Zkusíme jestli to jsou T4 nebo T4p
      try { readT4(rows); t4Rows = rows; } catch {}
      try { readT4p(rows); t4pRows = rows; } catch {}
    }
  }

  // pokud se nepovedlo najít, zkusíme první dva ne-číselníkové
  if (!t4Rows || !t4pRows) {
    const nonCns = csvDataFiles.filter(f => !/ciselnik/i.test(f.name));
    for (const f of nonCns) {
      const rows = parseCsvSmart(f.text); if (!rows || !rows[0]) continue;
      if (!t4Rows) { try { readT4(rows); t4Rows = rows; } catch {} }
      if (!t4pRows) { try { readT4p(rows); t4pRows = rows; } catch {} }
      if (t4Rows && t4pRows) break;
    }
  }
  
  if (!t4Rows || !t4pRows) {
    console.error("[detekce] Nalezeno CSV:", csvDataFiles.map(f => ` - ${f.name}`).join("\n"));
    throw new Error(`${tag}: nenašel jsem spolehlivě T4/T4p v CSV (zkontroluj obsah ZIPu)`);
  }

  const t4  = readT4(t4Rows);
  const t4p = readT4p(t4pRows);
  const cns = readCiselniky(csvCnsFiles);
  console.log(`[${tag}] Načteno: T4=${t4.length} řádků, T4p=${t4p.length} řádků, Číselníků=${Object.keys(cns).length} záznamů.`);

  // 3) stáhni GeoJSON okrsků (používáme axios místo fetch)
  if (!okrskyGeoUrl) throw new Error(`${tag}: chybí URL na GeoJSON okrsků`);
  
  let fullGeo;
  try {
    console.log(`[${tag}] Stahuji GeoJSON z: ${okrskyGeoUrl}`);
    const res = await axios.get(okrskyGeoUrl, { responseType: 'json' });
    fullGeo = res.data;
  } catch(e) {
    throw new Error(`[${tag}] Chyba při stahování GeoJSON: ${e.message}`);
  }

  // 4) pro každý target vygeneruj soubor results_*.json
  await fsp.mkdir(OUT_DIR, { recursive: true });

  for (const target of TARGETS) {
    const targetInfo = target.momc ? `${target.obec}:${target.momc}` : `${target.obec}`;
    let geoFiltered = filterPrecincts(fullGeo, target);
    
    // Problém: GeoJSON okrsků nemusí mít přesný okrsek_local, pokud byl GeoJSON jen filtrován.
    // Pro určení, které okrsky filtrovat, použijeme jen ty z GEOMETRIE.
    const okrSet = okrSetFromGeo(geoFiltered);
    if (okrSet.size === 0) {
        console.warn(`[${tag}] Varování: Po filtrování 0 polygonů pro ${targetInfo}. Přeskočeno. Zkontrolujte GeoJSON a OBEC/MOMC kódy.`);
        continue;
    }
    
    const okrResults = buildResults(t4, t4p, cns, okrSet, null /* bez filtru stran */);

    const suffix = target.momc ? `${target.obec}_${target.momc}` : `${target.obec}`;

    fs.writeFileSync(
      path.join(OUT_DIR, `results_${tag}_${suffix}.json`),
      JSON.stringify({
        meta: { election: tag, target, generated: new Date().toISOString(), source: "volby.cz (CSV + ciselniky)" },
        okrsky: okrResults
      })
    );
    console.log(`[${tag}] Uloženo: results_${tag}_${suffix}.json (${Object.keys(okrResults).length} okrsků)`);
  }
}

// ---------- main ----------
(async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });

  // GeoJSON PSP 2025 bereme ze secretu
  const okrsky2025 = process.env.OKRSKY_2025_GEOJSON_URL || null;

  if (!okrsky2025) {
     console.error("Chyba: Proměnná prostředí OKRSKY_2025_GEOJSON_URL není nastavena. Nelze pokračovat.");
     process.exit(1);
  }

  try {
    // PSP 2025 – zipy v /manual: PS2025data...csv.zip + PS2025ciselniky...csv.zip
    await processElection(
      "psp2025",
      ["ps2025","data","csv"],
      ["ps2025","cisel","csv"],
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
      okrsky2025
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
