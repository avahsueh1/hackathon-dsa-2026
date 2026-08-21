import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.config import DATA_DIR
from backend.policy_map import build_policy_map_payload, policy_map_payload


def test_policy_map_uses_exact_count_nights_and_balanced_panel():
    payload = policy_map_payload()

    assert payload["comparison"] == {
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
        "daysApart": 359,
        "panelBlocks": 261,
        "formula": "individuals + 1.75 × tents / structures + 2.03 × vehicles",
        "unit": "adjusted observed count",
        "interpretation": (
            "Every color is the January 25, 2024 observation minus the "
            "January 31, 2023 observation for the same block."
        ),
    }
    assert payload["summary"] == {
        "before": 1314.49,
        "after": 981.8,
        "delta": -332.69,
        "percentChange": -25.31,
        "blocksDown": 93,
        "blocksUp": 78,
        "blocksUnchanged": 90,
    }
    assert len(payload["geojson"]["features"]) == 261


def test_every_feature_has_raw_components_for_both_nights_and_delta():
    payload = policy_map_payload()
    expected_keys = {"individuals", "tentsStructures", "vehicles", "adjusted"}

    for feature in payload["geojson"]["features"]:
        properties = feature["properties"]
        assert set(properties["before"]) == expected_keys
        assert set(properties["after"]) == expected_keys
        assert set(properties["delta"]) == expected_keys
        assert set(properties["direction"]) == expected_keys
        for key in expected_keys:
            assert properties["delta"][key] == pytest.approx(
                properties["after"][key] - properties["before"][key]
            )
            expected_direction = (
                "down"
                if properties["delta"][key] < 0
                else "up"
                if properties["delta"][key] > 0
                else "unchanged"
            )
            assert properties["direction"][key] == expected_direction

    assert sum(
        feature["properties"]["before"]["adjusted"]
        for feature in payload["geojson"]["features"]
    ) == pytest.approx(payload["summary"]["before"])
    assert sum(
        feature["properties"]["after"]["adjusted"]
        for feature in payload["geojson"]["features"]
    ) == pytest.approx(payload["summary"]["after"])


def test_component_and_area_changes_explain_the_weighted_change():
    payload = policy_map_payload()

    assert payload["componentChanges"] == [
        {
            "component": "individuals",
            "label": "Individuals",
            "before": 425,
            "after": 510,
            "delta": 85,
            "percentChange": 20.0,
            "direction": "up",
        },
        {
            "component": "tentsStructures",
            "label": "Tents / structures",
            "before": 470,
            "after": 258,
            "delta": -212,
            "percentChange": -45.1,
            "direction": "down",
        },
        {
            "component": "vehicles",
            "label": "Vehicles",
            "before": 33,
            "after": 10,
            "delta": -23,
            "percentChange": -69.7,
            "direction": "down",
        },
    ]
    assert len(payload["areaChanges"]) == 6
    assert sum(area["blocks"] for area in payload["areaChanges"]) == 261
    assert sum(float(area["delta"]) for area in payload["areaChanges"]) == pytest.approx(
        payload["summary"]["delta"]
    )


def test_safe_sites_and_evidence_boundaries_are_explicit():
    payload = policy_map_payload()
    sites = {site["id"]: site for site in payload["safeSleepingSites"]}

    first_site = sites["safe-sleeping-20th-b"]
    assert first_site["latitude"] == 32.71829182
    assert first_site["longitude"] == -117.14614399
    assert first_site["tentSpaces"] == 136
    assert first_site["peoplePerTentMax"] == 2
    assert first_site["insideCountPanel"] is False

    second_site = sites["safe-sleeping-o-lot"]
    assert second_site["latitude"] == 32.72217185
    assert second_site["longitude"] == -117.14757720
    assert second_site["tentSpaces"] == 400
    assert second_site["peoplePerTentMax"] == 2
    assert second_site["insideCountPanel"] is False
    assert payload["enforcementLayer"]["available"] is False
    assert "not verified enforcement" in payload["enforcementLayer"]["explanation"]
    assert payload["enforcementLayer"]["publicProxy"]["appropriateLabel"] == (
        "Resident-reported encampment locations"
    )
    assert payload["auditorFindings"][0]["metric"] == "Movement unknown"
    assert payload["auditorFindings"][1]["metric"] == "+45%"
    assert "6,938" in payload["auditorFindings"][1]["detail"]
    assert len(payload["timeline"]) == 5

    ordinance = payload["ordinanceOffenseLayer"]
    assert ordinance["available"] is True
    assert ordinance["citywideRecordCount"] == 29
    assert ordinance["within500mOfPanelCount"] == 7
    assert ordinance["nearbyClusterCount"] == 6
    assert sum(cluster["recordCount"] for cluster in ordinance["clusters"]) == 7
    assert "not raid" in ordinance["caveat"]


def test_policy_map_rejects_a_mislabeled_count_date():
    panel = pd.read_csv(
        DATA_DIR / "BlockLevel_Counts_Panel261.csv",
        parse_dates=["report_month", "count_date"],
    )
    panel.loc[panel["report_month"].eq("2023-01-01"), "count_date"] = "2023-01-30"

    with pytest.raises(ValueError, match="organizer count date 2023-01-31"):
        build_policy_map_payload(panel=panel)


def test_policy_map_endpoint_exposes_focused_contract():
    response = TestClient(app).get("/api/policy-map")

    assert response.status_code == 200
    body = response.json()
    assert {
        "comparison",
        "summary",
        "componentChanges",
        "areaChanges",
        "timeline",
        "safeSleepingSites",
        "ordinanceOffenseLayer",
        "enforcementLayer",
        "auditorFindings",
        "geojson",
        "caveat",
    } <= body.keys()
