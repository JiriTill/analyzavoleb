// scripts/prepare-data.js
// Stáhne a připraví okrsková data (PSP 2025, KZ 2024, KV 2022) → /public/data
// Detekuje jestli CSV T4/T4p má v "OKRSEK" lokální číslo (8002) nebo interní ID (29587) a podle toho udělá join.
// Výstup vždy ukládá pod klíčem = lokální číslo okrsku (např. "8002").

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { pipeline } = require("stream/promises");
const { createWriteStream } = require("fs");
const AdmZip = require("adm-zip");
const { parse } = require("csv-parse/sync");

const OUT_DIR = path.join("public", "data");
const TARGETS = (process.env.TARGETS || "554821:545911")
  .split(",").map((x)=>x.trim()).filter(Boolean)
  .map((item)=>{ const [obec, momc] = item.split(":"); return { obec, momc: momc || null }; });

async function HTTP(url){ const r=await fetch(url); if(!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r; }
async function downloadToFile(url,dest){ await fsp.mkdir(path.dirname(dest),{recursive:true}); const r=await HTTP(url); await pipeline(r.body, createWriteStream(dest)); return dest; }
function unzipToDir(zipFile,outDir){ const zip=new AdmZip(zipFile); zip.extractAllTo(outDir,true); return outDir; }
function listFilesDeep(dir){ const out=[]; (function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); e.isDirectory()?walk(p):out.push(p);} })(dir); return out; }
function guessProp(obj, candidates){ const keys=Object.keys(obj||{}); for(const c of candidates){ const hit=keys.find(k=>k.toLowerCase()===c.toLowerCase()); if(hit) return hit; } for(const k of keys){ const kl=k.toLowerCase(); if(candidates.some(c=>kl.includes(c.toLowerCase()))) return k; } return null; }
const asStr = (x)=> (x==null? null : String(x).trim());

function parseCsvSmart(raw){
  const tryParse = (delim)=>{ try{ return parse(raw,{ delimiter:delim, columns:true, bom:true, skip_empty_lines:true, relax_column_count:true, relax_quotes:true }); } catch{ return null; } };
  return tryParse(";") || tryParse(",") || tryParse("\t");
}
function detectCsv(files, mustHaveCols){
  for(const f of files){
    if(!f.toLowerCase().endsWith(".csv")) continue;
    const rows = parseCsvSmart(fs.readFileSync(f,"utf8"));
    if(!rows || !rows[0]) continue;
    const cols = Object.keys(rows[0]);
    if(mustHaveCols.every(c=>cols.includes(c))) return f;
  }
  return null;
}

// --- T4 / T4p ---
function readT4(csvPath){
  const rows = parseCsvSmart(fs.readFileSync(csvPath,"utf8")); if(!rows || !rows[0]) throw new Error("T4: nedokážu parsovat CSV");
  const s=rows[0];
  const OBEC=guessProp(s,["OBEC","KOD_OBEC","CIS_OBEC"]);
  const OKR =guessProp(s,["OKRSEK","ID_OKRSEK","IDOKRSEK"]);
  const VOL =guessProp(s,["VOL_SEZNAM"]);
  const VYD =guessProp(s,["VYD_OBALKY"]);
  const PL  =guessProp(s,["PL_HL_CELK"]);
  if(!OBEC || !OKR || !VOL || !VYD || !PL) throw new Error("T4: hlavičky neznámé");
  return rows.map(r=>({ OBEC:asStr(r[OBEC]), OKRSEK:asStr(r[OKR]), registered:+(r[VOL]||0), envelopes:+(r[VYD]||0), valid:+(r[PL]||0) }));
}
function readT4p(csvPath){
  const rows = parseCsvSmart(fs.readFileSync(csvPath,"utf8")); if(!rows || !rows[0]) throw new Error("T4p: nedokážu parsovat CSV");
  const s=rows[0];
  const OBEC=guessProp(s,["OBEC","KOD_OBEC","CIS_OBEC"]);
  const OKR =guessProp(s,["OKRSEK","ID_OKRSEK","IDOKRSEK"]);
  const KSTR=guessProp(s,["KSTRANA","KOD_STRANY","KOD_SUBJEKTU","KODSTRANA"]);
  const PHL =guessProp(s,["POC_HLASU"]);
  if(!OBEC || !OKR || !KSTR || !PHL) throw new Error("T4p: hlavičky neznámé");
  return rows.map(r=>({ OBEC:asStr(r[OBEC]), OKRSEK:asStr(r[OKR]), party_code:asStr(r[KSTR]), votes:+(r[PHL]||0) }));
}
function readCNS(zipDir){
  const files=listFilesDeep(zipDir).filter(f=>f.toLowerCase().endsWith(".csv"));
  const ordered=files.sort((a,b)=>{ const pa=path.basename(a).toLowerCase(), pb=path.basename(b).toLowerCase(); const wa=/stran|strany|subjekt/.test(pa)?0:1, wb=/stran|strany|subjekt/.test(pb)?0:1; return wa-wb; });
  for(const f of ordered){
    const rows=parseCsvSmart(fs.readFileSync(f,"utf8")); if(!rows || !rows[0]) continue;
    const s=rows[0];
    const KSTR=guessProp(s,["KSTRANA","KOD_STRANY","KOD_SUBJEKTU","KODSTRANA"]);
    const NAME=guessProp(s,["NAZ_STRANA","NAZEV_STRANA","NAZEV_SUBJEKTU","NAZEV"]);
    if(KSTR && NAME){ const map={}; for(const r of rows){ const k=asStr(r[KSTR]), v=asStr(r[NAME]); if(k && v) map[k]=v; } if(Object.keys(map).length) return map; }
  }
  return {};
}

