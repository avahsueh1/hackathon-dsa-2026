#!/usr/bin/env python3
"""Where should the next shelters go? A maximal-coverage siting model.

Inputs
  data/out/geometry.json   382 block polygons and centroids
  data/out/values.json     people per block per month
  data/out/shelters.json   existing beds, occupancy, cost benchmark
  data/out/transit.json    trolley stations      (optional)
  data/out/health.json     clinics and hospitals (optional)

Output
  data/out/plan.json

THE PROBLEM
    Downtown has 1,516 shelter beds and they are 85% full. Adding beds helps
    only if they land within walking distance of people who currently have
    none. "Put it where the most people are" is the obvious answer and it is
    wrong, because the biggest cluster already sits beside the biggest
    shelters -- those people are already covered.

THE MODEL
    Maximal Covering Location Problem (Church & ReVelle, 1974). Choose K sites
    from 382 candidate blocks to maximise the number of currently-unserved
    people brought within a WALK_M walk of a new bed.

    Solved greedily: repeatedly take the site covering the most remaining
    unmet demand. Coverage is submodular, so greedy is guaranteed within
    (1 - 1/e), about 63%, of the optimum. That bound is why this is defensible
    without an ILP solver, which the zero-dependency rule rules out anyway.

WHY 400 m
    This parameter decides whether the model is worth running at all, so it is
    chosen with evidence rather than taste. Downtown is only ~3.5 km across, so
    a large radius makes every candidate site look identical and the model
    collapses onto the naive answer. Measured lift over the naive baseline:

        250 m  +47%      500 m  +21%
        300 m  +76%      600 m  +13%
        400 m  +38%      800 m   +6%

    800 m -- a 10-minute walk -- is the standard access catchment and is what
    the rest of the project reports "nearby" against, but it is useless for
    *choosing between* sites here. 400 m is the common 5-minute-walk planning
    threshold, still a realistic distance to a bed, and it discriminates. The
    full sweep ships in plan.json so the choice can be argued with.

HONEST LIMITS
    Demand is where people were counted *sleeping*, which is not necessarily
    where they would accept a bed. Distances are straight-line -- the bay and
    the I-5 are not modelled as barriers. Land availability, zoning and
    community process are not modelled at all. These are candidate areas for a
    siting study, not sites.

    python3 scripts/build_siting_model.py
"""

import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "out")

WALK_M = 400.0        # ~5 minutes on foot. See "WHY 400 m" above.
NEARBY_M = 800.0      # ~10 minutes, used only for reporting context
MIN_GAP_M = 150.0     # do not stack a new site on top of an existing shelter
MAX_BEDS = 150        # realistic single-site capacity; the largest existing is 327
MIN_BEDS = 20         # below this a site is not worth standing up
N_SITES = 8
SWEEP = [250, 300, 400, 500, 600, 800]


def load(name, required=True):
    path = os.path.join(OUT, name)
    if not os.path.exists(path):
        if required:
            sys.exit("missing %s -- run the earlier build scripts first" % path)
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def meters(lon1, lat1, lon2, lat2):
    return math.hypot((lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)) * 111320.0,
                      (lat2 - lat1) * 110570.0)


GEO = load("geometry.json")
V = load("values.json")
SH = load("shelters.json")
TR = load("transit.json", False)
HE = load("health.json", False)

blocks = GEO["blocks"]
n = len(blocks)
cent = [b["centroid"] for b in blocks]
shelters = SH["shelters"]
COST_PER_BED = SH["benchmarks"]["cost_per_bed_year_usd"]

print("building %d x %d distance matrix" % (n, n))
D = [[0.0] * n for _ in range(n)]
for i in range(n):
    for j in range(i + 1, n):
        d = meters(cent[i][0], cent[i][1], cent[j][0], cent[j][1])
        D[i][j] = D[j][i] = d

SD = [[meters(s["lonlat"][0], s["lonlat"][1], cent[i][0], cent[i][1]) for i in range(n)]
      for s in shelters]
nearest_shelter_m = [min(SD[k][i] for k in range(len(shelters))) for i in range(n)]

station_pts = [s["lonlat"] for s in TR["stations"]] if TR else []
clinic_pts = [f["lonlat"] for f in HE["facilities"] if f["in_view"]] if HE else []


def count_within(points, i, radius):
    return sum(1 for p in points
               if meters(p[0], p[1], cent[i][0], cent[i][1]) <= radius)


# ------------------------------------------------------------------ demand

def demand_for(month_keys):
    """People per block, averaged over the given physically counted months."""
    idxs = [V["months"].index(m) for m in month_keys if m in V["months"]]
    out = [0.0] * n
    for i in range(n):
        vals = [V["values"][mi][i] for mi in idxs if V["values"][mi][i] is not None]
        out[i] = sum(vals) / len(vals) if vals else 0.0
    return out


counted = V["observed_months"]
SCENARIOS = {"latest": [counted[-1]], "recent3": counted[-3:]}


