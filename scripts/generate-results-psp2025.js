// Univerzální generátor výsledků PSP 2025 z CSV (pst4, pst4p) + číselník stran (cns)
// Vstupní soubory:  manual/psp2025/pst4.csv, manual/psp2025/pst4p.csv, manual/psp2025/cns.csv
// Výstupy: public/data/results_psp2025_<suffix>.json  (suffix si zvolíš přes mapování níže)
//
// Jak spustit (příklad):
//   TARGETS_PSP2025="554821_545911=7204:500011" node scripts/generate-results-psp2025.js
//
// Lze dát více cílů oddělených čárkou, např.:
//   TARGETS_PSP2025="554821_545911=7204:500011,XXXXX_YYYYY=AAAA:BBBB"
//
// Kde vlevo je <suffix> = to, co očekává tvoje appka v názvu souboru,
// a vpravo je "OKRES:OBEC" tak, jak se to vyskytuje v CSV z ČSÚ.
//
// Pozn.: Skript autodetekuje ; , \t a ignoruje BOM.
//
// ------------------------------------------------------------

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { parse } = require("csv-parse/sync");

const ROOT_IN = process.env.PSP2025_DIR || path.join("manual", "psp2025");
const OUT_DIR = path.join("public", "data");
const TMAP = process.env.TARGETS_PSP2025 || ""; // např. "554821_545911=7204:500011"

function ensureFile(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`Chybí soubor: ${p}`);
  }
  const sz = fs.statSync(p).size;
  if (sz < 10) throw new Error(`Soubor je podezřele malý: ${p}`);
}

function parseCsvSmart(raw) {
  const tryDelims = [";", ",", "\t"];
  for (const d of tryDelims) {
    try {
      const rows = parse(raw, {
        delimiter: d,
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
      });
      if (rows && rows.length) return rows;
    } catch {}
  }
  throw new Error("CSV nejde rozumně parsovat (zkontroluj delimiter).");
}

