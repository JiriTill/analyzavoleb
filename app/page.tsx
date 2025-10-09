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
  const [selectedFid, setSelectedFid] = useState<number | string | undefined>(undefined);
  const [results, setResults] = useState<Record<Year, ResultMap> | null>(null);
  const [geojsonUrl, setGeojsonUrl] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  // výsledky všech roků (kvůli trendům)
  useEffect(() => {
    loadResultsAllYears().then(setResults).catch(() => setResults(null));
  }, []);

  // init mapy
  useEffect(() => {
    if (mapRef.current) return;

    const style = process.env.NEXT_PUBLIC_MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`
      : "https://demotiles.maplibre.org/style.json";

    const map = new maplibregl.Map({
      container: "map",
      style,
      center: [18.289, 49.834],
      zoom: 12
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      refreshYearLayer(map, year);

      map.on("click", "precinct-fill", (e) => {
        const f = e.features?.[0];
        const id = f?.properties ? getOkrsekIdFromProps(f.properties) : null;
        if (id) setSelectedOkrsek(String(id));

        // zvýraznění přes feature-state (používáme generateId:true -> f.id existuje)
        if (typeof selectedFid !== "undefined") {
          map.setFeatureState({ source: "precincts", id: selectedFid }, { selected: false });
        }
        if (typeof f?.id !== "undefined") {
          map.setFeatureState({ source: "precincts", id: f.id }, { selected: true });
          setSelectedFid(f.id);
        }
      });

      map.on("mousemove", "precinct-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "precinct-fill", () => (map.getCanvas().style.cursor = ""));
    });
  }, [selectedFid]);

  // přepnutí roku
  useEffect(() => {
    if (!mapRef.current) return;
    refreshYearLayer(mapRef.current, year);
    setSelectedOkrsek(null);
    if (typeof selectedFid !== "undefined") {
      mapRef.current.setFeatureState({ source: "precincts", id: selectedFid }, { selected: false });
      setSelectedFid(undefined);
    }
  }, [year]);

  async function refreshYearLayer(map: maplibregl.Map, y: Year) {
    const tag = yearToTag[y];
    const url = await loadPrecinctsGeoJSON(tag);
    setGeojsonUrl(url);

    const srcId = "precincts";
    const fillId = "precinct-fill";
    const lineId = "precinct-outline";

    const existing = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      (existing as any).setData(url);
      return;
    }
    map.addSource(srcId, { type: "geojson", data: url, generateId: true } as any);

    map.addLayer({
      id: fillId,
      type: "fill",
      source: srcId,
      paint: {
        "fill-color": "#1d4ed8",
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          0.28, // vybraný
          0.08  // základní průhledná výplň
        ]
      }
    });

    map.addLayer({
      id: lineId,
      type: "line",
      source: srcId,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#0b3bbd",
          "#1d4ed8"
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          2.2,
          1.2
        ]
      }
    });
  }

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
      {/* malý box vlevo nahoře */}
      <div className="absolute z-10 m-2">
        <div className="rounded bg-white/90 shadow px-2 py-1 text-sm">
          <div className="font-medium">Analytický nástroj pro volební kampaň</div>
          <button className="underline" onClick={()=>setShowAbout(v=>!v)}>Zjisti více o projektu</button>
        </div>
        {showAbout && (
          <div className="mt-2 rounded bg-white/95 shadow p-3 text-xs max-w-xs">
            Nástroj zobrazuje okrskové hranice a výsledky (2022, 2024, 2025) pro rychlou orientaci v kampani – kde je silná/slabá podpora a jak se vyvíjí účast. Autor: Jiří Till.
            <button className="ml-2 text-gray-600" onClick={()=>setShowAbout(false)}>✕</button>
          </div>
        )}
      </div>

      <div id="map" className="flex-1" />
      <div className="w-[420px] border-l p-4 overflow-auto">
        <div className="mb-3">
          <YearTabs year={year} setYear={setYear} />
        </div>
        {!results ? (
          <p>Načítám data… Pokud se nic nenačte, zkontroluj, že Actions vygeneroval <code>/public/data/results_*.json</code>.</p>
        ) : !geojsonUrl ? (
          <p>Chybí GeoJSON pro daný rok (PSP 2025 vrstvu). Zkontroluj <code>OKRSKY_2025_GEOJSON_URL</code>.</p>
        ) : !selectedOkrsek ? (
          <p>👈 Klikni na okrsek v mapě pro zobrazení detailů a trendů (2022 → 2024 → 2025).</p>
        ) : (
          <SidePanel okrsekId={selectedOkrsek} year={year} resultsAllYears={results} />
        )}
      </div>
    </div>
  );
}
