// Renders the AI business-intelligence report. Numbers come straight from the
// SQL analytics; only the prose comes from the narrative (AI or template).
import { createPdf, downloadBlob, type PdfDoc } from './core'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AiReport {
  analytics: any
  narrative: any
  modelLabel: string
}

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
}

const amount = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (value: number, currency: string) => `${amount.format(Number(value || 0))} ${currency}`
const int = (value: number) => Math.round(Number(value || 0)).toLocaleString('en-US')
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`
// "2026-10-11" -> "11 Oct 2026" (dates are calendar days, so format them in UTC).
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

// The standard PDF fonts only cover Latin-1 / WinAnsi. Language models like
// typographic characters (non-breaking hyphens, narrow spaces…) that would be
// dropped silently, so map them to ones the font can draw.
const pdfText = (text: unknown) =>
  String(text ?? '')
    .replace(/[‐‑‒−]/g, '-')
    .replace(/[     ]/g, ' ')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/≈/g, '~')
    .replace(/→/g, '->')

const MODEL_NAMES: Record<string, string> = {
  'holt-winters-additive': 'Holt-Winters (trend + weekly seasonality)',
  'holt-linear': "Holt's linear trend",
  'seasonal-naive': 'same-weekday average',
}

// "groq:openai/gpt-oss-120b" -> "gpt-oss-120b via Groq"
function modelBadge(label: string) {
  const [provider, model = ''] = label.split(':')
  const name = model.split('/').pop() || label
  return `AI analysis · ${name}${provider ? ` via ${provider.charAt(0).toUpperCase()}${provider.slice(1)}` : ''}`
}

// Growth reads honestly: a jump from nothing is "New", not a meaningless +100%.
function growthLabel(pct: number, previous: number, current: number) {
  if (!previous) return current > 0 ? { text: 'New this period', color: COLORS.up } : { text: '—', color: COLORS.faint }
  const up = pct >= 0
  return { text: `${up ? '+' : ''}${pct}% vs prev.`, color: up ? COLORS.up : COLORS.down }
}

function render(doc: PdfDoc, { analytics, narrative, modelLabel }: AiReport) {
  const currency = analytics.restaurant.currency
  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const contentWidth = right - left
  const bottom = doc.page.height - doc.page.margins.bottom

  const ensure = (h: number) => {
    if (doc.y + h > bottom) doc.addPage()
  }
  // Keep a heading together with at least a few lines of what follows it.
  const heading = (text: string) => {
    ensure(80)
    doc.moveDown(0.9)
    doc.font('Helvetica-Bold').fontSize(12.5).fillColor(COLORS.ink).text(text, left, doc.y)
    doc.moveTo(left, doc.y + 3).lineTo(right, doc.y + 3).lineWidth(0.75).strokeColor(COLORS.rule).stroke()
    doc.moveDown(0.7)
    doc.fillColor(COLORS.body)
  }
  const paragraph = (text?: string) => {
    if (!text) return
    ensure(30)
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(pdfText(text), left, doc.y, {
      width: contentWidth,
      align: 'justify',
      lineGap: 1.5,
    })
    doc.moveDown(0.35)
  }
  const note = (text: string) => {
    ensure(20)
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(COLORS.muted).text(pdfText(text), left, doc.y, { width: contentWidth })
    doc.moveDown(0.35)
  }
  const table = (headers: [string, number, string?][], rows: string[][]) => {
    ensure(24 + rows.length * 16)
    const xs: number[] = []
    let x = right
    for (let i = headers.length - 1; i >= 1; i -= 1) {
      x -= headers[i][1]
      xs[i] = x
    }
    xs[0] = left
    let y = doc.y
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.muted)
    headers.forEach(([label, width, align], i) => doc.text(label, xs[i], y, { width, align: align ?? 'left' }))
    y += 13
    doc.moveTo(left, y - 1).lineTo(right, y - 1).lineWidth(0.5).strokeColor(COLORS.cardBorder).stroke()
    rows.forEach((row, r) => {
      if (r % 2 === 1) doc.rect(left, y, contentWidth, 16).fill(COLORS.zebra)
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.body)
      row.forEach((cell, i) =>
        doc.text(pdfText(cell), xs[i], y + 3, { width: headers[i][1], align: headers[i][2] ?? 'left', lineBreak: false, ellipsis: true })
      )
      y += 16
    })
    doc.y = y + 4
  }

  /* Header band */
  const bandH = 96
  doc.rect(0, 0, doc.page.width, bandH).fill(COLORS.band)
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(21).text(analytics.restaurant.name, left, 24, {
    width: contentWidth * 0.7,
    lineBreak: false,
    ellipsis: true,
  })
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.bandSub).text('Business Intelligence Report', left, 52)
  doc
    .fontSize(9)
    .fillColor(COLORS.bandMeta)
    .text(
      `${day(analytics.period.start)} – ${day(analytics.period.end)}  (${analytics.period.days} days)   ·   Generated ${day(
        new Date().toISOString().slice(0, 10)
      )}`,
      left,
      70
    )
  const badge = narrative._generatedBy === 'ai' ? modelBadge(modelLabel) : 'Automated summary'
  doc.fontSize(8).fillColor(COLORS.bandMeta).text(badge, right - 200, 30, { width: 200, align: 'right' })
  doc.y = bandH + 20

  /* KPI cards */
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
    {
      label: 'Cancelled',
      value: int(analytics.totals.cancelled),
      delta: analytics.totals.orders
        ? {
            text: `${((analytics.totals.cancelled / analytics.totals.orders) * 100).toFixed(1)}% of orders`,
            color: COLORS.muted,
          }
        : null,
    },
  ]
  const gap = 10
  const cardW = (contentWidth - gap * (cards.length - 1)) / cards.length
  const cardH = 60
  const cardsTop = doc.y
  cards.forEach((c, i) => {
    const x = left + i * (cardW + gap)
    doc.roundedRect(x, cardsTop, cardW, cardH, 6).fillAndStroke(COLORS.cardBg, COLORS.cardBorder)
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(c.label.toUpperCase(), x + 9, cardsTop + 9, {
      width: cardW - 18,
      characterSpacing: 0.3,
      lineBreak: false,
      ellipsis: true,
    })
    // Shrink long values (large revenues) so they stay on one line; PDFKit's
    // line wrapper breaks text that comes close to the edge, hence the slack.
    let size = 15
    doc.font('Helvetica-Bold').fontSize(size)
    while (size > 9 && doc.widthOfString(c.value) > cardW - 26) doc.fontSize((size -= 0.5))
    doc.fillColor(COLORS.ink).text(c.value, x + 9, cardsTop + 23 + (15 - size) / 2, {
      width: cardW - 18,
      lineBreak: false,
      ellipsis: true,
    })
    if (c.delta) {
      doc.font('Helvetica').fontSize(7.5).fillColor(c.delta.color).text(c.delta.text, x + 9, cardsTop + 44, {
        width: cardW - 18,
        lineBreak: false,
        ellipsis: true,
      })
    }
  })
  doc.y = cardsTop + cardH + 6

  heading('Executive Summary')
  paragraph(narrative.executiveSummary)

  heading('Sales Performance')
  paragraph(narrative.salesAnalysis)
  if (analytics.topItems.length) {
    table(
      [
        ['TOP ITEMS BY REVENUE', contentWidth * 0.55],
        ['QTY SOLD', contentWidth * 0.16, 'right'],
        ['REVENUE', contentWidth * 0.22, 'right'],
      ],
      analytics.topItems.map((it: any) => [String(it.name), int(it.quantity), money(it.revenue, currency)])
    )
  } else {
    note('No items were sold in this period.')
  }

  heading('Peak Times')
  paragraph(narrative.peakAnalysis)
  if (analytics.peakHours.length) {
    const hours = analytics.peakHours.map((h: any) => `${hourLabel(h.hour)} (${h.orders})`).join(',  ')
    const busiest =
      analytics.busiestDay && analytics.busiestDay.orders
        ? `${analytics.busiestDay.label} (${analytics.busiestDay.orders} orders)`
        : 'n/a'
    paragraph(`Busiest hours: ${hours}.   Busiest day: ${busiest}.`)
  } else {
    note('Not enough order activity to identify peak times yet.')
  }

  heading('7-Day Forecast')
  paragraph(narrative.forecastOutlook)
  const fc = analytics.forecast
  const hasSignal = fc?.forecast?.some((d: any) => d.orders > 0 || d.revenue > 0)
  if (fc?.forecast?.length && hasSignal) {
    // Accuracy in plain words for an owner, not MAE/MAPE jargon.
    const ev = fc.evaluation?.orders
    const modelName = MODEL_NAMES[fc.model?.orders] ?? fc.model?.orders ?? 'statistical model'
    let accuracy = `Forecast model: ${modelName}.`
    if (ev?.metrics?.mae != null) {
      accuracy += ` Back-tested on past weeks, it is typically within ±${Number(ev.metrics.mae).toFixed(1)} orders a day`
      if (ev.metrics.mape != null) accuracy += ` (${Number(ev.metrics.mape).toFixed(1)}%)`
      if (ev.skillVsNaive != null && ev.skillVsNaive > 0) {
        accuracy += `, ${Math.round(ev.skillVsNaive * 100)}% more accurate than repeating last week`
      }
      accuracy += '.'
    }
    note(`${accuracy} Ranges in brackets are the likely low–high number of orders.`)
    table(
      [
        ['DAY', contentWidth * 0.4],
        ['EXPECTED ORDERS', contentWidth * 0.28, 'right'],
        ['EXPECTED REVENUE', contentWidth * 0.28, 'right'],
      ],
      fc.forecast.map((d: any) => [
        weekday(d.date),
        d.ordersUpper != null && d.ordersUpper !== d.orders
          ? `${int(d.orders)}  (${int(d.ordersLower)}–${int(d.ordersUpper)})`
          : int(d.orders),
        money(d.revenue, currency),
      ])
    )
  } else {
    note('Not enough sales history for a reliable forecast yet — check back after a few days of orders.')
  }

  const recs: string[] = narrative.recommendations || []
  if (recs.length) {
    heading('Recommendations')
    for (const rec of recs) {
      ensure(24)
      const y = doc.y
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.band).text('•', left, y, { width: 12 })
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.body).text(pdfText(rec), left + 14, y, {
        width: contentWidth - 14,
        lineGap: 1,
      })
      doc.moveDown(0.35)
    }
  }

  /* Footers: "Page X of Y" once everything is laid out, so the page count is
     whatever the content needed. The footer sits inside the bottom margin;
     PDFKit treats text below the margin as overflow and would start a new
     (blank) page for it, so the margin is lifted while the footer is drawn. */
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i)
    const margin = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    const fy = doc.page.height - margin + 18
    doc.moveTo(left, fy - 6).lineTo(right, fy - 6).lineWidth(0.5).strokeColor(COLORS.rule).stroke()
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.faint)
      .text(`${pdfText(analytics.restaurant.name)}  ·  Business Intelligence Report  ·  Generated with RsWork`, left, fy, {
        width: contentWidth * 0.75,
        lineBreak: false,
      })
    doc.text(`Page ${i + 1 - range.start} of ${range.count}`, right - 100, fy, { width: 100, align: 'right', lineBreak: false })
    doc.page.margins.bottom = margin
  }
}

export async function downloadAiReportPdf(report: AiReport) {
  const { doc, done } = await createPdf({ size: 'A4', margin: 50, bufferPages: true })
  render(doc, report)
  doc.end()
  downloadBlob(await done, `rswork-report-${new Date().toISOString().slice(0, 10)}.pdf`)
}
