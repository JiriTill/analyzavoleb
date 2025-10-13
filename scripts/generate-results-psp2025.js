// scripts/generate-results-psp2025.js
// Vytvoří results_psp2025_<SUFFIX>.json z ručně nahraných CSV v manual/psp2025/
//
// Očekává soubory:
//   manual/psp2025/pst4.csv   – souhrn okrsků (VOL_SEZNAM, ODEVZ_OBAL, PL_HL_CELK, ...)
//   manual/psp2025/pst4p.csv  – hlasy pro strany (KSTRANA, POC_HLASU, ...)
//   manual/psp2025/cns.csv    – (volitelné) číselník stran: NSTRANA, NAZEV_STRN / NAZEV_ST / ZKRATKAN8...
//
// Výstup:
//   public/data/results_psp2025_<SUFFIX>.json
//
// <SUFFIX> = z prvního páru v TARGETS (OBEC[:MOMC]) → "OBEC_MOMC" nebo "OBEC".
// Pokud TARGETS není, použije se "ostrava_demo".

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { parse } = require("csv-parse/sync");

const ROOT = process.cwd();
const MANUAL = path.join(ROOT, "manual", "psp2025");
const OUT_DIR = path.join(ROOT, "public", "data");

// ============== helpers ==============
function exists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function parseCsvSmart(raw) {
  const tryDelim = (d) => {
    try {
      return parse(raw, {
        delimiter: d,
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_quotes: true,
        relax_column_count: true,
        trim: true,
      });
    } catch {
      return null;
    }
  };
  return tryDelim(";") || tryDelim(",") || tryDelim("\t");
}

