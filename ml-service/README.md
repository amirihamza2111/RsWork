# Forecast Service

A small, stateless FastAPI microservice that forecasts daily **orders** and
**revenue** using Holt-Winters triple exponential smoothing (additive trend +
weekly seasonality), with automatic fallbacks for short histories.

The Node backend (`/api/reports/forecast`) calls this service. If it is
unreachable, the backend falls back to a built-in seasonal-naive forecast, so
the API never breaks.

## Run locally

```bash
cd ml-service
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --port 8000 --reload
```

Point the backend at it with `ML_SERVICE_URL=http://localhost:8000` (this is the
default).

## API

`GET /health` → `{ "status": "ok" }`

`POST /forecast`
```json
{
  "series": [{ "date": "2026-04-01", "orders": 12, "revenue": 340.5 }],
  "horizon": 7
}
```
Response:
```json
{
  "model": { "orders": "holt-winters-additive", "revenue": "holt-winters-additive" },
  "horizon": 7,
  "historyPoints": 90,
  "forecast": [{ "date": "2026-06-27", "orders": 14, "revenue": 372.4 }]
}
```

## Model

- **≥ 14 days** of history → Holt-Winters additive (weekly seasonality), with a
  small grid search over the smoothing parameters (α, β, γ) minimising in-sample SSE.
- **4–13 days** → Holt's linear trend (double exponential smoothing).
- **1–3 days** → naive mean of the most recent points.
