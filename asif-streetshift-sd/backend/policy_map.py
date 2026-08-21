from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

import pandas as pd

from .config import DATA_DIR, ROOT_DIR


BEFORE_REPORT_MONTH = pd.Timestamp("2023-01-01")
AFTER_REPORT_MONTH = pd.Timestamp("2024-01-01")
BEFORE_COUNT_DATE = pd.Timestamp("2023-01-31")
AFTER_COUNT_DATE = pd.Timestamp("2024-01-25")
PANEL_BLOCKS = 261
TENT_MULTIPLIER = 1.75
VEHICLE_MULTIPLIER = 2.03
FORMULA = "individuals + 1.75 × tents / structures + 2.03 × vehicles"

AUDITOR_REPORT_URL = (
    "https://www.sandiego.gov/sites/default/files/2026-04/"
    "performance-audit-of-the-city-s-response-to-homeless-encampments-"
    "since-the-unsafe-camping-ordinance.pdf"
)
FIRST_SITE_URL = (
    "https://www.sandiego.gov/outreach2-article/"
    "mayor-gloria-announces-opening-first-safe-sleeping-site-san-diegans-experiencing"
)
SECOND_SITE_URL = (
    "https://www.sandiego.gov/mayor/"
    "mayor-gloria-opens-second-safe-sleeping-site-unsheltered-san-diegans"
)
ORDINANCE_URL = (
    "https://www.sandiego.gov/police/services/neighborhood-policing-division/"
    "unsafe-camping"
)
GET_IT_DONE_URL = "https://data.sandiego.gov/datasets/get-it-done-reports/"
GET_IT_DONE_GUIDANCE_URL = (
    "https://data.sandiego.gov/help/articles/tips-getitdone-311-requests/"
)
NIBRS_DATASET_URL = "https://data.sandiego.gov/datasets/police-nibrs/"
NIBRS_2023_URL = "https://seshat.datasd.org/police_nibrs/pd_nibrs_2023_datasd.csv"
NIBRS_2024_URL = "https://seshat.datasd.org/police_nibrs/pd_nibrs_2024_datasd.csv"

COMPONENTS = (
    ("individuals", "individuals", "Individuals"),
    ("tents_structures", "tentsStructures", "Tents / structures"),
    ("vehicles", "vehicles", "Vehicles"),
)


def _number(value: float | int, digits: int = 2) -> float | int:
    """Return JSON-friendly numbers while retaining meaningful decimals."""
    rounded = round(float(value), digits)
    return int(rounded) if rounded.is_integer() else rounded


def _percent_change(before: float, delta: float, digits: int = 2) -> float | None:
    if before == 0:
        return None
    return round(delta / before * 100, digits)


def _direction(delta: float) -> str:
    if delta < 0:
        return "down"
    if delta > 0:
        return "up"
    return "unchanged"


def _validate_period(
    period: pd.DataFrame,
    report_month: pd.Timestamp,
    expected_count_date: pd.Timestamp,
) -> None:
    if len(period) != PANEL_BLOCKS or period["block_id"].nunique() != PANEL_BLOCKS:
        raise ValueError(
            f"{report_month:%Y-%m} must contain {PANEL_BLOCKS} unique panel blocks"
        )
    count_dates = set(period["count_date"].dropna().unique())
    if count_dates != {expected_count_date}:
        formatted = sorted(pd.Timestamp(date).strftime("%Y-%m-%d") for date in count_dates)
        raise ValueError(
            f"{report_month:%Y-%m} should use organizer count date "
            f"{expected_count_date:%Y-%m-%d}; found {formatted}"
        )