// --- GeoJSON ---
function featureVal(props,cands,def=null){ const k=guessProp(props,cands); return k? asStr(props[k]) : def; }
function filterPrecincts(geo, target){
  const feats=(geo.features||[]).filter(f=>{
    const p=f.properties||{};
    const obec=featureVal(p,["KOD_OBEC","CIS_OBEC","OBEC","obec_kod","obec_kód"]);
    if(obec!==target.obec) return false;
    if(!target.momc) return true;
    const momc=featureVal(p,["KOD_MOMC","CIS_MOMC","MOMC","kod_momc","momc_kod"]);
    return momc===target.momc;
  });
  return {...geo, features:feats};
}
function harvestLocalGlobal(geo){
  const pairs=[]; const localSet=new Set(); const globalSet=new Set();
  for(const f of geo.features||[]){
    const p=f.properties||{};
    const local = featureVal(p,["cislo","CISLO_OKRSKU","okrsek","cislo_okrsku","cislo_okrsku_text"]);
    const global= featureVal(p,["ID_OKRSEK","id","ID","okrsek_id","id_okrsku"]);
    if(local) localSet.add(String(local));
    if(global) globalSet.add(String(global));
    if(local && global) pairs.push({ local:String(local), global:String(global) });
  }
  return { pairs, localSet, globalSet };
}

// --- join strategie ---
// Rozhodni, zda T4 OKRSEK odpovídá lokálním číslům nebo globálním ID z GeoJSONu.
function decideJoinMode(t4, localSet, globalSet){
  let mLocal=0, mGlobal=0;
  for(const r of t4){
    const ok = String(r.OKRSEK||"");
    if(localSet.has(ok)) mLocal++;
    if(globalSet.has(ok)) mGlobal++;
  }
  if(mLocal===0 && mGlobal===0) return "unknown";
  return (mLocal>=mGlobal) ? "direct-local" : "via-pairs";
}

function buildResultsDirectLocal(t4, t4p, cns, localSet){
  const t4ByLocal=new Map();
  for(const r of t4){ const k=String(r.OKRSEK||""); if(localSet.has(k)) t4ByLocal.set(k,r); }
  const t4pByLocal=new Map();
  for(const r of t4p){ const k=String(r.OKRSEK||""); if(!localSet.has(k)) continue; (t4pByLocal.get(k)||t4pByLocal.set(k,[]).get(k)).push(r); }

  const out={}; let matched=0;
  for(const local of localSet){
    const base=t4ByLocal.get(local);
    if(!base) continue;
    matched++;
    const rows=t4pByLocal.get(local)||[];
    const agg=rows.reduce((acc,r)=>{ if(!r.party_code) return acc; acc[r.party_code]=(acc[r.party_code]||0)+(r.votes||0); return acc; },{});
    const parties=Object.entries(agg).map(([code,votes])=>({ code, name:cns[code]||code, votes:+votes })).sort((a,b)=>b.votes-a.votes);
    out[local]={ registered:base.registered||0, turnout_pct: base.registered ? +(100*(base.envelopes/base.registered)).toFixed(2) : 0, valid: base.valid||0, parties };
  }
  console.log(`Join (direct-local): ${matched}/${localSet.size}`);
  return out;
}

