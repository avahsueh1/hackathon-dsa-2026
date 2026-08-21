(function () {
"use strict";

// Supplied by data.js, which assigns window.HEATMAP_DATA.
var DATA = window.HEATMAP_DATA;
var GEO = DATA.geometry, V = DATA.values;

var cs = getComputedStyle(document.documentElement);
function tok(n) { return cs.getPropertyValue(n).trim(); }

// ---------------------------------------------------------------- colour
// Fixed human-readable breaks (spec 6.2). NOT a per-month quantile scale --
// the point of the slider is comparing months, so a bin must mean the same
// thing in every frame. Both palettes share the breaks, so switching view
// never changes what a number means.
var BREAKS = [
  { max: 0,        label: "0",     blocks: "--map-parcel-empty", heat: null },
  { max: 2,        label: "0-2",   blocks: "--step-150", heat: "--heat-100" },
  { max: 5,        label: "2-5",   blocks: "--step-250", heat: "--heat-200" },
  { max: 10,       label: "5-10",  blocks: "--step-350", heat: "--heat-300" },
  { max: 20,       label: "10-20", blocks: "--step-450", heat: "--heat-400" },
  { max: 40,       label: "20-40", blocks: "--step-550", heat: "--heat-500" },
  { max: 80,       label: "40-80", blocks: "--step-650", heat: "--heat-600" },
  { max: Infinity, label: "80+",   blocks: "--step-700", heat: "--heat-700" }
];
BREAKS.forEach(function (b) {
  b.blocksHex = tok(b.blocks);
  b.heatHex = b.heat ? tok(b.heat) : null;
});
var MISSING_HEX = tok("--missing-fill");
var EMPTY_HEX = tok("--map-parcel-empty");

function binOf(v) {
  for (var i = 0; i < BREAKS.length; i++) if (v <= BREAKS[i].max) return i;
  return BREAKS.length - 1;
}

var view = "blocks";

// ---------------------------------------------------------------- legend
var legend = document.getElementById("legend");
var swatches = [];
BREAKS.forEach(function (b) {
  var d = document.createElement("div");
  d.className = "lg";
  d.innerHTML = '<div class="swatch"></div><div class="lbl">' + b.label + "</div>";
  legend.appendChild(d);
  swatches.push(d.querySelector(".swatch"));
});
function paintLegend() {
  BREAKS.forEach(function (b, i) {
    swatches[i].style.background =
      (view === "heat" && b.heatHex) ? b.heatHex : b.blocksHex;
  });
}

// ------------------------------------------------------------ projection
// Equirectangular with a cosine latitude correction (spec 6.1). At ~3.5km the
// error is far below a block; kx is not optional -- without it the map squashes.
var bb = GEO.bbox;
var minLon = bb[0], minLat = bb[1], maxLon = bb[2], maxLat = bb[3];
var kx = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
var spanX = (maxLon - minLon) * kx, spanY = (maxLat - minLat);

var PAD = 12;
var VB_W = 1000;
var scale = (VB_W - PAD * 2) / spanX;
var VB_H = spanY * scale + PAD * 2;

function px(lon) { return (lon - minLon) * kx * scale + PAD; }
function py(lat) { return VB_H - PAD - (lat - minLat) * scale; }

function ringsToPath(rings) {
  var d = "";
  for (var r = 0; r < rings.length; r++) {
    var ring = rings[r];
    for (var i = 0; i < ring.length; i++) {
      d += (i === 0 ? "M" : "L") + px(ring[i][0]).toFixed(2) + " " +
           py(ring[i][1]).toFixed(2);
    }
    d += "Z";
  }
  return d;
}

// ------------------------------------------------------------ street names
// The raw labels are keys, not prose: 05TH_AV, W_ASH_ST, I-5_SB_OFF_RA.
var SUFFIX = {
  AV: "Ave", ST: "St", BL: "Blvd", DR: "Dr", WY: "Way", PL: "Pl",
  RD: "Rd", CT: "Ct", TR: "Ter", PY: "Pkwy", AL: "Aly", HY: "Hwy", CR: "Cir",
  ONRAMP: "On-Ramp", OFFRAMP: "Off-Ramp", RAMP: "Ramp"
};
var DIR = { N: "N", S: "S", E: "E", W: "W", NB: "NB", SB: "SB", EB: "EB", WB: "WB" };

// Map_Border is the edge of the study area, not a street. It must never be
// drawn as a label or offered as a bounding street.
function isRealStreet(raw) {
  return !!raw && raw.toUpperCase() !== "MAP_BORDER";
}

function ordinal(t) {
  var m = /^(\d+)(ST|ND|RD|TH)$/.exec(t);
  if (!m) return null;
  return String(parseInt(m[1], 10)) + m[2].toLowerCase();
}

function prettyStreet(raw) {
  if (!isRealStreet(raw)) return "";
  raw = raw.toUpperCase()
           .replace(/_ON_RA$/, "_ONRAMP")
           .replace(/_OFF_RA$/, "_OFFRAMP")
           .replace(/_RA$/, "_RAMP");
  var parts = raw.split("_"), out = [];
  for (var i = 0; i < parts.length; i++) {
    var t = parts[i];
    if (!t) continue;
    var o = ordinal(t);
    if (o) { out.push(o); continue; }
    if (i > 0 && SUFFIX[t] && i === parts.length - 1) { out.push(SUFFIX[t]); continue; }
    if (DIR[t] && (i === 0 || i === parts.length - 1)) { out.push(DIR[t]); continue; }
    if (SUFFIX[t]) { out.push(SUFFIX[t]); continue; }
    if (/^I-\d+$/.test(t) || /^SR-\d+$/.test(t)) { out.push(t); continue; }
    if (t.length <= 2) { out.push(t); continue; }
    out.push(t.charAt(0) + t.slice(1).toLowerCase());
  }
  return out.join(" ");
}

// Every block_id is exactly its east street, an underscore, then its north
// street (verified for all 382), so a readable name needs no parsing of the id
// -- just the two street fields. "17TH_ST_K_ST" reads as "17th St & K St".
var blockIdxById = {};
V.block_ids.forEach(function (b, i) { blockIdxById[b] = i; });

function prettyBlock(i) {
  var b = GEO.blocks[i];
  var e = prettyStreet(b.streets.e), n = prettyStreet(b.streets.n);
  var nm = (e && n) ? e + " & " + n : (e || n || b.id);
  // Two blocks share a corner name and are distinguished only by a __2 suffix.
  if (/__2$/.test(b.id)) nm += " (2)";
  return nm;
}

function prettyBlockId(id) {
  var i = blockIdxById[id];
  return i === undefined ? id : prettyBlock(i);
}

// ------------------------------------------------------------------- svg
var NS = "http://www.w3.org/2000/svg";
var svg = document.getElementById("map");
svg.setAttribute("viewBox", "0 0 " + VB_W.toFixed(1) + " " + VB_H.toFixed(1));

var defs = document.createElementNS(NS, "defs");
var gradDefs = "";
BREAKS.forEach(function (b, i) {
  if (!b.heatHex) return;
  gradDefs +=
    '<radialGradient id="hg' + i + '">' +
    '<stop offset="0%" stop-color="' + b.heatHex + '" stop-opacity="0.95"/>' +
    '<stop offset="55%" stop-color="' + b.heatHex + '" stop-opacity="0.55"/>' +
    '<stop offset="100%" stop-color="' + b.heatHex + '" stop-opacity="0"/>' +
    "</radialGradient>";
});
defs.innerHTML =
  '<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" ' +
  'patternTransform="rotate(45)">' +
  '<line x1="0" y1="0" x2="0" y2="7" stroke="#1a1a19" stroke-width="2.2" ' +
  'stroke-opacity="0.5"/></pattern>' +
  '<filter id="blur" x="-25%" y="-25%" width="150%" height="150%">' +
  '<feGaussianBlur stdDeviation="9"/></filter>' + gradDefs;
svg.appendChild(defs);

var bg = document.createElementNS(NS, "rect");
bg.setAttribute("x", "0"); bg.setAttribute("y", "0");
bg.setAttribute("width", String(VB_W)); bg.setAttribute("height", String(VB_H));
bg.setAttribute("fill", tok("--map-street"));
svg.appendChild(bg);

// Everything below pans and zooms together (spec 6.1).
var viewport = document.createElementNS(NS, "g");
svg.appendChild(viewport);

function layer(id, parent) {
  var g = document.createElementNS(NS, "g");
  if (id) g.setAttribute("id", id);
  (parent || viewport).appendChild(g);
  return g;
}

var gParcels = layer("parcels");
var gBlocks = layer("blocks");
var gHeat = layer("heat");
gHeat.setAttribute("filter", "url(#blur)");
gHeat.style.display = "none";
var gHatch = layer("hatch");
gHatch.setAttribute("opacity", "0.16");     // spec 6.4 -- subtle
var gStreets = layer("streets");
var gTransit = layer("transit");
var gShelters = layer("shelters");
var gHealth = layer("health");
var gPlan = layer("plan");
var gAreas = layer("areas");
var planNodes = [];
gTransit.style.display = "none";
gShelters.style.display = "none";
gHealth.style.display = "none";
gPlan.style.display = "none";

var paths = [], hatches = [], blobs = [], parcels = [];

// Each block's outer ring in projected (pre-transform) coordinates, plus its
// bounding box. Used for box-select hit testing, so the test runs against the
// polygon itself rather than the centroid -- spec 5.5 warns that two centroids
// fall outside their own block.
var proj = GEO.blocks.map(function (b) {
  var pts = b.rings[0].map(function (p) { return [px(p[0]), py(p[1])]; });
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  pts.forEach(function (p) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  });
  return { pts: pts, x0: x0, y0: y0, x1: x1, y1: y1 };
});

GEO.blocks.forEach(function (b, i) {
  var d = ringsToPath(b.rings);

  // The basemap parcel. Its fat stroke is painted in the street colour, which
  // widens the gap between blocks so the rights-of-way read as streets.
  var pc = document.createElementNS(NS, "path");
  pc.setAttribute("d", d);
  pc.setAttribute("class", "parcel");
  gParcels.appendChild(pc);
  parcels.push(pc);

  var p = document.createElementNS(NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("class", "block");
  p.dataset.i = i;
  gBlocks.appendChild(p);
  paths.push(p);

  var c = document.createElementNS(NS, "circle");
  c.setAttribute("cx", px(b.centroid[0]).toFixed(2));
  c.setAttribute("cy", py(b.centroid[1]).toFixed(2));
  c.setAttribute("r", "0");
  gHeat.appendChild(c);
  blobs.push(c);

  var h = document.createElementNS(NS, "path");
  h.setAttribute("d", d);
  h.setAttribute("class", "hatch");
  h.setAttribute("fill", "url(#hatch)");
  gHatch.appendChild(h);
  hatches.push(h);
});

// ---------------------------------------------------------- street labels
// Placed from the st_* bounding-street labels. Spec 5.6 warns those fields are
// labels rather than a graph, so they are used ONLY for naming and placement
// (which spec 5.5 explicitly allows) and never for adjacency or anything spatial.
var streetAcc = {};
GEO.blocks.forEach(function (b) {
  var r = b.rings[0], x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (var i = 0; i < r.length; i++) {
    var X = px(r[i][0]), Y = py(r[i][1]);
    if (X < x0) x0 = X; if (X > x1) x1 = X;
    if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
  }
  var mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  function add(name, axis, pos, along) {
    if (!isRealStreet(name)) return;
    var k = name + "|" + axis;
    var a = streetAcc[k] || (streetAcc[k] = { name: name, axis: axis, pos: 0, n: 0, lo: Infinity, hi: -Infinity });
    a.pos += pos; a.n++;
    if (along < a.lo) a.lo = along;
    if (along > a.hi) a.hi = along;
  }
  add(b.streets.w, "v", x0, my);
  add(b.streets.e, "v", x1, my);
  add(b.streets.n, "h", y0, mx);
  add(b.streets.s, "h", y1, mx);
});

var streets = Object.keys(streetAcc).map(function (k) {
  var a = streetAcc[k];
  return {
    name: a.name, axis: a.axis, n: a.n,
    pos: a.pos / a.n, mid: (a.lo + a.hi) / 2, len: a.hi - a.lo
  };
}).filter(function (s) { return s.n >= 2 && s.len > 30; });

streets.sort(function (a, b) { return b.n - a.n; });

var streetNodes = [];
streets.forEach(function (s) {
  var t = document.createElementNS(NS, "text");
  t.textContent = prettyStreet(s.name);
  var major = s.n >= 8;
  t.setAttribute("class", "stlabel" + (major ? " major" : ""));
  var x = s.axis === "v" ? s.pos : s.mid;
  var y = s.axis === "v" ? s.mid : s.pos;
  t.setAttribute("x", x.toFixed(1));
  t.setAttribute("y", y.toFixed(1));
  if (s.axis === "v") t.setAttribute("transform", "rotate(-90 " + x.toFixed(1) + " " + y.toFixed(1) + ")");
  gStreets.appendChild(t);
  streetNodes.push({ node: t, major: major });
});

// ------------------------------------------------------------ area labels
var areaAcc = {};
GEO.blocks.forEach(function (b) {
  var a = areaAcc[b.area] || (areaAcc[b.area] = { x: 0, y: 0, n: 0 });
  a.x += px(b.centroid[0]); a.y += py(b.centroid[1]); a.n++;
});
var areaNodes = [];
Object.keys(areaAcc).forEach(function (name) {
  var a = areaAcc[name];
  var t = document.createElementNS(NS, "text");
  t.setAttribute("class", "arealabel");
  t.setAttribute("x", (a.x / a.n).toFixed(1));
  t.setAttribute("y", (a.y / a.n).toFixed(1));
  t.textContent = name;
  gAreas.appendChild(t);
  areaNodes.push(t);
});

// ------------------------------------------------------ transit (MTS GTFS)
// Retrieved from the MTS developer feed at BUILD time and inlined by
// build_page.py -- the page itself still fetches nothing.
var TRANSIT = DATA.transit;
var transitNodes = [], stationNodes = [];
if (TRANSIT) {
  var routeById = {};
  TRANSIT.routes.forEach(function (r) { routeById[r.id] = r; });

  function polyline(pts) {
    var d = "";
    for (var i = 0; i < pts.length; i++) {
      d += (i === 0 ? "M" : "L") + px(pts[i][0]).toFixed(2) + " " + py(pts[i][1]).toFixed(2);
    }
    return d;
  }
  // White casing under each line so overlapping trolley routes stay separable.
  ["casing", "line"].forEach(function (pass) {
    TRANSIT.lines.forEach(function (ln) {
      var col = (routeById[ln.route_id] || {}).color || "#666";
      ln.paths.forEach(function (pts) {
        var p = document.createElementNS(NS, "path");
        p.setAttribute("d", polyline(pts));
        p.setAttribute("class", "trolley" + (pass === "casing" ? " casing" : ""));
        if (pass === "line") p.setAttribute("stroke", col);
        gTransit.appendChild(p);
        transitNodes.push({ node: p, casing: pass === "casing" });
      });
    });
  });
  TRANSIT.stations.forEach(function (s) {
    var c = document.createElementNS(NS, "circle");
    c.setAttribute("class", "station");
    c.setAttribute("cx", px(s.lonlat[0]).toFixed(2));
    c.setAttribute("cy", py(s.lonlat[1]).toFixed(2));
    var t = document.createElementNS(NS, "title");
    t.textContent = s.name + " — trolley station";
    c.appendChild(t);
    gTransit.appendChild(c);
    stationNodes.push(c);
  });
}

// --------------------------------------------------------- shelters (HIC)
// One colour for every shelter -- size carries the bed count. A second hue for
// "full" was doing two jobs with one channel and read as a different kind of
// thing, so occupancy is a small FULL tag instead.
var SHELTERS = DATA.shelters;
var shelterNodes = [];
if (SHELTERS) {
  SHELTERS.shelters.forEach(function (s) {
    var full = s.utilization !== null && s.utilization >= 0.95;
    var x = px(s.lonlat[0]), y = py(s.lonlat[1]);
    var g = document.createElementNS(NS, "g");

    var c = document.createElementNS(NS, "circle");
    c.setAttribute("class", "shelter");
    c.setAttribute("cx", x.toFixed(2));
    c.setAttribute("cy", y.toFixed(2));
    // Area proportional to beds, so 300 beds looks like 3x of 100, not 9x.
    c._r = 4 + Math.sqrt(s.beds) * 1.5;

    var money = s.funding_fy25_usd
      ? "\nFY25 funding: $" + (s.funding_fy25_usd / 1e6).toFixed(2) + "M" +
        (s.cost_per_bed_year_usd
          ? " ($" + s.cost_per_bed_year_usd.toLocaleString() + "/bed/yr)" : "") +
        "\n  matched to budget line: " + s.funding_program +
        " (" + s.funding_confidence + " confidence)"
      : "\nFY25 funding: no unambiguous budget line";
    var t = document.createElementNS(NS, "title");
    t.textContent = s.name + "\nRun by " + s.org +
      "\n" + s.address +
      "\n" + s.beds + " beds · " + s.occupied + " occupied · " + s.free + " free" +
      (s.utilization !== null ? " (" + Math.round(s.utilization * 100) + "% full)" : "") +
      money;
    c.appendChild(t);
    g.appendChild(c);

    // The disc is sized by beds, so it says "roughly here, this big". A small
    // solid dot marks the actual address.
    var pin = document.createElementNS(NS, "circle");
    pin.setAttribute("class", "shelterpin");
    pin.setAttribute("cx", x.toFixed(2));
    pin.setAttribute("cy", y.toFixed(2));
    g.appendChild(pin);

    var tag = null, tagText = null;
    if (full) {
      tag = document.createElementNS(NS, "rect");
      tag.setAttribute("class", "fulltag");
      g.appendChild(tag);
      tagText = document.createElementNS(NS, "text");
      tagText.setAttribute("class", "fulltagtx");
      tagText.textContent = "FULL";
      g.appendChild(tagText);
    }

    gShelters.appendChild(g);
    shelterNodes.push({ c: c, pin: pin, x: x, y: y, tag: tag, tagText: tagText });
  });
}

// Every external source gets named on the page, with the note that all of it
// was fetched at build time and inlined.
var srcs = ["<b>Counts:</b> Downtown San Diego Partnership monthly street counts " +
            "and block-level sweeps, via the Regional Task Force on Homelessness."];
if (SHELTERS) srcs.push("<b>Shelters &amp; funding:</b> " + SHELTERS.attribution);
if (HEALTH) srcs.push("<b>Health facilities:</b> " + HEALTH.attribution);
if (TRANSIT) srcs.push("<b>Transit:</b> " + TRANSIT.attribution);
document.getElementById("sources").innerHTML = srcs.join("<br>");

// ------------------------------------------------- health facilities (HCAI)
// Drawn as icons rather than coloured squares: a medical cross reads as care
// at a glance, where a teal square needs the legend every time. Only the
// facilities sitting on the block grid are drawn -- the acute hospitals are
// all several km outside the frame, which is itself the finding.

// Each icon is a path drawn in a 0..10 box, scaled and centred at the marker.
var ICONS = {
  clinic:      "M4 0 H6 V4 H10 V6 H6 V10 H4 V6 H0 V4 H4 Z",
  hospital:    "M4 0 H6 V4 H10 V6 H6 V10 H4 V6 H0 V4 H4 Z",
  psychiatric: "M4 0 H6 V4 H10 V6 H6 V10 H4 V6 H0 V4 H4 Z",
  hospice:     "M5 10 C1 6.6 0 5 0 3.4 A3 3 0 0 1 5 1.6 A3 3 0 0 1 10 3.4 C10 5 9 6.6 5 10 Z",
  nursing:     "M0 4 H4 A2 2 0 0 1 6 6 H10 V9 H0 Z M1 1 H3 V3.4 H1 Z",
  home_health: "M5 0 L10 4.2 V10 H6.5 V6.5 H3.5 V10 H0 V4.2 Z",
  other:       "M5 1 A4 4 0 1 1 4.99 1 Z"
};
var ICON_COLOR = {
  clinic: "#0d9488", hospital: "#b91c1c", psychiatric: "#b91c1c",
  hospice: "#b45309", nursing: "#475569", home_health: "#64748b", other: "#64748b"
};

var HEALTH = DATA.health;
var healthNodes = [];
if (HEALTH) {
  HEALTH.facilities.filter(function (f) { return f.in_view; }).forEach(function (f) {
    var g = document.createElementNS(NS, "g");
    g.setAttribute("class", "healthmark");
    var x = px(f.lonlat[0]), y = py(f.lonlat[1]);

    // A pale disc behind the glyph so it stays legible over a dark block.
    var halo = document.createElementNS(NS, "circle");
    halo.setAttribute("class", "healthhalo");
    halo.setAttribute("cx", x.toFixed(2));
    halo.setAttribute("cy", y.toFixed(2));
    g.appendChild(halo);

    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", ICONS[f.cls] || ICONS.other);
    p.setAttribute("fill", ICON_COLOR[f.cls] || ICON_COLOR.other);
    g.appendChild(p);

    var t = document.createElementNS(NS, "title");
    t.textContent = f.name + "\n" + f.type +
      "\n" + f.address + ", " + f.city +
      (f.capacity ? "\n" + f.capacity + " licensed beds" : "") +
      (f.trauma ? "\nTrauma centre: " + f.trauma : "") +
      "\nNearest block: " + f.nearest_block + " (" + f.nearest_block_m + " m)";
    g.appendChild(t);

    gHealth.appendChild(g);
    healthNodes.push({ g: g, path: p, halo: halo, x: x, y: y,
                       big: f.cls === "hospital" || f.cls === "psychiatric" });
  });
}

// ------------------------------------------------------------- map legend

var mapLegend = document.getElementById("maplegend");

function swatch(kind, style, label) {
  return '<span class="mlrow"><span class="sw ' + kind + '" style="' + style +
         '"></span>' + label + "</span>";
}

function paintMapLegend() {
  var parts = [];
  if (document.getElementById("lay-shelters").checked && SHELTERS) {
    parts.push('<span class="mlrow mlgroup">Shelters</span>');
    parts.push(swatch("circ", "background:#7a3fb5;opacity:.55;border-color:#4c2276",
                      "circle size = beds"));
    parts.push(swatch("pin", "", "exact location"));
    parts.push('<span class="mlrow"><span class="fulltagsw">FULL</span>' +
      "95% or more occupied</span>");
  }
  if (document.getElementById("lay-health").checked && HEALTH) {
    parts.push('<span class="mlrow mlgroup">Health</span>');
    var seen = {};
    HEALTH.facilities.forEach(function (f) { if (f.in_view) seen[f.cls] = 1; });
    var HL = [["hospital", "hospital"], ["psychiatric", "psychiatric"],
              ["clinic", "clinic"], ["nursing", "nursing home"],
              ["hospice", "hospice"], ["home_health", "home health"],
              ["other", "other"]];
    HL.forEach(function (h) {
      if (!seen[h[0]]) return;
      // Draw the real icon in the legend, so the key matches the map exactly.
      parts.push('<span class="mlrow"><svg class="micon" viewBox="0 0 10 10">' +
        '<path d="' + (ICONS[h[0]] || ICONS.other) + '" fill="' +
        (ICON_COLOR[h[0]] || ICON_COLOR.other) + '"/></svg>' + h[1] + "</span>");
    });
    // Say it plainly: there is no hospital on this map.
    if (!seen.hospital && !seen.psychiatric && HEALTH.totals.nearest_trauma) {
      parts.push('<span class="mlrow">no hospital downtown — nearest is ' +
        HEALTH.totals.nearest_trauma_km.toFixed(1) + " km away</span>");
    }
  }
  var planBox = document.getElementById("lay-plan");
  if (planBox && planBox.checked && DATA.plan) {
    parts.push('<span class="mlrow mlgroup">Proposed</span>');
    parts.push(swatch("circ", "background:#d97706;border-color:#ffffff",
                      "recommended site"));
    parts.push(swatch("circ",
      "background:#d97706;opacity:.12;border-color:#b45309",
      "the " + DATA.plan.method.walk_m + " m walk it covers (hover to highlight)"));
  }
  if (document.getElementById("lay-transit").checked && TRANSIT) {
    parts.push('<span class="mlrow mlgroup">Trolley</span>');
    var shown = {};
    TRANSIT.lines.forEach(function (l) { shown[l.route_id] = 1; });
    TRANSIT.routes.forEach(function (r) {
      if (shown[r.id]) parts.push(swatch("line", "background:" + r.color, r.name));
    });
    parts.push(swatch("dot", "", "station"));
  }
  mapLegend.innerHTML = parts.join("");
  mapLegend.classList.toggle("on", parts.length > 0);
}

function bindLayer(id, group) {
  var el = document.getElementById(id);
  if (!group.childNodes.length) { el.parentNode.style.display = "none"; return; }
  el.addEventListener("change", function () {
    group.style.display = el.checked ? "" : "none";
    paintMapLegend();
  });
}
bindLayer("lay-transit", gTransit);
bindLayer("lay-shelters", gShelters);
bindLayer("lay-health", gHealth);

// ------------------------------------------------------------- month axis
var months = V.months;
var slider = document.getElementById("slider");
slider.max = String(months.length - 1);

var month_index = {};
months.forEach(function (m, i) { month_index[m] = i; });

var observedSet = {}, missingSet = {};
V.observed_months.forEach(function (m) { observedSet[m] = 1; });
V.missing_months.forEach(function (m) { missingSet[m] = 1; });

var ticks = document.getElementById("ticks");
months.forEach(function (m, i) {
  var cls = observedSet[m] ? "observed" : (missingSet[m] ? "missing" :
            (m.slice(5) === "01" ? "year" : null));
  if (!cls) return;
  var t = document.createElement("div");
  t.className = "tick " + cls;
  t.style.left = (i / (months.length - 1) * 100) + "%";
  t.title = m;
  ticks.appendChild(t);
});

function monthName(m) {
  var MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return MN[parseInt(m.slice(5), 10) - 1] + " " + m.slice(0, 4);
}

// ------------------------------------------------------------------ render
var badge = document.getElementById("badge");
var badgeText = document.getElementById("badge-text");
var curtain = document.getElementById("curtain");
var monthLabel = document.getElementById("month-label");
var totalLabel = document.getElementById("total-label");
var cur = 0;

function render(mi) {
  cur = mi;
  var m = months[mi];
  var row = V.values[mi];
  var obsRow = V.is_observed[mi];
  var isMissing = !!missingSet[m];
  var heat = view === "heat";

  var total = 0, nObs = 0;
  for (var i = 0; i < row.length; i++) {
    var v = row[i];
    var p = paths[i];

    if (v === null) {
      p.setAttribute("fill", MISSING_HEX);
      p.setAttribute("fill-opacity", heat ? "0.30" : "0.85");
      parcels[i].classList.add("empty");
      blobs[i].setAttribute("r", "0");
    } else {
      total += v;
      var bi = binOf(v);
      parcels[i].classList.toggle("empty", v === 0);
      if (heat) {
        // In heat view the choropleth goes fully transparent but stays in the
        // DOM: it is still the hit target for the tooltip.
        p.setAttribute("fill", BREAKS[bi].blocksHex);
        p.setAttribute("fill-opacity", "0");
        var r = v > 0 ? 9 + Math.sqrt(v) * 4.6 : 0;
        blobs[i].setAttribute("r", r.toFixed(1));
        blobs[i].setAttribute("fill", BREAKS[bi].heatHex ? "url(#hg" + bi + ")" : "none");
      } else {
        p.setAttribute("fill", v === 0 ? EMPTY_HEX : BREAKS[bi].blocksHex);
        // Slightly translucent so the street grid underneath stays readable.
        p.setAttribute("fill-opacity", v === 0 ? "0" : "0.88");
        blobs[i].setAttribute("r", "0");
      }
    }

    // A null cell is NOT hatched: "no published total" is a different claim
    // from "estimated", and Outside Perimeter is null for every month before
    // it entered the program in Apr 2021.
    var estimated = !isMissing && !obsRow[i] && v !== null;
    hatches[i].style.display = (estimated && !heat) ? "" : "none";
    if (obsRow[i]) nObs++;
  }

  monthLabel.textContent = monthName(m);
  slider.setAttribute("aria-valuetext", monthName(m));

  if (isMissing) {
    totalLabel.textContent = "no data";
    badge.className = "badge missing";
    badgeText.textContent = "No count published — " + monthName(m);
    curtain.classList.add("on");
  } else {
    totalLabel.textContent = Math.round(total).toLocaleString() + " people downtown";
    curtain.classList.remove("on");
    if (nObs > 0) {
      badge.className = "badge observed";
      badgeText.textContent = "Observed count — " + monthName(m) +
        " · " + nObs + " blocks physically counted";
    } else {
      badge.className = "badge estimated";
      badgeText.textContent = "Estimated — " + monthName(m) + " · area total × block share";
    }
  }
  if (tipIdx >= 0) fillTip(tipIdx);
  paintStats(isMissing ? null : total, mi);
  // Keep a live selection in step with the slider.
  if (typeof selIdx !== "undefined" && selIdx && selIdx.length) renderPanel();
  if (view === "table") renderTable();
}

// ---------------------------------------------------------------- stat row
var INS = DATA.insights;
var statsEl = document.getElementById("stats");

function prevCounted(mi) {
  for (var i = mi - 1; i >= 0; i--) {
    if (V.values[i].some(function (v) { return v !== null; })) return i;
  }
  return -1;
}

function paintStats(total, mi) {
  var cards = [];

  var pm = prevCounted(mi);
  var mom = "";
  if (total !== null && pm >= 0) {
    var prev = V.values[pm].reduce(function (a, v) { return a + (v || 0); }, 0);
    if (prev > 0) {
      var d = (total - prev) / prev * 100;
      mom = '<div class="n ' + (d >= 0 ? "up" : "down") + '">' +
            (d >= 0 ? "▲ " : "▼ ") + Math.abs(d).toFixed(1) + "% vs " +
            monthName(months[pm]) + "</div>";
    }
  }
  cards.push('<div class="stat"><div class="k">People counted downtown</div><div class="v">' +
    (total === null ? "—" : Math.round(total).toLocaleString()) +
    ' <small>people</small></div>' + mom + "</div>");

  cards.push('<div class="stat"><div class="k">Most crowded blocks</div><div class="v">' +
    INS.concentration.top10_pct.toFixed(1) + '% <small>in just 10 blocks</small></div>' +
    '<div class="n">' + prettyBlockId(INS.concentration.top_block.block_id) +
    " alone holds " + INS.concentration.top_block.pct_of_downtown.toFixed(1) +
    "%</div></div>");

  if (SHELTERS) {
    var t = SHELTERS.totals;
    cards.push('<div class="stat"><div class="k">Shelter beds downtown</div><div class="v">' +
      t.beds.toLocaleString() + ' <small>beds</small></div>' +
      '<div class="n">only ' + t.free + " free · " +
      Math.round(t.utilization * 100) + "% full</div></div>");

    var top = SHELTERS.siting_candidates[0];
    cards.push('<div class="stat"><div class="k">Biggest shortfall</div><div class="v">' +
      Math.round(top.unmet_800m).toLocaleString() +
      ' <small>with no bed nearby</small></div>' +
      '<div class="n">around ' + prettyBlockId(top.block_id) + ", " + top.area +
      "</div></div>");
  } else {
    cards.push('<div class="stat"><div class="k">Blocks</div><div class="v">' +
      V.block_ids.length + "</div></div>");
    cards.push('<div class="stat"><div class="k">Counted months</div><div class="v">' +
      V.observed_months.length + ' <small>of ' + months.length + "</small></div></div>");
  }

  statsEl.innerHTML = cards.join("");
}


// ------------------------------------------------- table view (spec 6.6)
// The same month, without colour. Colour-blind readers, printing, screen
// readers and anyone who would rather read numbers all land here.

var tvSort = { key: "people", dir: -1 };

function renderTable() {
  var row = V.values[cur], obsRow = V.is_observed[cur];
  var isMissing = !!missingSet[months[cur]];
  var pick = (selIdx && selIdx.length) ? selIdx.slice()
                                       : V.block_ids.map(function (_, i) { return i; });

  var rows = pick.map(function (i) {
    return {
      i: i,
      name: prettyBlock(i),
      area: GEO.blocks[i].area,
      people: row[i],
      observed: obsRow[i],
      share: V.share_within_area[i]
    };
  });

  var k = tvSort.key, dir = tvSort.dir;
  rows.sort(function (a, b) {
    var x = a[k], y = b[k];
    if (k === "people") {
      x = x === null ? -1 : x;
      y = y === null ? -1 : y;
    }
    if (typeof x === "string") return dir * x.localeCompare(y);
    return dir * (x - y);
  });

  var total = rows.reduce(function (a, r) { return a + (r.people || 0); }, 0);
  document.getElementById("tv-title").textContent =
    (selIdx && selIdx.length) ? "Blocks in your selection" : "Every block";
  document.getElementById("tv-sub").textContent =
    rows.length + " blocks · " + monthName(months[cur]) + " · " +
    (isMissing ? "no count published" : fmt(total) + " people");

  function th(key, label, cls) {
    var on = tvSort.key === key;
    return "<th data-k='" + key + "'" + (cls ? " class='" + cls + "'" : "") + ">" +
      label + (on ? " <span class='arrow'>" + (tvSort.dir < 0 ? "▾" : "▴") +
      "</span>" : "") + "</th>";
  }

  var html = "<thead><tr>" + th("name", "Block") + th("area", "Neighbourhood") +
    th("people", "People", "n") + th("share", "Share of area", "n") +
    th("observed", "Counted?") + "</tr></thead><tbody>";

  html += rows.map(function (r) {
    return "<tr><td>" + r.name + "</td><td>" + r.area + "</td>" +
      "<td class='n'>" + (r.people === null ? "no data"
        : (r.observed ? "" : "~") + fmt(r.people)) + "</td>" +
      "<td class='n'>" + (r.share * 100).toFixed(1) + "%</td>" +
      "<td class='obs'>" + (r.people === null ? "not published"
        : (r.observed ? "counted in person" : "estimated")) + "</td></tr>";
  }).join("");
  html += "</tbody>";
  var tbl = document.getElementById("tv-table");
  tbl.innerHTML = html;

  Array.prototype.forEach.call(tbl.querySelectorAll("th"), function (el) {
    el.addEventListener("click", function () {
      var key = el.dataset.k;
      // Same column flips direction; a new column starts descending for
      // numbers and ascending for names, which is what people expect.
      if (tvSort.key === key) {
        tvSort.dir = -tvSort.dir;
      } else {
        tvSort.key = key;
        tvSort.dir = (key === "name" || key === "area") ? 1 : -1;
      }
      renderTable();
    });
  });
}

function setView(v) {
  view = v;
  ["blocks", "heat", "table"].forEach(function (m) {
    document.getElementById("view-" + m).setAttribute("aria-pressed", String(v === m));
  });
  var isTable = v === "table";
  gHeat.style.display = v === "heat" ? "" : "none";
  // The table replaces the map rather than sitting under it: it is an
  // alternative to the picture, not a supplement to it.
  document.querySelector(".map-shell").hidden = isTable;
  document.querySelector(".legend").hidden = isTable;
  document.getElementById("tableview").hidden = !isTable;
  paintLegend();
  render(cur);
  if (isTable) renderTable();
}
["blocks", "heat", "table"].forEach(function (m) {
  document.getElementById("view-" + m).addEventListener("click", function () { setView(m); });
});

// ------------------------------------------------------------ zoom + pan
var k = 1, tx = 0, ty = 0;
var MIN_K = 1, MAX_K = 14;

function applyTransform() {
  viewport.setAttribute("transform", "translate(" + tx.toFixed(2) + "," + ty.toFixed(2) + ") scale(" + k.toFixed(4) + ")");

  // Labels counter-scale so they stay legible instead of ballooning, and the
  // denser tier only appears once there is room for it.
  var base = 9.5 / k, areaBase = 15 / k;
  streetNodes.forEach(function (s) {
    s.node.style.fontSize = base.toFixed(2) + "px";
    s.node.style.strokeWidth = (2.4 / k).toFixed(2) + "px";
    s.node.style.display = (s.major || k >= 2.2) ? "" : "none";
  });
  areaNodes.forEach(function (t) {
    t.style.fontSize = areaBase.toFixed(2) + "px";
    t.style.strokeWidth = (3 / k).toFixed(2) + "px";
    t.style.display = k >= 5 ? "none" : "";
  });
  // Spec 6.3 -- raise the block outline once zoomed in.
  gBlocks.style.strokeWidth = "";
  paths.forEach(function (p) { p.style.strokeWidth = k > 3 ? "1px" : "0.6px"; });
  parcels.forEach(function (p) { p.style.strokeWidth = (3 / Math.sqrt(k)).toFixed(2); });

  // Overlay marks keep a constant on-screen size as the map scales.
  transitNodes.forEach(function (t) {
    t.node.style.strokeWidth = ((t.casing ? 6.2 : 3.4) / k).toFixed(2);
  });
  stationNodes.forEach(function (c) {
    c.setAttribute("r", (3.1 / k).toFixed(2));
    c.style.strokeWidth = (1.1 / k).toFixed(2);
  });
  shelterNodes.forEach(function (n) {
    var r = n.c._r / Math.sqrt(k);
    n.c.setAttribute("r", r.toFixed(2));
    n.c.style.strokeWidth = (1.4 / k).toFixed(2);
    n.pin.setAttribute("r", (2.6 / Math.sqrt(k)).toFixed(2));
    n.pin.style.strokeWidth = (0.9 / k).toFixed(2);
    if (!n.tag) return;
    // The FULL tag keeps a constant on-screen size and sits just above the disc.
    var w = 26 / k, h = 11 / k, ty = n.y - r - h * 0.55;
    n.tag.setAttribute("x", (n.x - w / 2).toFixed(2));
    n.tag.setAttribute("y", (ty - h / 2).toFixed(2));
    n.tag.setAttribute("width", w.toFixed(2));
    n.tag.setAttribute("height", h.toFixed(2));
    n.tag.setAttribute("rx", (h / 2).toFixed(2));
    n.tagText.setAttribute("x", n.x.toFixed(2));
    n.tagText.setAttribute("y", ty.toFixed(2));
    n.tagText.style.fontSize = (7.6 / k).toFixed(2) + "px";
  });
  healthNodes.forEach(function (n) {
    var size = (n.big ? 13 : 10) / Math.sqrt(k);
    n.halo.setAttribute("r", (size * 0.72).toFixed(2));
    n.halo.style.strokeWidth = (1 / k).toFixed(2);
    // Icon paths are authored in a 0..10 box, so scale then centre.
    var sc = size / 10;
    n.path.setAttribute("transform",
      "translate(" + (n.x - size / 2).toFixed(2) + "," + (n.y - size / 2).toFixed(2) +
      ") scale(" + sc.toFixed(4) + ")");
  });
  paths.forEach(function (p) {
    if (p.classList.contains("sel")) p.style.strokeWidth = (1.7).toFixed(2) + "px";
  });
  planNodes.forEach(function (pn) {
    var r = 9 / Math.sqrt(k);
    pn.dot.setAttribute("r", r.toFixed(2));
    pn.dot.style.strokeWidth = (1.6 / k).toFixed(2);
    pn.ring.style.strokeWidth = (1.3 / k).toFixed(2);
    pn.ring.style.strokeDasharray = (5 / k).toFixed(2) + " " + (4 / k).toFixed(2);
    if (pn.num) pn.num.style.fontSize = (r * 1.15).toFixed(2) + "px";
  });
  drawSelBox();
}

function clamp() {
  k = Math.max(MIN_K, Math.min(MAX_K, k));
  var maxX = VB_W * (k - 1), maxY = VB_H * (k - 1);
  tx = Math.max(-maxX, Math.min(0, tx));
  ty = Math.max(-maxY, Math.min(0, ty));
}

function svgPoint(e) {
  var r = svg.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width * VB_W,
    y: (e.clientY - r.top) / r.height * VB_H
  };
}

svg.addEventListener("wheel", function (e) {
  e.preventDefault();
  var pt = svgPoint(e);
  var prev = k;
  k *= Math.pow(1.0016, -e.deltaY);
  k = Math.max(MIN_K, Math.min(MAX_K, k));
  // Keep the point under the cursor fixed.
  tx = pt.x - (pt.x - tx) * (k / prev);
  ty = pt.y - (pt.y - ty) * (k / prev);
  clamp();
  applyTransform();
}, { passive: false });

// World coordinates are the pre-transform projected space the block paths live
// in, so a stored selection stays pinned to the map through zoom and pan.
function toWorld(e) {
  var p = svgPoint(e);
  return { x: (p.x - tx) / k, y: (p.y - ty) / k };
}

var selBox = document.createElementNS(NS, "rect");
selBox.setAttribute("class", "selbox");
selBox.style.display = "none";
viewport.appendChild(selBox);

var selecting = false, selStart = null, selRect = null;
var selBtn = document.getElementById("select-btn");

function setSelectMode(on) {
  selecting = on;
  selBtn.setAttribute("aria-pressed", String(on));
  svg.classList.toggle("selecting", on);
}
// Pressing the button again is the natural "undo": it drops the box and the
// breakdown, rather than leaving a stale selection behind on the map.
selBtn.addEventListener("click", function () {
  if (selecting) {
    clearSelection();
    setSelectMode(false);
  } else {
    setSelectMode(true);
  }
});

function drawSelBox() {
  if (!selRect) { selBox.style.display = "none"; return; }
  selBox.setAttribute("x", selRect.x0.toFixed(2));
  selBox.setAttribute("y", selRect.y0.toFixed(2));
  selBox.setAttribute("width", (selRect.x1 - selRect.x0).toFixed(2));
  selBox.setAttribute("height", (selRect.y1 - selRect.y0).toFixed(2));
  selBox.style.strokeWidth = (1.6 / k).toFixed(2);
  selBox.style.strokeDasharray = (5 / k).toFixed(2) + " " + (3 / k).toFixed(2);
  selBox.style.display = "";
}

var dragging = false, dragged = false, lastX = 0, lastY = 0;

svg.addEventListener("pointerdown", function (e) {
  if (selecting) {
    selStart = toWorld(e);
    selRect = { x0: selStart.x, y0: selStart.y, x1: selStart.x, y1: selStart.y };
    drawSelBox();
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
    return;
  }
  dragging = true; dragged = false;
  lastX = e.clientX; lastY = e.clientY;
  svg.classList.add("dragging");
  try { svg.setPointerCapture(e.pointerId); } catch (_) {}
});

svg.addEventListener("pointermove", function (e) {
  if (selStart) {
    var w = toWorld(e);
    selRect = {
      x0: Math.min(selStart.x, w.x), y0: Math.min(selStart.y, w.y),
      x1: Math.max(selStart.x, w.x), y1: Math.max(selStart.y, w.y)
    };
    drawSelBox();
    tip.style.display = "none";
    return;
  }
  if (!dragging) return;
  var r = svg.getBoundingClientRect();
  var dx = (e.clientX - lastX) / r.width * VB_W;
  var dy = (e.clientY - lastY) / r.height * VB_H;
  if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 2) dragged = true;
  lastX = e.clientX; lastY = e.clientY;
  tx += dx; ty += dy;
  clamp();
  applyTransform();
});

