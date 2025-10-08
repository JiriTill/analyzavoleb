"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Year, yearToTag, ResultMap, PrecinctResultMin } from "@/lib/types";
import {
  loadResultsAllYears,
  loadPrecinctsGeoJSON,
  getOkrsekIdFromProps,
} from "@/lib/dataClient";
import { YearTabs } from "@/components/YearTabs";
import { SidePanel } from "@/components/SidePanel";

type FC = any;

export default function Page() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [year, setYear] = useState<Year>("2025");
  const [selectedOkrsek, setSelectedOkrsek] = useState<string | null>(null);
  const [hoverOkrsek, setHoverOkrsek] = useState<string | null>(null);

  const [results, setResults] =
    useState<Record<Year, ResultMap> | null>(null);

  const [geojsonUrl, setGeojsonUrl] = useState<string | null>(null);
  const [geoData, setGeoData] = useState<FC | null>(null);

  // tooltip UI
  const [tip, setTip] = useState<{ x: number; y: number; html: string } | null>(null);
  const [search, setSearch] = useState("");

  // ---------- helpers ----------
  function getTurnoutPctFor(okrsek: string, y: Year): number | null {
    const r = results?.[y]?.okrsky?.[okrsek];
    return r ? r.turnout_pct ?? null : null;
  }

  function geojsonBounds(fc: FC): [[number, number], [number, number]] | null {
    try {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const f of fc.features || []) {
        const g = f.geometry;
        if (!g) continue;
        const coords =
          g.type === "Polygon"
            ? g.coordinates.flat(1)
            : g.type === "MultiPolygon"
            ? g.coordinates.flat(2)
            : [];
        for (const [x, y] of coords) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
        return [[minX, minY], [maxX, maxY]];
      }
      return null;
    } catch {
      return null;
    }
  }

  function setFilterFor(layerId: string, okrsek: string | null) {
    const map = mapRef.current;
    if (!map || !map.getLayer(layerId)) return;
    if (!okrsek) {
      map.setFilter(layerId, ["==", ["get", "___dummy"], "___none"]);
      return;
    }
    // snažíme se být tolerantní k různým názvům vlastností
    map.setFilter(layerId, [
      "any",
      ["==", ["to-string", ["get", "cislo_okrsku"]], okrsek],
      ["==", ["to-string", ["get", "CISLO_OKRSKU"]], okrsek],
      ["==", ["to-string", ["get", "CIS_OKRSEK"]], okrsek],
      ["==", ["to-string", ["get", "OKRSEK"]], okrsek],
      ["==", ["to-string", ["get", "okrsek"]], okrsek],
    ]);
  }

  async function refreshYearLayer(map: maplibregl.Map, y: Year) {
    const tag = yearToTag[y];
    const url = await loadPrecinctsGeoJSON(tag);
    setGeojsonUrl(url);

    // načti GeoJSON objekt (spolehlivější)
    const data = await fetch(url)
      .then((r) => r.json())
      .catch(() => null);
    if (!data || !data.features) {
      console.warn("Precincts GeoJSON nenalezen / nevalidní:", url);
      return;
    }
    setGeoData(data);

    const srcId = "precincts";
    const fillId = "precinct-fill";
    const lineId = "precinct-outline";
    const hoverId = "precinct-hover";
    const selId = "precinct-selected";

    const exists = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
    if (exists) {
      (exists as any).setData(data);
    } else {
      map.addSource(srcId, { type: "geojson", data });

      // základní výplň
      map.addLayer({
        id: fillId,
        type: "fill",
        source: srcId,
        paint: {
          "fill-color": "#1d4ed8",
          "fill-opacity": 0.30
        },
      });

      // obrys všech okrsků
      map.addLayer({
        id: lineId,
        type: "line",
        source: srcId,
        paint: {
          "line-color": "#1d4ed8",
          "line-width": 1.6
        },
      });

      // hover zvýraznění
      map.addLayer({
        id: hoverId,
        type: "line",
        source: srcId,
        paint: {
          "line-color": "#111827",
          "line-width": 3
        },
        filter: ["==", ["get", "___dummy"], "___none"]
      });

      // selected zvýraznění
      map.addLayer({
        id: selId,
        type: "line",
        source: srcId,
        paint: {
          "line-color": "#f59e0b",
          "line-width": 4
        },
        filter: ["==", ["get", "___dummy"], "___none"]
      });
    }

    // vrstvy nahoru
    try {
      map.moveLayer(lineId);
      map.moveLayer(hoverId);
      map.moveLayer(selId);
      map.moveLayer(fillId);
    } catch {}

    // zoom na oblast
    const b = geojsonBounds(data);
    if (b) map.fitBounds(b, { padding: 24, duration: 500 });

    // reset stavů
    setSelectedOkrsek(null);
    setHoverOkrsek(null);
    setFilterFor("precinct-hover", null);
    setFilterFor("precinct-selected", null);
  }

  // ---------- data ----------
  useEffect(() => {
    loadResultsAllYears()
      .then(setResults)
      .catch(() => setResults(null));
  }, []);

  // ---------- mapa init ----------
  useEffect(() => {
    if (mapRef.current) return;

       const style = process.env.NEXT_PUBLIC_MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`
      : "https://demotiles.maplibre.org/style.json";
    
    const map = new maplibregl.Map({
      container: "map",
      style,
      center: [18.289, 49.834],
      zoom: 12,
      maxZoom: 21
    });
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");

    map.on("load", () => {
      refreshYearLayer(map, year);

      // klik → select
      map.on("click", "precinct-fill", (e) => {
        const f = e.features?.[0];
        const id = f?.properties ? getOkrsekIdFromProps(f.properties as any) : null;
        if (id) {
          setSelectedOkrsek(String(id));
          setFilterFor("precinct-selected", String(id));
        }
      });

      // hover → outline + tooltip
      map.on("mousemove", "precinct-fill", (e) => {
        const f = e.features?.[0];
        const id = f?.properties ? getOkrsekIdFromProps(f.properties as any) : null;
        if (id) {
          setHoverOkrsek(String(id));
          setFilterFor("precinct-hover", String(id));
          const t = getTurnoutPctFor(String(id), "2025");
          map.getCanvas().style.cursor = "pointer";
          setTip({
            x: e.point.x,
            y: e.point.y,
            html: `<div><strong>Okrsek ${id}</strong>${t != null ? `<br/>Účast 2025: ${t.toFixed(1)} %` : ""}</div>`,
          });
        }
      });
      map.on("mouseleave", "precinct-fill", () => {
        map.getCanvas().style.cursor = "";
        setHoverOkrsek(null);
        setFilterFor("precinct-hover", null);
        setTip(null);
      });
    });
  }, []);

  // přepnutí roku → vyměň GeoJSON
  useEffect(() => {
    if (!mapRef.current) return;
    refreshYearLayer(mapRef.current, year);
  }, [year]);

  // vybraný okrsek → panel
  const selectedData: PrecinctResultMin | null = useMemo(() => {
    if (!results || !selectedOkrsek) return null;
    const out: any = { okrsek: selectedOkrsek, years: {} };
    (Object.keys(results) as Year[]).forEach((y) => {
      const ok = results[y]?.okrsky?.[selectedOkrsek];
      if (ok) out.years[y] = ok;
    });
    return out;
  }, [results, selectedOkrsek]);

  // vyhledávání okrsku
  function focusOkrsek(id: string) {
    const map = mapRef.current;
    if (!map || !geoData) return;
    const feat: any =
      (geoData.features || []).find((f: any) => {
        const props = f.properties || {};
        const fid = getOkrsekIdFromProps(props);
        return fid === id;
      }) || null;
    if (!feat) return;
    setSelectedOkrsek(id);
    setFilterFor("precinct-selected", id);

    // spočti bbox 1 feature
    const g = feat.geometry;
    const coords =
      g.type === "Polygon" ? g.coordinates.flat(1) : g.type === "MultiPolygon" ? g.coordinates.flat(2) : [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of coords) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (isFinite(minX)) {
      map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 28, duration: 500 });
    }
  }

  return (
    <div className="flex h-screen w-screen">
      {/* MAPA */}
      <div id="map" className="relative flex-1">
        {/* tooltip */}
        {tip && (
          <div
            className="absolute z-10 bg-white/95 shadow rounded px-2 py-1 text-sm pointer-events-none"
            style={{ left: tip.x + 10, top: tip.y + 10 }}
            dangerouslySetInnerHTML={{ __html: tip.html }}
          />
        )}
      </div>

      {/* PANEL */}
      <div className="w-[420px] border-l p-4 overflow-auto">
        <div className="mb-3 flex items-center justify-between gap-2">
          <YearTabs year={year} setYear={setYear} />
          <div className="flex items-center gap-1">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Okrsek # …"
              className="border rounded px-2 py-1 w-28"
              onKeyDown={(e) => {
                if (e.key === "Enter" && search.trim()) focusOkrsek(search.trim());
              }}
            />
            <button
              className="px-2 py-1 border rounded"
              onClick={() => search.trim() && focusOkrsek(search.trim())}
              title="Najít okrsek"
            >
              Najít
            </button>
          </div>
        </div>

        {!results ? (
          <p>
            Načítám data… Pokud se nic nenačte, ještě neběžel GitHub Action, který generuje{" "}
            <code>/public/data</code>.
          </p>
        ) : !geojsonUrl ? (
          <p>Chybí GeoJSON pro daný rok. Zkontroluj přípravu dat.</p>
        ) : !selectedOkrsek ? (
          <p>👈 Najetím zvýrazníš okrsek (tooltip), kliknutím vybereš. Můžeš také zadat číslo okrsku a kliknout
            „Najít“.</p>
        ) : (
          <SidePanel okrsekId={selectedOkrsek} year={year} resultsAllYears={results} />
        )}
      </div>
    </div>
  );
}
