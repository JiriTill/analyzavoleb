// lib/dataClient.ts
import type { Year, ResultMap } from "./types";

/** Preferované property pro „číslo okrsku“ – pořadí je DŮLEŽITÉ */
const PREFERRED_OKRSEK_KEYS = [
  "CISLO_OKRSKU",
  "cislo_okrsku",
  "CIS_OKRSEK",
  "cis_okrsek",
  "cis_okrsku",
  // až nakonec obecné/nezaručené:
  "OKRSEK",
  "okrsek",
  "okrsek_cislo",
  "cislo_okrsku_text",
];

function normId(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  // skutečná čísla okrsků mívají 3–6 číslic (8001, 12005, …)
  if (/^\d{3,6}$/.test(s)) return s.replace(/^0+/, "") || "0";
  return null;
}

/** Najdi správné ID okrsku v properties (preferuj „CISLO_OKRSKU“ apod.). */
export function getOkrsekIdFromProps(props: Record<string, unknown>): string | null {
  // 1) preferované klíče
  for (const k of PREFERRED_OKRSEK_KEYS) {
    const val = normId(props?.[k]);
    if (val) return val;
  }
  // 2) nouzově cokoliv co v názvu obsahuje „okrsek“
  const anyKey = Object.keys(props || {}).find((k) => /okrsek/i.test(k));
  if (anyKey) {
    const val = normId(props[anyKey]);
    if (val) return val;
  }
  return null;
}

/** Robustní fetch JSON: vrátí `null` pro 404/abort, jinak vyhodí reálné chyby. */
async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404 || res.status === 0) return null; // chybějící rok nevadí
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return (await res.json()) as T;
  } catch (e: any) {
    // AbortError apod. – berem jako „nenašel jsem“
    return null;
  }
}

export async function loadPrecinctsGeoJSON(tag: string): Promise<string> {
  // build url podle toho, co generuješ v /public/data/
  // (např. precincts_psp2025_554821_545911.geojson)
  // nechávám zde jen formu s tagem (zbytek se sestavuje na backendu u tebe)
  return `/data/precincts_${tag}_554821_545911.geojson`;
}

const yearToTagLocal: Record<Year, string> = {
  "2025": "psp2025",
  "2024": "kz2024",
  "2022": "kv2022",
};

export async function loadResultsAllYears(): Promise<Record<Year, ResultMap> | null> {
  const out: Partial<Record<Year, ResultMap>> = {};
  // bereme jen to, co skutečně existuje
  for (const y of Object.keys(yearToTagLocal) as Year[]) {
    const tag = yearToTagLocal[y];
    const url = `/data/results_${tag}_554821_545911.json`;
    const json = await fetchJsonOrNull<ResultMap>(url);
    if (json) out[y] = json;
  }
  return (out as Record<Year, ResultMap>) ?? null;
}

// export pro page.tsx
export const yearToTag = yearToTagLocal;