function endDrag(e) {
  if (selStart) {
    selStart = null;
    try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
    // A click rather than a drag clears the selection.
    if (selRect && (selRect.x1 - selRect.x0 < 1 || selRect.y1 - selRect.y0 < 1)) {
      clearSelection();
    } else {
      applySelection();
    }
    return;
  }
  if (!dragging) return;
  dragging = false;
  svg.classList.remove("dragging");
  try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
}
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);

// ------------------------------------------------------- selection geometry

function pointInPoly(x, y, pts) {
  var inside = false;
  for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function segHit(ax, ay, bx, by, cx, cy, dx, dy) {
  function o(px1, py1, px2, py2, px3, py3) {
    var v = (py2 - py1) * (px3 - px2) - (px2 - px1) * (py3 - py2);
    return v === 0 ? 0 : (v > 0 ? 1 : 2);
  }
  var o1 = o(ax, ay, bx, by, cx, cy), o2 = o(ax, ay, bx, by, dx, dy);
  var o3 = o(cx, cy, dx, dy, ax, ay), o4 = o(cx, cy, dx, dy, bx, by);
  return o1 !== o2 && o3 !== o4;
}

// True when the box overlaps the block's polygon at all -- not merely its
// centroid, so a block clipped by the edge of the box still counts.
function rectHitsBlock(r, p) {
  if (p.x1 < r.x0 || p.x0 > r.x1 || p.y1 < r.y0 || p.y0 > r.y1) return false;
  var i;
  for (i = 0; i < p.pts.length; i++) {
    var q = p.pts[i];
    if (q[0] >= r.x0 && q[0] <= r.x1 && q[1] >= r.y0 && q[1] <= r.y1) return true;
  }
  var corners = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
  for (i = 0; i < 4; i++) {
    if (pointInPoly(corners[i][0], corners[i][1], p.pts)) return true;
  }
  for (i = 0; i < p.pts.length - 1; i++) {
    for (var e = 0; e < 4; e++) {
      var c1 = corners[e], c2 = corners[(e + 1) % 4];
      if (segHit(p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1],
                 c1[0], c1[1], c2[0], c2[1])) return true;
    }
  }
  return false;
}

