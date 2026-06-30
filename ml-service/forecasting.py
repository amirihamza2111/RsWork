"""
Time-series forecasting for restaurant demand & revenue.

Models (additive Holt-Winters, Holt's linear trend, seasonal-naive, naive-mean)
are selected by *out-of-sample* accuracy using rolling-origin cross-validation
(backtesting), not in-sample fit. Returns the winning model, honest error
metrics (MAE / RMSE / MAPE), a skill score vs. the seasonal-naive baseline, and
prediction intervals derived from backtest residuals.
"""
from __future__ import annotations

import statistics

SEASON_LEN = 7          # weekly seasonality
EVAL_HORIZON = 7        # evaluate one week ahead per fold
MAX_FOLDS = 4           # rolling-origin folds
Z_90 = 1.645            # ~90% prediction interval


# --------------------------------------------------------------------------- #
# Smoothing primitives
# --------------------------------------------------------------------------- #
def _mean(values):
    return sum(values) / len(values) if values else 0.0


def _initial_trend(series, slen):
    return sum((series[i + slen] - series[i]) / slen for i in range(slen)) / slen


def _initial_seasonals(series, slen):
    n_seasons = len(series) // slen
    season_avgs = [_mean(series[slen * j: slen * j + slen]) for j in range(n_seasons)]
    return {
        i: _mean([series[slen * j + i] - season_avgs[j] for j in range(n_seasons)])
        for i in range(slen)
    }


def _holt_winters(series, slen, alpha, beta, gamma, n_preds):
    result = []
    seasonals = _initial_seasonals(series, slen)
    level = series[0]
    trend = _initial_trend(series, slen)
    for i in range(len(series) + n_preds):
        if i == 0:
            result.append(series[0])
            continue
        if i >= len(series):
            m = i - len(series) + 1
            result.append(level + m * trend + seasonals[i % slen])
        else:
            val = series[i]
            last_level = level
            level = alpha * (val - seasonals[i % slen]) + (1 - alpha) * (level + trend)
            trend = beta * (level - last_level) + (1 - beta) * trend
            seasonals[i % slen] = gamma * (val - level) + (1 - gamma) * seasonals[i % slen]
            result.append(level + trend + seasonals[i % slen])
    return result


def _holt_linear(series, alpha, beta, n_preds):
    result = [series[0]]
    level = series[0]
    trend = series[1] - series[0] if len(series) > 1 else 0.0
    for i in range(1, len(series) + n_preds):
        if i >= len(series):
            m = i - len(series) + 1
            result.append(level + m * trend)
        else:
            val = series[i]
            last_level = level
            level = alpha * val + (1 - alpha) * (level + trend)
            trend = beta * (level - last_level) + (1 - beta) * trend
            result.append(level + trend)
    return result


# --------------------------------------------------------------------------- #
# Forecasters: each maps (train, horizon) -> list[float]
# --------------------------------------------------------------------------- #
def _fc_seasonal_naive(train, h):
    if not train:
        return [0.0] * h
    out = []
    for i in range(h):
        idx = len(train) - SEASON_LEN + (i % SEASON_LEN)
        out.append(train[idx] if idx >= 0 else train[-1])
    return out


def _fc_naive_mean(train, h):
    window = train[-min(SEASON_LEN, len(train)):] if train else []
    return [_mean(window)] * h


def _make_holt_linear(alpha, beta):
    return lambda train, h: _holt_linear(train, alpha, beta, h)[-h:]


def _make_holt_winters(alpha, beta, gamma):
    return lambda train, h: _holt_winters(train, SEASON_LEN, alpha, beta, gamma, h)[-h:]


def _candidates(n):
    """Build candidate (name, params, forecaster, min_train) for a series of length n."""
    cands = [
        ("seasonal-naive", {}, _fc_seasonal_naive, SEASON_LEN),
        ("naive-mean", {}, _fc_naive_mean, 1),
    ]
    if n >= 8:
        for alpha in (0.2, 0.5, 0.8):
            for beta in (0.05, 0.2):
                cands.append(
                    ("holt-linear", {"alpha": alpha, "beta": beta},
                     _make_holt_linear(alpha, beta), 4)
                )
    if n >= 2 * SEASON_LEN:
        for alpha in (0.2, 0.4, 0.6, 0.8):
            for beta in (0.05, 0.2):
                for gamma in (0.2, 0.5):
                    cands.append(
                        ("holt-winters-additive",
                         {"alpha": alpha, "beta": beta, "gamma": gamma},
                         _make_holt_winters(alpha, beta, gamma), 2 * SEASON_LEN)
                    )
    return cands


