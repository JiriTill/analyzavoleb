import { Year, yearToTag, ResultMap } from "@/lib/types";

// suffix pro MOaP (Ostrava: 554821, MOaP: 545911)
const AREA_SUFFIX = "554821_545911";

export async function loadResults(y: Year): Promise<ResultMap | null> {
  const tag = yearToTag[y];
  const url = `/data/results_${tag}_${AREA_SUFFIX}.json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
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

// DŮLEŽITÉ: bereme okrsek z okrsek_local (join klíč v results_*.json)
export function getOkrsekIdFromProps(props: Record<string, any>): string | null {
  const prefer = ["okrsek_local", "OKRSEK", "CIS_OKRSEK", "CISLO_OKRSKU", "cislo_okrsku"];
  for (const k of Object.keys(props || {})) {
    const kl = k.toLowerCase();
    if (prefer.some(p => p.toLowerCase() === kl)) {
      const v = props[k];
      if (v != null && String(v).trim() !== "") return String(v).trim().replace(/^0+/, "");
    }
  }
  // fallback: první numericky vypadající hodnota
  for (const k of Object.keys(props || {})) {
    const v = String(props[k] ?? "");
    if (/^\d+$/.test(v)) return v.replace(/^0+/, "");
  }
  return null;
}
