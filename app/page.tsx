"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Year, yearToTag, ResultMap, PrecinctResultMin } from "@/lib/types";
import { loadResultsAllYears, getOkrsekIdFromProps } from "@/lib/dataClient";
import { YearTabs } from "@/components/YearTabs";
import { SidePanel } from "@/components/SidePanel";

type FC = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>;

/** Filtr na vybraný okrsek – OR přes několik možných klíčů v properties */
function buildSelectionFilter(id: string | null) {
  if (!id) return ["==", ["get", "___never___"], "__none__"]; // nic nevybere
  const keys = [
    "CISLO_OKRSKU",
    "cislo_okrsku",
    "CIS_OKRSEK",
    "cis_okrsek",
    "cis_okrsku",
    "OKRSEK",
    "okrsek",
    "okrsek_cislo",
    "cislo_okrsku_text",
  ];
  return ["any", ...keys.map((k) => ["==", ["to-string", ["get", k]], id])];
}

export default function Page() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [year, setYear] = useState<Year>("2025");
  const [selectedOkrsek, setSelectedOkrsek] = useState<string | null>(null);
  const [results, setResults] = useState<Record<Year, ResultMap> | null>(null);
  const [hasGeoForYear, setHasGeoForYear] = useState<boolean>(false);
  const [showAbout, setShowAbout] = useState(false);

  // --- načti výsledkové JSONy (rok, který chybí, se prostě přeskočí) ---
  useEffect(() => {
    loadResultsAllYears().then(setResults).catch(() => setResults(null));
  }, []);

  // --- inicializace mapy ---
  useEffect(() => {
    if (mapRef.current) return;

    const style = process.env.NEXT_PUBLIC_MAPTILER_KEY
      ? `https://api.maptiler.com/maps/streets/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`
      : "https://demotiles.maplibre.org/style.json";

    const map = new maplibregl.Map({
      container: "map",
      style,
      center: [18.289, 49.834],
      zoom: 12,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    map.once("load", () => {
      // vytvoř zdroje/vrstvy prázdné – data doplníme níže
      ensureLayers(map);
      // první nahrání dat pro aktuální rok
      void refreshYearLayer(map, year);

      // univerzální klik přes queryRenderedFeatures
      map.on("click", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["precinct-fill"] });
        const f = features?.[0];
        const id = f?.properties ? getOkrsekIdFromProps(f.properties as any) : null;
        if (!id) return;
        setSelectedOkrsek(String(id));
        map.setFilter("precinct-selected", buildSelectionFilter(String(id)) as any);
        map.setFilter("precinct-selected-outline", buildSelectionFilter(String(id)) as any);
      });

      // kurzor
      map.on("mousemove", (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ["precinct-fill"] });
        map.getCanvas().style.cursor = hit?.length ? "pointer" : "";
      });
    });
  }, []);

  // --- přepnutí roku ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setSelectedOkrsek(null);
    map.setFilter("precinct-selected", buildSelectionFilter(null) as any);
    map.setFilter("precinct-selected-outline", buildSelectionFilter(null) as any);
    if (!map.isStyleLoaded()) {
      map.once("load", () => void refreshYearLayer(map, year));
    } else {
      void refreshYearLayer(map, year);
    }
  }, [year]);

  /** Vytvoř source a vrstvy, pokud ještě nejsou. */
  function ensureLayers(map: maplibregl.Map) {
    const srcId = "precincts";
    const fillId = "precinct-fill";
    const lineId = "precinct-outline";
    const selFillId = "precinct-selected";
    const selLineId = "precinct-selected-outline";

    if (!map.getSource(srcId)) {
      map.addSource(srcId, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] } as FC,
      } as any);
    }

    if (!map.getLayer(fillId)) {
      map.addLayer({
        id: fillId,
        type: "fill",
        source: srcId,
        paint: { "fill-color": "#1d4ed8", "fill-opacity": 0.08 },
      });
    }
    if (!map.getLayer(lineId)) {
      map.addLayer({
        id: lineId,
        type: "line",
        source: srcId,
        paint: { "line-color": "#1d4ed8", "line-width": 1.2 },
      });
    }
    if (!map.getLayer(selFillId)) {
      map.addLayer({
        id: selFillId,
        type: "fill",
        source: srcId,
        filter: buildSelectionFilter(null) as any,
        paint: { "fill-color": "#0b3bbd", "fill-opacity": 0.28 },
      });
    }
    if (!map.getLayer(selLineId)) {
      map.addLayer({
        id: selLineId,
        type: "line",
        source: srcId,
        filter: buildSelectionFilter(null) as any,
        paint: { "line-color": "#0b3bbd", "line-width": 2.2 },
      });
    }
  }

  /** Bezpečně načti GeoJSON pro daný rok. Když chybí, source vyčisti. */
  async function refreshYearLayer(map: maplibregl.Map, y: Year) {
    const tag = yearToTag[y];
    const url = `/data/precincts_${tag}_554821_545911.geojson`;

    let data: FC | null = null;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) data = (await res.json()) as FC;
    } catch {
      // ignore
    }

    const src = map.getSource("precincts") as maplibregl.GeoJSONSource;
    if (!src) {
      ensureLayers(map);
    }

    if (data) {
      (map.getSource("precincts") as any).setData(data);
      setHasGeoForYear(true);
    } else {
      // rok nemá geojson – vyčistíme data, ale vrstvy necháme existovat
      (map.getSource("precincts") as any).setData({ type: "FeatureCollection", features: [] });
      setHasGeoForYear(false);
    }
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
            orientaci v kampani – kde je silná/slabá podpora a jak se vyvíjí účast. Autor:
            Jiří Till.
            <button className="ml-2 text-gray-600" onClick={() => setShowAbout(false)}>
              ✕
            </button>
          </div>
        )}
      </div>

      <div id="map" className="flex-1" />
      <div className="w-[420px] border-l p-4 overflow-auto">
        <div className="mb-3">
          <YearTabs year={year} setYear={setYear} />
        </div>

        {!results ? (
          <p>
            Načítám data… Pokud se nic nenačte, zkontroluj, že v <code>/public/data</code>{" "}
            existuje <code>results_*.json</code>.
          </p>
        ) : !hasGeoForYear ? (
          <p>
            Pro tento rok nejsou hranice okrsků. Zkus jiný rok nahoře.
            <br />
            (Chybí soubor <code>precincts_{yearToTag[year]}_554821_545911.geojson</code>.)
          </p>
        ) : !selectedOkrsek ? (
          <p>👈 Klikni na okrsek v mapě pro zobrazení detailů a trendů.</p>
        ) : (
          <SidePanel okrsekId={selectedOkrsek} year={year} resultsAllYears={results} />
        )}
      </div>
    </div>
  );
}