def solve(demand, radius, k_sites=N_SITES, max_beds=MAX_BEDS):
    """Returns (unmet_by_block, greedy_sites, naive_sites).

    Existing supply counts only FREE beds, spread across each shelter's own
    catchment in proportion to demand. An occupied bed serves nobody new, so a
    99%-full shelter next door does not make a block look served.
    """
    near = [[j for j in range(n) if D[i][j] <= radius] for i in range(n)]
    sh_near = [[i for i in range(n) if SD[k][i] <= radius] for k in range(len(shelters))]

    served = [0.0] * n
    for k, s in enumerate(shelters):
        free = s["free"]
        if free <= 0:
            continue
        pool = sum(demand[i] for i in sh_near[k])
        if pool <= 0:
            continue
        for i in sh_near[k]:
            served[i] += free * demand[i] / pool
    unmet = [max(0.0, demand[i] - served[i]) for i in range(n)]

    def run(pick):
        rem = list(unmet)
        banned = set(i for i in range(n) if nearest_shelter_m[i] < MIN_GAP_M)
        out = []
        for _ in range(k_sites):
            i = pick(rem, banned, near)
            if i is None:
                break
            pool = sum(rem[j] for j in near[i])
            beds = int(min(max_beds, math.ceil(pool)))
            if beds < MIN_BEDS:
                break
            take = min(beds, pool)
            # A site serves at most its bed count, so draw the nearby need down
            # proportionally -- the next pick then sees only what is left.
            if pool > 0:
                for j in near[i]:
                    rem[j] -= take * rem[j] / pool
            out.append({"block": i, "beds": beds, "covered": round(take, 1)})
            banned.update(j for j in near[i] if D[i][j] < MIN_GAP_M)
        return out

    def greedy_pick(rem, banned, near):
        best, best_cov = None, 0.0
        for i in range(n):
            if i in banned:
                continue
            cov = sum(rem[j] for j in near[i])
            if cov > best_cov:
                best, best_cov = i, cov
        return best

    order = sorted(range(n), key=lambda i: -demand[i])

    def naive_pick(rem, banned, near):
        for i in order:
            if i not in banned:
                return i
        return None

    return unmet, run(greedy_pick), run(naive_pick)


# ------------------------------------------------- sensitivity on the radius
# Run first, because it is the evidence for the WALK_M choice above.

print("\nsensitivity: does the choice of site actually matter?")
print("  %6s %9s %8s %9s %8s" % ("radius", "unmet", "model", "naive", "lift"))
sweep = []
base_demand = demand_for(SCENARIOS["latest"])
for radius in SWEEP:
    u, g, nv = solve(base_demand, float(radius))
    gc = sum(s["covered"] for s in g)
    nc = sum(s["covered"] for s in nv)
    lift = (gc / nc - 1) * 100 if nc else None
    sweep.append({
        "radius_m": radius,
        "unmet": round(sum(u), 1),
        "model_covered": round(gc, 1),
        "naive_covered": round(nc, 1),
        "lift_pct": round(lift, 1) if lift is not None else None,
        "sites": len(g),
    })
    print("  %5dm %9.0f %8.0f %9.0f %7.1f%%"
          % (radius, sum(u), gc, nc, lift if lift is not None else 0))

# ------------------------------------------------------------------- solve

results = {}
for label, month_keys in SCENARIOS.items():
    demand = demand_for(month_keys)
    unmet, sites, base = solve(demand, WALK_M)
    results[label] = {
        "months": month_keys,
        "demand": demand,
        "unmet": unmet,
        "total_people": round(sum(demand), 1),
        "total_unmet": round(sum(unmet), 1),
        "sites": sites,
        "model_covered": round(sum(s["covered"] for s in sites), 1),
        "baseline_covered": round(sum(s["covered"] for s in base), 1),
        "baseline_blocks": [blocks[s["block"]]["id"] for s in base],
    }
    r = results[label]
    print("\nscenario %-8s (%s) at %dm" % (label, ", ".join(month_keys), int(WALK_M)))
    print("  %.0f people counted, %.0f with no free bed within walking distance"
          % (r["total_people"], r["total_unmet"]))
    print("  model %d sites cover %.0f  |  naive covers %.0f"
          % (len(sites), r["model_covered"], r["baseline_covered"]))

primary = results["latest"]

top_a = [blocks[s["block"]]["id"] for s in results["latest"]["sites"]]
top_b = [blocks[s["block"]]["id"] for s in results["recent3"]["sites"]]
stable = [b for b in top_a if b in top_b]
print("\n%d of %d sites survive both demand scenarios" % (len(stable), len(top_a)))

# --------------------------------------------------------- enrich the sites

demand = primary["demand"]
unmet = primary["unmet"]
near_walk = [[j for j in range(n) if D[i][j] <= WALK_M] for i in range(n)]

