// The raw labels in the block data are keys, not prose: 05TH_AV, W_ASH_ST,
// I-5_SB_OFF_RA. Ported unchanged from the pipeline-era page -- the rules were
// derived from all 382 block ids and still hold.

const SUFFIX: Record<string, string> = {
  AV: "Ave", ST: "St", BL: "Blvd", DR: "Dr", WY: "Way", PL: "Pl",
  RD: "Rd", CT: "Ct", TR: "Ter", PY: "Pkwy", AL: "Aly", HY: "Hwy", CR: "Cir",
  ONRAMP: "On-Ramp", OFFRAMP: "Off-Ramp", RAMP: "Ramp",
};

const DIR: Record<string, string> = {
  N: "N", S: "S", E: "E", W: "W", NB: "NB", SB: "SB", EB: "EB", WB: "WB",
};

// Map_Border is the edge of the study area, not a street. It must never be
// drawn as a label or offered as a bounding street.
function isRealStreet(raw: string | undefined): raw is string {
  return !!raw && raw.toUpperCase() !== "MAP_BORDER";
}

function ordinal(t: string): string | null {
  const m = /^(\d+)(ST|ND|RD|TH)$/.exec(t);
  return m ? String(parseInt(m[1], 10)) + m[2].toLowerCase() : null;
}

export function prettyStreet(raw: string | undefined): string {
  if (!isRealStreet(raw)) return "";
  const norm = raw.toUpperCase()
    .replace(/_ON_RA$/, "_ONRAMP")
    .replace(/_OFF_RA$/, "_OFFRAMP")
    .replace(/_RA$/, "_RAMP");

  const parts = norm.split("_");
  const out: string[] = [];
  parts.forEach((t, i) => {
    if (!t) return;
    const o = ordinal(t);
    if (o) return void out.push(o);
    if (i > 0 && SUFFIX[t] && i === parts.length - 1) return void out.push(SUFFIX[t]);
    if (DIR[t] && (i === 0 || i === parts.length - 1)) return void out.push(DIR[t]);
    if (SUFFIX[t]) return void out.push(SUFFIX[t]);
    if (/^I-\d+$/.test(t) || /^SR-\d+$/.test(t)) return void out.push(t);
    if (t.length <= 2) return void out.push(t);
    out.push(t.charAt(0) + t.slice(1).toLowerCase());
  });
  return out.join(" ");
}

/** "13TH_ST" + "J_ST" -> "13th St & J St" */
export function corner(a: string, b: string): string {
  const x = prettyStreet(a);
  const y = prettyStreet(b);
  return x && y ? `${x} & ${y}` : x || y;
}
