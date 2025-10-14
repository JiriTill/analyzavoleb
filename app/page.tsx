"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map, FilterSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Year, yearToTag, ResultMap, PrecinctResultMin } from "@/lib/types";
import {
  loadResultsAllYears,
  loadPrecinctsGeoJSON,
  getOkrsekIdFromProps,
} from "@/lib/dataClient";
import { YearTabs } from "@/components/YearTabs";
import { SidePanel } from "@/components/SidePanel";

/* ---------------- constants ---------------- */
const SRC_ID = "precincts";
const FILL_ID = "precinct-fill";
const LINE_ID = "precinct-outline";
const SEL_FILL = "precinct-selected";
const SEL_LINE = "precinct-selected-outline";

/* ---------------- helpers ---------------- */

/**
 * Filtr pro vybraný okrsek:
 * - hledá ve více možných klíčích (liší se mezi GeoJSON zdroji),
 * - porovnává jak string, tak number (MapLibre striktně typuje).
 */
function buildSelectionFilter(id: string | null): FilterSpecification {
  if (!id) {
    // filtr, který určitě nic nevybere
    return ["==", ["get", "__none__"], "__none__"];
  }

  const idStr = String(id);
  const idNum = Number(idStr);
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

  const tests: any[] = [];
  for (const k of keys) {
    // porovnání se stringem
    tests.push(["==", ["get", k], idStr]);
    // i s číslem (když je vlastnost v GeoJSONu numeric)
    if (!Number.isNaN(idNum)) tests.push(["==", ["get", k], idNum]);
  }

  return ["any", ...tests] as any;
}

/** Zavolá callback až když je styl načtený */
function styleReady(map: Map, cb: () => void) {
  if (map.isStyleLoaded()) cb();
  else map.once("load", cb);
}

/** Bezpečné nastavení filtru (vrstva už může existovat/nemusí) */
function safeSetFilter(map: Map, layerId: string, filter: FilterSpecification) {
  if (map.getLayer(layerId)) {
    try {
      map.setFilter(layerId, filter);
    } catch {
      // ignore
    }
  }
}

/** Vrátí URL GeoJSONu pro daný rok; pokud není dostupný, padne na PSP 2025 */
async function resolveGeoUrl(tag: string): Promise<string> {
  const url = await loadPrecinctsGeoJSON(tag);
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (head.ok) return url;
  } catch {
    /* ignore */
  }
  return await loadPrecinctsGeoJSON("psp2025");
}

/* ---------------- component ---------------- */

export default function Page() {
  const mapRef = useRef<Map | null>(null);
  const [year, setYear] = useState<Year>("2025");
  const [selectedOkrsek, setSelectedOkrsek] = useState<string | null>(null);
  const [results, setResults] = useState<Record<Year, ResultMap> | null>(null);
  const [geojsonUrl, setGeojsonUrl] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  // 1) načtení výsledků pro pravý panel (404 u 2024/2022 nevadí)
  useEffect(() => {
    loadResultsAllYears().then(setResults).catch(() => setResults(null));
  }, []);

  // 2) inicializace mapy
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

      // interakce až PO vytvoření vrstev
      map.on("mousemove", FILL_ID, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", FILL_ID, () => (map.getCanvas().style.cursor = ""));

      map.on("click", FILL_ID, (e) => {
        const f = e.features?.[0];
        const id = f?.properties ? getOkrsekIdFromProps(f.properties as any) : null;
        if (!id) return;

        const idStr = String(id);
        setSelectedOkrsek(idStr); // pro pravý panel

        // vizuální zvýraznění
        const filt = buildSelectionFilter(idStr);
        safeSetFilter(map, SEL_FILL, filt);
        safeSetFilter(map, SEL_LINE, filt);
      });
    });

    return () => {
      try {
        map.remove();
      } catch {
        /* ignore */
      }
      mapRef.current = null;
    };
  }, []);

  // 3) změna roku → přenačti hranice, resetuj výběr
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setSelectedOkrsek(null);
    styleReady(map, () => {
      refreshYearLayer(map, year);
    });
  }, [year]);

  // vytvoření/aktualizace zdroje a vrstev
  async function refreshYearLayer(map: Map, y: Year) {
    const tag = yearToTag[y];
    const url = await resolveGeoUrl(tag);
    setGeojsonUrl(url);

    styleReady(map, () => {
      const src = map.getSource(SRC_ID) as maplibregl.GeoJSONSource | undefined;

      if (src) {
        try {
          (src as any).setData(url);
        } catch {
          /* ignore */
        }
        safeSetFilter(map, SEL_FILL, buildSelectionFilter(null));
        safeSetFilter(map, SEL_LINE, buildSelectionFilter(null));
        return;
      }

      map.addSource(SRC_ID, { type: "geojson", data: url } as any);

      // základní výplň (více průhledná)
      map.addLayer({
        id: FILL_ID,
        type: "fill",
        source: SRC_ID,
        paint: {
          "fill-color": "#1d4ed8",
          "fill-opacity": 0.10,
        },
      });

      // obrys
      map.addLayer({
        id: LINE_ID,
        type: "line",
        source: SRC_ID,
        paint: {
          "line-color": "#1d4ed8",
          "line-width": 1.2,
        },
      });

      // vybraný okrsek – výplň
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

      // vybraný okrsek – obrys
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

  // data do pravého panelu
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
      {/* hlavička vlevo nahoře */}
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
            Načítám data… Pokud se nic nenačte, zkontroluj, že Actions vygeneroval{" "}
            <code>/public/data/results_*.json</code>.
          </p>
        ) : !geojsonUrl ? (
          <p>
            Chybí GeoJSON (pro rok 2025 ho čekáme v secretu{" "}
            <code>OKRSKY_2025_GEOJSON_URL</code>).
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
