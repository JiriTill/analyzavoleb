// lib/dataClient.ts
import { Year, yearToTag, ResultMap } from "@/lib/types";

const AREA_SUFFIX = "554821_545911"; // Ostrava + MOaP

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
  for (const y of ["2025", "2024", "2022"] as Year[]) {
    const r = await loadResults(y);
    if (r) out[y] = r;
  }
  return out as Record<Year, ResultMap>;
}

export async function loadPrecinctsGeoJSON(tag: "psp2025" | "kz2024" | "kv2022"): Promise<string> {
  return `/data/precincts_${tag}_${AREA_SUFFIX}.geojson`;
}

// !!! DŮLEŽITÉ: klíč je okrsek_local (sjednocené lokální číslo z GeoJSONu)
export function getOkrsekIdFromProps(props: Record<string, any>): string | null {
  if (props?.okrsek_local != null) return String(props.okrsek_local);
  // fallbacky – jen kdyby nahoře chybělo
  const candidates = ["OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU", "cislo_okrsku", "okrsek"];
  for (const c of candidates) {
    for (const k of Object.keys(props || {})) {
      if (k.toLowerCase() === c.toLowerCase() && props[k] != null) return String(props[k]);
    }
  }
  return null;
}

