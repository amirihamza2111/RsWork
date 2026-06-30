"""
Forecast microservice for Layali Carthage.

Stateless: the Node backend posts the daily history (orders + revenue) and gets
back a forecast with prediction intervals and out-of-sample accuracy metrics.
"""
from datetime import date, timedelta
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

from forecasting import evaluate_and_forecast

app = FastAPI(title="Layali Carthage — Forecast Service", version="2.0.0")


class Point(BaseModel):
    date: str
    orders: float = 0.0
    revenue: float = 0.0


class ForecastRequest(BaseModel):
    series: List[Point]
    horizon: int = 7


def _interval(value):
    return None if value is None else round(value, 2)


@app.get("/health")
def health():
    return {"status": "ok", "service": "forecast"}


@app.post("/forecast")
def forecast(req: ForecastRequest):
    horizon = max(1, min(int(req.horizon), 31))
    points = sorted(req.series, key=lambda p: p.date)

    orders = evaluate_and_forecast([p.orders for p in points], horizon)
    revenue = evaluate_and_forecast([p.revenue for p in points], horizon)

    last_date = date.fromisoformat(points[-1].date) if points else date.today()

    out = []
    for i in range(horizon):
        d = last_date + timedelta(days=i + 1)
        out.append(
            {
                "date": d.isoformat(),
                "orders": int(round(orders["forecast"][i])),
                "ordersLower": None if orders["lower"][i] is None else int(round(orders["lower"][i])),
                "ordersUpper": None if orders["upper"][i] is None else int(round(orders["upper"][i])),
                "revenue": round(revenue["forecast"][i], 2),
                "revenueLower": _interval(revenue["lower"][i]),
                "revenueUpper": _interval(revenue["upper"][i]),
            }
        )

    return {
        "model": {"orders": orders["model"], "revenue": revenue["model"]},
        "evaluation": {
            "orders": {
                "model": orders["model"],
                "params": orders["params"],
                "metrics": orders["metrics"],
                "skillVsNaive": orders["skillVsNaive"],
            },
            "revenue": {
                "model": revenue["model"],
                "params": revenue["params"],
                "metrics": revenue["metrics"],
                "skillVsNaive": revenue["skillVsNaive"],
            },
        },
        "horizon": horizon,
        "historyPoints": len(points),
        "forecast": out,
    }
