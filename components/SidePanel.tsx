"use client";
import { useMemo, useState } from "react";
import { Year, ResultMap, PartyBarDatum } from "@/lib/types";
import { Top6Bar } from "@/components/Top6Bar";
import { TurnoutLine } from "@/components/TurnoutLine";
import { PartyTrendLine } from "@/components/PartyTrendLine";
import { guessPartyPalette } from "@/lib/partyColors";

export function SidePanel({
  okrsekId, year, resultsAllYears
}: { okrsekId: string; year: Year; resultsAllYears: Record<Year, ResultMap>; }) {
  const [selectedParty, setSelectedParty] = useState<string>("");

  const current = resultsAllYears[year]?.okrsky?.[okrsekId];

  const top6: PartyBarDatum[] = useMemo(() => {
    if (!current) return [];
    const valid = current.valid || 0;
    return (current.parties||[])
      .sort((a,b)=>b.votes-a.votes).slice(0,6)
      .map(p=>({ party_code:p.code, name:p.name, votes:p.votes, pct: valid? (100*p.votes/valid):0 }));
  }, [current]);

  const turnoutSeries = useMemo(() => {
    const ys: { year: Year; turnout: number; registered: number; valid: number }[] = [];
    (["2022","2024","2025"] as Year[]).forEach(y => {
      const ok = resultsAllYears[y]?.okrsky?.[okrsekId];
      if (ok) ys.push({ year: y, turnout: ok.turnout_pct||0, registered: ok.registered||0, valid: ok.valid||0 });
    });
    return ys;
  }, [resultsAllYears, okrsekId]);

  const partyTrend = useMemo(() => {
    if (!selectedParty) return null;
    const rows: { year: Year; pct: number; votes: number; potential: number }[] = [];
    (["2022","2024","2025"] as Year[]).forEach(y => {
      const ok = resultsAllYears[y]?.okrsky?.[okrsekId];
      if (!ok) return;
      const valid = ok.valid||0;
      const reg = ok.registered||0;
      const env = Math.round((ok.turnout_pct||0) * reg / 100);
      const p = (ok.parties||[]).find(pp => (pp.code===selectedParty) || (pp.name||"").toLowerCase().includes(selectedParty.toLowerCase()));
      const pct = p && valid ? (100 * p.votes/valid) : 0;
      const potential = Math.max(0, reg - env) * (pct/100);
      rows.push({ year: y, pct, votes: p?.votes||0, potential });
    });
    return rows;
  }, [resultsAllYears, okrsekId, selectedParty]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Okrsek {okrsekId}</h2>
      {!current ? (
        <p className="text-sm text-gray-600">Pro tento rok nejsou data. Zkus jiný rok nahoře.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
            <div className="rounded border p-2">
              <div className="text-gray-500">Voliči v seznamu</div>
              <div className="font-semibold">{current.registered?.toLocaleString?.() || current.registered}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-gray-500">Vydané obálky</div>
              <div className="font-semibold">{Math.round((current.turnout_pct/100)*(current.registered||0)).toLocaleString()}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-gray-500">Platné hlasy</div>
              <div className="font-semibold">{current.valid?.toLocaleString?.() || current.valid}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-gray-500">Účast</div>
              <div className="font-semibold">{current.turnout_pct?.toFixed?.(2)} %</div>
            </div>
          </div>

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
            <select className="border rounded px-2 py-1"
              value={selectedParty}
              onChange={(e)=>setSelectedParty(e.target.value)}>
              <option value="">— vyber —</option>
              {[...new Set((current.parties||[]).map(d=>d.code))].map(code => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>

          {partyTrend && (
            <div className="mb-4">
              <h3 className="font-semibold mb-2">Trend vybrané strany (%, odhad potenciálu)</h3>
              <PartyTrendLine data={partyTrend} color={guessPartyPalette(selectedParty||"")} />
              <p className="text-xs text-gray-500 mt-1">
                Odhad potenciálu = (nevoliči) × (aktuální podíl strany). Orientační metrika.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
