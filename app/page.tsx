"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { FilterSpecification, Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Year, yearToTag, ResultMap, PrecinctResultMin } from "@/lib/types";
import {
  loadResultsAllYears,
  loadPrecinctsGeoJSON,
  getOkrsekIdFromProps,
} from "@/lib/dataClient";
import { YearTabs } from "@/components/YearTabs";
import { SidePanel } from "@/components/SidePanel";

// ---------------- helpers ----------------
const SEL_FILL = "precinct-selected";
const SEL_LINE = "precinct-selected-outline";
const SRC_ID = "precincts";
const FILL_ID = "precinct-fill";
const LINE_ID = "precinct-outline";

function buildSelectionFilter(id: string | null): FilterSpecification {
  if (!id) {
    // filtr který určitě nic nevybere
    return ["==", ["get", "___none___"], "___none___"];
  }
  const keys = [
    "OKRSEK",
    "CIS_OKRSEK",
    "CISLO_OKRSKU",
    "cislo_okrsku",
    "okrsek",
    "okrsek_cislo",
    "cislo_okrsku_text",
  ];
  return ["any", ...keys.map((k) => ["==", ["to-string", ["get", k]], id])] as any;
}

function styleReady(map: Map, cb: () => void) {
  if (map.isStyleLoaded()) cb();
  else map.once("load", cb);
}

function safeSetFilter(map: Map, layerId: string, filter: FilterSpecification) {
  if (map.getLayer(layerId)) {
    try {
      map.setFilter(layerId, filter);
    } catch {
      /* ignore */
    }
  }
}

/** Zkusí vrátit GeoJSON pro daný rok; není-li dostupný, spadne na PSP 2025 */
async function resolveGeoUrl(tag: string): Promise<string> {
  const url = await loadPrecinctsGeoJSON(tag);
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (head.ok) return url;
  } catch {
    // ignore
  }
  // fallback na PSP 2025 (hranice stejné/stačí pro interakci, dokud nedoplníme data)
  return await loadPrecinctsGeoJSON("psp2025");
}

// ---------------- component ----------------
export default function Page() {
  const mapRef = useRef<Map | null>(null);
  const [year, setYear] = useState<Year>("2025");
  const [selectedOkrsek, setSelectedOkrsek] = useState<string | null>(null);
  const [results, setResults] = useState<Record<Year, ResultMap> | null>(null);
  const [geojsonUrl, setGeojsonUrl] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  // načtení výsledků (bez pádu, 2024/2022 mohou chybět)
  useEffect(() => {
    loadResultsAllYears()
      .then(setResults)
      .catch(() => setResults(null));
  }, []);

  // inicializace mapy
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

    styleReady(map, async () => {
      await refreshYearLayer(map, year);

      // interakce – až PO vytvoření vrstev
      map.on("mousemove", FILL_ID, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", FILL_ID, () => (map.getCanvas().style.cursor = ""));
      map.on("click", FILL_ID, (e) => {
        const f = e.features?.[0];
        const id = f?.properties ? getOkrsekIdFromProps(f.properties) : null;
        if (!id) return;
        const idStr = String(id);
        setSelectedOkrsek(idStr);
        safeSetFilter(map, SEL_FILL, buildSelectionFilter(idStr));
        safeSetFilter(map, SEL_LINE, buildSelectionFilter(idStr));
      });
    });

    // cleanup při unmountu
    return () => {
      try {
        map.remove();
      } catch {
        /* ignore */
      }
      mapRef.current = null;
    };
  }, []);

  // změna roku – přenačti hranice a zruš výběr
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setSelectedOkrsek(null);
    styleReady(map, () => {
      refreshYearLayer(map, year);
    });
  }, [year]);

  async function refreshYearLayer(map: Map, y: Year) {
    const tag = yearToTag[y];
    const url = await resolveGeoUrl(tag);
    setGeojsonUrl(url);

    styleReady(map, () => {
      const src = map.getSource(SRC_ID) as maplibregl.GeoJSONSource | undefined;

      if (src) {
        // update existujícího zdroje (HEAD už proběhl; 404 tu nepošleme)
        try {
          (src as any).setData(url);
        } catch {
          // kdyby se i tak něco pokazilo, raději odpojíme výběr
        }
        safeSetFilter(map, SEL_FILL, buildSelectionFilter(null));
        safeSetFilter(map, SEL_LINE, buildSelectionFilter(null));
        return;
      }

      // nově – vytvoř zdroj + vrstvy
      map.addSource(SRC_ID, { type: "geojson", data: url } as any);

      map.addLayer({
        id: FILL_ID,
        type: "fill",
        source: SRC_ID,
        paint: {
          "fill-color": "#1d4ed8",
          "fill-opacity": 0.10, // víc zprůhlednit
        },
      });

      map.addLayer({
        id: LINE_ID,
        type: "line",
        source: SRC_ID,
        paint: {
          "line-color": "#1d4ed8",
          "line-width": 1.2,
        },
      });

      map.addLayer({
        id: SEL_FILL,
        type: "fill",
        source: SRC_ID,
        filter: buildSelectionFilter(null),
        paint: {
          "fill-color": "#0b3bbd",
          "fill-opacity": 0.30,
        },
      });

      map.addLayer({
        id: SEL_LINE,
        type: "line",
        source: SRC_ID,
        filter: buildSelectionFilter(null),
        paint: {
          "line-color": "#0b3bbd",
          "line-width": 2.2,
        },
      });
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
      {/* horní badge + about */}
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
            Jiří Till.{" "}
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
            Načítám data… Pokud se nic nenačte, zkontroluj prosím, že GitHub Actions
            vygeneroval <code>/public/data/results_*.json</code>.
          </p>
        ) : !geojsonUrl ? (
          <p>
            Chybí GeoJSON hranic. Pro 2025 se čeká URL v secretu{" "}
            <code>OKRSKY_2025_GEOJSON_URL</code>.
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