function buildResultsViaPairs(t4, t4p, cns, pairs){
  const t4ByGlobal=new Map();
  for(const r of t4){ const k=String(r.OKRSEK||""); t4ByGlobal.set(k,r); }
  const t4pByGlobal=new Map();
  for(const r of t4p){ const k=String(r.OKRSEK||""); (t4pByGlobal.get(k)||t4pByGlobal.set(k,[]).get(k)).push(r); }

  const out={}; let matched=0;
  for(const {local,global} of pairs){
    const base=t4ByGlobal.get(global);
    if(!base) continue;
    matched++;
    const rows=t4pByGlobal.get(global)||[];
    const agg=rows.reduce((acc,r)=>{ if(!r.party_code) return acc; acc[r.party_code]=(acc[r.party_code]||0)+(r.votes||0); return acc; },{});
    const parties=Object.entries(agg).map(([code,votes])=>({ code, name:cns[code]||code, votes:+votes })).sort((a,b)=>b.votes-a.votes);
    out[local]={ registered:base.registered||0, turnout_pct: base.registered ? +(100*(base.envelopes/base.registered)).toFixed(2) : 0, valid: base.valid||0, parties };
  }
  console.log(`Join (via-pairs local↔global): ${matched}/${pairs.length}`);
  return out;
}

function loadManualMandates(tag){
  const f=path.join("manual",`mandates_${tag}.json`);
  if(fs.existsSync(f)){ try{ const j=JSON.parse(fs.readFileSync(f,"utf8")); if(Array.isArray(j.parties)) return j.parties.map(String); }catch{} }
  return null;
}

async function processElection(tag, links){
  const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),`${tag}-`));
  if(!links.dataZip || !links.cnsZip) throw new Error(`${tag}: chybí zipy dat/číselníků`);
  const dataZip=await downloadToFile(links.dataZip,path.join(tmp,`${tag}_data.zip`));
  const cnsZip =await downloadToFile(links.cnsZip ,path.join(tmp,`${tag}_cns.zip` ));
  if(!links.okrskyUrl) throw new Error(`${tag}: chybí URL na GeoJSON okrsků`);
  const okrGeoPath=await downloadToFile(links.okrskyUrl,path.join(tmp,`${tag}_okrsky.geojson`));

  const dataDir=unzipToDir(dataZip,path.join(tmp,"data"));
  const cnsDir =unzipToDir(cnsZip ,path.join(tmp,"cns"));
  const files=listFilesDeep(dataDir);

  const t4File = detectCsv(files,["OKRSEK","VOL_SEZNAM","VYD_OBALKY","PL_HL_CELK"]) || files.find(f=>/t4.*\.csv$/i.test(f));
  const t4pFile= detectCsv(files,["OKRSEK","KSTRANA","POC_HLASU"]) || files.find(f=>/t4p.*\.csv$/i.test(f));
  if(!t4File || !t4pFile) throw new Error(`${tag}: nenašel jsem T4/T4p`);

  const t4=readT4(t4File);
  const t4p=readT4p(t4pFile);
  const cns=readCNS(cnsDir);

  const fullGeo=JSON.parse(fs.readFileSync(okrGeoPath,"utf8"));
  const manualMandates=loadManualMandates(tag);

  for(const target of TARGETS){
    let geoFiltered=filterPrecincts(fullGeo,target);
    if(!geoFiltered.features?.length){ console.warn(`[${tag}] 0 polygonů po filtru ${target.obec}:${target.momc} – fallback bez filtru`); geoFiltered=fullGeo; }

    const {pairs, localSet, globalSet} = harvestLocalGlobal(geoFiltered);
    const mode = decideJoinMode(t4, localSet, globalSet);
    let okrResults={};
    if(mode==="direct-local"){
      okrResults = buildResultsDirectLocal(t4,t4p,cns,localSet);
    }else if(mode==="via-pairs" && pairs.length){
      okrResults = buildResultsViaPairs(t4,t4p,cns,pairs);
    }else{
      // nouzově zkus direct-local
      console.warn(`[${tag}] Join mode unknown – zkouším direct-local jako fallback`);
      okrResults = buildResultsDirectLocal(t4,t4p,cns,localSet);
    }
    // filtr subjektů (volitelně)
    if(manualMandates){
      for(const k of Object.keys(okrResults)){
        const low=manualMandates.map(x=>x.toLowerCase());
        okrResults[k].parties = (okrResults[k].parties||[]).filter(p=>low.some(a=>(p.name||"").toLowerCase().includes(a)));
      }
    }

    await fsp.mkdir(OUT_DIR,{recursive:true});
    const suffix = target.momc ? `${target.obec}_${target.momc}` : `${target.obec}`;
    fs.writeFileSync(path.join(OUT_DIR,`precincts_${tag}_${suffix}.geojson`), JSON.stringify(geoFiltered));
    fs.writeFileSync(path.join(OUT_DIR,`results_${tag}_${suffix}.json`), JSON.stringify({
      meta:{ election:tag, key:"local_cislo", join_mode:mode, target, generated:new Date().toISOString(), source:"volby.cz/ČSÚ" },
      okrsky: okrResults
    }));
  }
}

