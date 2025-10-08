"use client";
import { Year } from "@/lib/types";
export function YearTabs({ year, setYear }: { year: Year; setYear: (y: Year) => void }) {
const years: Year[] = ["2025", "2024", "2022"];
return (
<div className="inline-flex rounded bg-gray-100 p-1">
{years.map((y) => (
<button key={y}
onClick={() => setYear(y)}
className={`px-3 py-1 rounded ${y===year?"bg-black text-white":"text-gray-800"}`}>{y}</button>
))}
</div>
);
}
