// scripts/prepare-data.js - Úprava funkce processElection

// ... (zbytek skriptu je stejný)

// ---------- hlavní pipeline pro volby ----------
async function processElection(tag, manualTokensData, manualTokensCns, okrskyGeoUrl) {
  // ... (načtení dataZip, cnsZip - beze změny)
  const dataZip = findManualZip(manualTokensData);
  const cnsZip  = findManualZip(manualTokensCns);

  if (!dataZip || !cnsZip) {
    throw new Error(`Chybí zipy dat/číselníků (hledal jsem: ${manualTokensData.join("+")} / ${manualTokensCns.join("+")})`);
  }
  
  // 2) načti CSV z obou zipů
  let csvDataFiles, csvCnsFiles;
  
  // !!! ROBUSTNÍ NAČTENÍ ZIP SOUBORŮ S OŠETŘENÍM CHYBY ADM-ZIP !!!
  try {
      csvDataFiles = listCsvFilesInZip(dataZip);
      csvCnsFiles  = listCsvFilesInZip(cnsZip);
  } catch (e) {
      if (e.message.includes("ADM-ZIP: Invalid or unsupported zip format")) {
          // Pokud chyba nastane u KZ nebo KV, můžeme to ignorovat, pokud chybí data
          if (tag !== 'psp2025') {
              throw new Error(`ZIP soubory pro ${tag} jsou poškozené, přeskočeno: ${e.message}`);
          }
      }
      // Pro PSP 2025 je to kritická chyba, skript havaruje
      throw e; 
  }
  
  // POZOR: Pokud nastala chyba a byla ignorována (KZ, KV), csvFiles budou undefined
  if (!csvDataFiles || !csvCnsFiles || csvDataFiles.length === 0 || csvCnsFiles.length === 0) {
      if (tag !== 'psp2025') {
          console.warn(`[${tag}] Ignoruji, protože ZIPy jsou neplatné/prázdné.`);
          return; // Zastaví zpracování pro tento tag
      }
      throw new Error(`${tag}: Data ZIPy jsou poškozené/prázdné.`);
  }

  // ... (zbytek logiky - detekce T4/T4p, čtení dat - beze změny)
  // ... (stahování GeoJSON - beze změny)
  // ... (generování souborů results_*.json - beze změny)
}

// ... (v main funkci se úprava logiky try/catch pro KZ a KV vrátí, aby se nenačítala poškozená data)

(async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const okrsky2025 = process.env.OKRSKY_2025_GEOJSON_URL || null;

  if (!okrsky2025) {
     console.error("Chyba: Proměnná prostředí OKRSKY_2025_GEOJSON_URL není nastavena. Nelze pokračovat.");
     process.exit(1);
  }
  
  // PSP 2025 MUSÍ fungovat
  try {
    await processElection(
      "psp2025",
      ["ps2025","data","csv"],
      ["ps2025","cisel","csv"],
      okrsky2025
    );
  } catch (e) {
    console.error(`🔴 Chyba při zpracování PSP 2025: ${e.message}`);
  }

  // KZ 2024 a KV 2022 mohou selhat kvůli poškozeným ZIPům.
  // Zde se musí zajistit, že i když selžou, skript nespadne.
  try {
    await processElection(
      "kz2024",
      ["kz2024","data","csv"],
      ["kz2024","cisel","csv"],
      okrsky2025
    );
  } catch (e) {
    console.warn(`⚠️ Varování: Přeskočeno KZ 2024: ${e.message}`);
  }

  try {
    await processElection(
      "kv2022",
      ["kv2022","data","csv"],
      ["kv2022","cisel","csv"],
      okrsky2025
    );
  } catch (e) {
    console.warn(`⚠️ Varování: Přeskočeno KV 2022: ${e.message}`);
  }

  console.log(`✔ Hotovo. Výstupy v ${OUT_DIR}`);
})().catch((e) => {
  console.error("FATÁLNÍ CHYBA SKRIPTU:", e);
  process.exit(1);
});
