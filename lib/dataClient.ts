// lib/dataClient.ts

import { Year, ResultMap, yearToTag } from "./types";

/**
 * Kódy území (město + MO/část). Lze přepsat přes env proměnné,
 * jinak se použijí defaulty pro Ostrava (554821) a MOaP (545911).
 */
const CITY_CODE = process.env.NEXT_PUBLIC_CITY_CODE || "554821";
const DISTRICT_CODE = process.env.NEXT_PUBLIC_DISTRICT_CODE || "545911";

/** Pomocné – složí URL souboru v /public/data */
function dataUrl(kind: "results" | "precincts", tag: string) {
  const base = `/data/${kind}_${tag}_${CITY_CODE}_${DISTRICT_CODE}`;
  return kind === "results" ? `${base}.json` : `${base}.geojson`;
}

/** HEAD na URL – vrací true, když soubor existuje */
async function headExists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Vrátí URL GeoJSONu pro daný tag (psp2025/kv2022/kz2024 atd.).
 * Tady nic nestahujeme, jen skládáme cestu. Ověření existence
 * řeší `page.tsx` přes HEAD a případný fallback.
 */
export function loadPrecinctsGeoJSON(tag: string): Promise<string> {
  return Promise.resolve(dataUrl("precincts", tag));
}

/**
 * Načte výsledky pro požadovaný rok (když soubor neexistuje, vrátí null).
 */
export async function loadResults(year: Year): Promise<ResultMap | null> {
  const tag = yearToTag[year];
  const url = dataUrl("results", tag);
  if (!(await headExists(url))) return null;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as ResultMap;
}

/**
 * Načte výsledky všech podporovaných roků, které v repo skutečně jsou.
 * Roky, pro které soubor chybí (404), jednoduše vynechá.
 */
export async function loadResultsAllYears(): Promise<Record<Year, ResultMap>> {
  const out: Partial<Record<Year, ResultMap>> = {};
  const years: Year[] = ["2025", "2024", "2022"];

  for (const y of years) {
    const one = await loadResults(y);
    if (one) out[y] = one;
  }

  return out as Record<Year, ResultMap>;
}

/**
 * Zjištění ID okrsku z GeoJSON feature.properties.
 * Vrací string – sjednotíme si typ pro porovnávání/filtry.
 */
export function getOkrsekIdFromProps(props: Record<string, unknown>): string | null {
  const keys = [
    "OKRSEK",
    "CIS_OKRSEK",
    "CISLO_OKRSKU",
    "cislo_okrsku",
    "okrsek",
    "okrsek_cislo",
    "cislo_okrsku_text",
    "ID_OKRSKY",
  ];

  for (const k of keys) {
    if (props[k] != null) {
      const v = props[k] as any;
      // povolíme number i string
      if (typeof v === "number" || typeof v === "string") return String(v);
    }
  }
  return null;
}