# --------------------------------------------------------------------------- #
# Evaluation
# --------------------------------------------------------------------------- #
def _backtest(series, forecaster, min_train, h_eval=EVAL_HORIZON, max_folds=MAX_FOLDS):
    """Rolling-origin CV with an expanding window. Returns aggregated errors or None."""
    n = len(series)
    abs_errs, sq_errs, apes = [], [], []
    folds = 0
    for k in range(max_folds, 0, -1):
        cut = n - k * h_eval
        if cut < min_train:
            continue
        train, actual = series[:cut], series[cut:cut + h_eval]
        if len(actual) < h_eval:
            continue
        pred = forecaster(train, h_eval)
        for a, p in zip(actual, pred):
            abs_errs.append(abs(a - p))
            sq_errs.append((a - p) ** 2)
            if a > 0:
                apes.append(abs(a - p) / a)
        folds += 1

    if folds == 0:
        return None

    mae = sum(abs_errs) / len(abs_errs)
    rmse = (sum(sq_errs) / len(sq_errs)) ** 0.5
    mape = (sum(apes) / len(apes) * 100) if apes else None
    return {"mae": mae, "rmse": rmse, "mape": mape, "folds": folds}


def _round_metrics(m):
    out = {"folds": m["folds"]}
    out["mae"] = round(m["mae"], 3)
    out["rmse"] = round(m["rmse"], 3)
    out["mape"] = round(m["mape"], 2) if m["mape"] is not None else None
    return out


def evaluate_and_forecast(values, horizon):
    """
    Select the best model by backtest MAE, refit on the full series, and return
    the forecast with prediction intervals and evaluation metrics.
    """
    n = len(values)
    horizon = max(1, int(horizon))

    if n == 0:
        return {
            "model": "empty", "params": {}, "metrics": None, "skillVsNaive": None,
            "forecast": [0.0] * horizon, "lower": [0.0] * horizon, "upper": [0.0] * horizon,
        }

    cands = _candidates(n)
    scored = []
    baseline_mae = None
    for name, params, forecaster, min_train in cands:
        bt = _backtest(values, forecaster, min_train)
        if bt is None:
            continue
        scored.append((name, params, forecaster, bt))
        if name == "seasonal-naive":
            baseline_mae = bt["mae"]

    if scored:
        # Lowest out-of-sample MAE wins (RMSE as tie-break).
        best_name, best_params, best_fc, best_bt = min(
            scored, key=lambda s: (s[3]["mae"], s[3]["rmse"])
        )
        metrics = _round_metrics(best_bt)
        resid = best_bt["rmse"]
        skill = (
            round(1 - best_bt["mae"] / baseline_mae, 3)
            if baseline_mae and baseline_mae > 0 else None
        )
    else:
        # Too little history to backtest — fall back to a sensible default model.
        if n >= 2 * SEASON_LEN:
            best_name, best_params = "holt-winters-additive", {"alpha": 0.5, "beta": 0.1, "gamma": 0.3}
            best_fc = _make_holt_winters(0.5, 0.1, 0.3)
        elif n >= 4:
            best_name, best_params = "holt-linear", {"alpha": 0.5, "beta": 0.1}
            best_fc = _make_holt_linear(0.5, 0.1)
        else:
            best_name, best_params, best_fc = "naive-mean", {}, _fc_naive_mean
        metrics, resid, skill = None, None, None

    preds = [max(0.0, float(p)) for p in best_fc(values, horizon)]
    if resid is not None:
        # A backtest ran (resid may be 0 for a perfect fit -> tight interval).
        lower = [max(0.0, p - Z_90 * resid) for p in preds]
        upper = [p + Z_90 * resid for p in preds]
    else:
        # No backtest was possible (very short history) -> no interval.
        lower = [None] * horizon
        upper = [None] * horizon

    return {
        "model": best_name,
        "params": best_params,
        "metrics": metrics,
        "skillVsNaive": skill,
        "forecast": preds,
        "lower": lower,
        "upper": upper,
    }


# Backwards-compatible thin wrapper.
def forecast_series(values, horizon):
    result = evaluate_and_forecast(values, horizon)
    return result["forecast"], result["model"]
