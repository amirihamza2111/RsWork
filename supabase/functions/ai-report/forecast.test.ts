import { assertEquals } from 'jsr:@std/assert@1';
import { getForecast, seasonalNaiveForecast } from './forecast.ts';

const weeks = (n: number) =>
  Array.from({ length: n * 7 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 5 + i)); // 2026-01-05 is a Monday
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    return { date: d.toISOString().slice(0, 10), orders: weekend ? 20 : 10, revenue: weekend ? 200 : 100 };
  });

Deno.test('seasonal-naive projects each weekday from its own history', () => {
  const out = seasonalNaiveForecast(weeks(4), 7);
  assertEquals(out.length, 7);
  for (const p of out) {
    const dow = new Date(`${p.date}T00:00:00Z`).getUTCDay();
    assertEquals(p.orders, dow === 0 || dow === 6 ? 20 : 10);
    assertEquals(p.ordersLower, p.orders); // no variance -> tight interval
  }
});

Deno.test('forecast starts the day after the last history point', () => {
  const history = weeks(1);
  const [first] = seasonalNaiveForecast(history, 1);
  assertEquals(first.date, '2026-01-12');
});

Deno.test('falls back when the ML service is unreachable', async () => {
  const result = await getForecast(weeks(2), 3, 'http://127.0.0.1:9', 500);
  assertEquals(result.source, 'fallback');
  assertEquals(result.forecast.length, 3);
});