function inRect(r, x, y) {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

// --------------------------------------------------------------- selection

var selIdx = null;
var panel = document.getElementById("panel");
var detail = document.getElementById("detail");

function clearSelection() {
  selIdx = null;
  selRect = null;
  selBox.style.display = "none";
  panel.classList.remove("on");
  detail.classList.remove("on");
  paths.forEach(function (p) { p.classList.remove("sel"); });
}
document.getElementById("panel-clear").addEventListener("click", function () {
  clearSelection();
  setSelectMode(false);
});
document.getElementById("co-jump").addEventListener("click", function () {
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
});

function applySelection() {
  selIdx = [];
  for (var i = 0; i < proj.length; i++) {
    if (rectHitsBlock(selRect, proj[i])) selIdx.push(i);
  }
  paths.forEach(function (p, i) { p.classList.toggle("sel", selIdx.indexOf(i) >= 0); });
  panel.classList.add("on");
  if (!selIdx.length) {
    document.getElementById("co-value").textContent = "0";
    document.getElementById("co-unit").textContent = "blocks";
    document.getElementById("co-meta").textContent =
      "The box did not overlap any block — drag again over the grid.";
    detail.classList.remove("on");
    return;
  }
  detail.classList.add("on");
  renderPanel();
}

function fmt(n, dp) {
  if (n === null || n === undefined) return "—";
  return dp ? n.toFixed(dp) : Math.round(n).toLocaleString();
}

function renderPanel() {
  if (!selIdx || !selIdx.length) return;
  var row = V.values[cur], obsRow = V.is_observed[cur];
  var isMissing = missingSet[months[cur]];
  var i, j;

  // ---- basics
  var total = 0, nObs = 0, nEst = 0, nNull = 0, nZero = 0;
  var byArea = {};
  selIdx.forEach(function (i) {
    var v = row[i], a = GEO.blocks[i].area;
    var A = byArea[a] || (byArea[a] = { blocks: 0, persons: 0 });
    A.blocks++;
    if (v === null) { nNull++; return; }
    total += v; A.persons += v;
    if (v === 0) nZero++;
    if (obsRow[i]) nObs++; else nEst++;
  });

  var monthTotal = 0;
  for (j = 0; j < row.length; j++) if (row[j] !== null) monthTotal += row[j];
  var pct = monthTotal > 0 ? total / monthTotal * 100 : null;

  // ---- what falls inside the box
  var shIn = [], hIn = [], stIn = 0;
  if (SHELTERS) {
    SHELTERS.shelters.forEach(function (s) {
      if (inRect(selRect, px(s.lonlat[0]), py(s.lonlat[1]))) shIn.push(s);
    });
  }
  if (HEALTH) {
    HEALTH.facilities.forEach(function (f) {
      if (f.in_view && inRect(selRect, px(f.lonlat[0]), py(f.lonlat[1]))) hIn.push(f);
    });
  }
  if (TRANSIT) {
    TRANSIT.stations.forEach(function (s) {
      if (inRect(selRect, px(s.lonlat[0]), py(s.lonlat[1]))) stIn++;
    });
  }
  var beds = shIn.reduce(function (a, s) { return a + s.beds; }, 0);
  var free = shIn.reduce(function (a, s) { return a + s.free; }, 0);
  var gap = isMissing ? null : total - beds;

  var areaNames = Object.keys(byArea).sort(function (a, b) {
    return byArea[b].persons - byArea[a].persons;
  });

  // ---- the callout: one number, nothing else
  document.getElementById("co-value").textContent = isMissing ? "—" : fmt(total);
  document.getElementById("co-unit").textContent = isMissing ? "" : "people";
  document.getElementById("co-meta").textContent =
    selIdx.length + " block" + (selIdx.length === 1 ? "" : "s") + " · " +
    monthName(months[cur]) +
    (isMissing ? " · no count published" : "");

  // ---- the story, in one paragraph. A sentence needs no legend, which is why
  // it comes before any number grid or table.
  var when = monthName(months[cur]);
  var everythingCounted = nEst === 0 && nNull === 0;
  var about = everythingCounted ? "" : "about ";
  var cpb = SHELTERS ? SHELTERS.benchmarks.cost_per_bed_year_usd : 0;
  var story;

  if (isMissing) {
    story = "Nobody published a street count for <b>" + when + "</b>, so there is " +
      "no figure for this area. That means <b>unknown</b>, not zero — drag the " +
      "slider to a month with a count.";
  } else {
    story = "In this part of downtown, " + about + "<b>" + fmt(total) + " people</b>" +
      (everythingCounted ? " were counted" : " were") + " sleeping outside in <b>" +
      when + "</b>. ";
    if (beds > 0) {
      story += "There " + (beds === 1 ? "is" : "are") + " <b>" + fmt(beds) +
        " shelter bed" + (beds === 1 ? "" : "s") + "</b> in the same area, and <b>" +
        free + "</b> of them " + (free === 1 ? "is" : "are") + " free. ";
    } else {
      story += "There are <b>no shelter beds at all</b> in this area. ";
    }
    if (gap > 0) {
      story += "So " + about + "<b>" + fmt(gap) + " people have nowhere to go</b>";
      if (cpb) {
        story += ", and housing them would cost roughly <b>$" +
          fmt(gap * cpb / 1e6, 1) + " million a year</b>";
      }
      story += ".";
    } else {
      story += "That is enough beds for everyone counted here.";
    }
  }
  document.getElementById("story").innerHTML = story;

  // ---- three numbers, not eight
  function big(value, label, warn) {
    return '<div class="big' + (warn ? " warn" : "") + '"><div class="bv">' +
      value + '</div><div class="bk">' + label + "</div></div>";
  }
  document.getElementById("bigthree").innerHTML =
    big(isMissing ? "—" : fmt(total), "people sleeping outside") +
    big(fmt(free), "shelter beds free" + (beds ? " of " + fmt(beds) : "")) +
    big(gap === null ? "—" : fmt(Math.max(0, gap)), "people with nowhere to go",
        gap > 0);

  // ---- plain-language inventory
  var whats = [];
  if (shIn.length) {
    whats.push("<b>" + shIn.length + " shelter" + (shIn.length === 1 ? "" : "s") +
      "</b> with " + fmt(beds) + " beds between them, " +
      (beds ? Math.round((beds - free) / beds * 100) : 0) + "% full");
  } else {
    whats.push("<b>No shelter</b> in this area");
  }
  if (HEALTH) {
    var clinics = hIn.filter(function (f) { return f.cls === "clinic"; }).length;
    var others = hIn.length - clinics;
    if (hIn.length) {
      whats.push("<b>" + hIn.length + " health " +
        (hIn.length === 1 ? "facility" : "facilities") + "</b>" +
        (clinics ? " (" + clinics + " clinic" + (clinics === 1 ? "" : "s") +
          (others ? ", " + others + " other" : "") + ")" : ""));
    } else {
      whats.push("<b>No clinic or hospital</b> in this area");
    }
    if (HEALTH.totals.nearest_trauma_km) {
      whats.push("Nearest emergency room is <b>" +
        HEALTH.totals.nearest_trauma_km.toFixed(1) + " km away</b> (" +
        HEALTH.totals.nearest_trauma + ")");
    }
  }
  if (TRANSIT) {
    whats.push(stIn ? "<b>" + stIn + " trolley stop" + (stIn === 1 ? "" : "s") +
      "</b> for getting here" : "<b>No trolley stop</b> in this area");
  }
  whats.push("Mostly <b>" + areaNames[0] + "</b>" +
    (areaNames.length > 1 ? ", plus " + (areaNames.length - 1) + " other " +
      (areaNames.length === 2 ? "neighbourhood" : "neighbourhoods") : "") +
    " · " + selIdx.length + " blocks");
  document.getElementById("whats").innerHTML =
    whats.map(function (w) { return "<li>" + w + "</li>"; }).join("");

  // ---- composition by area
  var ah = "<tr class='hdr'><td>Neighbourhood</td><td class='num'>Blocks</td>" +
           "<td class='num'>People</td><td class='num'>Share</td></tr>";
  ah += areaNames.map(function (a) {
    var A = byArea[a];
    return "<tr><td>" + a + "</td><td class='num'>" + A.blocks + "</td><td class='num'>" +
      (isMissing ? "—" : fmt(A.persons)) + "</td><td class='num'>" +
      (isMissing || !total ? "—" : (A.persons / total * 100).toFixed(0) + "%") +
      "</td></tr>";
  }).join("");
  ah += "<tr class='tot'><td>Total</td><td class='num'>" + selIdx.length +
        "</td><td class='num'>" + (isMissing ? "—" : fmt(total)) +
        "</td><td class='num'>100%</td></tr>";
  document.getElementById("d-areas").innerHTML = ah;

  // ---- shelters
  document.getElementById("d-shelters-title").textContent =
    shIn.length ? "Shelters in selection" : "Nearest shelter";
  var sh = "";
  if (shIn.length) {
    sh = "<tr class='hdr'><td>Shelter</td><td class='num'>Beds</td>" +
         "<td class='num'>Full</td><td class='num'>Yearly cost</td></tr>";
    sh += shIn.sort(function (a, b) { return b.beds - a.beds; }).map(function (s) {
      return "<tr><td>" + s.name +
        (s.org ? "<br><span style='color:var(--text-muted);font-size:10.5px'>run by " +
          s.org + "</span>" : "") +
        "</td><td class='num'>" + s.beds +
        "</td><td class='num'>" + Math.round((s.utilization || 0) * 100) + "%</td>" +
        "<td class='num'>" + (s.funding_fy25_usd
          ? "$" + (s.funding_fy25_usd / 1e6).toFixed(1) + "M" : "—") + "</td></tr>";
    }).join("");
    sh += "<tr class='tot'><td>Total</td><td class='num'>" + beds +
          "</td><td class='num'>" + (beds ? Math.round((beds - free) / beds * 100) : 0) +
          "%</td><td class='num'></td></tr>";
    sh += "<tr><td colspan='4' class='num' style='padding-top:5px'>" + free +
          " free bed" + (free === 1 ? "" : "s") + " right now</td></tr>";
  } else if (SHELTERS) {
    var cxw = (selRect.x0 + selRect.x1) / 2, cyw = (selRect.y0 + selRect.y1) / 2;
    var best = null;
    SHELTERS.shelters.forEach(function (s) {
      var d = Math.hypot(px(s.lonlat[0]) - cxw, py(s.lonlat[1]) - cyw);
      if (!best || d < best.d) best = { d: d, s: s };
    });
    sh = best ? "<tr><td>" + best.s.name + "</td><td class='num'>" + best.s.beds +
      " beds · " + best.s.free + " free</td></tr>" +
      "<tr><td colspan='2' style='color:var(--text-muted);padding-top:4px'>" +
      "No shelter inside this box.</td></tr>" : "<tr><td>—</td></tr>";
  }
  document.getElementById("d-shelters").innerHTML = sh || "<tr><td>—</td></tr>";

  // ---- health and access
  var hh = "";
  if (HEALTH) {
    if (hIn.length) {
      hh += "<tr class='hdr'><td>In this area</td><td class='num'>Type</td></tr>";
      hh += hIn.sort(function (a, b) { return a.cls.localeCompare(b.cls); })
        .map(function (f) {
          return "<tr><td>" + f.name + "</td><td class='num'>" +
            f.cls.replace(/_/g, " ") + "</td></tr>";
        }).join("");
    } else {
      hh += "<tr><td colspan='2'>No health facility in box</td></tr>";
    }
    // Straight-line nearest can be across the bay, so name the nearest
    // reachable hospital and the nearest trauma centre instead.
    var T = HEALTH.totals;
    if (T.nearest_mainland_hospital) {
      hh += "<tr><td style='padding-top:7px;color:var(--text-muted)'>Nearest hospital<br>" +
        T.nearest_mainland_hospital + "</td><td class='num' style='padding-top:7px'>" +
        T.nearest_mainland_hospital_km.toFixed(1) + " km</td></tr>";
    }
    if (T.nearest_trauma) {
      hh += "<tr><td style='color:var(--text-muted)'>Nearest trauma (" +
        T.nearest_trauma_level + ")<br>" + T.nearest_trauma + "</td>" +
        "<td class='num'>" + T.nearest_trauma_km.toFixed(1) + " km</td></tr>";
    }
  }
  document.getElementById("d-health").innerHTML = hh || "<tr><td>—</td></tr>";

  // ---- counted months only: these are observation, not model output
  var mh = "<tr class='hdr'><td>Month</td><td class='num'>People</td>" +
           "<td class='num'>Share of downtown</td></tr>";
  mh += V.observed_months.map(function (m) {
    var mi = month_index[m];
    if (mi === undefined) return "";
    var t = 0, dt = 0, any = false;
    for (var n = 0; n < selIdx.length; n++) {
      var v = V.values[mi][selIdx[n]];
      if (v !== null) { t += v; any = true; }
    }
    for (var q = 0; q < V.values[mi].length; q++) {
      if (V.values[mi][q] !== null) dt += V.values[mi][q];
    }
    if (!any) return "";
    return "<tr" + (mi === cur ? " class='tot'" : "") + "><td><span class='obs-dot'></span>" +
      monthName(m) + "</td><td class='num'>" + fmt(t) + "</td><td class='num'>" +
      (dt ? (t / dt * 100).toFixed(1) + "%" : "—") + "</td></tr>";
  }).join("");
  document.getElementById("d-months").innerHTML = mh;

  // ---- every selected block
  document.getElementById("d-blocks-title").textContent =
    "Every block in selection (" + selIdx.length + ")";
  var ranked = selIdx.slice().sort(function (a, b) {
    return (row[b] === null ? -1 : row[b]) - (row[a] === null ? -1 : row[a]);
  });
  var bh = "<tr class='hdr'><td>Block</td><td class='num'>People</td></tr>";
  bh += ranked.map(function (i) {
    var v = row[i];
    return "<tr><td>" + (obsRow[i] ? "<span class='obs-dot'></span>" : "") +
      prettyBlock(i) + "</td><td class='num'>" +
      (v === null ? "no data" : (obsRow[i] ? "" : "~") + fmt(v)) + "</td>" +
      "</td></tr>";
  }).join("");
  document.getElementById("d-blocks").innerHTML = bh;

  renderSpark();
}

// Selection total across every month, so a box can be read as a trend and not
// just a snapshot. Observed months are dotted; gap months break the line.
function renderSpark() {
  var el = document.getElementById("panel-spark");
  var W = 600, H = 40, P = 3;
  el.setAttribute("viewBox", "0 0 " + W + " " + H);
  var series = months.map(function (_, mi) {
    var r = V.values[mi], t = null;
    for (var n = 0; n < selIdx.length; n++) {
      var v = r[selIdx[n]];
      if (v !== null) t = (t || 0) + v;
    }
    return t;
  });
  var max = Math.max.apply(null, series.filter(function (v) { return v !== null; }).concat([1]));
  var xOf = function (i) { return P + i / (months.length - 1) * (W - P * 2); };
  var yOf = function (v) { return H - P - (v / max) * (H - P * 2); };

  var d = "", pen = false;
  series.forEach(function (v, i) {
    if (v === null) { pen = false; return; }
    d += (pen ? "L" : "M") + xOf(i).toFixed(1) + " " + yOf(v).toFixed(1);
    pen = true;
  });

  var dots = "";
  V.observed_months.forEach(function (m) {
    var i = month_index[m];
    if (i === undefined || series[i] === null) return;
    dots += '<circle cx="' + xOf(i).toFixed(1) + '" cy="' + yOf(series[i]).toFixed(1) +
            '" r="2.4" fill="' + tok("--step-600") + '"/>';
  });
  var here = '<line x1="' + xOf(cur).toFixed(1) + '" y1="0" x2="' + xOf(cur).toFixed(1) +
             '" y2="' + H + '" stroke="' + tok("--border-strong") + '" stroke-width="1"/>';

  el.innerHTML = here +
    '<path d="' + d + '" fill="none" stroke="' + tok("--step-500") +
    '" stroke-width="1.6" stroke-linejoin="round"/>' + dots;

  document.getElementById("panel-sparkcap").textContent =
    monthName(months[0]) + " to " + monthName(months[months.length - 1]) +
    " · the busiest month here was " + fmt(max) + " people · each dot is a month " +
    "volunteers walked these blocks in person";
}

document.getElementById("reset").addEventListener("click", function () {
  k = 1; tx = 0; ty = 0;
  applyTransform();
});

// ----------------------------------------------------------------- tooltip
var tip = document.getElementById("tip");
var tipIdx = -1;

function confidenceOf(i) {
  var cv = V.cv_bucket[i];
  return cv === "low" ? "high" : (cv === "medium" ? "medium" : "low");
}

function fillTip(i) {
  var b = GEO.blocks[i];
  var v = V.values[cur][i];
  var obs = V.is_observed[cur][i];
  var s = b.streets;
  var html =
    '<div class="tid">' + prettyBlock(i) + "</div>" +
    '<div class="tarea">' + b.area + "</div>" +
    '<div class="tst">bounded by ' +
      [s.n, s.e, s.s, s.w].filter(isRealStreet).map(prettyStreet).join(", ") +
      "</div><hr>";

  if (v === null) {
    html += '<div class="tval">No count published</div>' +
            '<div class="tmeta">' +
            (missingSet[months[cur]]
              ? "DSDP reporting gap — unknown, not zero."
              : b.area + " had no published total this month.") + "</div>";
  } else {
    html += '<div class="tval">' + (obs ? "Counted " : "Est. ") +
            (v >= 10 ? Math.round(v) : v.toFixed(1)) +
            ' <span class="unit">people</span></div>';
    // The downtown figure quotes the same balanced-panel basis as the headline
    // concentration stat, so the two can never disagree on screen.
    var dt = V.share_equal_weight[i];
    html += '<div class="tmeta">' +
            (V.share_within_area[i] * 100).toFixed(1) + "% of " + b.area +
            (dt > 0 ? " · " + (dt * 100).toFixed(1) + "% of downtown" : "") + "</div>" +
            '<div class="tmeta">Based on ' + V.n_observations[i] +
            " physical counts · " + confidenceOf(i) + " confidence</div>";
    if (dt === 0 && V.n_observations[i] > 0) {
      html += '<div class="tflag">Outside the 261-block balanced panel, so no ' +
              "comparable downtown share.</div>";
    }
  }
  if (!obs && v !== null) {
    html += '<div class="tflag">Estimated: this area\'s published total for ' +
            monthName(months[cur]) + ", split by this block’s share.</div>";
  }
  if (V.cv_bucket[i] === "high" && V.n_observations[i] > 0) {
    html += '<div class="tflag">This block’s share swings a lot between counts ' +
            "— read it as indicative.</div>";
  }
  tip.innerHTML = html;
}

function moveTip(e) {
  var pad = 14;
  var r = tip.getBoundingClientRect();
  var x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
  tip.style.left = Math.max(8, x) + "px";
  tip.style.top = Math.max(8, y) + "px";
}

svg.addEventListener("mouseover", function (e) {
  var t = e.target;
  if (!t.dataset || t.dataset.i === undefined) return;
  tipIdx = +t.dataset.i;
  t.classList.add("hover");
  t.parentNode.appendChild(t);
  fillTip(tipIdx);
  tip.style.display = "block";
  moveTip(e);
});
svg.addEventListener("mousemove", function (e) {
  if (dragging) { tip.style.display = "none"; return; }
  if (tip.style.display === "block") moveTip(e);
});
svg.addEventListener("mouseleave", function () {
  tipIdx = -1;
  tip.style.display = "none";
});
svg.addEventListener("mouseout", function (e) {
  var t = e.target;
  if (t.dataset && t.dataset.i !== undefined) t.classList.remove("hover");
  tipIdx = -1;
  tip.style.display = "none";
});

// -------------------------------------------------------------- interaction
slider.addEventListener("input", function () { render(+slider.value); });

var timer = null;
var playBtn = document.getElementById("play");

function stop() {
  clearInterval(timer);
  timer = null;
  playBtn.innerHTML = "&#9654;";
  playBtn.setAttribute("aria-label", "Play through months");
}
function start() {
  if (timer) return;
  playBtn.innerHTML = "&#10073;&#10073;";
  playBtn.setAttribute("aria-label", "Pause");
  timer = setInterval(function () {        // spec 6.5 -- ~4 months/sec
    var n = cur + 1;
    if (n >= months.length) { stop(); return; }
    slider.value = String(n);
    render(n);
  }, 250);
}
playBtn.addEventListener("click", function () { timer ? stop() : start(); });

document.addEventListener("keydown", function (e) {
  if (e.code === "Space" && e.target.tagName !== "BUTTON") {
    e.preventDefault();
    timer ? stop() : start();
    return;
  }
  if (!e.shiftKey) return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  var n = cur + (e.key === "ArrowRight" ? 12 : -12);
  n = Math.max(0, Math.min(months.length - 1, n));
  slider.value = String(n);
  render(n);
});

// Open on the most recent month that actually carries a count.
var startIdx = months.length - 1;
while (startIdx > 0 && missingSet[months[startIdx]]) startIdx--;
slider.value = String(startIdx);
paintLegend();
applyTransform();
render(startIdx);


// --------------------------------------------------------------- theme
// Three states: auto follows the operating system, light and dark override
// it. Colours live in CSS custom properties, but the SVG reads them once at
// startup, so a theme change has to re-read the tokens and repaint.

var THEMES = ["auto", "light", "dark"];
var themeBtn = document.getElementById("theme-btn");

function readTokens() {
  cs = getComputedStyle(document.documentElement);
  BREAKS.forEach(function (b) {
    b.blocksHex = tok(b.blocks);
    b.heatHex = b.heat ? tok(b.heat) : null;
  });
  MISSING_HEX = tok("--missing-fill");
  EMPTY_HEX = tok("--map-parcel-empty");
  bg.setAttribute("fill", tok("--map-street"));
}

function applyTheme(name) {
  if (name === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", name);
  }
  try { localStorage.setItem("heatmap-theme", name); } catch (e) {}
  themeBtn.textContent = "Theme: " + name;
  readTokens();
  paintLegend();
  paintMapLegend();
  render(cur);
  // Gradients are baked into <defs>, so they need rebuilding by hand.
  BREAKS.forEach(function (b, i) {
    if (!b.heatHex) return;
    var g = document.getElementById("hg" + i);
    if (!g) return;
    Array.prototype.forEach.call(g.querySelectorAll("stop"), function (st) {
      st.setAttribute("stop-color", b.heatHex);
    });
  });
}

var savedTheme = "auto";
try { savedTheme = localStorage.getItem("heatmap-theme") || "auto"; } catch (e) {}
themeBtn.addEventListener("click", function () {
  var i = THEMES.indexOf(themeBtn.textContent.replace("Theme: ", ""));
  applyTheme(THEMES[(i + 1) % THEMES.length]);
});

// ============================================================ dashboard
// Three tabs over one dataset: what we know, where it is, what to do.
// Panels are populated from the inlined JSON, so adding a new one means
// adding a section and a render function -- see docs/ADDING_A_PANEL.md.

var TABS = ["tonight", "drops", "explore", "plan"];

function showTab(name) {
  TABS.forEach(function (t) {
    var btn = document.getElementById("tb-" + t);
    var pane = document.getElementById("tab-" + t);
    if (!btn || !pane) return;
    var on = t === name;
    btn.setAttribute("aria-selected", String(on));
    pane.hidden = !on;
  });
  // The map only measures correctly once its pane is visible.
  if (name === "explore") applyTransform();
  if (location.hash.slice(1) !== name) history.replaceState(null, "", "#" + name);
}

TABS.forEach(function (t) {
  var btn = document.getElementById("tb-" + t);
  if (btn) btn.addEventListener("click", function () { showTab(t); });
});

function money(usd, dp) {
  if (usd === null || usd === undefined) return "—";
  if (usd >= 1e6) return "$" + (usd / 1e6).toFixed(dp === undefined ? 1 : dp) + "M";
  if (usd >= 1e3) return "$" + Math.round(usd / 1e3) + "k";
  return "$" + Math.round(usd);
}

var PLAN = DATA.plan;

// ------------------------------------------------------------- overview
// Deliberately graphic rather than wordy: each finding is a small chart with
// one line of text under it. The long-form version lives on the other tabs.

function svgOpen(w, h) {
  return '<svg class="mc" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="xMinYMid meet">';
}

// A row of horizontal bars sharing one scale. label on the left, value on the
// right, so the eye compares bar lengths and never has to read an axis.
function hbars(items, opts) {
  opts = opts || {};
  var W = 340, rowH = 30, padL = opts.padL || 108, padR = 54;
  var H = items.length * rowH + 4;
  var max = opts.max || Math.max.apply(null, items.map(function (i) { return i.value; }));
  var track = W - padL - padR;
  var out = svgOpen(W, H);
  items.forEach(function (it, k) {
    var y = k * rowH + 5;
    var w = max > 0 ? Math.max(2, it.value / max * track) : 2;
    out += '<text x="' + (padL - 8) + '" y="' + (y + 13) +
      '" font-size="11.5" text-anchor="end" fill="' + tok("--text-secondary") +
      '">' + it.label + "</text>";
    out += '<rect x="' + padL + '" y="' + y + '" width="' + track +
      '" height="18" rx="4" fill="' + tok("--surface-sunken") + '"/>';
    out += '<rect x="' + padL + '" y="' + y + '" width="' + w.toFixed(1) +
      '" height="18" rx="4" fill="' + (it.color || tok("--step-500")) + '"/>';
    out += '<text x="' + (padL + track + 6) + '" y="' + (y + 13) +
      '" font-size="12" font-weight="600" fill="' + tok("--text-primary") +
      '">' + it.display + "</text>";
  });
  return out + "</svg>";
}

// A distance ruler. Reads as "here" versus "all the way over there".
function ruler(km, label, hereLabel) {
  var W = 340, H = 62, padL = 10, padR = 12;
  var track = W - padL - padR;
  var maxKm = Math.ceil(km) + 1;
  var x = padL + (km / maxKm) * track;
  var out = svgOpen(W, H);
  out += '<line x1="' + padL + '" y1="34" x2="' + (W - padR) + '" y2="34" stroke="' +
    tok("--border-strong") + '" stroke-width="2" stroke-linecap="round"/>';
  out += '<line x1="' + padL + '" y1="34" x2="' + x.toFixed(1) +
    '" y2="34" stroke="' + tok("--step-500") + '" stroke-width="2" stroke-dasharray="4 3"/>';
  out += '<circle cx="' + padL + '" cy="34" r="6" fill="' + tok("--step-500") + '"/>';
  out += '<text x="' + padL + '" y="20" font-size="11" fill="' +
    tok("--text-secondary") + '">' + hereLabel + "</text>";
  out += '<circle cx="' + x.toFixed(1) + '" cy="34" r="6" fill="#b5333f"/>';
  out += '<text x="' + Math.min(x, W - padR - 4).toFixed(1) +
    '" y="54" font-size="11.5" font-weight="600" text-anchor="end" fill="#b5333f">' +
    label + "</text>";
  return out + "</svg>";
}

(function renderOverview() {
  var counted = V.observed_months.length;

  document.getElementById("hero-lede").innerHTML =
    "Downtown San Diego counts the people sleeping on its streets every month. " +
    "This turns " + V.months.length + " months of those counts into one question: " +
    "<b>where would new shelter beds help the most people?</b>";

  function hn(v, k, bad) {
    return '<div class="heronum' + (bad ? " bad" : "") + '"><div class="hv">' +
      v + '</div><div class="hk">' + k + "</div></div>";
  }
  var nums = hn(V.months.length, "months of counts") +
             hn("382", "blocks, " + counted + " walked in person");
  if (PLAN) {
    nums += hn(fmt(PLAN.today.people_counted),
               "sleeping outside, " + monthName(PLAN.today.month));
    nums += hn(fmt(PLAN.today.people_without_a_bed), "with no bed nearby", true);
  }
  document.getElementById("hero-nums").innerHTML = nums;

  // --- the flow: three steps, mostly picture
  var flow = document.getElementById("flow");
  if (flow) {
    var arrow = '<div class="arrow">&rarr;</div>';
    var cards = [];

    cards.push('<div class="fcard"><div class="ficon">' +
      svgOpen(60, 46) +
      '<rect x="6" y="8" width="14" height="30" rx="2" fill="' + tok("--step-250") + '"/>' +
      '<rect x="23" y="16" width="14" height="22" rx="2" fill="' + tok("--step-450") + '"/>' +
      '<rect x="40" y="4" width="14" height="34" rx="2" fill="' + tok("--step-650") + '"/>' +
      "</svg></div>" +
      "<h3>The data</h3><p><b>" + fmt(V.months.length * 382) + "</b> block-months, " +
      "reconciled to the published totals within 1%.</p></div>");

    cards.push(arrow);
    cards.push('<div class="fcard"><div class="ficon">' +
      svgOpen(60, 46) +
      '<circle cx="30" cy="24" r="19" fill="none" stroke="' + tok("--border-strong") +
      '" stroke-width="2"/>' +
      '<circle cx="30" cy="24" r="7" fill="#b5333f"/>' +
      "</svg></div>" +
      "<h3>The pattern</h3><p>Need sits on a handful of blocks. The shelters are " +
      "already there &mdash; and <b>full</b>.</p></div>");

    cards.push(arrow);
    cards.push('<div class="fcard"><div class="ficon">' +
      svgOpen(60, 46) +
      '<path d="M10 38 L10 20 L22 12 L34 20 L34 38 Z" fill="' + tok("--step-450") + '"/>' +
      '<path d="M34 38 L34 26 L44 20 L52 26 L52 38 Z" fill="' + tok("--step-650") + '"/>' +
      "</svg></div>" +
      "<h3>The plan</h3><p>" + (PLAN
        ? "<b>" + PLAN.totals.sites + " new sites</b> reach <b>" +
          fmt(PLAN.totals.people_covered) + "</b> of them, for " +
          money(PLAN.totals.annual_cost_usd) + " a year."
        : "Run the siting model.") + "</p></div>");

    flow.innerHTML = cards.join("");
  }

  // --- findings, each one a chart plus a single line
  function finding(num, unit, title, chart, line) {
    return '<div class="finding"><div class="fhead"><div class="fnum">' + num +
      "<small>" + unit + "</small></div><h3>" + title + "</h3></div>" +
      '<div class="fchart">' + chart + "</div>" +
      "<p>" + line + "</p></div>";
  }

  var f = [];

  // 1. concentration: a sliver of blocks, a big share of people
  f.push(finding(
    INS.concentration.top10_pct.toFixed(1) + "%", "of people, in 10 blocks",
    "Need is concentrated",
    hbars([
      { label: "share of blocks", value: 10 / 382 * 100, display: "2.6%",
        color: tok("--border-strong") },
      { label: "share of people", value: INS.concentration.top10_pct,
        display: INS.concentration.top10_pct.toFixed(1) + "%" }
    ], { max: 100, padL: 96 }),
    "Those same 10 blocks are only 2.6% of downtown. The top 50 hold " +
    INS.concentration.top50_pct.toFixed(0) + "% &mdash; so targeting a few streets " +
    "reaches most people."));

  // 2. beds exist, but almost none are free
  if (SHELTERS) {
    var t = SHELTERS.totals;
    f.push(finding(
      t.free, "beds actually free", "Shelters are full",
      hbars([
        { label: "beds downtown", value: t.beds, display: fmt(t.beds),
          color: tok("--step-350") },
        { label: "sleeping outside", value: PLAN ? PLAN.today.people_counted : 0,
          display: fmt(PLAN ? PLAN.today.people_counted : 0),
          color: tok("--step-550") },
        { label: "beds free", value: t.free, display: fmt(t.free), color: "#b5333f" }
      ], { padL: 100 }),
      "There are more beds than people outside &mdash; but " +
      Math.round(t.utilization * 100) + "% are already taken."));
  }

  // 3. no hospital
  if (HEALTH && HEALTH.totals.nearest_trauma_km) {
    f.push(finding(
      "0", "hospitals downtown", "Care is somewhere else",
      ruler(HEALTH.totals.nearest_trauma_km,
            HEALTH.totals.nearest_trauma_km.toFixed(1) + " km away",
            "downtown: " + HEALTH.totals.in_view + " clinics, 0 hospitals"),
      "The nearest emergency room is " + HEALTH.totals.nearest_trauma + "."));
  }

  // 4. placement beats volume
  if (PLAN && PLAN.vs_baseline.lift_pct !== null) {
    f.push(finding(
      "+" + PLAN.vs_baseline.lift_pct.toFixed(0) + "%", "more people reached",
      "Placement matters",
      hbars([
        { label: "this model", value: PLAN.vs_baseline.model_covered,
          display: fmt(PLAN.vs_baseline.model_covered) },
        { label: "build at the crowd", value: PLAN.vs_baseline.baseline_covered,
          display: fmt(PLAN.vs_baseline.baseline_covered),
          color: tok("--border-strong") }
      ], { padL: 108 }),
      "Same money, same number of shelters &mdash; <b>" +
      fmt(PLAN.vs_baseline.extra_people_covered) + " more people</b> reached."));
  }

  document.getElementById("findings").innerHTML = f.join("");
})();

// ----------------------------------------------------------------- plan

(function renderPlan() {
  if (!PLAN) {
    var pane = document.getElementById("tab-plan");
    if (pane) {
      pane.innerHTML = '<p class="sectsub">No siting plan found. Run ' +
        "<code>python3 scripts/build_siting_model.py</code> and rebuild.</p>";
    }
    return;
  }
  var T = PLAN.totals, TD = PLAN.today, M = PLAN.method;

  document.getElementById("plan-lede").innerHTML =
    "<b>" + T.sites + " new shelter sites</b> holding <b>" + fmt(T.beds) +
    " beds</b> would put a bed within a 5-minute walk of <b>" +
    fmt(T.people_covered) + " of the " + fmt(TD.people_without_a_bed) +
    " people</b> who currently have none &mdash; <b>" + T.pct_of_unmet_covered +
    "% of the gap</b> &mdash; for <b>" + money(T.annual_cost_usd) + " a year</b>, " +
    "or " + money(T.cost_per_person_usd, 0) + " per person housed.";

  function hn(v, k, bad) {
    return '<div class="heronum' + (bad ? " bad" : "") + '"><div class="hv">' +
      v + '</div><div class="hk">' + k + "</div></div>";
  }
  document.getElementById("plan-nums").innerHTML =
    hn(T.sites, "sites recommended") +
    hn(fmt(T.beds), "new beds in total") +
    hn(money(T.annual_cost_usd), "a year to operate") +
    hn(T.pct_of_unmet_covered + "%", "of the current gap closed");


  // ------------------------------------------------------------- mini map
  // The same projection as the big map, drawn small and quiet: grey blocks,
  // shaded by today's count, with the seven sites numbered on top. It answers
  // "where are these?" without making the reader change tabs.
  (function minimap() {
    var el = document.getElementById("plan-map");
    if (!el) return;
    el.setAttribute("viewBox", "0 0 " + VB_W.toFixed(1) + " " + VB_H.toFixed(1));

    var mi = month_index[TD.month];
    var row = mi === undefined ? null : V.values[mi];
    var parts = [];

    parts.push('<rect x="0" y="0" width="' + VB_W + '" height="' + VB_H +
      '" fill="' + tok("--map-street") + '"/>');

    // blocks, shaded by the month the model was built on
    GEO.blocks.forEach(function (b, i) {
      var v = row ? row[i] : null;
      var fill = tok("--map-parcel");
      if (v !== null && v !== undefined && v > 0) fill = BREAKS[binOf(v)].blocksHex;
      parts.push('<path d="' + ringsToPath(b.rings) + '" fill="' + fill +
        '" fill-opacity="0.9" stroke="' + tok("--map-street") + '" stroke-width="1.6"/>');
    });

    // existing shelters, so "why not just there" answers itself
    if (SHELTERS) {
      SHELTERS.shelters.forEach(function (s) {
        var sx = px(s.lonlat[0]).toFixed(1), sy = py(s.lonlat[1]).toFixed(1);
        parts.push('<circle cx="' + sx + '" cy="' + sy + '" r="' +
          (3 + Math.sqrt(s.beds) * 1.1).toFixed(1) +
          '" fill="#7a3fb5" fill-opacity="0.30" stroke="#4c2276" stroke-opacity="0.7"' +
          ' stroke-width="1.4"/>');
        parts.push('<circle cx="' + sx + '" cy="' + sy +
          '" r="3.2" fill="#3b1a63" stroke="#fff" stroke-width="1.1"/>');
      });
    }

    // the recommendations
    var rad = PLAN.method.walk_m / 110570.0 * scale;
    PLAN.recommendations.forEach(function (r) {
      var x = px(r.centroid[0]), y = py(r.centroid[1]);
      parts.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' +
        rad.toFixed(1) + '" fill="#d97706" fill-opacity="0.06" stroke="#b45309"' +
        ' stroke-opacity="0.4" stroke-width="1.6" stroke-dasharray="6 5"/>');
    });
    PLAN.recommendations.forEach(function (r) {
      var x = px(r.centroid[0]), y = py(r.centroid[1]);
      parts.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
        '" r="14" fill="#d97706" stroke="#fff" stroke-width="2.5"><title>Site ' +
        r.rank + ": " + prettyBlockId(r.block_id) + ", " + r.beds +
        " beds</title></circle>");
      parts.push('<text x="' + x.toFixed(1) + '" y="' + (y + 0.5).toFixed(1) +
        '" font-size="17" font-weight="700" fill="#fff" text-anchor="middle"' +
        ' dominant-baseline="central" pointer-events="none">' + r.rank + "</text>");
    });

    el.innerHTML = parts.join("");
    document.getElementById("plan-map-cap").innerHTML =
      "Numbered circles are the recommended sites; the dashed ring is the " +
      PLAN.method.walk_m + "&nbsp;m walk each one covers. Purple discs are the " +
      "shelters that already exist, sized by beds. Block shading is " +
      monthName(TD.month) + ", the month the model was built on.";
  })();

  document.getElementById("plan-sub").innerHTML =
    "Ranked by how many people each one reaches who have no bed nearby today. " +
    "Sites marked <span class='tag'>holds up</span> also come out on top when " +
    "demand is averaged over the last three counts instead of just the most " +
    "recent, so they do not depend on a single year.";

  // Each card carries the evidence for itself: how many people within a
  // 5-minute walk have no bed today, how far the nearest existing shelter is,
  // and what else is reachable. Without that the ranking is just an assertion.
  var maxUnmet = Math.max.apply(null,
    PLAN.recommendations.map(function (r) { return r.unmet_within_walk; }));
  document.getElementById("plan-sites").innerHTML = PLAN.recommendations
    .map(function (r, k) {
      var access = [];
      access.push(fmt(r.nearest_shelter_m) + " m to the nearest shelter");
      if (r.trolley_stops_within_walk) access.push(r.trolley_stops_within_walk + " trolley stops");
      if (r.clinics_within_walk) access.push(r.clinics_within_walk + " clinics");
      var pct = maxUnmet > 0 ? (r.unmet_within_walk / maxUnmet * 100) : 0;
      return '<div class="site' + (k > 2 ? " rest" : "") + '">' +
        '<div class="rank">' + r.rank + "</div>" +
        '<div><div class="where">' + prettyBlockId(r.block_id) +
        (r.robust ? '<span class="tag">holds up</span>' : "") + "</div>" +
        '<div class="meta">' + r.area + " &middot; " + access.join(" &middot; ") + "</div>" +
        '<div class="why"><div class="whybar"><span style="width:' + pct.toFixed(1) +
        '%"></span></div><div class="whytx"><b>' + fmt(r.unmet_within_walk) +
        " people</b> within a 5-minute walk have no bed today</div></div></div>" +
        '<div class="nums"><div class="b">' + r.beds + " beds</div>" +
        '<div class="c">reaches ' + fmt(r.people_covered) + " people<br>" +
        money(r.annual_cost_usd) + "/yr &middot; " + money(r.cost_per_person_usd, 0) +
        " each</div></div></div>";
    }).join("");

  // model vs the obvious plan
  var B = PLAN.vs_baseline;
  var top = Math.max(B.model_covered, B.baseline_covered) || 1;
  document.getElementById("bar-model").style.width = (B.model_covered / top * 100) + "%";
  document.getElementById("bar-base").style.width = (B.baseline_covered / top * 100) + "%";
  document.getElementById("bar-model-v").innerHTML =
    "<b>" + fmt(B.model_covered) + "</b> people reached";
  document.getElementById("bar-base-v").innerHTML =
    fmt(B.baseline_covered) + " people reached";
  document.getElementById("compare-note").innerHTML =
    "Same number of sites, same bed cap, same budget per bed. Choosing by " +
    "coverage reaches <b>" + fmt(B.extra_people_covered) + " more people</b>, a " +
    B.lift_pct + "% improvement. The naive plan clusters its sites on the " +
    "crowd &mdash; which is already the best-served part of downtown.";

  // sensitivity
  var sv = "<tr><th>If people walk</th><th>Model reaches</th>" +
           "<th>Naive reaches</th><th>Model is</th></tr>";
  sv += PLAN.sensitivity.map(function (r) {
    var best = r.radius_m === M.walk_m;
    return "<tr" + (best ? " class='best'" : "") + "><td>" + r.radius_m + " m" +
      (best ? " (used)" : "") + "</td><td class='n'>" + fmt(r.model_covered) +
      "</td><td class='n'>" + fmt(r.naive_covered) + "</td><td class='n'>+" +
      (r.lift_pct === null ? "—" : r.lift_pct.toFixed(0) + "%") + "</td></tr>";
  }).join("");
  document.getElementById("sensitivity").innerHTML = sv;

  // Coverage curve. The x axis is the NUMBER of sites, not cost: cost per
  // person is flat at about $30,700 whichever site you build, because each
  // site is sized to the demand it covers. So the diminishing return is in
  // reach per site, and plotting against cost would just draw a straight line
  // and say nothing.
  (function curve() {
    var el = document.getElementById("curve");
    var W = 720, H = 190, L = 52, R = 14, Tp = 16, Bt = 40;
    el.setAttribute("viewBox", "0 0 " + W + " " + H);
    var recs = PLAN.recommendations;
    var maxCov = TD.people_without_a_bed || 1;
    var xOf = function (k) { return L + (k / recs.length) * (W - L - R); };
    var yOf = function (v) { return H - Bt - (v / maxCov) * (H - Tp - Bt); };
    var parts = [];

    parts.push('<line x1="' + L + '" y1="' + yOf(maxCov).toFixed(1) + '" x2="' +
      (W - R) + '" y2="' + yOf(maxCov).toFixed(1) + '" stroke="' +
      tok("--border-strong") + '" stroke-width="1" stroke-dasharray="4 3"/>');
    parts.push('<text x="' + (L + 5) + '" y="' + (yOf(maxCov) - 5).toFixed(1) +
      '" font-size="10.5" fill="' + tok("--text-muted") +
      '">everyone without a bed (' + fmt(maxCov) + ")</text>");

    var d = "M" + xOf(0).toFixed(1) + " " + yOf(0).toFixed(1);
    recs.forEach(function (r, k) {
      d += " L" + xOf(k + 1).toFixed(1) + " " + yOf(r.cumulative_covered).toFixed(1);
    });
    parts.push('<path d="' + d + '" fill="none" stroke="' + tok("--step-500") +
      '" stroke-width="2.2" stroke-linejoin="round"/>');

    recs.forEach(function (r, k) {
      parts.push('<circle cx="' + xOf(k + 1).toFixed(1) + '" cy="' +
        yOf(r.cumulative_covered).toFixed(1) + '" r="4" fill="' + tok("--step-600") +
        '"><title>After site ' + r.rank + " (" + prettyBlockId(r.block_id) + "): " +
        fmt(r.cumulative_covered) + " people reached, " + money(r.cumulative_cost_usd) +
        "/yr</title></circle>");
      parts.push('<text x="' + xOf(k + 1).toFixed(1) + '" y="' + (H - Bt + 15) +
        '" font-size="10.5" text-anchor="middle" fill="' + tok("--text-secondary") +
        '">' + (k + 1) + "</text>");
    });

    parts.push('<line x1="' + L + '" y1="' + (H - Bt) + '" x2="' + (W - R) +
      '" y2="' + (H - Bt) + '" stroke="' + tok("--border-subtle") + '"/>');
    parts.push('<text x="' + ((L + W - R) / 2).toFixed(1) + '" y="' + (H - 6) +
      '" font-size="10.5" text-anchor="middle" fill="' + tok("--text-muted") +
      '">number of new shelters built</text>');
    [0, 0.5, 1].forEach(function (f) {
      parts.push('<text x="' + (L - 7) + '" y="' + (yOf(maxCov * f) + 3.5).toFixed(1) +
        '" font-size="10.5" text-anchor="end" fill="' + tok("--text-secondary") +
        '">' + fmt(maxCov * f) + "</text>");
    });
    el.innerHTML = parts.join("");

    var third = recs[Math.min(2, recs.length - 1)];
    document.getElementById("curve-cap").innerHTML =
      "The first " + Math.min(3, recs.length) + " shelters reach <b>" +
      fmt(third.cumulative_covered) + " of the " + fmt(maxCov) + " people</b> (" +
      third.pct_of_unmet + "%); the remaining " + (recs.length - 3) + " add " +
      fmt(recs[recs.length - 1].cumulative_covered - third.cumulative_covered) +
      " more. Cost per person is almost identical wherever you build &mdash; about " +
      money(PLAN.method.cost_per_bed_year_usd, 0) + " a year &mdash; so the ranking is " +
      "about <b>how many people each site reaches</b>, not value for money.";
  })();

  // method
  document.getElementById("method-body").innerHTML =
    "<b>" + M.name + "</b> (" + M.reference + "). Each of the 382 blocks is a " +
    "candidate site. The model repeatedly picks the block that puts a bed within " +
    M.walk_m + " m of the most people who do not have one, caps it at " +
    M.max_beds_per_site + " beds, subtracts the demand it serves, and repeats. " +
    M.guarantee + " Existing supply counts <b>only free beds</b> &mdash; an occupied " +
    "bed serves nobody new. Cost uses " + money(M.cost_per_bed_year_usd, 0) +
    " per bed per year, taken from " + M.cost_source + ".";
  document.getElementById("method-limits").innerHTML =
    M.limits.map(function (l) { return "<li>" + l + "</li>"; }).join("");
  var RB = PLAN.robustness;
  document.getElementById("method-robust").innerHTML =
    "Re-running with demand averaged over " + RB.scenario_b.months.join(", ") +
    " instead of just " + RB.scenario_a.months.join(", ") + " keeps <b>" +
    RB.stable_count + " of " + RB.scenario_a.blocks.length + " sites</b>, including " +
    "the top two. The rest move, so treat the top of the list as the firm part " +
    "and the tail as indicative.";
})();

