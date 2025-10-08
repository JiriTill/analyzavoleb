export type Year = "2025" | "2024" | "2022";
export const yearToTag: Record<Year, "psp2025" | "kz2024" | "kv2022"> = {
"2025": "psp2025",
"2024": "kz2024",
"2022": "kv2022"
};


export type ResultMap = {
meta?: any;
okrsky: Record<string, {
registered: number;
turnout_pct: number;
valid: number;
parties: { code: string; name: string; votes: number }[];
}>;
};


export type PartyBarDatum = { party_code: string; name: string; votes: number; pct: number };
export type PrecinctResultMin = { okrsek: string; years: Partial<Record<Year, any>> };
