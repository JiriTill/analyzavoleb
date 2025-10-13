"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type FilterSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { Year, yearToTag, ResultMap, PrecinctResultMin } from "@/lib/types";
import {
  loadResultsAllYears,
  loadPrecinctsGeoJSON,
  getOkrsekIdFromProps,
} from "@/lib/dataClient";

import { YearTabs } from "@/components/YearTabs";
import { SidePanel } from "@/components/SidePanel";

// ---- jednotné kandidátní názvy property s číslem okrsku ----
const OKRSEK_PROP_KEYS = [
  "OKRSEK",
  "CIS_OKRSEK",
  "CISLO_OKRSKU",
  "cislo_okrsku",
  "okrsek",
  "okrsek_cislo",
  "cislo_okrsku_text",
];

// prázdný (nemožný) filtr – použije se při inicializaci a při resetu výběru
function emptySelectionFilter(): FilterSpecification {
  return [
    "==",
    ["to-string", ["get", OKRSEK_PROP_KEYS[0]]],
    "__none__",
  ] as FilterSpecification;
}

// výběrový filtr pro zadané id okrsku (OR přes možné property)
function buildSelectionFilter(id: string): FilterSpecification {
  const clauses: FilterSpecification[] = OKRSEK_PROP_KEYS.map((k) => [
    "==",
    ["to-string", ["get", k]],
    id,
  ]) as unknown as FilterSpecification[];

  if (clauses.length === 1) return clauses[0];
  return ["any", ...(clauses as unknown as FilterSpecification[])] as FilterSpecification;
}

export default function Page() {
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [year, setYear] = useState<Year>("2025");
  const [selectedOkrsek, setSelectedOkrsek] = useState<string | null>(null);
  const [results, setResults] = useState<Record<Year, ResultMap> | null>(null);
  const [geojsonUrl, setGeojsonUrl] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  // načtení výsledků pro všechny roky (kvůli trendům)
  useEffect(() => {
    loadResultsAllYears().then(setResults).catch(() => setResults(null));
  }, []);

  // inicializace mapy (jen jednou)
  useEffect(() => {
    if (mapRef.current) return;

    const style = process.env.NEXT_PUBLIC_MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`
      : "https://demotiles.maplibre.org/style.json";

    const map = new maplibregl.Map({
      container: "map",
      style,
      center: [18.289, 49.834], // Ostrava
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    map.once("load", () => {
      // po načtení stylu přidej vrstvy pro aktuální rok
      refreshYearLayer(map, year);

      // interakce
      map.on("click", "precinct-fill", (e) => {
        const f = e.features?.[0];
        const id = f?.properties ? getOkrsekIdFromProps(f.properties) : null;
        if (id) {
          const idStr = String(id);
          setSelectedOkrsek(idStr);
          const sel = buildSelectionFilter(idStr);
          map.setFilter("precinct-selected", sel);
          map.setFilter("precinct-selected-outline", sel);
        }
      });

      map.on("mousemove", "precinct-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "precinct-fill", () => (map.getCanvas().style.cursor = ""));
    });
  }, [year]);

  // přepnutí roku → vyměň GeoJSON a resetni výběr
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!map.isStyleLoaded()) {
      map.once("load", () => refreshYearLayer(map, year));
    } else {
      refreshYearLayer(map, year);
    }
    setSelectedOkrsek(null);
  }, [year]);

  // přidání/obnovení vrstev pro daný rok
  async function refreshYearLayer(map: maplibregl.Map, y: Year) {
    const tag = yearToTag[y];
    const url = await loadPrecinctsGeoJSON(tag);
    setGeojsonUrl(url);

    const srcId = "precincts";
    const fillId = "precinct-fill";
    const lineId = "precinct-outline";
    const selFillId = "precinct-selected";
    const selLineId = "precinct-selected-outline";

    const existing = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;

    if (existing) {
      existing.setData(url); // URL string je v MapLibre povolen
      // reset výběru
      map.setFilter(selFillId, emptySelectionFilter());
      map.setFilter(selLineId, emptySelectionFilter());
      return;
    }

    map.addSource(srcId, { type: "geojson", data: url });

    // základní vrstva (všechny okrsky)
    map.addLayer({
      id: fillId,
      type: "fill",
      source: srcId,
      paint: { "fill-color": "#1d4ed8", "fill-opacity": 0.08 },
    });

    map.addLayer({
      id: lineId,
      type: "line",
      source: srcId,
      paint: { "line-color": "#1d4ed8", "line-width": 1.2 },
    });

    // vrstva vybraného okrsku (prázdný filtr na startu)
    map.addLayer({
      id: selFillId,
      type: "fill",
      source: srcId,
      filter: emptySelectionFilter(),
      paint: { "fill-color": "#0b3bbd", "fill-opacity": 0.28 },
    });

    map.addLayer({
      id: selLineId,
      type: "line",
      source: srcId,
      filter: emptySelectionFilter(),
      paint: { "line-color": "#0b3bbd", "line-width": 2.2 },
    });
  }

  // data pro pravý panel podle aktuálně vybraného okrsku
  const selectedData: PrecinctResultMin | null = useMemo(() => {
    if (!results || !selectedOkrsek) return null;
    const out: any = { okrsek: selectedOkrsek, years: {} };
    (Object.keys(results) as Year[]).forEach((y) => {
      const ok = (results[y] as any)?.okrsky?.[selectedOkrsek];
      if (ok) out.years[y] = ok;
    });
    return out;
  }, [results, selectedOkrsek]);

  return (
    <div className="flex h-screen w-screen">
      {/* levý horní info box */}
      <div className="absolute z-10 m-2">
        <div className="rounded bg-white/90 shadow px-2 py-1 text-sm">
          <div className="font-medium">Analytický nástroj pro volební kampaň</div>
          <button className="underline" onClick={() => setShowAbout((v) => !v)}>
            Zjisti více o projektu
          </button>
        </div>
        {showAbout && (
          <div className="mt-2 rounded bg-white/95 shadow p-3 text-xs max-w-xs">
            Nástroj zobrazuje okrskové hranice a výsledky (2022, 2024, 2025) pro rychlou
            orientaci v kampani – kde je silná/slabá podpora a jak se vyvíjí účast.
            Autor: Jiří Till.
            <button
              className="ml-2 text-gray-600"
              onClick={() => setShowAbout(false)}
              aria-label="Zavřít"
              title="Zavřít"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* mapa */}
      <div id="map" className="flex-1" />

      {/* pravý panel */}
      <div className="w-[420px] border-l p-4 overflow-auto">
        <div className="mb-3">
          <YearTabs year={year} setYear={setYear} />
        </div>

        {!results ? (
          <p>
            Načítám data… Pokud se nic nenačte, zkontroluj, že Actions vygeneroval{" "}
            <code>/public/data/results_*.json</code>.
          </p>
        ) : !geojsonUrl ? (
          <p>
            Chybí GeoJSON. Zkontroluj prostředí (např. <code>OKRSKY_2025_GEOJSON_URL</code>)
            nebo existenci souboru v <code>/public/data</code>.
          </p>
        ) : !selectedOkrsek ? (
          <p>👈 Klikni na okrsek v mapě pro zobrazení detailů a trendů (2022 → 2024 → 2025).</p>
        ) : (
          <SidePanel okrsekId={selectedOkrsek} year={year} resultsAllYears={results} />
        )}
      </div>
    </div>
  );
}