// --- resolvery ---
async function fetchHtml(u){ return await (await HTTP(u)).text(); }
function anchors(html){ return [...html.matchAll(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({href:m[1].startsWith("http")?m[1]:new URL(m[1],"https://www.volby.cz").toString(), text:m[2].replace(/\s+/g," ").trim()})); }

async function resolvePSP2025(){
  const dataZip="https://www.volby.cz/opendata/ps2025/PS2025data20251005_csv.zip";
  const cnsZip ="https://www.volby.cz/opendata/ps2025/PS2025ciselniky20251005_csv.zip";
  const okrskyUrl=process.env.OKRSKY_2025_GEOJSON_URL || null;
  if(!okrskyUrl) console.warn("[PSP2025] Chybí OKRSKY_2025_GEOJSON_URL (GeoJSON okrsků).");
  return { dataZip, cnsZip, okrskyUrl };
}
async function resolveKZ2024(){
  const hrefs=anchors(await fetchHtml("https://www.volby.cz/opendata/kz2024/kz2024_opendata.htm"));
  const dataZip=(hrefs.find(h=>/okrsk|okrsky|okrskov/i.test(h.text)&&/\.zip$/i.test(h.href))||hrefs.find(h=>/kz2024.*data.*\.zip$/i.test(h.href)))?.href||null;
  const cnsZip =(hrefs.find(h=>/číselní|ciselnik/i.test(h.text)&&/\.zip$/i.test(h.href))||hrefs.find(h=>/kz2024.*cisel.*\.zip$/i.test(h.href)))?.href||null;
  const okrskyUrl=(hrefs.find(h=>/geojson/i.test(h.text)&&/\.geojson$/i.test(h.href))?.href)||"https://www.volby.cz/opendata/kz2024/geo/vol_okrsky_2024g100.geojson";
  return { dataZip, cnsZip, okrskyUrl };
}
async function resolveKV2022(){
  const hrefs=anchors(await fetchHtml("https://www.volby.cz/opendata/kv2022/kv2022_opendata.htm"));
  const dataZip=(hrefs.find(h=>/okrsk|okrsky|okrskov/i.test(h.text)&&/\.zip$/i.test(h.href))||hrefs.find(h=>/kv2022.*data.*\.zip$/i.test(h.href)))?.href||null;
  const cnsZip =(hrefs.find(h=>/číselní|ciselnik/i.test(h.text)&&/\.zip$/i.test(h.href))||hrefs.find(h=>/kv2022.*cisel.*\.zip$/i.test(h.href)))?.href||null;
  const okrskyUrl=(hrefs.find(h=>/geojson/i.test(h.text)&&/\.geojson$/i.test(h.href))?.href)||"https://www.volby.cz/opendata/kv2022/geo/vol_okrsky_2022g100.geojson";
  return { dataZip, cnsZip, okrskyUrl };
}

// --- main ---
(async function main(){
  await fsp.mkdir(OUT_DIR,{recursive:true});
  const psp=await resolvePSP2025(); await processElection("psp2025", psp);
  try{ const kz=await resolveKZ2024(); if(!kz.dataZip||!kz.cnsZip) throw new Error("kz2024: chybí zipy"); await processElection("kz2024", kz); }
  catch(e){ console.warn("[WARN] KZ2024 přeskočeno:", e.message||e); }
  try{ const kv=await resolveKV2022(); if(!kv.dataZip||!kv.cnsZip) throw new Error("kv2022: chybí zipy"); await processElection("kv2022", kv); }
  catch(e){ console.warn("[WARN] KV2022 přeskočeno:", e.message||e); }
  console.log(`✔ Hotovo. Výstupy v ${OUT_DIR}`);
})().catch(e=>{ console.error(e); process.exit(1); });
