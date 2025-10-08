"use client";
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
map.on("click", "precinct-fill", (e) => {
const f = e.features?.[0];
const id = f?.properties ? getOkrsekIdFromProps(f.properties) : null;
if (id) setSelectedOkrsek(String(id));
});


map.on("mousemove", "precinct-fill", () => map.getCanvas().style.cursor = "pointer");
map.on("mouseleave", "precinct-fill", () => map.getCanvas().style.cursor = "");
});
}, []);


// when year changes → swap geojson layer
useEffect(() => {
if (!mapRef.current) return;
refreshYearLayer(mapRef.current, year);
setSelectedOkrsek(null);
}, [year]);


// helper
async function refreshYearLayer(map: maplibregl.Map, y: Year) {
const tag = yearToTag[y];
const url = await loadPrecinctsGeoJSON(tag);
setGeojsonUrl(url);


const srcId = "precincts";
const fillId = "precinct-fill";
const lineId = "precinct-outline";


const existing = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
if (existing) {
existing.setData(url);
return;
}
map.addSource(srcId, { type: "geojson", data: url });
map.addLayer({ id: fillId, type: "fill", source: srcId, paint: { "fill-color": "#1d4ed8", "fill-opacity": 0.15 } });
map.addLayer({ id: lineId, type: "line", source: srcId, paint: { "line-color": "#1d4ed8", "line-width": 1.2 } });
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
<div id="map" className="flex-1" />
<div className="w-[420px] border-l p-4 overflow-auto">
<div className="mb-3">
<YearTabs year={year} setYear={setYear} />
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
