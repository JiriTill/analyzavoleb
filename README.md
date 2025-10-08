# MOaP Elections Map (Ostrava – Moravská Ostrava a Přívoz)


Interaktivní mapa okrsků s trendy (2022, 2024, 2025), vybraná strana a odhad „potenciálu“ (nevoliči × podíl strany). Postaveno na Next.js + MapLibre + Recharts. Deploy na Vercel.


## Jak to funguje
- Data se **automaticky** stahují a připravují přes GitHub Action (`prepare-data.yml`).
- Akce vygeneruje do `/public/data`:
- `precincts_psp2025_554821_545911.geojson`, `results_psp2025_554821_545911.json`
- `precincts_kz2024_554821_545911.geojson`, `results_kz2024_554821_545911.json`
- `precincts_kv2022_554821_545911.geojson`, `results_kv2022_554821_545911.json`


## Co je potřeba nastavit
1. V repu → **Settings → Secrets → Actions**:
- `OKRSKY_2025_GEOJSON_URL` – URL na GeoJSON hranic PSP 2025 (z geoportálu ČSÚ)
- `TARGETS` (volitelně) – např. `554821:545911` (MOaP). V budoucnu přidej další obce/obvody čárkou.
2. Vercel – **Build Command**: `npm run build`
- (Doporučení: můžeš přidat i `NEXT_PUBLIC_MAPTILER_KEY` mezi Environment Variables pro hezčí dlaždice.)


## Trendy a potenciál
- **Trend strany (%)**: podíl hlasů strany na platných hlasech v okrsku (per rok).
- **Odhad potenciálu**: `nevoliči × aktuální podíl strany` – orientační metrika; předpokládá podobnou strukturu nevoličů jako u voličů.


## Rozšíření mimo MOaP
- Přidej do `TARGETS` další položky `OBEC[:MOMC]` (např. `XXXXXX:YYYYYY`).
- Frontend používá suffix `554821_545911` – pro další oblasti udělej drobný refactor (přidat výběr oblasti v UI a suffix přepínat).
