/// lib/dataClient.ts

export function getOkrsekIdFromProps(props: Record<string, unknown>): string | null {
  const keys = [
    "OKRSEK",
    "CIS_OKRSEK",
    "CISLO_OKRSKU",
    "cislo_okrsku",
    "okrsek",
    "okrsek_cislo",
    "cislo_okrsku_text",
    "ID_OKRSKY", // kdyby v datu byl interní klíč
  ];

  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(props, k)) {
      const v = (props as any)[k];

      // kanonizace: preferuj číslo bez nul; jinak ořezaný string
      if (typeof v === "number" && Number.isFinite(v)) {
        return String(v);
      }
      if (typeof v === "string") {
        const trimmed = v.trim();
        // zkus převést na číslo (odstraní nuly vlevo, "002" -> 2)
        const asNum = Number(trimmed.replace(/\s+/g, ""));
        if (!Number.isNaN(asNum)) return String(asNum);
        // fallback: vrať čistý string (bez mezer)
        return trimmed;
      }
    }
  }
  return null;
}
