// app/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type maplibreglType from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { Year, yearToTag, ResultMap, PrecinctResultMin } from "@/lib/types";
import {
  loadResultsAllYears,
  loadPrecinctsGeoJSON,
  getOkrsekIdFromProps,
} from "@/lib/dataClient";
import { YearTabs } from "@/components/YearTabs";
import { SidePanel } from "@/components/SidePanel";

export default function Page() {
  const mapRef = useRef<maplibreglType.Map | null>(null);
  const [ml, setMl] = useState<typeof import("maplibre-gl") | null>(null);
  const [year, setYear] = useState<Year>("2025");
  const [selectedOkrsek, setSelectedOkrsek] = useState<string | null>(null);
  const [results, setResults] = useState<Record<Year, ResultMap> | null>(null);
  const [geojsonUrl, setGeojsonUrl] = useState<string | null>(null);

  // načti výsledky pro všechny roky (kvůli trendům)
  useEffect(() => {
    loadResultsAllYears().then(setResults).catch(() => setResults(null));
  }, []);

  // lazy import maplibre (bezpečnější v Nextu)
  useEffect(() => {
    import("maplibre-gl").then((m) => setMl(m));
  }, []);

  // inicializace mapy
  useEffect(() => {
    if (!ml) return;
    if (mapRef.current) return;

    const style = process.env.NEXT_PUBLIC_MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`
      : "https://demotiles.maplibre.org/style.json";

    const map = new ml.Map({
      container: "map",
      style,
      center: [18.289, 49.834], // Ostrava
      zoom: 12,
    });

    map.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      refreshYearLayer(map, year);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml]);

  // přepnutí roku → vyměň GeoJSON
  useEffect(() => {
    if (!mapRef.current) return;
    refreshYearLayer(mapRef.current, year);
    setSelectedOkrsek(null);
  }, [year]);

  async function refreshYearLayer(map: maplibreglType.Map, y: Year) {
    const tag = yearToTag[y];
    const url = await loadPrecinctsGeoJSON(tag);
    setGeojsonUrl(url);

    const srcId = "precincts";
    const fillId = "precinct-fill";
    const lineId = "precinct-outline";
    const hoverId = "precinct-hover";

    const existing = map.getSource(srcId) as maplibreglType.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(url);
    } else {
      map.addSource(srcId, { type: "geojson", data: url, generateId: true });
      map.addLayer({
        id: fillId,
        type: "fill",
        source: srcId,
        paint: {
          "fill-color": "#1d4ed8",
          "fill-opacity": 0.08, // jemnější výplň
        },
      });
      map.addLayer({
        id: lineId,
        type: "line",
        source: srcId,
        paint: { "line-color": "#1d4ed8", "line-width": 1.2 },
      });
      map.addLayer({
        id: hoverId,
        type: "line",
        source: srcId,
        paint: { "line-color": "#1d4ed8", "line-width": 3 },
        filter: ["==", ["feature-state", "hover"], true],
      });

      let hoveredId: number | null = null;
      map.on("mousemove", fillId, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        if (hoveredId !== null) map.setFeatureState({ source: srcId, id: hoveredId }, { hover: false });
        hoveredId = f.id as number;
        map.setFeatureState({ source: srcId, id: hoveredId }, { hover: true });
      });
      map.on("mouseleave", fillId, () => {
        map.getCanvas().style.cursor = "";
        if (hoveredId !== null) map.setFeatureState({ source: srcId, id: hoveredId }, { hover: false });
        hoveredId = null;
      });
      map.on("click", fillId, (e) => {
        const f = e.features?.[0];
        const id = f?.properties ? getOkrsekIdFromProps(f.properties) : null;
        if (id) setSelectedOkrsek(String(id));
      });

      // jakmile se zdroj načte poprvé, sjeď na extent okrsků
      const fitOnce = (ev: any) => {
        if (ev.sourceId !== srcId || !map.isSourceLoaded(srcId)) return;
        const data: any = (map.getSource(srcId) as any)?._data;
        if (data?.type === "FeatureCollection" && Array.isArray(data.features) && data.features.length) {
          const bbox = getBbox(data);
          if (bbox) map.fitBounds(bbox, { padding: 40, duration: 0 });
        }
        map.off("sourcedata", fitOnce);
      };
      map.on("sourcedata", fitOnce);
    }
  }

  // spočti bbox z GeoJSONu (stačí pro fitBounds)
  function getBbox(fc: any): [number, number, number, number] | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const push = (c: number[]) => {
      const [x, y] = c;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    try {
      for (const f of fc.features || []) {
        const geom = f.geometry;
        if (!geom) continue;
        if (geom.type === "Polygon") geom.coordinates.flat(1).forEach(push);
        else if (geom.type === "MultiPolygon") geom.coordinates.flat(2).forEach(push);
      }
      if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
        return [minX, minY, maxX, maxY];
      }
    } catch {}
    return null;
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
      {/* MAPA + overlay “O projektu” */}
      <div className="relative flex-1">
        <div id="map" className="h-full w-full" />
        <a
          href="/o-projektu"
          className="absolute left-3 top-3 z-10 rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium shadow hover:bg-white"
          title="O projektu"
        >
          Analýza voleb MOaP
        </a>
      </div>

      {/* PANEL */}
      <div className="w-[420px] border-l p-4 overflow-auto">
        <div className="mb-3 flex items-center gap-2">
          <YearTabs year={year} setYear={setYear} />
          {!geojsonUrl && <span className="text-xs text-gray-500">Načítám hranice…</span>}
        </div>
        {!results ? (
          <p>Načítám data… Pokud se nic nenačte, ještě neběžel GitHub Action, který generuje <code>/public/data</code>.</p>
        ) : !geojsonUrl ? (
          <p>Chybí GeoJSON pro daný rok. Zkontroluj přípravu dat.</p>
        ) : !selectedOkrsek ? (
          <p>👈 Klikni na okrsek v mapě pro zobrazení detailů a trendů (2022→2024→2025).</p>
        ) : (
          <SidePanel okrsekId={selectedOkrsek} year={year} resultsAllYears={results} />
        )}
      </div>
    </div>
  );
}
