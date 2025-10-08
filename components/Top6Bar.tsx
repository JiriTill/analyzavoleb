"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from "recharts";
import { PartyBarDatum } from "@/lib/types";
import { colorForParty } from "@/lib/partyColors";


export function Top6Bar({ data }: { data: PartyBarDatum[] }) {
return (
<div style={{ width: "100%", height: 240 }}>
<ResponsiveContainer>
<BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
<XAxis dataKey="name" angle={-20} textAnchor="end" height={40} interval={0} />
<YAxis width={36} />
<Tooltip formatter={(v:any)=>`${v.toFixed? v.toFixed(2): v}%`} />
<Bar dataKey="pct">
{data.map((d, i) => (<Cell key={i} fill={colorForParty(d.party_code)} />))}
</Bar>
</BarChart>
</ResponsiveContainer>
</div>
);
}