def _safe_sleeping_sites() -> list[dict[str, Any]]:
    return [
        {
            "id": "safe-sleeping-20th-b",
            "name": "20th & B Safe Sleeping Site",
            "latitude": 32.71829182,
            "longitude": -117.14614399,
            "address": "2145 Caminito Centro, San Diego, CA 92102",
            "facilityAddress": "1970 B Street, San Diego, CA 92102",
            "openedDate": "2023-06-30",
            "openingLabel": "Began accepting clients June 29–30, 2023",
            "openedDateNote": (
                "City materials place initial client arrivals across June 29–30, 2023; "
                "June 30 is used on this timeline."
            ),
            "tentSpaces": 136,
            "peoplePerTentMax": 2,
            "capacityLabel": "136 tent spaces · up to 2 people per tent",
            "insideCountPanel": False,
            "outsidePanel": True,
            "distanceToPanelMeters": 254,
            "coordinateNote": (
                "Official City address point; it does not claim to be the precise tent-area centroid."
            ),
            "sourceLabel": "City of San Diego — first Safe Sleeping site announcement",
            "sourceUrl": FIRST_SITE_URL,
            "addressSourceUrl": (
                "https://docs.sandiego.gov/council_reso_ordinance/rao2024/R-315452.pdf"
            ),
        },
        {
            "id": "safe-sleeping-o-lot",
            "name": "O Lot Safe Sleeping Site",
            "latitude": 32.72217185,
            "longitude": -117.14757720,
            "address": "1800 Welch Road, San Diego, CA 92101",
            "facilityAddress": None,
            "openedDate": "2023-10-21",
            "openingLabel": "Began client intakes October 21, 2023",
            "openedDateNote": "The City announced that client intakes would begin October 21, 2023.",
            "tentSpaces": 400,
            "peoplePerTentMax": 2,
            "capacityLabel": "Up to 400 tents at launch · up to 2 people per tent",
            "insideCountPanel": False,
            "outsidePanel": True,
            "distanceToPanelMeters": 595,
            "coordinateNote": (
                "Official City address point; it does not claim to be the precise tent-area centroid."
            ),
            "sourceLabel": "City of San Diego — second Safe Sleeping site announcement",
            "sourceUrl": SECOND_SITE_URL,
            "addressSourceUrl": (
                "https://docs.sandiego.gov/council_reso_ordinance/rao2024/R-315812.pdf"
            ),
        },
    ]


def _ordinance_offense_layer() -> dict[str, Any]:
    """Return a privacy-reduced snapshot of public NIBRS ordinance records."""
    with (ROOT_DIR / "data" / "derived" / "ordinance_offense_clusters.json").open(
        encoding="utf-8"
    ) as source:
        snapshot = json.load(source)
    return {
        "available": True,
        "label": "Police-recorded ordinance offenses",
        "description": (
            "SDPD NIBRS case records whose code_section begins 63.0404. Markers are "
            "rounded, clustered locations within 500 meters of the study area."
        ),
        **snapshot,
        "caveat": (
            "These are not raid, citation, arrest, outreach, or encampment-removal "
            "locations. They are offenses recorded in police case reports; one record "
            "does not necessarily represent one person, and encounters without a NIBRS "
            "offense are absent."
        ),
        "sourceLabel": "City of San Diego — Police NIBRS Crime Offenses",
        "sourceUrl": NIBRS_DATASET_URL,
        "sourceFiles": [NIBRS_2023_URL, NIBRS_2024_URL],
    }


