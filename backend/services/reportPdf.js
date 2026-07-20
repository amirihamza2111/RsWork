// Renders the AI business-intelligence report into a PDFKit document.
// Numbers come straight from analytics (DB-derived); only the prose is from the
// narrative (AI or template), so figures are always accurate.
//
// The document is created with { bufferPages: true } by the caller so we can add
// "Page X of Y" footers after all content is laid out.

const COLORS = {
  band: '#34506b',
  bandSub: '#cfdcea',
  bandMeta: '#aebfd2',
  ink: '#1f2d3d',
  body: '#33414f',
  muted: '#6b7a8d',
  faint: '#9aa7b4',
  rule: '#d7dee7',
  cardBg: '#f5f7fa',
  cardBorder: '#e2e8f0',
  zebra: '#f7f9fb',
  up: '#2f9e44',
  down: '#e03131',
};

const money = (value, currency) => `${Number(value || 0).toFixed(2)} ${currency}`;
const int = (value) => String(Math.round(Number(value || 0)));
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

// Growth reads honestly: a jump from nothing is "New", not a meaningless +100%.
function growthLabel(pct, previous, current) {
  if (!previous) return current > 0 ? { text: 'New this period', color: COLORS.up } : { text: '—', color: COLORS.faint };
  const up = pct >= 0;
  return { text: `${up ? '+' : ''}${pct}% vs prev.`, color: up ? COLORS.up : COLORS.down };
}

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
    ensure(46);
    doc.moveDown(0.9);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(12.5).fillColor(COLORS.ink).text(text, left, y);
    doc.moveTo(left, doc.y + 3).lineTo(right, doc.y + 3).lineWidth(0.75).strokeColor(COLORS.rule).stroke();
    doc.moveDown(0.7);
    doc.fillColor(COLORS.body);
  };

  const paragraph = (text) => {
    if (!text) return;
    ensure(30);
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(text, left, doc.y, {
      width: contentWidth,
      align: 'justify',
      lineGap: 1.5,
    });
    doc.moveDown(0.35);
  };

  const note = (text) => {
    ensure(20);
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(COLORS.muted).text(text, left, doc.y, {
      width: contentWidth,
    });
    doc.moveDown(0.35);
  };

  /* ------------------------------- Header band ------------------------------ */
  const bandH = 96;
  doc.rect(0, 0, doc.page.width, bandH).fill(COLORS.band);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(21).text(analytics.restaurant.name, left, 24, {
    width: contentWidth * 0.7,
    lineBreak: false,
    ellipsis: true,
  });
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.bandSub).text('Business Intelligence Report', left, 52);
  doc
    .fontSize(9)
    .fillColor(COLORS.bandMeta)
    .text(
      `Period: ${analytics.period.start} to ${analytics.period.end}  (${analytics.period.days} days)   ·   Generated ${new Date()
        .toISOString()
        .slice(0, 10)}`,
      left,
      70
    );
  // Source badge, right-aligned inside the band.
  const badge = narrative._generatedBy === 'ai' ? `AI narrative · ${modelLabel}` : 'Template narrative';
  doc.fontSize(8).fillColor(COLORS.bandMeta).text(badge, right - 200, 30, { width: 200, align: 'right' });

  doc.y = bandH + 20;
  doc.fillColor('#000000');

  /* -------------------------------- KPI cards ------------------------------- */
  const cards = [
    {
      label: 'Total Orders',
      value: int(analytics.totals.orders),
      delta: growthLabel(analytics.comparison.ordersGrowthPct, analytics.comparison.prevOrders, analytics.totals.orders),
    },
    {
      label: 'Revenue Collected',
      value: money(analytics.totals.revenue, currency),
      delta: growthLabel(analytics.comparison.revenueGrowthPct, analytics.comparison.prevRevenue, analytics.totals.revenue),
    },
    { label: 'Avg. Order Value', value: money(analytics.totals.avgOrderValue, currency), delta: null },
    { label: 'Cancelled', value: int(analytics.totals.cancelled), delta: null },
  ];
  const gap = 10;
  const cardW = (contentWidth - gap * (cards.length - 1)) / cards.length;
  const cardH = 60;
  const cardsTop = doc.y;
  cards.forEach((c, i) => {
    const x = left + i * (cardW + gap);
    doc.roundedRect(x, cardsTop, cardW, cardH, 6).fillAndStroke(COLORS.cardBg, COLORS.cardBorder);
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(c.label.toUpperCase(), x + 9, cardsTop + 9, {
      width: cardW - 18,
      characterSpacing: 0.3,
      lineBreak: false,
      ellipsis: true,
    });
    doc.font('Helvetica-Bold').fontSize(15).fillColor(COLORS.ink).text(c.value, x + 9, cardsTop + 23, {
      width: cardW - 18,
      lineBreak: false,
      ellipsis: true,
    });
    if (c.delta) {
      doc.font('Helvetica').fontSize(7.5).fillColor(c.delta.color).text(c.delta.text, x + 9, cardsTop + 44, {
        width: cardW - 18,
        lineBreak: false,
        ellipsis: true,
      });
    }
  });
  doc.y = cardsTop + cardH + 6;
  doc.fillColor('#000000');

  /* ---------------------------- Executive summary --------------------------- */
  heading('Executive Summary');
  paragraph(narrative.executiveSummary);

  /* --------------------------- Sales + top items ---------------------------- */
  heading('Sales Performance');
  paragraph(narrative.salesAnalysis);
  if (analytics.topItems.length) {
    ensure(24 + analytics.topItems.length * 16);
    const colName = left;
    const qtyW = contentWidth * 0.16;
    const revW = contentWidth * 0.22;
    const colQty = right - revW - qtyW;
    const colRev = right - revW;

    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.muted);
    doc.text('ITEM', colName, y, { width: contentWidth * 0.55 });
    doc.text('QTY', colQty, y, { width: qtyW, align: 'right' });
    doc.text('REVENUE', colRev, y, { width: revW, align: 'right' });
    y += 13;
    doc.moveTo(left, y - 1).lineTo(right, y - 1).lineWidth(0.5).strokeColor(COLORS.cardBorder).stroke();

    analytics.topItems.forEach((it, i) => {
      if (i % 2 === 1) doc.rect(left, y, contentWidth, 16).fill(COLORS.zebra);
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.body);
      doc.text(String(it.name), colName, y + 3, { width: contentWidth * 0.55, lineBreak: false, ellipsis: true });
      doc.text(int(it.quantity), colQty, y + 3, { width: qtyW, align: 'right' });
      doc.text(money(it.revenue, currency), colRev, y + 3, { width: revW, align: 'right' });
      y += 16;
    });
    doc.y = y + 4;
  } else {
    note('No items were sold in this period.');
  }

  /* ------------------------------- Peak times ------------------------------- */
  heading('Peak Times');
  paragraph(narrative.peakAnalysis);
  const peakHoursTxt = analytics.peakHours.length
    ? analytics.peakHours.map((h) => `${hourLabel(h.hour)} (${h.orders})`).join(',  ')
    : null;
  if (peakHoursTxt) {
    paragraph(
      `Busiest hours: ${peakHoursTxt}.   Busiest day: ${
        analytics.busiestDay && analytics.busiestDay.orders
          ? `${analytics.busiestDay.label} (${analytics.busiestDay.orders} orders)`
          : 'n/a'
      }.`
    );
  } else {
    note('Not enough order activity to identify peak times yet.');
  }

  /* ------------------------------- Forecast --------------------------------- */
  heading('7-Day Forecast');
  paragraph(narrative.forecastOutlook);
  const fc = analytics.forecast;
  const hasSignal = fc?.forecast?.some((d) => d.orders > 0 || d.revenue > 0);
  if (fc?.forecast?.length && hasSignal) {
    const ev = fc.evaluation?.orders;
    if (ev?.metrics) {
      note(
        `Model: ${fc.model?.orders}. Accuracy (orders): MAE ${ev.metrics.mae}, MAPE ${
          ev.metrics.mape ?? 'n/a'
        }%${ev.skillVsNaive != null ? `, ${Math.round(ev.skillVsNaive * 100)}% better than naive` : ''}.`
      );
    }
    ensure(24 + fc.forecast.length * 16);
    const ordW = contentWidth * 0.28;
    const revW = contentWidth * 0.28;
    const colDate = left;
    const colOrd = right - revW - ordW;
    const colRev = right - revW;

    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.muted);
    doc.text('DATE', colDate, y, { width: contentWidth * 0.4 });
    doc.text('FORECAST ORDERS', colOrd, y, { width: ordW, align: 'right' });
    doc.text('FORECAST REVENUE', colRev, y, { width: revW, align: 'right' });
    y += 13;
    doc.moveTo(left, y - 1).lineTo(right, y - 1).lineWidth(0.5).strokeColor(COLORS.cardBorder).stroke();

    fc.forecast.forEach((d, i) => {
      if (i % 2 === 1) doc.rect(left, y, contentWidth, 16).fill(COLORS.zebra);
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.body);
      doc.text(d.date, colDate, y + 3, { width: contentWidth * 0.4 });
      const ordersTxt =
        d.ordersUpper != null && d.ordersUpper !== d.orders ? `${int(d.orders)}  (${int(d.ordersLower)}–${int(d.ordersUpper)})` : int(d.orders);
      doc.text(ordersTxt, colOrd, y + 3, { width: ordW, align: 'right' });
      doc.text(money(d.revenue, currency), colRev, y + 3, { width: revW, align: 'right' });
      y += 16;
    });
    doc.y = y + 4;
  } else {
    note('Not enough sales history for a reliable forecast yet — check back after a few days of orders.');
  }

  /* ---------------------------- Recommendations ----------------------------- */
  const recs = narrative.recommendations || [];
  if (recs.length) {
    heading('Recommendations');
    recs.forEach((rec) => {
      ensure(24);
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.band).text('•', left, y, { width: 12 });
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(rec, left + 14, y, {
        width: contentWidth - 14,
        align: 'left',
        lineGap: 1,
      });
      doc.moveDown(0.35);
    });
  }

  /* -------------------------------- Footers --------------------------------- */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const fy = doc.page.height - doc.page.margins.bottom + 16;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.faint)
      .text(`${analytics.restaurant.name}  ·  RsWork`, left, fy, { width: contentWidth * 0.6, align: 'left', lineBreak: false });
    doc.text(`Page ${i + 1 - range.start} of ${range.count}`, right - 120, fy, {
      width: 120,
      align: 'right',
      lineBreak: false,
    });
  }
}

module.exports = { renderAiReport };
