// AI business-intelligence report: analytics (SQL, run as the caller so the
// manager check applies) + 7-day forecast (ML service or fallback) + narrative.
//
// POST { restaurantId, startDate?, endDate? } -> { analytics, narrative, modelLabel }
import { HttpError, json, readJson, serve } from '../_shared/http.ts';
import { asUser, requireCaller } from '../_shared/supabase.ts';
import { getForecast } from './forecast.ts';
import { generateNarrative, modelLabel } from './narrative.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const optionalDate = (value: unknown) => (typeof value === 'string' && DATE_RE.test(value) ? value : null);

serve(async (req) => {
  const caller = await requireCaller(req);
  const body = await readJson(req);

  const { data: analytics, error } = await asUser(caller.token).rpc('report_ai_analytics', {
    p_restaurant: body.restaurantId,
    p_start: optionalDate(body.startDate),
    p_end: optionalDate(body.endDate),
  });
  if (error) {
    const status = /^PT\d{3}$/.test(error.code ?? '') ? Number(error.code.slice(2)) : 400;
    throw new HttpError(status, error.message);
  }

  const { history, ...rest } = analytics;
  const forecast = await getForecast(
    history ?? [],
    7,
    Deno.env.get('ML_SERVICE_URL'),
    Number(Deno.env.get('ML_TIMEOUT_MS')) || 4000,
  );
  const report = { ...rest, forecast };
  const narrative = await generateNarrative(report);
  return json({ analytics: report, narrative, modelLabel });
});
