import { Year, yearToTag, ResultMap } from "@/lib/types";


const AREA_SUFFIX = "554821_545911"; // Ostrava + MOaP (možno změnit na jiný TARGET později)


export async function loadResults(y: Year): Promise<ResultMap | null> {
const tag = yearToTag[y];
const url = `/data/results_${tag}_${AREA_SUFFIX}.json`;
try {
const res = await fetch(url);
if (!res.ok) return null;
return await res.json();
} catch {
return null;
}
}


export async function loadResultsAllYears(): Promise<Record<Year, ResultMap>> {
const out: Partial<Record<Year, ResultMap>> = {};
for (const y of ["2025","2024","2022"] as Year[]) {
const r = await loadResults(y);
if (r) out[y] = r;
}
return out as Record<Year, ResultMap>;
}


export async function loadPrecinctsGeoJSON(tag: "psp2025"|"kz2024"|"kv2022"): Promise<string> {
return `/data/precincts_${tag}_${AREA_SUFFIX}.geojson`;
}


export function getOkrsekIdFromProps(props: Record<string, any>): string | null {
const keys = Object.keys(props || {});
const candidates = ["cislo_okrsku", "OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU", "okrsek", "okrsek_id"];
for (const c of candidates) {
const k = keys.find(k => k.toLowerCase() === c.toLowerCase());
if (k && props[k] != null) return String(props[k]);
}
// fallback: pick first numeric-looking property
const numKey = keys.find(k => /^\d+$/.test(String(props[k])));
return numKey ? String(props[numKey]) : null;
}
