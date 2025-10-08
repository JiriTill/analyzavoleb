const COLORS: Record<string, string> = {
ANO: "#4c6fff",
SPOLU: "#ff8a00",
SPD: "#7a52aa",
PIR: "#00a2ae",
PIRATI: "#00a2ae",
STAN: "#2fb344",
STAC: "#e4572e",
MOTOR: "#333333"
};


export function colorForParty(codeOrName: string) {
const key = codeOrName.toUpperCase();
for (const k of Object.keys(COLORS)) {
if (key.includes(k)) return COLORS[k];
}
return "#666";
}


export function guessPartyPalette(code: string) { return colorForParty(code); }