cum_cov, cum_cost = 0.0, 0
recommendations = []
for rank, s in enumerate(primary["sites"], 1):
    i = s["block"]
    b = blocks[i]
    cum_cov += s["covered"]
    cost = s["beds"] * COST_PER_BED
    cum_cost += cost
    recommendations.append({
        "rank": rank,
        "block_id": b["id"],
        "area": b["area"],
        "streets": b["streets"],
        "centroid": b["centroid"],
        "beds": s["beds"],
        "people_covered": s["covered"],
        "cumulative_covered": round(cum_cov, 1),
        "pct_of_unmet": round(100.0 * cum_cov / primary["total_unmet"], 1)
        if primary["total_unmet"] else None,
        "annual_cost_usd": cost,
        "cumulative_cost_usd": cum_cost,
        "cost_per_person_usd": round(cost / s["covered"]) if s["covered"] else None,
        "people_on_this_block": round(demand[i], 1),
        "unmet_within_walk": round(sum(unmet[j] for j in near_walk[i]), 1),
        "nearest_shelter_m": round(nearest_shelter_m[i]),
        "trolley_stops_within_walk": count_within(station_pts, i, NEARBY_M),
        "clinics_within_walk": count_within(clinic_pts, i, NEARBY_M),
        "robust": b["id"] in stable,
    })

print("\nrecommended sites:")
for r in recommendations:
    print("  %d. %-24s %-16s %3d beds  covers %5.1f  $%.2fM/yr  %d trolley  %d clinics%s"
          % (r["rank"], r["block_id"], r["area"], r["beds"], r["people_covered"],
             r["annual_cost_usd"] / 1e6, r["trolley_stops_within_walk"],
             r["clinics_within_walk"], "  [robust]" if r["robust"] else ""))

lift = (primary["model_covered"] / primary["baseline_covered"] - 1) * 100 \
    if primary["baseline_covered"] else None

payload = {
    "method": {
        "name": "Maximal Covering Location Problem, solved greedily",
        "reference": "Church & ReVelle (1974)",
        "guarantee": "Coverage is submodular, so greedy lands within "
                     "(1 - 1/e), about 63%, of the optimal solution.",
        "walk_m": WALK_M,
        "walk_rationale": "5-minute walk. Chosen because it discriminates "
                          "between sites; at 800 m every candidate looks alike "
                          "and the model collapses onto the naive answer. See "
                          "sensitivity.",
        "nearby_m": NEARBY_M,
        "max_beds_per_site": MAX_BEDS,
        "min_beds_per_site": MIN_BEDS,
        "min_gap_from_existing_m": MIN_GAP_M,
        "cost_per_bed_year_usd": COST_PER_BED,
        "cost_source": SH["benchmarks"]["source"],
        "demand_months": SCENARIOS["latest"],
        "limits": [
            "Demand is where people were counted sleeping, not necessarily "
            "where they would accept a bed.",
            "Distances are straight-line; the bay and the I-5 are not modelled "
            "as barriers.",
            "Land availability, zoning and community process are not modelled. "
            "These are candidate areas for a siting study, not sites.",
            "Only free beds count as existing supply, so a full shelter next "
            "door does not make a block look served.",
        ],
    },
    "today": {
        "month": SCENARIOS["latest"][0],
        "people_counted": primary["total_people"],
        "existing_beds": SH["totals"]["beds"],
        "existing_free": SH["totals"]["free"],
        "people_without_a_bed": primary["total_unmet"],
        "pct_without_a_bed": round(100.0 * primary["total_unmet"] /
                                   primary["total_people"], 1)
        if primary["total_people"] else None,
    },
    "recommendations": recommendations,
    "totals": {
        "sites": len(recommendations),
        "beds": sum(r["beds"] for r in recommendations),
        "people_covered": round(cum_cov, 1),
        "pct_of_unmet_covered": round(100.0 * cum_cov / primary["total_unmet"], 1)
        if primary["total_unmet"] else None,
        "annual_cost_usd": cum_cost,
        "cost_per_person_usd": round(cum_cost / cum_cov) if cum_cov else None,
    },
    "vs_baseline": {
        "baseline_name": "Put shelters on the blocks with the most people",
        "baseline_covered": primary["baseline_covered"],
        "model_covered": primary["model_covered"],
        "lift_pct": round(lift, 1) if lift is not None else None,
        "extra_people_covered": round(primary["model_covered"] -
                                      primary["baseline_covered"], 1),
        "baseline_blocks": primary["baseline_blocks"],
    },
    "sensitivity": sweep,
    "robustness": {
        "scenario_a": {"months": results["latest"]["months"], "blocks": top_a},
        "scenario_b": {"months": results["recent3"]["months"], "blocks": top_b},
        "stable_blocks": stable,
        "stable_count": len(stable),
    },
}

path = os.path.join(OUT, "plan.json")
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, separators=(",", ":"), allow_nan=False)
print("\n  wrote data/out/plan.json  %.1f KB" % (os.path.getsize(path) / 1024))