// -------------------------------------------- proposed sites on the map

if (PLAN && typeof gPlan !== "undefined") {
  PLAN.recommendations.forEach(function (r) {
    var g = document.createElementNS(NS, "g");
    g.setAttribute("class", "propsite");
    var x = px(r.centroid[0]), y = py(r.centroid[1]);
    var ring = document.createElementNS(NS, "circle");
    ring.setAttribute("class", "propring");
    ring.setAttribute("cx", x.toFixed(2));
    ring.setAttribute("cy", y.toFixed(2));
    // The ring is the actual walking catchment, in map units, so it grows and
    // shrinks with the map the way a real distance should.
    ring.setAttribute("r", (PLAN.method.walk_m / 110570.0 * scale).toFixed(2));
    g.appendChild(ring);
    var dot = document.createElementNS(NS, "circle");
    dot.setAttribute("class", "propdot");
    dot.setAttribute("cx", x.toFixed(2));
    dot.setAttribute("cy", y.toFixed(2));
    var t = document.createElementNS(NS, "title");
    t.textContent = "Proposed site " + r.rank + ": " + prettyBlockId(r.block_id) +
      "\n" + r.beds + " beds, reaching " + fmt(r.people_covered) + " people" +
      "\n" + money(r.annual_cost_usd) + " a year";
    dot.appendChild(t);
    g.appendChild(dot);
    var num = document.createElementNS(NS, "text");
    num.setAttribute("class", "proprank");
    num.setAttribute("x", x.toFixed(2));
    num.setAttribute("y", y.toFixed(2));
    num.textContent = r.rank;
    g.appendChild(num);

    g._x = x; g._y = y;
    gPlan.appendChild(g);
    planNodes.push({ g: g, ring: ring, dot: dot, num: num });
  });
  bindLayer("lay-plan", gPlan);
}

