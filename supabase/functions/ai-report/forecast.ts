export interface DailyPoint {
  date: string;
  orders: number;
  revenue: number;
}

export interface ForecastPoint {
  date: string;
  orders: number;
  ordersLower: number;
  ordersUpper: number;
  revenue: number;
  revenueLower: number;
  revenueUpper: number;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Built-in fallback: average each metric by weekday and project it forward,
// with a ~90% interval from the weekday standard deviation.
export function seasonalNaiveForecast(history: DailyPoint[], horizon: number): ForecastPoint[] {
  const Z = 1.645;
  const byDow: Record<number, { orders: number[]; revenue: number[] }> = {};
  for (const point of history) {
    const dow = new Date(`${point.date}T00:00:00Z`).getUTCDay();
    byDow[dow] ??= { orders: [], revenue: [] };
    byDow[dow].orders.push(point.orders);
    byDow[dow].revenue.push(point.revenue);
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const std = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
  };

  const last = history.length ? new Date(`${history[history.length - 1].date}T00:00:00Z`) : new Date();
  const out: ForecastPoint[] = [];
  for (let i = 1; i <= horizon; i += 1) {
    const d = new Date(last.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const bucket = byDow[d.getUTCDay()] ?? { orders: [], revenue: [] };
    const oMean = avg(bucket.orders);
    const rMean = avg(bucket.revenue);
    const oStd = std(bucket.orders);
    const rStd = std(bucket.revenue);
    out.push({
      date: ymd(d),
      orders: Math.max(0, Math.round(oMean)),
      ordersLower: Math.max(0, Math.round(oMean - Z * oStd)),
      ordersUpper: Math.max(0, Math.round(oMean + Z * oStd)),
      revenue: Math.max(0, Number(rMean.toFixed(2))),
      revenueLower: Math.max(0, Number((rMean - Z * rStd).toFixed(2))),
      revenueUpper: Math.max(0, Number((rMean + Z * rStd).toFixed(2))),
    });
  }
  return out;
}

// Forecast from the Python ML service when reachable, else the fallback.
export async function getForecast(history: DailyPoint[], horizon = 7, mlUrl?: string, timeoutMs = 4000) {
  const base = { horizon, historyPoints: history.length, history };
  if (mlUrl) {
    try {
      const resp = await fetch(`${mlUrl.replace(/\/+$/, '')}/forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series: history, horizon }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) throw new Error(`ML service responded ${resp.status}`);
      const result = await resp.json();
      return { ...base, source: 'ml', model: result.model, evaluation: result.evaluation ?? null, forecast: result.forecast };
    } catch (err) {
      return fallback(base, history, horizon, (err as Error).message);
    }
  }
  return fallback(base, history, horizon, 'ML service not configured');
}

const fallback = (base: object, history: DailyPoint[], horizon: number, reason: string) => ({
  ...base,
  source: 'fallback',
  model: { orders: 'seasonal-naive', revenue: 'seasonal-naive' },
  evaluation: null,
  reason,
  forecast: seasonalNaiveForecast(history, horizon),
});