def build_policy_map_payload(
    panel: pd.DataFrame | None = None,
    grid: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the focused, evidence-bounded policy-period map contract.

    The endpoint compares the same 261 organizer-defined blocks on two count
    nights. It describes changes in observations; it does not track people or
    estimate that any policy caused those changes.
    """
    data = (
        pd.read_csv(
            DATA_DIR / "BlockLevel_Counts_Panel261.csv",
            parse_dates=["report_month", "count_date"],
        )
        if panel is None
        else panel.copy()
    )
    for column in ("report_month", "count_date"):
        data[column] = pd.to_datetime(data[column], errors="raise")
    for column in ("individuals", "tents_structures", "vehicles"):
        data[column] = pd.to_numeric(data[column], errors="raise")
    data["adjusted"] = (
        data["individuals"]
        + TENT_MULTIPLIER * data["tents_structures"]
        + VEHICLE_MULTIPLIER * data["vehicles"]
    )

    before = data[data["report_month"].eq(BEFORE_REPORT_MONTH)].copy()
    after = data[data["report_month"].eq(AFTER_REPORT_MONTH)].copy()
    _validate_period(before, BEFORE_REPORT_MONTH, BEFORE_COUNT_DATE)
    _validate_period(after, AFTER_REPORT_MONTH, AFTER_COUNT_DATE)

    raw_columns = [
        "block_id",
        "area",
        "individuals",
        "tents_structures",
        "vehicles",
        "adjusted",
    ]
    joined = before[raw_columns].merge(
        after[raw_columns],
        on="block_id",
        suffixes=("_before", "_after"),
        how="inner",
        validate="one_to_one",
    )
    if len(joined) != PANEL_BLOCKS:
        raise ValueError(
            f"Balanced panel should contain {PANEL_BLOCKS} joined blocks; found {len(joined)}"
        )
    if not joined["area_before"].eq(joined["area_after"]).all():
        raise ValueError("A balanced-panel block changed area labels between count dates")

    if grid is None:
        with (DATA_DIR / "Downtown_BlockGrid.geojson").open(encoding="utf-8") as source:
            grid = json.load(source)
    geometries = {
        feature["properties"]["block_id"]: feature["geometry"]
        for feature in grid["features"]
    }
    missing_geometry = set(joined["block_id"]) - set(geometries)
    if missing_geometry:
        raise ValueError(
            f"Block grid is missing {len(missing_geometry)} balanced-panel geometries"
        )

    features: list[dict[str, Any]] = []
    for row in joined.sort_values("block_id").itertuples(index=False):
        before_values = {
            "individuals": _number(row.individuals_before, 0),
            "tentsStructures": _number(row.tents_structures_before, 0),
            "vehicles": _number(row.vehicles_before, 0),
            "adjusted": _number(row.adjusted_before, 2),
        }
        after_values = {
            "individuals": _number(row.individuals_after, 0),
            "tentsStructures": _number(row.tents_structures_after, 0),
            "vehicles": _number(row.vehicles_after, 0),
            "adjusted": _number(row.adjusted_after, 2),
        }
        delta_values = {
            key: _number(float(after_values[key]) - float(before_values[key]), 2)
            for key in before_values
        }
        direction = {key: _direction(float(value)) for key, value in delta_values.items()}
        features.append(
            {
                "type": "Feature",
                "geometry": geometries[row.block_id],
                "properties": {
                    "blockId": row.block_id,
                    "area": row.area_before,
                    "before": before_values,
                    "after": after_values,
                    "delta": delta_values,
                    "direction": direction,
                },
            }
        )

    before_total = float(before["adjusted"].sum())
    after_total = float(after["adjusted"].sum())
    total_delta = after_total - before_total

    component_changes = []
    for source_column, component, label in COMPONENTS:
        component_before = float(before[source_column].sum())
        component_after = float(after[source_column].sum())
        component_delta = component_after - component_before
        component_changes.append(
            {
                "component": component,
                "label": label,
                "before": _number(component_before, 0),
                "after": _number(component_after, 0),
                "delta": _number(component_delta, 0),
                "percentChange": _percent_change(component_before, component_delta, 1),
                "direction": _direction(component_delta),
            }
        )

    area_changes = []
    for area, rows in joined.groupby("area_before"):
        area_before = float(rows["adjusted_before"].sum())
        area_after = float(rows["adjusted_after"].sum())
        area_delta = area_after - area_before
        area_changes.append(
            {
                "area": area,
                "blocks": int(len(rows)),
                "before": _number(area_before, 2),
                "after": _number(area_after, 2),
                "delta": _number(area_delta, 2),
                "percentChange": _percent_change(area_before, area_delta),
                "direction": _direction(area_delta),
            }
        )
    area_changes.sort(key=lambda item: float(item["delta"]))

    events = [
        {
            "id": "before-count",
            "kind": "observation",
            "date": "2023-01-31",
            "title": "Before count",
            "description": "Organizer-labeled overnight count across the fixed 261-block panel.",
            "sourceLabel": "Building for Good organizer dataset",
            "sourceUrl": (
                "https://github.com/sandiegodata-projects/downtown-partnership"
            ),
        },
        {
            "id": "safe-sleeping-20th-b",
            "kind": "site",
            "date": "2023-06-30",
            "title": "20th & B Safe Sleeping site opened",
            "description": "First City Safe Sleeping site began serving clients.",
            "sourceLabel": "City of San Diego — opening announcement",
            "sourceUrl": FIRST_SITE_URL,
        },
        {
            "id": "unsafe-camping-enforcement",
            "kind": "policy",
            "date": "2023-07-31",
            "title": "Unsafe Camping Ordinance enforcement began",
            "description": (
                "The City began its progressive enforcement approach after outreach "
                "and education."
            ),
            "sourceLabel": "City of San Diego — Unsafe Camping Ordinance",
            "sourceUrl": ORDINANCE_URL,
        },
        {
            "id": "safe-sleeping-o-lot",
            "kind": "site",
            "date": "2023-10-21",
            "title": "O Lot Safe Sleeping site began intakes",
            "description": "The second City Safe Sleeping site began client intakes.",
            "sourceLabel": "City of San Diego — opening announcement",
            "sourceUrl": SECOND_SITE_URL,
        },
        {
            "id": "after-count",
            "kind": "observation",
            "date": "2024-01-25",
            "title": "After count",
            "description": "Organizer-labeled overnight count across the same 261 blocks.",
            "sourceLabel": "Building for Good organizer dataset",
            "sourceUrl": (
                "https://github.com/sandiegodata-projects/downtown-partnership"
            ),
        },
    ]

    return {
        "title": "Where did downtown street observations change after the 2023 policy rollout?",
        "design": "descriptive_before_after_balanced_panel",
        "comparison": {
            "before": {
                "reportMonth": "2023-01-01",
                "countDate": "2023-01-31",
                "label": "Overnight count conducted January 31, 2023",
            },
            "after": {
                "reportMonth": "2024-01-01",
                "countDate": "2024-01-25",
                "label": "Overnight count conducted January 25, 2024",
            },
            "monthsApart": 12,
            "daysApart": int((AFTER_COUNT_DATE - BEFORE_COUNT_DATE).days),
            "panelBlocks": PANEL_BLOCKS,
            "formula": FORMULA,
            "unit": "adjusted observed count",
            "interpretation": (
                "Every color is the January 25, 2024 observation minus the "
                "January 31, 2023 observation for the same block."
            ),
        },
        "summary": {
            "before": _number(before_total, 2),
            "after": _number(after_total, 2),
            "delta": _number(total_delta, 2),
            "percentChange": _percent_change(before_total, total_delta),
            "blocksDown": sum(
                feature["properties"]["direction"]["adjusted"] == "down"
                for feature in features
            ),
            "blocksUp": sum(
                feature["properties"]["direction"]["adjusted"] == "up"
                for feature in features
            ),
            "blocksUnchanged": sum(
                feature["properties"]["direction"]["adjusted"] == "unchanged"
                for feature in features
            ),
        },
        "componentChanges": component_changes,
        "componentInterpretation": (
            "The adjusted observation fell because recorded tents / structures and "
            "vehicles declined, while directly recorded individuals rose from 425 to "
            "510. The map can separate these components instead of presenting the "
            "weighted total as a literal population count."
        ),
        "areaChanges": area_changes,
        "timeline": events,
        "safeSleepingSites": _safe_sleeping_sites(),
        "ordinanceOffenseLayer": _ordinance_offense_layer(),
        "enforcementLayer": {
            "available": False,
            "label": "Event-level enforcement locations are not publicly available",
            "title": "Cleanup and abatement locations are not publicly available",
            "explanation": (
                "The official public Get It Done data contains geolocated resident "
                "reports, not verified enforcement contacts, citations, arrests, raids, "
                "or abatements. Plotting those reports as enforcement would mislabel the "
                "evidence, so this layer is intentionally disabled."
            ),
            "alternativeLabel": (
                "Resident reports are a separate proxy and are not plotted as enforcement."
            ),
            "publicProxy": {
                "name": "Get It Done encampment reports",
                "appropriateLabel": "Resident-reported encampment locations",
                "notEquivalentTo": "Enforcement or abatement locations",
                "datasetUrl": GET_IT_DONE_URL,
                "guidanceUrl": GET_IT_DONE_GUIDANCE_URL,
            },
            "sourceLabel": "City Auditor — Performance Audit (April 2026)",
            "sourceUrl": AUDITOR_REPORT_URL,
        },
        "auditorFindings": [
            {
                "id": "movement-not-identifiable",
                "metric": "Movement unknown",
                "title": "The City could not determine where people moved",
                "detail": (
                    "The City Auditor was unable to determine the specific geographic "
                    "movement of the homeless population. Block changes show where "
                    "observations differed, not where any individual person went."
                ),
                "sourceLabel": "City Auditor — Performance Audit (April 2026)",
                "sourceUrl": AUDITOR_REPORT_URL,
            },
            {
                "id": "downtown-reports-increased",
                "metric": "+45%",
                "title": "Downtown encampment reports increased",
                "detail": (
                    "Downtown received 6,938 more Get It Done encampment reports in the "
                    "two years after the ordinance than in the two years before it, a 45% "
                    "increase. Fewer weighted observations therefore do not establish "
                    "fewer resident-reported encampment concerns."
                ),
                "sourceLabel": "City Auditor — Performance Audit (April 2026)",
                "sourceUrl": AUDITOR_REPORT_URL,
            },
        ],
        "geojson": {"type": "FeatureCollection", "features": features},
        "caveat": (
            "This is a descriptive comparison of two single-night observations, not a "
            "causal estimate or a population-movement tracker. The Safe Sleeping sites "
            "and ordinance implementation overlap in time, there is no untreated control "
            "group, and other conditions may explain some or all of the change. Both site "
            "markers are outside the fixed downtown count panel."
        ),
        "sources": [
            {
                "id": "organizer",
                "label": "Organizer block-count repository",
                "url": "https://github.com/sandiegodata-projects/downtown-partnership",
            },
            {"id": "first-site", "label": "City — first Safe Sleeping site", "url": FIRST_SITE_URL},
            {"id": "second-site", "label": "City — second Safe Sleeping site", "url": SECOND_SITE_URL},
            {"id": "ordinance", "label": "City — Unsafe Camping Ordinance", "url": ORDINANCE_URL},
            {"id": "audit", "label": "City Auditor — 2026 performance audit", "url": AUDITOR_REPORT_URL},
            {"id": "get-it-done", "label": "City Open Data — Get It Done reports", "url": GET_IT_DONE_URL},
            {"id": "nibrs", "label": "City Open Data — Police NIBRS offenses", "url": NIBRS_DATASET_URL},
        ],
    }


@lru_cache(maxsize=1)
def policy_map_payload() -> dict[str, Any]:
    return build_policy_map_payload()