(function () { window.__panelLoaderWorks = V.block_ids.length; })();

/*__PANEL_JS__*/

applyTheme(savedTheme);


// ======================================================= Surplus -> Street
// The coordination loop: claim a zone, post how much you are bringing, and
// everyone else sees it is covered so they go somewhere else.
//
// Claims live in localStorage. That is honest for a demo -- a hosted version
// syncs them between restaurants, which is the entire point of the product --
// and the UI says so rather than pretending otherwise. All reads and writes go
// through loadClaims/saveClaims, so swapping in an API is one function.

var ZONES = DATA.zones;
var CLAIM_KEY = "surplus-street-claims-v1";
var MEAL_QUICK = [10, 25, 50, 100];

function loadClaims() {
  try {
    return JSON.parse(localStorage.getItem(CLAIM_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

function saveClaims(list) {
  try {
    localStorage.setItem(CLAIM_KEY, JSON.stringify(list));
  } catch (e) {
    // Private browsing, or storage full. The session still works; it just
    // will not survive a reload, and saying so beats failing silently.
    console.warn("claims could not be saved:", e);
  }
}

function claimsFor(zoneId) {
  return loadClaims().filter(function (c) {
    return c.zone === zoneId && c.status !== "cancelled";
  });
}

function mealsFor(zoneId) {
  return claimsFor(zoneId).reduce(function (a, c) { return a + c.meals; }, 0);
}

// need tonight = expected people - meals already claimed
function stillNeeded(z) {
  return Math.max(0, z.expected_tonight - mealsFor(z.id));
}

function coverage(z) {
  if (!z.expected_tonight) return 1;
  return Math.min(1, mealsFor(z.id) / z.expected_tonight);
}

function todayStamp() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
         "-" + String(d.getDate()).padStart(2, "0");
}

function prettyDate(iso) {
  var MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var p = iso.split("-");
  return parseInt(p[2], 10) + " " + MN[parseInt(p[1], 10) - 1] + " " + p[0];
}

var BAND_LABEL = { high: "High need", medium: "Medium need", low: "Lower need" };

// ------------------------------------------------------------ the zone list

var claimTarget = null;

function renderTonight() {
  if (!ZONES) return;
  var zones = ZONES.zones;

  var expected = zones.reduce(function (a, z) { return a + z.expected_tonight; }, 0);
  var claimed = zones.reduce(function (a, z) { return a + mealsFor(z.id); }, 0);
  var short = Math.max(0, expected - claimed);
  var uncovered = zones.filter(function (z) { return coverage(z) < 0.999; }).length;

  document.getElementById("tonight-sub").innerHTML =
    "Zones are ranked by how much food is still needed. Claim one and every " +
    "other restaurant sees it is covered, so nobody doubles up and nowhere " +
    "gets missed. Need is based on " + ZONES.basis.charAt(0).toLowerCase() +
    ZONES.basis.slice(1);

  function tn(v, k, cls) {
    return '<div class="tnum' + (cls ? " " + cls : "") + '"><div class="tv">' + v +
      '</div><div class="tk">' + k + "</div></div>";
  }
  document.getElementById("tonight-nums").innerHTML =
    tn(fmt(expected), "meals needed downtown") +
    tn(fmt(claimed), "claimed so far", claimed > 0 ? "good" : "") +
    tn(fmt(short), "still unclaimed", short > 0 ? "bad" : "good") +
    tn(uncovered + " of " + zones.length, "zones still short");

  // Zones that still need food come first -- the list is a worklist.
  var order = zones.slice().sort(function (a, b) {
    var ca = coverage(a) >= 0.999, cb = coverage(b) >= 0.999;
    if (ca !== cb) return ca ? 1 : -1;
    return stillNeeded(b) - stillNeeded(a);
  });

  document.getElementById("zone-list").innerHTML = order.map(function (z) {
    var mine = claimsFor(z.id);
    var meals = mealsFor(z.id);
    var cov = coverage(z);
    var covered = cov >= 0.999;
    var pct = Math.round(cov * 100);

    var who = mine.map(function (c) {
      return (c.who || "A restaurant") + " &middot; " + fmt(c.meals) + " meals &middot; " +
             c.when;
    });

    return '<div class="zcard ' + z.band + (covered ? " covered" : "") + '">' +
      '<div class="zhead">' +
        '<div><div class="zname">' + z.name +
          '<span class="zband ' + z.band + '">' + BAND_LABEL[z.band] + "</span></div>" +
          '<div class="zwhere">near ' + prettyStreet(z.landmark.a) + " &amp; " +
            prettyStreet(z.landmark.b) + " &middot; " + z.block_count + " blocks" +
            (z.services.shelters ? " &middot; " + z.services.shelters + " shelters" : "") +
          "</div>" +
        "</div>" +
        '<div class="zexp"><b>~' + fmt(z.expected_tonight) + "</b><span>expected</span></div>" +
      "</div>" +
      '<div class="zbar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="zstat">' +
        (covered
          ? '<span class="ok">Covered &mdash; ' + fmt(meals) + " meals coming</span>"
          : (meals
              ? '<span class="part">' + fmt(meals) + " meals coming &middot; <b>" +
                fmt(stillNeeded(z)) + " still needed</b></span>"
              : '<span class="none"><b>' + fmt(stillNeeded(z)) +
                " meals needed</b> &middot; nothing claimed yet</span>")) +
      "</div>" +
      (who.length ? '<ul class="zwho"><li>' + who.join("</li><li>") + "</li></ul>" : "") +
      '<div class="zactions">' +
        '<button class="btn ' + (covered ? "ghostbtn" : "primary") +
        '" data-claim="' + z.id + '">' +
        (meals ? "Add another drop" : "Claim this zone") + "</button>" +
      "</div>" +
    "</div>";
  }).join("");

  Array.prototype.forEach.call(
    document.querySelectorAll("[data-claim]"), function (b) {
      b.addEventListener("click", function () { openClaim(b.dataset.claim); });
    });

  renderZoneMap();
  renderDrops();
}

// ------------------------------------------------------------- the zone map
// Blocks are drawn, but every block in a zone gets the SAME colour -- the
// picture is zone-level, so it reveals nothing about individual blocks.

function renderZoneMap() {
  var el = document.getElementById("zone-map");
  if (!el || !ZONES) return;
  el.setAttribute("viewBox", "0 0 " + VB_W.toFixed(1) + " " + VB_H.toFixed(1));

  var byBlock = {};
  ZONES.zones.forEach(function (z) {
    z.block_ids.forEach(function (b) { byBlock[b] = z; });
  });

  var BANDC = { high: "#c2410c", medium: "#ea9a3e", low: "#e8d9c0" };
  var parts = ['<rect x="0" y="0" width="' + VB_W + '" height="' + VB_H +
               '" fill="' + tok("--map-street") + '"/>'];

  GEO.blocks.forEach(function (b, i) {
    var z = byBlock[b.id];
    var fill = tok("--map-parcel");
    var op = "1";
    if (z) {
      fill = coverage(z) >= 0.999 ? "#4f7a41" : BANDC[z.band];
      op = coverage(z) >= 0.999 ? "0.75" : "0.85";
    }
    parts.push('<path d="' + ringsToPath(b.rings) + '" fill="' + fill +
      '" fill-opacity="' + op + '" stroke="' + tok("--map-street") +
      '" stroke-width="1.4"/>');
  });

  ZONES.zones.forEach(function (z) {
    var x = px(z.centroid[0]), y = py(z.centroid[1]);
    var covered = coverage(z) >= 0.999;
    parts.push('<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
      '" class="zlabel" text-anchor="middle" dominant-baseline="central">' +
      z.name.toUpperCase() + "</text>");
    parts.push('<text x="' + x.toFixed(1) + '" y="' + (y + 30).toFixed(1) +
      '" class="zsub" text-anchor="middle" dominant-baseline="central">' +
      (covered ? "covered" : fmt(stillNeeded(z)) + " meals") + "</text>");
  });

  el.innerHTML = parts.join("");

  document.getElementById("zone-key").innerHTML =
    '<span class="kk"><i style="background:#c2410c"></i>High need</span>' +
    '<span class="kk"><i style="background:#ea9a3e"></i>Medium</span>' +
    '<span class="kk"><i style="background:#e8d9c0"></i>Lower</span>' +
    '<span class="kk"><i style="background:#4f7a41"></i>Covered tonight</span>';
  document.getElementById("zone-map-cap").textContent =
    "Ten delivery zones. Colour is the zone's need band, not any individual " +
    "block — every block in a zone is shaded the same.";
}

// --------------------------------------------------------------- claim flow

var modal = document.getElementById("claim-modal");

function openClaim(zoneId) {
  var z = ZONES.zones.filter(function (x) { return x.id === zoneId; })[0];
  if (!z) return;
  claimTarget = z;
  document.getElementById("claim-zone").innerHTML =
    "<b>" + z.name + "</b> &mdash; near " + prettyStreet(z.landmark.a) + " &amp; " +
    prettyStreet(z.landmark.b) + ". About " + fmt(stillNeeded(z)) +
    " more meals would cover it tonight.";

  var suggest = Math.min(200, Math.max(10, Math.round(stillNeeded(z) / 5) * 5)) || 25;
  document.getElementById("claim-meals").value = suggest;
  document.getElementById("claim-quick").innerHTML = MEAL_QUICK.concat([suggest])
    .filter(function (v, i, a) { return a.indexOf(v) === i; })
    .sort(function (a, b) { return a - b; })
    .map(function (v) {
      return '<button type="button" class="qbtn" data-meals="' + v + '">' + v + "</button>";
    }).join("");
  Array.prototype.forEach.call(document.querySelectorAll(".qbtn"), function (b) {
    b.addEventListener("click", function () {
      document.getElementById("claim-meals").value = b.dataset.meals;
    });
  });

  // The food description is per-drop, so it must not carry over from the last
  // claim. The business name is the opposite: remembering it saves retyping.
  document.getElementById("claim-what").value = "";
  document.getElementById("claim-when").selectedIndex = 1;
  try {
    document.getElementById("claim-who").value =
      localStorage.getItem("surplus-street-who") || "";
  } catch (e) {}

  modal.hidden = false;
  document.getElementById("claim-meals").focus();
}

function closeClaim() {
  modal.hidden = true;
  claimTarget = null;
}

document.getElementById("claim-cancel").addEventListener("click", closeClaim);
modal.addEventListener("click", function (e) {
  if (e.target === modal) closeClaim();
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && !modal.hidden) closeClaim();
});

document.getElementById("claim-confirm").addEventListener("click", function () {
  if (!claimTarget) return;
  var meals = parseInt(document.getElementById("claim-meals").value, 10);
  if (!meals || meals < 1) {
    document.getElementById("claim-meals").focus();
    return;
  }
  var who = document.getElementById("claim-who").value.trim();
  try { localStorage.setItem("surplus-street-who", who); } catch (e) {}

  var list = loadClaims();
  list.push({
    id: "c" + list.length + "-" + claimTarget.id,
    zone: claimTarget.id,
    zone_name: claimTarget.name,
    meals: meals,
    when: document.getElementById("claim-when").value,
    what: document.getElementById("claim-what").value.trim(),
    who: who,
    date: todayStamp(),
    status: "claimed"
  });
  saveClaims(list);
  closeClaim();
  renderTonight();
});

// ------------------------------------------------------ my drops + SB 1383

function renderDrops() {
  var list = loadClaims().filter(function (c) { return c.status !== "cancelled"; });
  var tbl = document.getElementById("drops-table");
  var empty = document.getElementById("drops-empty");
  if (!tbl) return;

  var meals = list.reduce(function (a, c) { return a + c.meals; }, 0);
  var delivered = list.filter(function (c) { return c.status === "delivered"; });
  document.getElementById("drops-nums").innerHTML =
    '<div class="tnum"><div class="tv">' + list.length +
    '</div><div class="tk">drops logged</div></div>' +
    '<div class="tnum good"><div class="tv">' + fmt(meals) +
    '</div><div class="tk">meals donated</div></div>' +
    '<div class="tnum"><div class="tv">' + delivered.length +
    '</div><div class="tk">marked delivered</div></div>';

  empty.hidden = list.length > 0;
  if (!list.length) { tbl.innerHTML = ""; return; }

  tbl.innerHTML = "<thead><tr><th>Date</th><th>Zone</th><th class='n'>Meals</th>" +
    "<th>What</th><th>Drop time</th><th>Status</th><th></th></tr></thead><tbody>" +
    list.map(function (c) {
      return "<tr><td>" + prettyDate(c.date) + "</td><td>" + c.zone_name +
        "</td><td class='n'>" + fmt(c.meals) + "</td><td>" + (c.what || "&mdash;") +
        "</td><td>" + c.when + "</td><td>" +
        (c.status === "delivered"
          ? '<span class="pill done">Delivered</span>'
          : '<span class="pill">Claimed</span>') + "</td>" +
        "<td class='n'>" +
        (c.status === "delivered" ? "" :
          '<button class="btn tiny" data-deliver="' + c.id + '">Mark delivered</button>') +
        ' <button class="btn tiny ghostbtn" data-drop="' + c.id + '">Remove</button>' +
        "</td></tr>";
    }).join("") + "</tbody>";

  Array.prototype.forEach.call(document.querySelectorAll("[data-deliver]"), function (b) {
    b.addEventListener("click", function () {
      var all = loadClaims();
      all.forEach(function (c) { if (c.id === b.dataset.deliver) c.status = "delivered"; });
      saveClaims(all);
      renderTonight();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-drop]"), function (b) {
    b.addEventListener("click", function () {
      var all = loadClaims().filter(function (c) { return c.id !== b.dataset.drop; });
      saveClaims(all);
      renderTonight();
    });
  });
}

function csvEscape(v) {
  v = String(v === null || v === undefined ? "" : v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// The columns SB 1383 record-keeping actually asks for: who donated, what,
// how much, when, and where it went.
function buildCsv() {
  var rows = [["Date", "Donor", "Zone", "Meals donated", "Food description",
               "Drop window", "Status"]];
  loadClaims().filter(function (c) { return c.status !== "cancelled"; })
    .forEach(function (c) {
      rows.push([c.date, c.who || "", c.zone_name, c.meals, c.what || "",
                 c.when, c.status]);
    });
  return rows.map(function (r) { return r.map(csvEscape).join(","); }).join("\n");
}

document.getElementById("export-csv").addEventListener("click", function () {
  var csv = buildCsv();
  var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sb1383-donation-log-" + todayStamp() + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
});

// Some sandboxes block page-initiated downloads, so the text is always
// available to copy as well.
document.getElementById("show-csv").addEventListener("click", function () {
  var ta = document.getElementById("csv-out");
  ta.value = buildCsv();
  ta.hidden = !ta.hidden;
  if (!ta.hidden) ta.select();
});

document.getElementById("clear-drops").addEventListener("click", function () {
  saveClaims([]);
  document.getElementById("csv-out").hidden = true;
  renderTonight();
});

document.getElementById("privacy-more").addEventListener("click", function (e) {
  e.preventDefault();
  alert(ZONES ? ZONES.privacy : "Zone-level only.");
});

if (ZONES) renderTonight();

// Deep link so a tab can be shared: index.html#plan
var initial = location.hash.slice(1);
showTab(TABS.indexOf(initial) >= 0 ? initial : "tonight");

})();
