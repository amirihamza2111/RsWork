const aiClient = require('./aiClient');

const money = (value, currency) => `${Number(value || 0).toFixed(2)} ${currency}`;
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

// Compact, factual brief handed to the model — only real numbers, no prose.
function buildFacts(a) {
  const c = a.restaurant.currency;
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
    topItems: a.topItems.map((i) => `${i.name}: ${i.quantity} sold, ${money(i.revenue, c)}`),
    peakHours: a.peakHours.map((h) => `${hourLabel(h.hour)} (${h.orders} orders)`),
    busiestDay: a.busiestDay ? `${a.busiestDay.label} (${a.busiestDay.orders} orders)` : 'n/a',
    quietestDay: (() => {
      const sorted = [...(a.peakDays || [])].sort((x, y) => x.orders - y.orders);
      return sorted[0] ? `${sorted[0].label} (${sorted[0].orders} orders)` : 'n/a';
    })(),
    forecastNext7Days: a.forecast?.forecast
      ? a.forecast.forecast.map((d) => `${d.date}: ~${d.orders} orders, ~${money(d.revenue, c)}`)
      : 'unavailable',
    forecastModel: a.forecast?.model?.orders || 'n/a',
  };
}

const SYSTEM = `You are a restaurant business-intelligence analyst. Write a concise, professional report for the restaurant owner. Use ONLY the numbers provided — never invent figures. Be specific and actionable. Keep each section tight.`;

function buildPrompt(facts) {
  return `Here is the restaurant's performance data (JSON):

${JSON.stringify(facts, null, 2)}

Write the report as a JSON object with exactly these string fields:
- "executiveSummary": 2-3 sentences summarizing overall performance and the trend vs the previous period.
- "salesAnalysis": one paragraph on orders, revenue, average order value, and the best-selling items.
- "peakAnalysis": one paragraph on the busiest hours and days, and the quietest day.
- "forecastOutlook": one paragraph interpreting the 7-day forecast (mention it is model-based).
- "recommendations": an array of 3-5 short, concrete action items grounded in the data.

Return ONLY the JSON object.`;
}

// Deterministic narrative used when the AI provider is unavailable or errors.
function templateNarrative(a) {
  const c = a.restaurant.currency;
  const revTrend =
    a.comparison.revenueGrowthPct >= 0
      ? `up ${a.comparison.revenueGrowthPct}%`
      : `down ${Math.abs(a.comparison.revenueGrowthPct)}%`;
  const top = a.topItems[0]?.name || 'n/a';
  const fc = a.forecast?.forecast || [];
  const fcOrders = fc.reduce((s, d) => s + (d.orders || 0), 0);

  return {
    executiveSummary: `Over ${a.period.days} days the restaurant recorded ${a.totals.orders} orders for ${money(
      a.totals.revenue,
      c
    )} in revenue (${revTrend} vs the previous period). Average order value was ${money(
      a.totals.avgOrderValue,
      c
    )}.`,
    salesAnalysis: `Revenue totalled ${money(a.totals.revenue, c)} across ${a.totals.orders} orders, with ${
      a.totals.cancelled
    } cancelled. The best-selling item was ${top}${
      a.topItems[0] ? ` (${a.topItems[0].quantity} sold)` : ''
    }.`,
    peakAnalysis: `The busiest day was ${a.busiestDay?.label || 'n/a'} and peak hours were ${
      a.peakHours.map((h) => hourLabel(h.hour)).join(', ') || 'n/a'
    }.`,
    forecastOutlook: fc.length
      ? `The model (${a.forecast?.model?.orders}) projects about ${fcOrders} orders over the next 7 days.`
      : 'Forecast data is not available for this period.',
    recommendations: [
      `Promote ${top} and pair it with high-margin add-ons.`,
      `Staff up for ${a.busiestDay?.label || 'peak days'} and the ${
        a.peakHours[0] ? hourLabel(a.peakHours[0].hour) : 'busiest'
      } rush.`,
      'Run a targeted offer on the quietest day to smooth demand.',
    ],
    _generatedBy: 'template',
  };
}

async function generateNarrative(analytics) {
  if (!aiClient.isConfigured()) {
    return templateNarrative(analytics);
  }
  try {
    const facts = buildFacts(analytics);
    const result = await aiClient.generateJson({ system: SYSTEM, prompt: buildPrompt(facts) });
    return {
      executiveSummary: String(result.executiveSummary || ''),
      salesAnalysis: String(result.salesAnalysis || ''),
      peakAnalysis: String(result.peakAnalysis || ''),
      forecastOutlook: String(result.forecastOutlook || ''),
      recommendations: Array.isArray(result.recommendations)
        ? result.recommendations.map(String)
        : [],
      _generatedBy: 'ai',
    };
  } catch (err) {
    // Never fail the report because the AI is down — fall back to the template.
    return { ...templateNarrative(analytics), _generatedBy: 'template', _aiError: err.message };
  }
}

module.exports = { generateNarrative, templateNarrative };
