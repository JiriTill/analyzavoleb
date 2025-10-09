"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Year, yearToTag, ResultMap, PrecinctResultMin } from "@/lib/types";
import { loadResultsAllYears, loadPrecinctsGeoJSON, getOkrsekIdFromProps } from "@/lib/dataClient";
import { YearTabs } from "@/components/YearTabs";
import { SidePanel } from "@/components/SidePanel";

export default function Page() {
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [year, setYear] = useState<Year>("2025");
  const [selectedOkrsek, setSelectedOkrsek] = useState<string | null>(null);
  const [results, setResults] = useState<Record<Year, ResultMap> | null>(null);
  const [geojsonUrl, setGeojsonUrl] = useState<string | null>(null);

  // pro UI „O projektu“
  const [aboutOpen, setAboutOpen] = useState(false);

  // ID features pro hover/selection (MapLibre feature-state)
  const hoveredIdRef = useRef<number | string | null>(null);
  const selectedIdRef = useRef<number | string | null>(null);

  // 1) Načti výsledky pro všechny roky (kvůli trendům)
  useEffect(() => {
    loadResultsAllYears().then(setResults).catch(() => setResults(null));
  }, []);

  // 2) Inicializace mapy
  useEffect(() => {
    if (mapRef.current) return;

    const style = process.env.NEXT_PUBLIC_MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`
      : "https://demotiles.maplibre.org/style.json";

    const map = new maplibregl.Map({
      container: "map",
      style,
      center: [18.289, 49.834], // Ostrava
      zoom: 12
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      // Po načtení stylu přidej okrsky pro aktuální rok
      refreshYearLayer(map, year);

      // Hover – JEN feature-state (bez extra vrstvy/filtru)
      map.on("mousemove", "precinct-fill", (e) => {
        if (!e.features?.length) return;
        const f = e.features[0];
        if (hoveredIdRef.current != null) {
          map.setFeatureState({ source: "precincts", id: hoveredIdRef.current }, { hover: false });
        }
        hoveredIdRef.current = f.id as number | string;
        map.setFeatureState({ source: "precincts", id: hoveredIdRef.current }, { hover: true });
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "precinct-fill", () => {
        if (hoveredIdRef.current != null) {
          map.setFeatureState({ source: "precincts", id: hoveredIdRef.current }, { hover: false });
          hoveredIdRef.current = null;
        }
        map.getCanvas().style.cursor = "";
      });

      // Klik – nastav vybraný okrsek (clear předchozího)
      map.on("click", "precinct-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;

        if (selectedIdRef.current != null) {
          map.setFeatureState({ source: "precincts", id: selectedIdRef.current }, { selected: false });
        }
        selectedIdRef.current = f.id as number | string;
        map.setFeatureState({ source: "precincts", id: selectedIdRef.current }, { selected: true });

        const id = f.properties ? getOkrsekIdFromProps(f.properties) : null; // -> vrací okrsek_local
        if (id) setSelectedOkrsek(String(id));
      });
    });
  }, []);

  // 3) Přepnutí roku → vyměň GeoJSON + reset vybraného
  useEffect(() => {
    if (!mapRef.current) return;
    refreshYearLayer(mapRef.current, year);
    setSelectedOkrsek(null);
  }, [year]);

  // Helper: přidej/aktualizuj zdroj a vrstvy
  async function refreshYearLayer(map: maplibregl.Map, y: Year) {
    const tag = yearToTag[y];
    const url = await loadPrecinctsGeoJSON(tag);
    setGeojsonUrl(url);

    const srcId = "precincts";
    const fillId = "precinct-fill";
    const lineId = "precinct-outline";

    const existing = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;

    // při změně roku zruš highlighty (ID se mohou změnit)
    if (hoveredIdRef.current != null) {
      map.setFeatureState({ source: srcId, id: hoveredIdRef.current }, { hover: false });
      hoveredIdRef.current = null;
    }
    if (selectedIdRef.current != null) {
      map.setFeatureState({ source: srcId, id: selectedIdRef.current }, { selected: false });
      selectedIdRef.current = null;
    }

    if (existing) {
      existing.setData(url);
      return; // vrstvy už existují
    }

    // generateId: true → GeoJSON featurám přidá stabilní ID (nutné pro feature-state)
    map.addSource(srcId, { type: "geojson", data: url, generateId: true });

    // Jemně průhledná výplň + zvýraznění přes feature-state
    map.addLayer({
      id: fillId,
      type: "fill",
      source: srcId,
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false], "#1d4ed8",
          ["boolean", ["feature-state", "hover"], false], "#1d4ed8",
          "#1d4ed8"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 0.35,   // vybraný
          ["boolean", ["feature-state", "hover"], false], 0.20,      // hover
          0.06                                                     // default (víc zprůhlednit)
        ]
      }
    });

    // Obrys s přepínáním síly barvy podle stavu
    map.addLayer({
      id: lineId,
      type: "line",
      source: srcId,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false], "#1d4ed8",
          0.3, // pro hover použijeme šířku místo barvy
          "#1d4ed8"
        ],
        "line-opacity": 0.9,
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 2.2,
          ["boolean", ["feature-state", "hover"], false], 1.8,
          1.0
        ]
      }
    });
  }

  // Data vybraného okrsku (pro SidePanel)
  const selectedData: PrecinctResultMin | null = useMemo(() => {
    if (!results || !selectedOkrsek) return null;
    const out: any = { okrsek: selectedOkrsek, years: {} };
    (["2022", "2024", "2025"] as Year[]).forEach((y) => {
      const ok = results[y]?.okrsky?.[selectedOkrsek];
      if (ok) out.years[y] = ok;
    });
    return out;
  }, [results, selectedOkrsek]);

  return (
    <div className="flex h-screen w-screen relative">
      {/* malý horní panel + rozbalovací „O projektu“ */}
      <div className="absolute top-3 left-3 z-20">
        <div className="bg-white/90 backdrop-blur rounded-lg shadow px-3 py-2">
          <div className="text-sm font-semibold">Analytický nástroj pro volební kampaň</div>
          {!aboutOpen ? (
            <button className="text-xs underline text-blue-700" onClick={() => setAboutOpen(true)}>
              Zjisti více o projektu
            </button>
          ) : (
            <div className="mt-2 max-w-[440px] text-xs text-gray-700">
              <p className="mb-2">
                Interaktivní mapa okrsků s historickými výsledky (2022, 2024, 2025) a odhadem
                „potenciálu“. Slouží k plánování terénních aktivit (door-to-door, stánky…).
                Autor: Jiří Till.
              </p>
              <p className="mb-2">
                Tip: Klikni do mapy na okrsek. Vpravo uvidíš TOP 6 subjektů v daném roce, vývoj
                účasti a trend vybrané strany.
              </p>
              <div className="flex gap-2">
                <button className="text-xs underline" onClick={() => setAboutOpen(false)}>Zavřít</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div id="map" className="flex-1" />
      <div className="w-[420px] border-l bg-white p-4 overflow-auto z-10">
        <div className="mb-3">
          <YearTabs year={year} setYear={setYear} />
        </div>
        {!results ? (
          <p>Načítám data… Pokud se nic nenačte, ještě neběžel GitHub Action, který generuje <code>/public/data</code>.</p>
        ) : !geojsonUrl ? (
          <p>Chybí GeoJSON pro daný rok. Zkontroluj přípravu dat.</p>
        ) : !selectedOkrsek ? (
          <p>👈 Klikni na okrsek v mapě pro zobrazení detailů a trendů (2022 → 2024 → 2025).</p>
        ) : selectedData && Object.keys(selectedData.years || {}).length === 0 ? (
          <p>Pro tento rok nejsou data. Zkus jiný rok nahoře. (Zkontroluj, zda se vygeneroval <code>/public/data/results_…json</code>.)</p>
        ) : (
          <SidePanel okrsekId={selectedOkrsek} year={year} resultsAllYears={results} />
        )}
      </div>
    </div>
  );
}
