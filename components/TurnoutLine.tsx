"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";


export function TurnoutLine({ data }: { data: { year: string; turnout: number }[] }) {
return (
<div style={{ width: "100%", height: 200 }}>
<ResponsiveContainer>
<LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
<XAxis dataKey="year" />
<YAxis domain={[0, 100]} width={36} />
<Tooltip formatter={(v:any)=>`${v.toFixed? v.toFixed(2): v}%`} />
<Line type="monotone" dataKey="turnout" dot />
</LineChart>
</ResponsiveContainer>
</div>
);
}