const asStr = (x) => (x == null ? null : String(x).trim());
const asNum = (x) => {
  if (x == null) return 0;
  const s = String(x).replace(",", ".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

function loadCsv(p) {
  ensureFile(p);
  const raw = fs.readFileSync(p, "utf8");
  return parseCsvSmart(raw);
}

// --- načtení číselníku stran ---
function loadCns() {
  const cnsPath = path.join(ROOT_IN, "cns.csv");
  const rows = loadCsv(cnsPath);
  // typicky sloupce: NSTRANA / NAZEV_STRN (nebo NAZEV_STRANA)
  const sample = rows[0] || {};
  const KSTR = Object.keys(sample).find((k) => /^N?STRANA$/i.test(k)) || "NSTRANA";
  const NAME =
    Object.keys(sample).find((k) => /NAZEV/i.test(k)) ||
    Object.keys(sample).find((k) => /NAME/i.test(k));

  if (!KSTR || !NAME) {
    throw new Error(`cns.csv: nenašel jsem sloupce s kódem a názvem strany (mám hlavičku: ${Object.keys(sample).join(", ")})`);
  }
  const map = new Map();
  for (const r of rows) {
    const code = asStr(r[KSTR]);
    const name = asStr(r[NAME]);
    if (code && name) map.set(code, name);
  }
  return map;
}

// --- načtení T4 (účasti) ---
function loadT4() {
  const p = path.join(ROOT_IN, "pst4.csv");
  const rows = loadCsv(p);
  // očekáváme sloupce: OKRES, OBEC, OKRSEK, VOL_SEZNAM, ODEVZ_OBAL (případně ODEVZ_OBALKY), PL_HL_CELK
  const s = rows[0] || {};
  const col = (names) => Object.keys(s).find((k) => names.some((n) => k.toLowerCase() === n.toLowerCase()));

  const OKRES = col(["OKRES"]);
  const OBEC = col(["OBEC"]);
  const OKRSEK = col(["OKRSEK", "CISLO_OKRSKU"]);
  const VOL = col(["VOL_SEZNAM", "VOLICI_V_SEZNAMU", "VOLICI_SEZNAM"]);
  const ODEVZ = col(["ODEVZ_OBAL", "ODEVZ_OBALKY", "ODEVZ_OBALY", "ODEVZ_OBALK"]);
  const PL = col(["PL_HL_CELK", "PLATNE_HLASY_CELK"]);

  const required = { OKRES, OBEC, OKRSEK, VOL, ODEVZ, PL };
  for (const [name, val] of Object.entries(required)) {
    if (!val) throw new Error(`pst4.csv: chybí očekávaný sloupec: ${name}`);
  }

  return rows.map((r) => ({
    okres: asStr(r[OKRES]),
    obec: asStr(r[OBEC]),
    okrsek: asStr(r[OKRSEK]),
    vol_seznam: asNum(r[VOL]),
    odevz_obalky: asNum(r[ODEVZ]),
    platne_hlasy: asNum(r[PL]),
  }));
}

// --- načtení T4p (hlasy stran) ---
function loadT4p() {
  const p = path.join(ROOT_IN, "pst4p.csv");
  const rows = loadCsv(p);
  // očekáváme: OKRES, OBEC, OKRSEK, KSTRANA, POC_HLASU
  const s = rows[0] || {};
  const col = (names) => Object.keys(s).find((k) => names.some((n) => k.toLowerCase() === n.toLowerCase()));

  const OKRES = col(["OKRES"]);
  const OBEC = col(["OBEC"]);
  const OKRSEK = col(["OKRSEK"]);
  const KSTR = col(["KSTRANA", "KOD_STRANY", "NSTRANA"]);
  const HLAS = col(["POC_HLASU", "HLASY", "HLASY_CELK"]);

  const required = { OKRES, OBEC, OKRSEK, KSTR, HLAS };
  for (const [name, val] of Object.entries(required)) {
    if (!val) throw new Error(`pst4p.csv: chybí očekávaný sloupec: ${name}`);
  }

  return rows.map((r) => ({
    okres: asStr(r[OKRES]),
    obec: asStr(r[OBEC]),
    okrsek: asStr(r[OKRSEK]),
    kstrana: asStr(r[KSTR]),
    hlasy: asNum(r[HLAS]),
  }));
}

// --- parsování TARGETS mapy ---
// formát: "suffixA=OKRES:OBEC,suffixB=AAA:BBB"
function parseTargetsMap(raw) {
  const out = [];
  for (const part of (raw || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [suffix, pair] = part.split("=");
    if (!suffix || !pair) continue;
    const [okres, obec] = pair.split(":");
    out.push({ suffix, okres: (okres || "").trim(), obec: (obec || "").trim() });
  }
  return out;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });

  const cns = loadCns();      // Map(code -> name)
  const t4 = loadT4();        // účast per okrsek
  const t4p = loadT4p();      // hlasy stran per okrsek

  const targets = parseTargetsMap(TMAP);
  if (!targets.length) {
    console.error(`Nebyl zadán TARGETS_PSP2025 (např.: TARGETS_PSP2025="554821_545911=7204:500011").`);
    process.exit(1);
  }

  for (const target of targets) {
    const { suffix, okres, obec } = target;
    // Filtrování dat na okres+obec
    const t4_f = t4.filter((r) => r.okres === okres && r.obec === obec);
    const t4p_f = t4p.filter((r) => r.okres === okres && r.obec === obec);

    if (!t4_f.length) {
      console.warn(`[${suffix}] Varování: nenašel jsem žádné řádky v pst4.csv pro OKRES=${okres}, OBEC=${obec}.`);
    }
    if (!t4p_f.length) {
      console.warn(`[${suffix}] Varování: nenašel jsem žádné řádky v pst4p.csv pro OKRES=${okres}, OBEC=${obec}.`);
    }

    // Index účasti podle okrsku
    const t4ByOkr = new Map();
    for (const r of t4_f) {
      t4ByOkr.set(r.okrsek, r);
    }

    // Skládání hlasů stran per okrsek
    const partiesByOkr = new Map(); // okrsek -> Map(partyName -> votes)
    for (const r of t4p_f) {
      const okr = r.okrsek;
      const code = r.kstrana;
      const name = cns.get(code) || code;
      const m = partiesByOkr.get(okr) || new Map();
      m.set(name, (m.get(name) || 0) + r.hlasy);
      partiesByOkr.set(okr, m);
    }

    // Výstupní struktura
    const okrskyOut = {};
    for (const [okr, rec] of t4ByOkr.entries()) {
      const voters = rec.vol_seznam || 0;
      const odevz = rec.odevz_obalky || 0;
      const valid = rec.platne_hlasy || 0;
      const ucast = voters ? round2((odevz / voters) * 100) : 0;

      const parts = Array.from((partiesByOkr.get(okr) || new Map()).entries())
        .map(([name, votes]) => ({ name, votes }))
        .sort((a, b) => b.votes - a.votes);

      // Top 6 s podíly (z platných hlasů)
      const top6 = parts.slice(0, 6).map((p) => ({
        name: p.name,
        votes: p.votes,
        share: valid ? round2((p.votes / valid) * 100) : 0,
      }));

      // „plochá“ mapa stran: { "ANO 2025": 123, ... }
      const partiesDict = {};
      for (const p of parts) partiesDict[p.name] = p.votes;

      okrskyOut[okr] = {
        registered: voters,
        ballots_in: odevz,
        valid: valid,
        turnout_pct: ucast,
        parties: partiesDict,
        top6,
      };
    }

    const out = {
      meta: {
        election: "psp2025",
        filter: { okres, obec },
        generated: new Date().toISOString(),
        source: "CSV: pst4, pst4p, cns",
      },
      okrsky: okrskyOut,
    };

    const outName = `results_psp2025_${suffix}.json`;
    const outPath = path.join(OUT_DIR, outName);
    fs.writeFileSync(outPath, JSON.stringify(out), "utf8");
    console.log(`✔ Uloženo: ${outPath} (okrsků: ${Object.keys(okrskyOut).length})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
