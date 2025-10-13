// scripts/generate-results-psp2025.js
// Čte manuální CSV (pst4, pst4p, cns) a generuje results_psp2025_<suffix>.json do public/data.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { parse } = require('csv-parse/sync');

const IN_DIR = path.join('manual', 'psp2025');
const OUT_DIR = path.join('public', 'data');

/** Auto-delim (tab, ;, ,) + columns:true */
function parseCsvSmart(raw) {
  const tryDelims = ['\t', ';', ','];
  for (const d of tryDelims) {
    try {
      const rows = parse(raw, {
        delimiter: d,
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        trim: true
      });
      if (rows && rows.length) return rows;
    } catch {}
  }
  throw new Error('CSV parse failed with all delimiters');
}

const asStr = (x) => (x == null ? null : String(x).trim());

function reqCol(row, names, label) {
  for (const n of names) if (n in row) return n;
  throw new Error(`Missing expected column (${label}): any of [${names.join(', ')}]`);
}

function num(x) {
  if (x == null || x === '') return 0;
  const n = +String(x).replace(',', '.');
  return Number.isFinite(n) ? n : 0;
}

// TARGETS_PSP2025 = "554821_545911=7204:500011,..."  (suffix = obec_kod:momc_kod → okres:obec)
function parseTargets(env) {
  const s = process.env.TARGETS_PSP2025 || env || '';
  if (!s) throw new Error('Secret TARGETS_PSP2025 is empty. Expected e.g. 554821_545911=7204:500011');
  const out = [];
  for (const part of s.split(',').map(x => x.trim()).filter(Boolean)) {
    const [suffix, rhs] = part.split('=');
    if (!suffix || !rhs) throw new Error(`Bad TARGETS_PSP2025 item: "${part}"`);
    const [okres, obec] = rhs.split(':');
    if (!okres || !obec) throw new Error(`Bad okres:obec mapping in "${part}"`);
    out.push({ suffix, okres: String(okres), obec: String(obec) });
  }
  return out;
}

(async function main() {
  // 1) Načíst CSV
  const pst4 = parseCsvSmart(fs.readFileSync(path.join(IN_DIR, 'pst4.csv'), 'utf8'));
  const pst4p = parseCsvSmart(fs.readFileSync(path.join(IN_DIR, 'pst4p.csv'), 'utf8'));
  const cns = parseCsvSmart(fs.readFileSync(path.join(IN_DIR, 'cns.csv'), 'utf8'));

  // 2) Najít názvy/klíče sloupců
  const sample4 = pst4[0];
  const COL_OKRES  = reqCol(sample4, ['OKRES', 'KOD_OKRES', 'CIS_OKRES'], 'OKRES');
  const COL_OBEC   = reqCol(sample4, ['OBEC', 'KOD_OBEC', 'CIS_OBEC'], 'OBEC');
  const COL_OKRSEK = reqCol(sample4, ['OKRSEK', 'CIS_OKRSEK', 'CISLO_OKRSKU'], 'OKRSEK');

  const COL_REG = reqCol(sample4, ['VOL_SEZNAM', 'VOLICI_V_SEZNAMU'], 'registered');
  const COL_SUB = reqCol(sample4, ['ODEVZ_OBAL', 'ODEVZ_OBALKY', 'ODEVZDANE_OBALKY'], 'submitted envelopes');
  const COL_VAL = reqCol(sample4, ['PL_HL_CELK', 'PLATNE_HLASY'], 'valid');

  const sample4p = pst4p[0];
  const COL_OKRES_P = reqCol(sample4p, ['OKRES', 'KOD_OKRES', 'CIS_OKRES'], 'OKRES (T4p)');
  const COL_OBEC_P  = reqCol(sample4p, ['OBEC', 'KOD_OBEC', 'CIS_OBEC'], 'OBEC (T4p)');
  const COL_OKR_P   = reqCol(sample4p, ['OKRSEK', 'CIS_OKRSEK', 'CISLO_OKRSKU'], 'OKRSEK (T4p)');
  const COL_KSTR    = reqCol(sample4p, ['KSTRANA', 'KOD_STRANY', 'KOD_SUBJEKTU', 'NSTRANA'], 'KSTRANA');
  const COL_HLASU   = reqCol(sample4p, ['POC_HLASU', 'HLASY'], 'POC_HLASU');

  // Číselník stran → kód → jméno (preferuj zkratku, pokud existuje)
  const cnsCode = reqCol(cns[0], ['NSTRANA', 'KSTRANA', 'KOD_STRANY'], 'CNS code');
  const cnsName = reqCol(cns[0], ['ZKRATKAN8', 'ZKRATKAN30', 'NAZEV_STRN', 'NAZEV_STRANA'], 'CNS name');
  const PARTY_NAME = {};
  for (const r of cns) {
    const code = asStr(r[cnsCode]);
    const name = asStr(r[cnsName]);
    if (code) PARTY_NAME[code] = name || code;
  }

  // 3) Vygenerovat výstupy pro všechny suffixy z TARGETS_PSP2025
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const targets = parseTargets();

  for (const t of targets) {
    const { okres, obec, suffix } = t;

    // index T4: okrsek → agregáty
    const t4Map = new Map();
    for (const row of pst4) {
      if (asStr(row[COL_OKRES]) !== okres) continue;
      if (asStr(row[COL_OBEC])  !== obec)  continue;
      const okr = asStr(row[COL_OKRSEK]);
      if (!okr) continue;
      t4Map.set(okr, {
        registered: num(row[COL_REG]),
        submitted:  num(row[COL_SUB]),
        valid:      num(row[COL_VAL]),
      });
    }

    // index T4p: okrsek → [{ code, name, votes }]
    const partiesBy = {};
    for (const row of pst4p) {
      if (asStr(row[COL_OKRES_P]) !== okres) continue;
      if (asStr(row[COL_OBEC_P])  !== obec)  continue;
      const okr = asStr(row[COL_OKR_P]); if (!okr) continue;
      const code = asStr(row[COL_KSTR]); const votes = num(row[COL_HLASU]);
      const name = PARTY_NAME[code] || code;
      (partiesBy[okr] ||= []).push({ code, name, votes });
    }

    // Sestavit finální mapu
    const out = {};
    for (const [okr, agg] of t4Map.entries()) {
      const parties = (partiesBy[okr] || []).sort((a,b)=>b.votes-a.votes);
      const turnout_pct = agg.registered ? +(100 * (agg.submitted / agg.registered)).toFixed(2) : 0;
      out[okr] = {
        registered: agg.registered,
        envelopes_submitted: agg.submitted,
        valid: agg.valid,
        turnout_pct,
        parties
      };
    }

    const payload = {
      meta: {
        election: 'psp2025',
        target: { suffix, okres, obec },
        generated: new Date().toISOString(),
        source: 'volby.cz CSV (pst4, pst4p, cns)'
      },
      okrsky: out
    };

    const outFile = path.join(OUT_DIR, `results_psp2025_${suffix}.json`);
    fs.writeFileSync(outFile, JSON.stringify(payload));
    console.log(`✔ Wrote ${outFile} (okrsků: ${Object.keys(out).length})`);
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
