"""API tests for the forecast service:  pip install pytest httpx && pytest -q"""
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app import app

client = TestClient(app)

# Busier weekends, like a restaurant: index 0 = Monday.
WEEKLY = [20, 22, 24, 26, 40, 48, 36]


def series(days, start=date(2026, 7, 6)):  # 2026-07-06 is a Monday
    return [
        {
            "date": (start + timedelta(days=i)).isoformat(),
            "orders": WEEKLY[i % 7] + (i % 3),
            "revenue": (WEEKLY[i % 7] + (i % 3)) * 30.0,
        }
        for i in range(days)
    ]


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_weekly_history_uses_holt_winters_and_keeps_the_pattern():
    history = series(90)
    body = client.post("/forecast", json={"series": history, "horizon": 7}).json()

    assert body["model"]["orders"] == "holt-winters-additive"
    assert body["historyPoints"] == 90
    assert len(body["forecast"]) == 7

    last = date.fromisoformat(history[-1]["date"])
    assert [p["date"] for p in body["forecast"]] == [(last + timedelta(days=i + 1)).isoformat() for i in range(7)]

    by_weekday = {date.fromisoformat(p["date"]).weekday(): p["orders"] for p in body["forecast"]}
    assert by_weekday[5] > by_weekday[0], "Saturday should forecast more orders than Monday"

    for p in body["forecast"]:
        assert p["orders"] >= 0 and p["revenue"] >= 0
        assert p["ordersLower"] <= p["orders"] <= p["ordersUpper"]
        assert p["revenueLower"] <= p["revenue"] <= p["revenueUpper"]

    metrics = body["evaluation"]["orders"]["metrics"]
    assert metrics["folds"] >= 1 and metrics["mae"] >= 0


def test_short_history_falls_back_without_intervals():
    body = client.post("/forecast", json={"series": series(3), "horizon": 3}).json()
    assert body["model"]["orders"] == "naive-mean"
    assert all(p["ordersLower"] is None and p["ordersUpper"] is None for p in body["forecast"])


def test_empty_history_returns_zeros():
    res = client.post("/forecast", json={"series": [], "horizon": 2})
    assert res.status_code == 200
    assert [p["orders"] for p in res.json()["forecast"]] == [0, 0]


def test_horizon_is_clamped():
    body = client.post("/forecast", json={"series": series(30), "horizon": 400}).json()
    assert body["horizon"] == 31 and len(body["forecast"]) == 31


def test_unsorted_input_is_sorted_by_date():
    history = series(21)
    shuffled = history[::2] + history[1::2]
    a = client.post("/forecast", json={"series": history, "horizon": 7}).json()
    b = client.post("/forecast", json={"series": shuffled, "horizon": 7}).json()
    assert a["forecast"] == b["forecast"]


def test_invalid_payload_is_rejected():
    assert client.post("/forecast", json={"series": "not a list"}).status_code == 422
