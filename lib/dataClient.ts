// lib/dataClient.ts
import { Year, yearToTag, ResultMap } from "@/lib/types";

const AREA_SUFFIX = "554821_545911"; // Ostrava + MOaP

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (_) {
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
  for (const y of ["2025","2024","2022"] as Year[]) {
    const r = await loadResults(y);
    if (r) out[y] = r;
  }
  return out as Record<Year, ResultMap>;
}

export async function loadPrecinctsGeoJSON(tag: "psp2025"|"kz2024"|"kv2022"): Promise<string> {
  // používáme jeden a tentýž GeoJSON (PSP 2025) – soubor leží v /public/data, generuje se jinak
  return `/data/precincts_psp2025_${AREA_SUFFIX}.geojson`;
}

/**
 * Získá unikátní ID okrsku z vlastností GeoJSON feature,
 * které slouží jako klíč pro spojení s daty z results_*.json.
 */
export function getOkrsekIdFromProps(props: Record<string, any>): string | null {
  // 1. Prioritně kontrolujeme normalizovaný klíč, který vkládá prepare-data.js
  if (props?.okrsek_local != null) return String(props.okrsek_local);
  
  // 2. Fallback na surové klíče (méně spolehlivé)
  const keys = Object.keys(props || {});
  const candidates = ["cislo_okrsku","OKRSEK","CIS_OKRSEK","CISLO_OKRSKU","okrsek","okrsek_id"];
  
  for (const c of candidates) {
    const k = keys.find(k => k.toLowerCase() === c.toLowerCase());
    if (k && props[k] != null) return String(props[k]);
  }
  
  // 3. Nouzově: první numerický property (pokud GeoJSON má jen čísla)
  const numKey = keys.find(k => /^\d+$/.test(String(props[k])));
  return numKey ? String(props[numKey]) : null;
}