function asStr(x) {
  if (x === null || x === undefined) return null;
  return String(x).trim();
}
function asNum(x) {
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function guessProp(obj, candidates) {
  const keys = Object.keys(obj || {});
  // 1) přesná shoda case-insensitive
  for (const c of candidates) {
    const hit = keys.find((k) => k.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  // 2) substring (bez diakritiky)
  const norm = (s) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  for (const k of keys) {
    const nk = norm(k);
    if (candidates.some((c) => nk.includes(norm(c)))) return k;
  }
  return null;
}

function loadCsv(filePath) {
  if (!exists(filePath)) {
    throw new Error(`Soubor ${filePath} neexistuje.`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = parseCsvSmart(raw);
  if (!rows || !rows.length) {
    throw new Error(`Soubor ${filePath} nejde parsovat nebo je prázdný.`);
  }
  return rows;
}

// ============== core ==============
function loadT4(pst4Path) {
  const rows = loadCsv(pst4Path);
  const s = rows[0];

  const KEY_OKR = guessProp(s, ["OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU", "OKRSEK_TEXT"]);
  const KEY_REG = guessProp(s, ["VOL_SEZNAM", "ZAPSANI_VOLICI"]);
  const KEY_SUB = guessProp(s, ["ODEVZ_OBAL", "ODEVZ_OBALKY", "ODEVZDANE_OBALKY"]);
  const KEY_VAL = guessProp(s, ["PL_HL_CELK", "PLATNE_HLASY"]);

  if (!KEY_OKR || !KEY_REG || !KEY_SUB || !KEY_VAL) {
    throw new Error(
      `T4: chybí očekávané sloupce (mám: ${Object.keys(s).join(
        ", "
      )}). Nutné: OKRSEK, VOL_SEZNAM/ZAPSANI..., ODEVZ_OBAL..., PL_HL_CELK/PLATNE_HLASY`
    );
  }

  const out = new Map(); // okrsek -> {registered, submitted, valid}
  for (const r of rows) {
    const okr = asStr(r[KEY_OKR]);
    if (!okr) continue;
    out.set(okr, {
      registered: asNum(r[KEY_REG]),
      submitted: asNum(r[KEY_SUB]),
      valid: asNum(r[KEY_VAL]),
    });
  }
  return out;
}

function loadT4p(pst4pPath) {
  const rows = loadCsv(pst4pPath);
  const s = rows[0];

  const KEY_OKR = guessProp(s, ["OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU", "OKRSEK_TEXT"]);
  const KEY_KOD = guessProp(s, ["KSTRANA", "KOD_STRANY", "NSTRANA"]);
  const KEY_VOT = guessProp(s, ["POC_HLASU", "HLASY"]);

  if (!KEY_OKR || !KEY_KOD || !KEY_VOT) {
    throw new Error(
      `T4p: chybí očekávané sloupce (mám: ${Object.keys(s).join(
        ", "
      )}). Nutné: OKRSEK, KSTRANA/NSTRANA, POC_HLASU`
    );
  }

  // okrsek -> { code -> votes }
  const byOkr = new Map();
  for (const r of rows) {
    const okr = asStr(r[KEY_OKR]);
    if (!okr) continue;
    const code = asStr(r[KEY_KOD]);
    const votes = asNum(r[KEY_VOT]);

    if (!byOkr.has(okr)) byOkr.set(okr, new Map());
    const m = byOkr.get(okr);
    m.set(code, (m.get(code) || 0) + votes);
  }
  return byOkr;
}

function loadPartiesCNS(cnsPath) {
  if (!exists(cnsPath)) return {};
  const rows = loadCsv(cnsPath);
  const s = rows[0];

  const KEY_CODE = guessProp(s, ["NSTRANA", "KSTRANA", "KOD_STRANY"]);
  const KEY_NAME =
    guessProp(s, ["NAZEV_STRN", "NAZEV_ST", "NAZ_STRANA", "NAZEV"]) ||
    guessProp(s, ["ZKRATKAN8", "ZKRATKA8", "ZKRATKAN30"]);

  if (!KEY_CODE || !KEY_NAME) {
    // Nevadí – vrátíme prázdnou mapu
    return {};
  }

  const map = {};
  for (const r of rows) {
    const k = asStr(r[KEY_CODE]);
    const v = asStr(r[KEY_NAME]);
    if (k) map[k] = v || k;
  }
  return map;
}

function suffixFromTargets() {
  const raw = process.env.TARGETS || "";
  const first = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)[0];

  if (!first) return "ostrava_demo";
  const [obec, momc] = first.split(":");
  return momc ? `${obec}_${momc}` : obec;
}

async function main() {
  const pst4 = ["manual/psp2025/pst4.csv", "manual/pst4.csv"].map((p) => path.join(ROOT, p)).find(exists);
  const pst4p = ["manual/psp2025/pst4p.csv", "manual/pst4p.csv"].map((p) => path.join(ROOT, p)).find(exists);
  const cns = ["manual/psp2025/cns.csv", "manual/cns.csv", "manual/psp2025/strany.csv"].map((p) => path.join(ROOT, p)).find(exists);

  if (!pst4 || !pst4p) {
    throw new Error(
      `Chybí vstupy. Najdi/nahraj:\n - manual/psp2025/pst4.csv\n - manual/psp2025/pst4p.csv\n(volitelně: manual/psp2025/cns.csv)`
    );
  }

  console.log(`[i] Čtu T4:   ${path.relative(ROOT, pst4)}`);
  console.log(`[i] Čtu T4p:  ${path.relative(ROOT, pst4p)}`);
  if (cns) console.log(`[i] Čtu CNS:  ${path.relative(ROOT, cns)}`);

  const t4 = loadT4(pst4);           // Map(okrsek -> {registered, submitted, valid})
  const t4p = loadT4p(pst4p);        // Map(okrsek -> Map(code -> votes))
  const partiesDict = cns ? loadPartiesCNS(cns) : {};

  const out = { meta: { election: "psp2025", generated: new Date().toISOString(), source: "manual/psp2025" }, okrsky: {} };

  for (const [okr, base] of t4.entries()) {
    const perParty = [];
    const m = t4p.get(okr) || new Map();
    for (const [code, votes] of m.entries()) {
      const name = partiesDict[code] || code;
      perParty.push({ code, name, votes });
    }
    perParty.sort((a, b) => b.votes - a.votes);

    const turnoutPct = base.registered > 0 ? +(100 * (base.submitted / base.registered)).toFixed(2) : 0;

    out.okrsky[String(okr)] = {
      registered: base.registered,
      turnout_pct: turnoutPct,
      valid: base.valid,
      parties: perParty,
    };
  }

  await fsp.mkdir(OUT_DIR, { recursive: true });
  const suffix = suffixFromTargets();
  const outPath = path.join(OUT_DIR, `results_psp2025_${suffix}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`\n✔ Hotovo: ${path.relative(ROOT, outPath)}  (okrsků: ${Object.keys(out.okrsky).length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
