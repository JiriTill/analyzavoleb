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
  if (!props) return null;

  // 1) preferuj klíče, které jasně obsahují "okrsek"
  const preferKeys = [
    "cislo_okrsku","cis_okrsek","okrsek","okrsek_cislo","cis_ok",
    "CISLO_OKRSKU","CIS_OKRSEK","OKRSEK"
  ];
  for (const k of Object.keys(props)) {
    const kl = k.toLowerCase();
    if (preferKeys.some(p => kl === p.toLowerCase() || kl.includes("okrsek"))) {
      const v = String(props[k] ?? "").trim();
      const digits = (v.match(/\d+/g) || []).join("");
      if (!digits) continue;
      if (digits.length === 4) return digits;             // typický formát (8001…)
      if (digits.length <= 5) return digits.replace(/^0+/, "");
    }
  }

  // 2) fallback: projdi všechny hodnoty a najdi 3–5místné číslo
  for (const v of Object.values(props)) {
    const m = String(v ?? "").match(/\b\d{3,5}\b/);
    if (m) return String(parseInt(m[0], 10));
  }
  return null;
}

