// app/o-projektu/page.tsx
export default function OProjektuPage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold mb-4">O projektu</h1>
      <p className="mb-3">
        Tento nástroj vizualizuje volební okrsky v Moravské Ostravě a Přívoze a zobrazuje okrskové výsledky
        (PSP 2025, krajské 2024, komunální 2022). Cílem je rychlá orientace, kde má která strana silná a slabá místa,
        a jak se vyvíjí účast.
      </p>
      <p className="mb-3">
        Projekt vytvořil <strong>Jiří Till</strong>. Data pochází z otevřených dat ČSÚ (volby.cz) a hranic okrsků (GeoJSON).
      </p>
      <p className="mb-6 text-sm text-gray-600">
        Pozn.: Některé výpočty (např. odhad „potenciálu“) jsou orientační a slouží pro rychlé srovnání, ne jako absolutní metrika.
      </p>
      <a href="/" className="inline-block rounded bg-black px-3 py-2 text-white hover:opacity-90">Zpět na hlavní stránku</a>
    </main>
  );
}
