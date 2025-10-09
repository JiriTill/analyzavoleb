// lib/dataClient.ts
import { Year, yearToTag, ResultMap } from "@/lib/types";

// POZOR: Tato konstanta MUSÍ odpovídat TARGETS v prepare-data.js (OBEC[:MOMC]).
// Zde je to pro "554821:545911" (Ostrava + MOaP).
const AREA_SUFFIX = "554821_545911"; 

export async function loadResults(y: Year): Promise<ResultMap | null> {
  const tag = yearToTag[y];
  // Vytvoří URL ve formátu /data/results_psp2025_554821_545911.json
  const url = `/data/results_${tag}_${AREA_SUFFIX}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to load results from ${url}: Status ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`Error fetching results from ${url}`, e);
    return null;
  }
}

export async function loadResultsAllYears(): Promise<Record<Year, ResultMap>> {
  const out: Partial<Record<Year, ResultMap>> = {};
  // Použití as const pro jistotu typu
  for (const y of ["2025", "2024", "2022"] as const as Year[]) {
    const r = await loadResults(y);
    if (r) out[y] = r;
  }
  // Předpokládáme, že Year má jen tyto tři hodnoty.
  return out as Record<Year, ResultMap>;
}

export async function loadPrecinctsGeoJSON(tag: "psp2025" | "kz2024" | "kv2022"): Promise<string> {
  // Vytvoří URL ve formátu /data/precincts_psp2025_554821_545911.geojson
  return `/data/precincts_${tag}_${AREA_SUFFIX}.geojson`;
}

// !!! DŮLEŽITÉ: klíč je okrsek_local (sjednocené lokální číslo z GeoJSONu)
export function getOkrsekIdFromProps(props: Record<string, any>): string | null {
  // Primární klíč pro join, měl by být vložen v prepare-data.js
  if (props?.okrsek_local != null) return String(props.okrsek_local);
  
  // fallbacky – jen kdyby nahoře chybělo (méně spolehlivé, protože nejsou kanonizované)
  const candidates = ["OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU", "cislo_okrsku", "okrsek"];
  for (const c of candidates) {
    for (const k of Object.keys(props || {})) {
      // Porovnání case-insensitive
      if (k.toLowerCase() === c.toLowerCase() && props[k] != null) return String(props[k]);
    }
  }
  return null;
}
