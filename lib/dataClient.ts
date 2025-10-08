// lib/dataClient.ts
import { Year, yearToTag, ResultMap } from "@/lib/types";

const AREA_SUFFIX = "554821_545911"; // Ostrava + MOaP

export async function loadResults(y: Year): Promise<ResultMap | null> {
  const tag = yearToTag[y];
  const url = `/data/results_${tag}_${AREA_SUFFIX}.json`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function loadResultsAllYears(): Promise<Record<Year, ResultMap>> {
  const out: Partial<Record<Year, ResultMap>> = {};
  for (const y of ["2025", "2024", "2022"] as Year[]) {
    const d = await loadResults(y);
    if (d) out[y] = d;
  }
  return out as Record<Year, ResultMap>;
}

export async function loadPrecinctsGeoJSON(tag: "psp2025" | "kz2024" | "kv2022"): Promise<string> {
  return `/data/precincts_${tag}_${AREA_SUFFIX}.geojson`;
}

/** Převeď libovolnou hodnotu na “8012” apod. */
export function normalizeOkrsekId(v: unknown): string | null {
  if (v == null) return null;
  const m = String(v).match(/\d+/g);
  if (!m) return null;
  return String(parseInt(m.join(""), 10));
}

/** Najdi v properties správné číslo okrsku – zvládá cislo, okrsek, cislo_okrsku, okrsek_cislo… */
export function getOkrsekIdFromProps(props: Record<string, any>): string | null {
  const keys = Object.keys(props || {});
  const exact = [
    "okrsek",
    "cislo",
    "cislo_okrsku",
    "cislo_okrsku_text",
    "okrsek_cislo",
    "cis_ok",
    "cis_okrsek",
    "CISLO_OKRSKU",
    "CIS_OKRSEK",
    "OKRSEK",
  ];

  // 1) přesná shoda běžných názvů
  for (const name of exact) {
    const k = keys.find((kk) => kk.toLowerCase() === name.toLowerCase());
    if (k && props[k] != null) {
      const id = normalizeOkrsekId(props[k]);
      if (id) return id;
    }
  }

  // 2) fuzzy – pole, jejichž název obsahuje "okrsek" nebo "cislo"
  for (const k of keys) {
    const kl = k.toLowerCase();
    if (kl.includes("okrsek") || (kl.includes("cislo") && !kl.includes("obec") && !kl.includes("momc"))) {
      const id = normalizeOkrsekId(props[k]);
      if (id) return id;
    }
  }

  // 3) poslední záchrana – první “malé” čistě číselné pole (3–5 číslic)
  for (const k of keys) {
    const id = normalizeOkrsekId(props[k]);
    if (id && id.length >= 3 && id.length <= 5) return id;
  }
  return null;
}
