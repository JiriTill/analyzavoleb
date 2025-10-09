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
  const [aboutOpen, setAboutOpen] = useState(false);

  // load all results for trends
  useEffect(() => {
    loadResultsAllYears().then(setResults).catch(() => setResults(null));
  }, []);

  // init map
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
      refreshYearLayer(map, year);
    });
  }, []);

  // change year → swap geojson layer
  useEffect(() => {
    if (!mapRef.current) return;
    refreshYearLayer(mapRef.current, year);
    setSelectedOkrsek(null);
  }, [year]);

  async function refreshYearLayer(map: maplibregl.Map, y: Year) {
    const tag = yearToTag[y];
    const url = await loadPrecinctsGeoJSON(tag);
    setGeojsonUrl(url);

    const srcId = "precincts";
    const fillId = "precinct-fill";
    const lineId = "precinct-outline";
    const labelId = "precinct-label";

    const existing = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(url);
    } else {
      map.addSource(srcId, { type: "geojson", data: url, generateId: true });

      // fill layer – more transparent + feature-state driven highlight
      map.addLayer({
        id: fillId,
        type: "fill",
        source: srcId,
        paint: {
          "fill-color": "#1d4ed8",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false], 0.35,
            ["boolean", ["feature-state", "hover"], false], 0.25,
            0.10
          ]
        }
      });

      // outline layer – thicker on selected
      map.addLayer({
        id: lineId,
        type: "line",
        source: srcId,
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false], "#0f172a",
            ["boolean", ["feature-state", "hover"], false], "#1e293b",
            "#1d4ed8"
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false], 2.4,
            ["boolean", ["feature-state", "hover"], false], 1.8,
            1.2
          ]
        }
      });

      // labels with okrsek_label (falls back to other props)
      map.addLayer({
        id: labelId,
        type: "symbol",
        source: srcId,
        layout: {
          "text-field": [
            "coalesce",
            ["get", "okrsek_label"],
            ["get", "CISLO_OKRSKU"],
            ["get", "cislo_okrsku"],
            ["get", "CIS_OKRSEK"],
            ["get", "OKRSEK"]
          ],
          "text-size": 12,
          "text-allow-overlap": true
        },
        paint: {
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.2
        }
      });
    }

    // pointer cursor
    const setCursor = (v: string) => (map.getCanvas().style.cursor = v);
    map.on("mousemove", fillId, () => setCursor("pointer"));
    map.on("mouseleave", fillId, () => setCursor(""));

    // hover + select states (no filters, only feature-state)
    let hoveredId: number | null = null;
    let selectedId: number | null = null;

    function getFeatureUid(f: any): number | null {
      // GeoJSON source with generateId => each feature has numeric id
      return typeof f.id === "number" ? f.id : null;
    }

    map.on("mousemove", fillId, (e) => {
      if (!e.features?.length) return;
      const uid = getFeatureUid(e.features[0]);
      if (uid == null) return;
      if (hoveredId !== null) map.setFeatureState({ source: srcId, id: hoveredId }, { hover: false });
      hoveredId = uid;
      map.setFeatureState({ source: srcId, id: hoveredId }, { hover: true });
    });

    map.on("mouseleave", fillId, () => {
      if (hoveredId !== null) map.setFeatureState({ source: srcId, id: hoveredId }, { hover: false });
      hoveredId = null;
    });

    map.on("click", fillId, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const uid = getFeatureUid(f);
      if (uid == null) return;

      if (selectedId !== null) map.setFeatureState({ source: srcId, id: selectedId }, { selected: false });
      selectedId = uid;
      map.setFeatureState({ source: srcId, id: selectedId }, { selected: true });

      const id = f?.properties ? getOkrsekIdFromProps(f.properties) : null;
      if (id) setSelectedOkrsek(String(id));
    });
  }

  const selectedData: PrecinctResultMin | null = useMemo(() => {
    if (!results || !selectedOkrsek) return null;
    const out: any = { okrsek: selectedOkrsek, years: {} };
    (Object.keys(results) as Year[]).forEach((y) => {
      const ok = results[y]?.okrsky?.[selectedOkrsek];
      if (ok) out.years[y] = ok;
    });
    return out;
  }, [results, selectedOkrsek]);

  return (
    <div className="flex h-screen w-screen">
      {/* top-left floating header */}
      <div className="absolute top-3 left-3 z-20">
        <div className="rounded-xl bg-white/90 backdrop-blur px-3 py-2 shadow">
          <div className="text-sm font-semibold">Analytický nástroj pro volební kampaň</div>
          {!aboutOpen ? (
            <button
              className="text-xs underline text-blue-700"
              onClick={() => setAboutOpen(true)}
              aria-label="Zjisti více o projektu"
            >
              Zjisti více o projektu
            </button>
          ) : (
            <div className="mt-2 max-w-sm text-xs text-gray-700">
              <div className="flex justify-between items-start">
                <div className="font-medium">O projektu</div>
                <button
                  className="ml-2 text-lg leading-none px-1"
                  aria-label="Zavřít"
                  onClick={() => setAboutOpen(false)}
                >
                  ×
                </button>
              </div>
              <p className="mt-1">
                Interaktivní mapa okrsků pro MOaP s porovnáním výsledků (2022, 2024, 2025),
                vývojem účasti a jednoduchým odhadem potenciálu. Autor: Jiří Till.
              </p>
              <p className="mt-1">
                Data: ČSÚ / volby.cz, okrsky z GeoJSON. Účast se počítá jako
                odevzdané obálky / voliči v seznamu.
              </p>
              <button
                className="mt-2 text-blue-700 underline"
                onClick={() => setAboutOpen(false)}
              >
                Zpět na hlavní obrazovku
              </button>
            </div>
          )}
        </div>
      </div>

      <div id="map" className="flex-1" />
      <div className="w-[420px] border-l p-4 overflow-auto bg-white/95 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <YearTabs year={year} setYear={setYear} />
        </div>

        {!results ? (
          <p>Načítám data… Pokud se nic nenačte, ještě neběžel GitHub Action, který generuje <code>/public/data</code>.</p>
        ) : !geojsonUrl ? (
          <p>Chybí GeoJSON pro daný rok. Zkontroluj přípravu dat.</p>
        ) : !selectedOkrsek ? (
          <p>👈 Klikni na okrsek v mapě pro zobrazení detailů a trendů (2022 → 2024 → 2025).</p>
        ) : !results[year] || !results[year].okrsky?.[selectedOkrsek] ? (
          <p>Pro tento rok nejsou data. Zkus jiný rok nahoře.</p>
        ) : (
          <SidePanel okrsekId={selectedOkrsek} year={year} resultsAllYears={results} />
        )}
      </div>
    </div>
  );
}
