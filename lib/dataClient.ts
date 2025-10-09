// lib/dataClient.ts
import { Year, yearToTag, ResultMap } from "@/lib/types";

const AREA_SUFFIX = "554821_545911"; // Ostrava + MOaP

/**
 * Bezpečný wrapper pro fetch statických JSON souborů.
 * Nastavuje cache: "no-store" pro stabilní chování během buildu Next.js.
 */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    // Používáme { cache: "no-store" } pro jistotu během server-side renderingu / buildu
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`Failed to fetch ${url}: Status ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error(`Error fetching ${url}`, e);
    return null;
  }
}

export async function loadResults(y: Year): Promise<ResultMap | null> {
  const tag = yearToTag[y];
  const url = `/data/results_${tag}_${AREA_SUFFIX}.json`;
  return await fetchJson<ResultMap>(url);
}

export async function loadResultsAllYears(): Promise<Record<Year, ResultMap>> {
  const out: Partial<Record<Year, ResultMap>> = {};
  for (const y of ["2025","2024","2022"] as const) {
    const r = await loadResults(y);
    if (r) out[y] = r;
  }
  // Předpokládáme, že typ Year má jen tyto 3 hodnoty
  return out as Record<Year, ResultMap>;
}

export async function loadPrecinctsGeoJSON(tag: "psp2025"|"kz2024"|"kv2022"): Promise<string> {
  // Vrátíme URL GeoJSONu, ten se stáhne až na straně klienta / mapy
  return `/data/precincts_psp2025_${AREA_SUFFIX}.geojson`;
}

/**
 * Získá unikátní ID okrsku z vlastností GeoJSON feature,
 * které slouží jako klíč pro spojení s daty z results_*.json.
 * DŮLEŽITÉ: Musí odpovídat klíči, který vkládá prepare-data.js.
 */
export function getOkrsekIdFromProps(props: Record<string, any>): string | null {
  const keys = Object.keys(props || {});

  // 1. Prioritně kontrolujeme klíč, který vkládá prepare-data.js (nejsilnější shoda)
  if (props?.okrsek_local != null) return String(props.okrsek_local);
  
  // 2. Fallback na nejčastější klíče pro okrsky
  const candidates = [
    "cislo_okrsku", 
    "OKRSEK", 
    "CIS_OKRSEK", 
    "CISLO_OKRSKU", 
    "okrsek", 
    "okrsek_id"
  ];
  
  for (const c of candidates) {
    // Hledáme case-insensitive shodu
    const k = keys.find(k => k.toLowerCase() === c.toLowerCase());
    if (k && props[k] != null) return String(props[k]);
  }
  
  return null;
}
