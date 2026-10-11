// Provider-agnostic narrative for the BI report (Groq or Gemini), with a
// deterministic template fallback so the report never fails because of the AI.

// deno-lint-ignore no-explicit-any
type Analytics = any;

// Providers retire models regularly; set the AI_MODEL secret to switch without
// a code change. These are only the fallbacks.
const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-3.5-flash-lite',
  groq: 'openai/gpt-oss-120b',
};

const provider = (Deno.env.get('AI_PROVIDER') ?? 'groq').toLowerCase();
const model = Deno.env.get('AI_MODEL') || DEFAULT_MODELS[provider] || DEFAULT_MODELS.groq;
const apiKey = provider === 'gemini' ? Deno.env.get('GEMINI_API_KEY') : Deno.env.get('GROQ_API_KEY');
const timeoutMs = Number(Deno.env.get('AI_TIMEOUT_MS')) || 20000;

export const modelLabel = `${provider}:${model}`;

const money = (value: number, currency: string) => `${Number(value || 0).toFixed(2)} ${currency}`;
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

// Compact, factual brief handed to the model — only real numbers, no prose.
function buildFacts(a: Analytics) {
  const c = a.restaurant.currency;
  const quietest = [...(a.peakDays ?? [])].sort((x, y) => x.orders - y.orders)[0];
  return {
    restaurant: a.restaurant.name,
    period: `${a.period.start} to ${a.period.end} (${a.period.days} days)`,
    totals: {
      orders: a.totals.orders,
      revenue: money(a.totals.revenue, c),
      averageOrderValue: money(a.totals.avgOrderValue, c),
      cancelledOrders: a.totals.cancelled,
    },
    vsPreviousPeriod: {
      ordersGrowthPct: a.comparison.ordersGrowthPct,
      revenueGrowthPct: a.comparison.revenueGrowthPct,
    },
    topItems: a.topItems.map((i: Analytics) => `${i.name}: ${i.quantity} sold, ${money(i.revenue, c)}`),
    peakHours: a.peakHours.map((h: Analytics) => `${hourLabel(h.hour)} (${h.orders} orders)`),
    busiestDay: a.busiestDay ? `${a.busiestDay.label} (${a.busiestDay.orders} orders)` : 'n/a',
    quietestDay: quietest ? `${quietest.label} (${quietest.orders} orders)` : 'n/a',
    forecastNext7Days: a.forecast?.forecast
      ? a.forecast.forecast.map((d: Analytics) => `${d.date}: ~${d.orders} orders, ~${money(d.revenue, c)}`)
      : 'unavailable',
    forecastModel: a.forecast?.model?.orders ?? 'n/a',
  };
}

const SYSTEM =
  'You are a restaurant business-intelligence analyst. Write a concise, professional report for the restaurant owner. Use ONLY the numbers provided — never invent figures. Be specific and actionable. Keep each section tight.';

const buildPrompt = (facts: unknown) => `Here is the restaurant's performance data (JSON):

${JSON.stringify(facts, null, 2)}

Write the report as a JSON object with exactly these string fields:
- "executiveSummary": 2-3 sentences summarizing overall performance and the trend vs the previous period.
- "salesAnalysis": one paragraph on orders, revenue, average order value, and the best-selling items.
- "peakAnalysis": one paragraph on the busiest hours and days, and the quietest day.
- "forecastOutlook": one paragraph interpreting the 7-day forecast (mention it is model-based).
- "recommendations": an array of 3-5 short, concrete action items grounded in the data.

Return ONLY the JSON object.`;

async function generateJson(prompt: string): Promise<Record<string, unknown>> {
  let text: string;
  if (provider === 'gemini') {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey! },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4096, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!resp.ok) throw new Error(`Gemini API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    text = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  } else {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        // Reasoning models spend part of the budget thinking before they answer.
        max_tokens: 4096,
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) throw new Error(`Groq API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    text = data.choices?.[0]?.message?.content ?? '';
  }

  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AI response was not valid JSON');
  }
}

export function templateNarrative(a: Analytics) {
  const c = a.restaurant.currency;
  const growth = a.comparison.revenueGrowthPct;
  const revTrend = growth >= 0 ? `up ${growth}%` : `down ${Math.abs(growth)}%`;
  const top = a.topItems[0]?.name ?? 'n/a';
  const fc = a.forecast?.forecast ?? [];
  const fcOrders = fc.reduce((s: number, d: Analytics) => s + (d.orders || 0), 0);

  return {
    executiveSummary: `Over ${a.period.days} days the restaurant recorded ${a.totals.orders} orders for ${money(
      a.totals.revenue,
      c,
    )} in revenue (${revTrend} vs the previous period). Average order value was ${money(a.totals.avgOrderValue, c)}.`,
    salesAnalysis: `Revenue totalled ${money(a.totals.revenue, c)} across ${a.totals.orders} orders, with ${
      a.totals.cancelled
    } cancelled. The best-selling item was ${top}${a.topItems[0] ? ` (${a.topItems[0].quantity} sold)` : ''}.`,
    peakAnalysis: `The busiest day was ${a.busiestDay?.label ?? 'n/a'} and peak hours were ${
      a.peakHours.map((h: Analytics) => hourLabel(h.hour)).join(', ') || 'n/a'
    }.`,
    forecastOutlook: fc.length
      ? `The model (${a.forecast?.model?.orders}) projects about ${fcOrders} orders over the next 7 days.`
      : 'Forecast data is not available for this period.',
    recommendations: [
      `Promote ${top} and pair it with high-margin add-ons.`,
      `Staff up for ${a.busiestDay?.label ?? 'peak days'} and the ${
        a.peakHours[0] ? hourLabel(a.peakHours[0].hour) : 'busiest'
      } rush.`,
      'Run a targeted offer on the quietest day to smooth demand.',
    ],
    _generatedBy: 'template',
  };
}

export async function generateNarrative(analytics: Analytics) {
  if (!apiKey) return templateNarrative(analytics);
  try {
    const result = await generateJson(buildPrompt(buildFacts(analytics)));
    return {
      executiveSummary: String(result.executiveSummary ?? ''),
      salesAnalysis: String(result.salesAnalysis ?? ''),
      peakAnalysis: String(result.peakAnalysis ?? ''),
      forecastOutlook: String(result.forecastOutlook ?? ''),
      recommendations: Array.isArray(result.recommendations) ? result.recommendations.map(String) : [],
      _generatedBy: 'ai',
    };
  } catch (err) {
    // Never fail the report because the AI is down — but say so in the logs.
    console.error(`[ai-report] ${modelLabel} failed, using the template narrative:`, err);
    return { ...templateNarrative(analytics), _aiError: (err as Error).message };
  }
}
