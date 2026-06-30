// Renders the AI business-intelligence report into a PDFKit document.
// Numbers come straight from analytics (DB-derived); only the prose is from the
// narrative (AI or template), so figures are always accurate.

const money = (value, currency) => `${Number(value || 0).toFixed(2)} ${currency}`;
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

function renderAiReport(doc, { analytics, narrative, modelLabel }) {
  const currency = analytics.restaurant.currency;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;
  const bottom = doc.page.height - doc.page.margins.bottom;

  const ensure = (h) => {
    if (doc.y + h > bottom) doc.addPage();
  };
  const heading = (text) => {
    ensure(34);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a1a1a').text(text);
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.5).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);
    doc.fillColor('#000000');
  };
  const paragraph = (text) => {
    if (!text) return;
    ensure(40);
    doc.font('Helvetica').fontSize(10.5).fillColor('#222222').text(text, { align: 'justify' });
    doc.moveDown(0.3);
  };

  // Header
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#111111').text(analytics.restaurant.name, { align: 'center' });
  doc.font('Helvetica').fontSize(12).fillColor('#444444').text('Business Intelligence Report', { align: 'center' });
  doc
    .fontSize(9.5)
    .fillColor('#666666')
    .text(
      `Period: ${analytics.period.start} → ${analytics.period.end} (${analytics.period.days} days)  ·  Generated: ${new Date()
        .toISOString()
        .slice(0, 10)}`,
      { align: 'center' }
    );
  const badge = narrative._generatedBy === 'ai' ? `AI-generated (${modelLabel})` : 'Template narrative';
  doc.fontSize(8).fillColor('#999999').text(badge, { align: 'center' });
  doc.moveDown(0.4);

  // Executive summary
  heading('Executive Summary');
  paragraph(narrative.executiveSummary);

  // KPIs
  heading('Key Metrics');
  const sign = (n) => `${n >= 0 ? '+' : ''}${n}% vs prev`;
  const kpis = [
    ['Total Orders', String(analytics.totals.orders), sign(analytics.comparison.ordersGrowthPct)],
    ['Total Revenue', money(analytics.totals.revenue, currency), sign(analytics.comparison.revenueGrowthPct)],
    ['Avg Order Value', money(analytics.totals.avgOrderValue, currency), ''],
    ['Cancelled', String(analytics.totals.cancelled), ''],
  ];
  const colW = contentWidth / kpis.length;
  const kpiTop = doc.y;
  kpis.forEach((kpi, i) => {
    const x = left + i * colW;
    doc.font('Helvetica').fontSize(8.5).fillColor('#777777').text(kpi[0], x, kpiTop, { width: colW - 8 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111').text(kpi[1], x, kpiTop + 12, { width: colW - 8 });
    if (kpi[2]) doc.font('Helvetica').fontSize(8).fillColor('#558855').text(kpi[2], x, kpiTop + 30, { width: colW - 8 });
  });
  doc.y = kpiTop + 46;
  doc.fillColor('#000000');

  // Sales + top items
  heading('Sales Performance');
  paragraph(narrative.salesAnalysis);
  if (analytics.topItems.length) {
    ensure(20 + analytics.topItems.length * 16);
    const c1 = left, c2 = left + contentWidth * 0.6, c3 = left + contentWidth * 0.8;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333');
    const hy = doc.y;
    doc.text('Top Items', c1, hy);
    doc.text('Qty', c2, hy, { width: contentWidth * 0.18, align: 'right' });
    doc.text('Revenue', c3, hy, { width: contentWidth * 0.2, align: 'right' });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10).fillColor('#222222');
    analytics.topItems.forEach((it) => {
      const y = doc.y;
      doc.text(String(it.name), c1, y, { width: contentWidth * 0.58 });
      doc.text(String(it.quantity), c2, y, { width: contentWidth * 0.18, align: 'right' });
      doc.text(money(it.revenue, currency), c3, y, { width: contentWidth * 0.2, align: 'right' });
      doc.moveDown(0.2);
    });
  }

  // Peak times
  heading('Peak Times');
  paragraph(narrative.peakAnalysis);
  paragraph(
    `Peak hours: ${analytics.peakHours.map((h) => `${hourLabel(h.hour)} (${h.orders})`).join(', ') || 'n/a'}.  ` +
      `Busiest day: ${analytics.busiestDay ? `${analytics.busiestDay.label} (${analytics.busiestDay.orders} orders)` : 'n/a'}.`
  );

  // Forecast
  heading('7-Day Forecast');
  paragraph(narrative.forecastOutlook);
  if (analytics.forecast?.forecast?.length) {
    const f = analytics.forecast;
    const ev = f.evaluation?.orders;
    if (ev?.metrics) {
      paragraph(
        `Model: ${f.model?.orders}.  Accuracy (orders): MAE ${ev.metrics.mae}, MAPE ${
          ev.metrics.mape ?? 'n/a'
        }%${ev.skillVsNaive != null ? `, ${Math.round(ev.skillVsNaive * 100)}% better than naive` : ''}.`
      );
    }
    ensure(20 + f.forecast.length * 16);
    const c1 = left, c2 = left + contentWidth * 0.4, c3 = left + contentWidth * 0.7;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333');
    const hy = doc.y;
    doc.text('Date', c1, hy);
    doc.text('Forecast Orders', c2, hy, { width: contentWidth * 0.3, align: 'right' });
    doc.text('Forecast Revenue', c3, hy, { width: contentWidth * 0.3, align: 'right' });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10).fillColor('#222222');
    f.forecast.forEach((d) => {
      const y = doc.y;
      doc.text(d.date, c1, y, { width: contentWidth * 0.4 });
      const ordersTxt = d.ordersLower != null ? `${d.orders} (${d.ordersLower}-${d.ordersUpper})` : String(d.orders);
      doc.text(ordersTxt, c2, y, { width: contentWidth * 0.3, align: 'right' });
      doc.text(money(d.revenue, currency), c3, y, { width: contentWidth * 0.3, align: 'right' });
      doc.moveDown(0.2);
    });
  }

  // Recommendations
  heading('Recommendations');
  (narrative.recommendations || []).forEach((rec) => {
    ensure(20);
    doc.font('Helvetica').fontSize(10.5).fillColor('#222222').text(`•  ${rec}`, { indent: 4 });
    doc.moveDown(0.15);
  });
}

module.exports = { renderAiReport };
