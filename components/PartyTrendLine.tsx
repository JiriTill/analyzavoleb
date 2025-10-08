"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";


export function PartyTrendLine({ data, color }: { data: { year: string; pct: number; votes: number; potential: number }[], color: string }) {
return (
<div style={{ width: "100%", height: 220 }}>
<ResponsiveContainer>
<LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
<XAxis dataKey="year" />
<YAxis yAxisId="left" domain={[0, 100]} width={36} />
<YAxis yAxisId="right" orientation="right" width={36} />
<Tooltip formatter={(value:any, name:any)=>{
if (name === 'pct') return [`${value.toFixed? value.toFixed(2): value}%`, 'Podíl (%)'];
if (name === 'potential') return [Math.round(value), 'Odhad potenciál (hlasy)'];
if (name === 'votes') return [value, 'Hlasy'];
return [value, name];
}} />
<Line yAxisId="left" type="monotone" dataKey="pct" dot stroke={color} />
<Line yAxisId="right" type="monotone" dataKey="potential" dot />
</LineChart>
</ResponsiveContainer>
</div>
);
}
