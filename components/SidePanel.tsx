"use client";
import { useMemo, useState } from "react";
import { Year, ResultMap, PartyBarDatum } from "@/lib/types";
import { Top6Bar } from "@/components/Top6Bar";
import { TurnoutLine } from "@/components/TurnoutLine";
import { PartyTrendLine } from "@/components/PartyTrendLine";
import { guessPartyPalette } from "@/lib/partyColors";

export function SidePanel({
  okrsekId,
  year,
  resultsAllYears
}: {
  okrsekId: string;
  year: Year;
  resultsAllYears: Record<Year, ResultMap>;
}) {
  const [selectedParty, setSelectedParty] = useState<string | null>(null);

  // TOP 6 subjektů pro zvolený rok
  const top6: PartyBarDatum[] = useMemo(() => {
    const r = resultsAllYears[year]?.okrsky?.[okrsekId];
    if (!r) return [];
    const valid = r.valid || 0;
    return (r.parties || [])
      .slice()
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 6)
      .map((p) => ({
        party_code: p.code,
        name: p.name,
        votes: p.votes,
        pct: valid ? (100 * p.votes) / valid : 0
      }));
  }, [resultsAllYears, okrsekId, year]);

  // Vývoj účasti 2022→2024→2025
  const turnoutSeries = useMemo(() => {
    const ys: { year: Year; turnout: number; registered: number; valid: number }[] = [];
    (["2022", "2024", "2025"] as Year[]).forEach((y) => {
      const ok = resultsAllYears[y]?.okrsky?.[okrsekId];
      if (ok) ys.push({ year: y, turnout: ok.turnout_pct || 0, registered: ok.registered || 0, valid: ok.valid || 0 });
    });
    return ys;
  }, [resultsAllYears, okrsekId]);

  // Trend vybrané strany + orientační potenciál
  const partyTrend = useMemo(() => {
    if (!selectedParty) return null;
    const rows: { year: Year; pct: number; votes: number; potential: number }[] = [];
    (["2022", "2024", "2025"] as Year[]).forEach((y) => {
      const ok = resultsAllYears[y]?.okrsky?.[okrsekId];
      if (!ok) return;
      const valid = ok.valid || 0;
      const reg = ok.registered || 0;
      const env = Math.round(((ok.turnout_pct || 0) * reg) / 100);
      const p = (ok.parties || []).find(
        (pp: any) => pp.code === selectedParty || (pp.name || "").toLowerCase().includes(selectedParty.toLowerCase())
      );
      const pct = p && valid ? (100 * p.votes) / valid : 0;
      const potential = Math.max(0, reg - env) * (pct / 100);
      rows.push({ year: y, pct, votes: p?.votes || 0, potential });
    });
    return rows;
  }, [resultsAllYears, okrsekId, selectedParty]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Okrsek {okrsekId}</h2>
      <p className="text-sm text-gray-600 mb-3">Kliknuté okrskové výsledky a trendy 2022 → 2024 → 2025.</p>

      <div className="mb-4">
        <h3 className="font-semibold mb-2">TOP 6 subjektů ({year})</h3>
        <Top6Bar data={top6} />
      </div>

      <div className="mb-4">
        <h3 className="font-semibold mb-2">Vývoj účasti</h3>
        <TurnoutLine data={turnoutSeries} />
      </div>

      <div className="mb-2">
        <label className="text-sm mr-2">Zvol subjekt pro trend:</label>
        <select
          className="border rounded px-2 py-1"
          value={selectedParty || ""}
          onChange={(e) => setSelectedParty(e.target.value || null)}
        >
          <option value="">— vyber —</option>
          {[...new Set(top6.map((d) => d.party_code))].map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>

      {partyTrend && (
        <div className="mb-4">
          <h3 className="font-semibold mb-2">Trend vybrané strany (%, odhad potenciálu)</h3>
          <PartyTrendLine data={partyTrend} color={guessPartyPalette(selectedParty || "")} />
          <p className="text-xs text-gray-500 mt-1">
            Pozn.: Odhad potenciálu = nevoliči × aktuální podíl strany. Je to orientační metrika.
          </p>
        </div>
      )}
    </div>
  );
}
