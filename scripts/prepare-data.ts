// @ts-nocheck
/**
* scripts/prepare-data.ts
* – stáhne okrsková data a hranice pro PSP 2025, KZ 2024, KV 2022
* – vyrobí výstupy do /public/data pro Ostrava (554821) + MOaP (545911)
* – podporuje lokální strany: čte manuální seznam mandátových subjektů z /manual/mandates_<tag>.json
* kde <tag> je psp2025 | kz2024 | kv2022
*
* Spuštění v CI: npx ts-node scripts/prepare-data.ts
* ENV:
* TARGETS=554821:545911 # formát OBEC[:MOMC], víc položek čárkou
* OKRSKY_2025_GEOJSON_URL=... # GeoJSON hranic okrsků pro PSP 2025 z NKOD/ČSÚ
*/
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
const AdmZip = require('adm-zip');
import { parse } from 'csv-parse/sync';


const OUT_DIR = process.env.OUT_DIR || path.join('public', 'data');


type Target = { obec: string; momc: string | null };
const TARGETS: Target[] = (process.env.TARGETS || '554821:545911')
.split(',')
.map(x => x.trim())
.filter(Boolean)
.map(item => { const [obec, momc] = item.split(':'); return { obec, momc: momc||null }; });


// ---------- util ----------
const HTTP = async (url: string) => { const res = await fetch(url); if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`); return res; };
async function downloadToFile(url: string, dest: string) { await fs.mkdir(path.dirname(dest), { recursive: true }); const res = await HTTP(url); const ws = createWriteStream(dest); await pipeline(res.body as any, ws as any); return dest; }
function unzipToDir(zipFile: string, outDir: string) { const zip = new AdmZip(zipFile); zip.extractAllTo(outDir, true); return outDir; }
function listFilesDeep(dir: string): string[] { const out: string[] = []; const walk = (d: string) => { for (const e of require('node:fs').readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory()? walk(p): out.push(p); } }; walk(dir); return out; }
function guessProp(obj: any, candidates: string[]): string | null { const keys = Object.keys(obj); for (const cand of candidates) { const hit = keys.find(k=>k.toLowerCase()===cand.toLowerCase()); if (hit) return hit; } for (const k of keys) { const kl = k.toLowerCase(); if (candidates.some(c=>kl.includes(c.toLowerCase()))) return k; } return null; }
const asStr = (x:any)=> x==null? null: String(x).trim();


// ---------- datové věty (CSV) ----------
type PrecinctResult = { OBEC: string; OKRSEK: string; registered: number; envelopes: number; valid: number; };
function readT4(csvPath: string): PrecinctResult[] {
const rows = parse(readFileSync(csvPath, 'utf8'), { delimiter: ';', bom: true, columns: true, skip_empty_lines: true });
const s = rows[0];
const OBEC = guessProp(s,['OBEC','KOD_OBEC','CIS_OBEC']);
const OKR = guessProp(s,['OKRSEK','CIS_OKRSEK','CISLO_OKRSKU']);
const VOL = guessProp(s,['VOL_SEZNAM']);
const VYD = guessProp(s,['VYD_OBALKY']);
const PL = guessProp(s,['PL_HL_CELK']);
if(!OBEC||!OKR||!VOL||!VYD||!PL) throw new Error('T4: neznámé hlavičky');
return rows.map((r:any)=>({ OBEC: asStr(r[OBEC])!, OKRSEK: asStr(r[OKR])!, registered: +r[VOL]||0, envelopes: +r[VYD]||0, valid: +r[PL]||0 }));
}


type PrecinctParty = { OBEC: string; OKRSEK: string; party_code: string; votes: number; };
function readT4p(csvPath: string): PrecinctParty[] {
const rows = parse(readFileSync(csvPath, 'utf8'), { delimiter: ';', bom: true, columns: true, skip_empty_lines: true });
const s = rows[0];
const OBEC = guessProp(s,['OBEC','KOD_OBEC','CIS_OBEC']);
const OKR = guessProp(s,['OKRSEK','CIS_OKRSEK','CISLO_OKRSKU']);
const KSTR= guessProp(s,['KSTRANA','KOD_STRANY']);
const PHL = guessProp(s,['POC_HLASU']);
if(!OBEC||!OKR||!KSTR||!PHL) throw new Error('T4p: neznámé hlavičky');
return rows.map((r:any)=>({ OBEC: asStr(r[OBEC])!, OKRSEK: asStr(r[OKR])!, party_code: asStr(r[KSTR])!, votes: +r[PHL]||0 }));
}
})().catch((e: any) => { 
  console.error(e);
  process.exit(1);
});
